// Photo Locker, the sync engine (the IO). The decisions are pure and tested in
// core/vaultSync.ts; this file only carries them out:
//   1. read this device's items, the synced index and the Drive folder's list;
//   2. link items Drive already has (never a second upload), upload the rest
//      (resumable, with progress, one retry, picks up again after a reload),
//      download photos this device lacks (videos and files on a tap, or
//      "Download all"), drop items deleted on another device;
//   3. save the index (joined with any save from another device in between).
// Runs when Photo Locker is open, after something is added, and once a while
// after the app starts when uploads are waiting.
import { FOOD_TAG, PROGRESS_TAG, cleanFolderPath, deletePlan, folderMovePlan, foodFolderPath, foodPhotoName, foodPhotoNumber, notBackedUpLine, planSync, driveProps, type IndexEntry, type SyncPlan, type VaultIndex } from '@core/vaultSync'
import { life } from '../bridge'
import { createDrive, DriveError, type DriveApi, type DriveFolder } from './driveApi'
import { thumbOf } from './mediaPrep'
import { getItem, listItems, metaOf, patchItem, putItem, removeItem, type VaultItem } from './vaultStore'

export interface SyncState {
  running: boolean
  /** "Uploading front.jpg", "Downloading 2 of 5"… */
  line: string | null
  done: number
  total: number
  lastSync: number | null
  error: string | null
  notBackedUp: SyncPlan['notBackedUp']
  /** Drive allowed for this sign-in (null = not known yet). */
  connected: boolean | null
  folder: { id: string; name: string } | null
  /** Bytes kept in the Locker (from the index) and Drive's own numbers. */
  storage: { locker: number; usage: number; limit: number } | null
}

const LAST_KEY = 'ls.vaultLastSync'
const readLast = () => {
  try {
    return Number(localStorage.getItem(LAST_KEY)) || null
  } catch {
    return null
  }
}

let state: SyncState = { running: false, line: null, done: 0, total: 0, lastSync: readLast(), error: null, notBackedUp: { here: 0, elsewhere: 0, bytes: 0 }, connected: null, folder: null, storage: null }
const listeners = new Set<(s: SyncState) => void>()
const set = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch }
  for (const l of listeners) l(state)
}
export const syncState = () => state
export function onSync(fn: (s: SyncState) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// The Drive key: from our server, kept in memory only, renewed 2 minutes before it ends.
let key: { token: string; expiresAt: number } | null = null
async function token(): Promise<string> {
  if (key && key.expiresAt - Date.now() > 120_000) return key.token
  if (!life.google?.driveToken) throw new DriveError('Google Drive works in the website and the desktop app')
  key = await life.google.driveToken()
  return key.token
}
let drive: DriveApi | null = null
const api = () => (drive ??= createDrive(token))

/** Is Drive allowed for this sign-in? (asks the server's status once in a while) */
export async function checkConnected(): Promise<boolean> {
  try {
    const st = await life.google?.status()
    const on = !!(st?.connected && st.drive)
    set({ connected: on })
    return on
  } catch {
    set({ connected: false })
    return false
  }
}

const lockerBytes = (ix: VaultIndex) => Object.values(ix.items).reduce((t, e) => t + (e.deletedAt ? 0 : e.sizeBytes), 0)

async function saveIndex(ix: VaultIndex): Promise<VaultIndex> {
  return life.vault ? life.vault.saveIndex(ix) : ix
}

let running: Promise<void> | null = null
let again = false

/** One sync pass (a second call while one runs waits for it and runs once more). */
export function syncNow(opts: { downloadAll?: boolean; ids?: string[] } = {}): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = pass(opts)
    .catch((e) => set({ error: (e as Error).message || 'Sync failed' }))
    .finally(() => {
      running = null
      set({ running: false, line: null, done: 0, total: 0 })
      if (again) {
        again = false
        void syncNow()
      }
    })
  return running
}

async function pass(opts: { downloadAll?: boolean; ids?: string[] }) {
  if (!life.vault) return
  set({ running: true, error: null, line: 'Checking…' })
  // Telegram food photos the server holds come in first (they go up with everything else).
  const foodError = await pullFoodInbox().then(() => null, (e) => `Food photos from Telegram could not be fetched: ${(e as Error).message}`)
  let index = await life.vault.index()
  const connected = state.connected ?? (await checkConnected())
  set({ folder: index.folder })
  let remote = null
  let driveError: string | null = null
  let subFolders = new Map<string, string>()
  if (connected && index.folder) {
    try {
      // The folder and the app's own sub-folders in it (Food/2026-11): a food photo there is not uploaded again.
      const tree = await api().listTree(index.folder.id)
      remote = tree.files
      subFolders = tree.folders
    } catch (e) {
      driveError = (e as Error).message
    }
  }
  const local = await listItems()
  const now = Date.now()
  const plan = planSync({ local: local.map(metaOf), index, remote, folderId: index.folder?.id ?? null, now })
  index = plan.index
  for (const id of plan.drop) await removeItem(id)
  for (const e of plan.learn) {
    const { deletedAt: _d, ...rest } = e
    await putItem({ ...rest, updatedAt: e.updatedAt }, true)
  }
  for (const a of plan.adopt) await patchItem(a.id, { driveFileId: a.fileId, driveFolderId: a.folderId, syncedAt: now, upload: undefined }, true)
  // A food photo another device already put in Drive: the server's copy can go.
  const adoptedFood = plan.adopt.map((a) => a.id).filter((id) => foodPhotoNumber(id))
  if (adoptedFood.length) await life.google?.foodInboxDone?.(adoptedFood).catch(() => null)
  // Uploads, one at a time.
  let i = 0
  let failed = 0
  const uploadedFood: string[] = []
  for (const id of plan.uploads) {
    i++
    const it = await getItem(id)
    if (!it?.blob || !index.folder) continue
    set({ line: `Uploading ${it.name} (${i} of ${plan.uploads.length})`, done: 0, total: it.sizeBytes })
    try {
      const target = await folderFor(it, index.folder.id, subFolders)
      const f = await upload(it, target)
      await patchItem(id, { driveFileId: f.fileId, driveFolderId: target, syncedAt: Date.now(), upload: undefined }, true)
      index.items[id] = { ...(index.items[id] ?? toIndex(it)), driveFileId: f.fileId, driveFolderId: target, updatedAt: Date.now() }
      if (foodPhotoNumber(id)) uploadedFood.push(id)
      plan.notBackedUp.here = Math.max(0, plan.notBackedUp.here - 1)
      plan.notBackedUp.bytes = Math.max(0, plan.notBackedUp.bytes - it.sizeBytes)
    } catch (e) {
      failed++
      driveError = (e as Error).message
    }
  }
  // Downloads: photos by themselves; videos and files when asked.
  const want = plan.downloads.filter((d) => opts.downloadAll || opts.ids?.includes(d.id) || (d.kind === 'photo' && !opts.ids))
  let n = 0
  for (const d of want) {
    n++
    const it = await getItem(d.id)
    if (!it) continue
    set({ line: `Downloading ${it.name} (${n} of ${want.length})`, done: 0, total: d.sizeBytes })
    try {
      const blob = await api().download(d.fileId, (done, total) => set({ done, total }), it.mime)
      const thumb = it.thumb ?? (await thumbOf(blob, it.kind).catch(() => null)) ?? undefined
      await patchItem(d.id, { blob, thumb, removedHere: undefined, driveFileId: d.fileId, syncedAt: Date.now() }, true)
    } catch (e) {
      driveError = (e as Error).message
    }
  }
  index = await saveIndex(index)
  // In Drive now: the server erases the photos it held for us (erase-after-copy).
  if (uploadedFood.length) await life.google?.foodInboxDone?.(uploadedFood).catch(() => null)
  const fine = !driveError && connected && !!index.folder
  if (fine || remote) {
    try {
      localStorage.setItem(LAST_KEY, String(Date.now()))
    } catch {
      /* fine */
    }
  }
  let storage = state.storage
  if (connected && index.folder && remote) storage = { locker: lockerBytes(index), ...(await api().about().catch(() => ({ usage: 0, limit: 0 }))) }
  set({ lastSync: fine || remote ? Date.now() : state.lastSync, error: failed ? `${failed} upload${failed > 1 ? 's' : ''} did not finish: ${driveError}` : driveError ?? foodError, notBackedUp: plan.notBackedUp, folder: index.folder, storage: storage ?? (index.folder ? { locker: lockerBytes(index), usage: 0, limit: 0 } : null) })
  window.dispatchEvent(new CustomEvent('life-vault-changed', { detail: { fromSync: true } }))
}

const toIndex = (it: VaultItem): IndexEntry => ({ id: it.id, kind: it.kind, name: it.name, tags: it.tags, takenAt: it.takenAt, sizeBytes: it.sizeBytes, mime: it.mime, updatedAt: it.updatedAt })

/** Uploads one item, picking up a session from before a reload; a dead session starts over once. */
async function upload(it: VaultItem, folderId: string) {
  const d = api()
  const progress = (done: number, total: number) => set({ done, total })
  let url = it.upload?.folderId === folderId && Date.now() - it.upload.at < 6 * 86400_000 ? it.upload.url : null
  for (let tries = 0; tries < 2; tries++) {
    if (!url) {
      url = await d.startUpload({ name: it.name, mime: it.mime, size: it.blob!.size, folderId, appProperties: driveProps(it) })
      await patchItem(it.id, { upload: { url, folderId, at: Date.now() } }, true)
    }
    try {
      return await d.resumeUpload(url, it.blob!, progress)
    } catch (e) {
      // Google forgot the session (404/410): start a fresh one. Anything else: one more try from where it stopped.
      if (e instanceof DriveError && (e.status === 404 || e.status === 410)) url = null
      if (tries === 1) throw e
    }
  }
  throw new DriveError('Upload failed')
}

/** Adds items (already prepared) and syncs. */
export async function addItems(items: VaultItem[]): Promise<void> {
  for (const it of items) await putItem(it)
  if (life.vault) await life.vault.saveIndex({ v: 1, folder: (await life.vault.index()).folder, items: Object.fromEntries(items.map((it) => [it.id, toIndex(it)])) })
  void syncNow()
}

/** Edits the name or tags (on every device). */
export async function editItem(id: string, patch: { name?: string; tags?: string[] }): Promise<void> {
  const it = await patchItem(id, { ...patch, updatedAt: Date.now() })
  if (it && life.vault) await life.vault.saveIndex({ v: 1, folder: (await life.vault.index()).folder, items: { [id]: toIndex(it) } })
}

/** Deletes: everywhere (Drive's bin + a tombstone for every device) or only from this device. */
export async function deleteItem(id: string, everywhere: boolean): Promise<void> {
  const ix = life.vault ? await life.vault.index() : null
  const local = await getItem(id)
  const d = deletePlan(ix?.items[id], local ? metaOf(local) : undefined, everywhere, Date.now())
  if (d.trashFileId) await api().trash(d.trashFileId)
  // A progress photo is also in Body's own store: it goes from there too (else it would come back in).
  await import('../body/bodyPhotos').then((m) => m.deleteOwnPhoto(id)).catch(() => {})
  if (d.removeLocal === 'all') await removeItem(id)
  else await patchItem(id, { blob: undefined, removedHere: true })
  if (d.entry && ix && life.vault) await life.vault.saveIndex({ v: 1, folder: ix.folder, items: { [id]: d.entry } })
  void syncNow()
}

/** Fetches one item's file now (a video or a file, or one removed from this device). */
export async function downloadOne(id: string): Promise<void> {
  await patchItem(id, { removedHere: undefined }, true)
  await syncNow({ ids: [id] })
  const it = await getItem(id)
  if (!it?.blob) throw new Error(state.error || 'It could not be downloaded: try again')
}

export const listDriveFolders = () => api().listFolders()

/**
 * Picks the Drive folder: a new one (made by the app, so drive.file can use it)
 * or one the app made before. Files already in the old folder are MOVED there
 * (no re-upload), so the Locker keeps one home and no copies.
 */
export async function chooseFolder(pick: { create: string } | DriveFolder): Promise<DriveFolder> {
  if (!life.vault) throw new Error('Photo Locker is not ready')
  const d = api()
  const folder = 'create' in pick ? await d.createFolder(pick.create) : pick
  const ix = await life.vault.index()
  const old = ix.folder?.id ?? null
  if (old && old !== folder.id) {
    set({ running: true, line: 'Moving your files to the new folder…' })
    try {
      const moves = folderMovePlan(await d.listFolder(old), old, folder.id)
      let k = 0
      for (const m of moves) {
        set({ line: `Moving to ${folder.name} (${++k} of ${moves.length})` })
        await d.move(m.fileId, m.from, folder.id)
      }
    } finally {
      set({ running: false, line: null })
    }
  }
  // Every item's folder is re-read from Drive on the next sync.
  await life.vault.saveIndex({ ...ix, folder: { id: folder.id, name: folder.name } })
  set({ folder })
  void syncNow()
  return folder
}

/** The warning line for the page. */
export const warningLine = (s: SyncState) => notBackedUpLine(s.notBackedUp, !!s.connected && !!s.folder)

type BodyPhoto = { id: string; day: string; at: number; blob: Blob; w: number; h: number }
const fromBodyPhoto = (p: BodyPhoto): VaultItem => ({ id: p.id.replace(/[^A-Za-z0-9_-]/g, '-'), kind: 'photo', name: `Progress ${p.day}.jpg`, tags: [PROGRESS_TAG], takenAt: p.at, sizeBytes: p.blob.size, mime: p.blob.type || 'image/jpeg', blob: p.blob, w: p.w, h: p.h, updatedAt: p.at })

/** A progress photo from Body (same id in both stores, so it is never shown twice). */
export async function addProgressPhoto(p: BodyPhoto): Promise<void> {
  const it = fromBodyPhoto(p)
  if (await getItem(it.id)) return
  it.thumb = (await thumbOf(p.blob, 'photo').catch(() => null)) ?? undefined
  await addItems([it])
}

/** Progress photos taken on this device before Photo Locker existed go into it (on this device; Drive once connected). */
export async function importProgressPhotos(): Promise<number> {
  const { listOwnPhotos } = await import('../body/bodyPhotos')
  const have = new Set((await listItems()).map((it) => it.id))
  const missing = (await listOwnPhotos()).filter((p) => !have.has(p.id))
  const items: VaultItem[] = []
  for (const p of missing) items.push({ ...fromBodyPhoto(p), thumb: (await thumbOf(p.blob, 'photo').catch(() => null)) ?? undefined })
  if (items.length) await addItems(items)
  return items.length
}

let booted = false
/** Once after the app starts: if uploads are waiting and Drive is set up, carry on (a reload mid-upload resumes). */
export async function vaultBoot(): Promise<void> {
  if (booted || !life.vault || !life.google?.driveToken) return
  booted = true
  // Telegram food photos held on the server: now, and every 30 minutes while the app is open.
  const food = async () => ((await pullFoodInbox().catch(() => 0)) > 0 && (await life.vault!.index()).folder ? void syncNow() : undefined)
  setInterval(() => void food(), 30 * 60_000)
  if (await pullFoodInbox().catch(() => 0)) return void food()
  const items = await listItems()
  if (!items.some((it) => it.blob && !it.driveFileId)) return
  const ix = await life.vault.index()
  if (ix.folder) void syncNow()
}

// ---- Telegram food photos (held on the server as file ids, 3 days at most: bots/foodLocker.ts) ----

/** The Drive folder an item goes to: the Locker's folder, or a sub-folder in it (made once, found again by path). */
async function folderFor(it: VaultItem, rootId: string, known: Map<string, string>): Promise<string> {
  const path = cleanFolderPath(it.folderPath)
  if (!path) return rootId
  let parent = rootId
  let sofar = ''
  for (const part of path.split('/')) {
    sofar = sofar ? `${sofar}/${part}` : part
    let id = known.get(sofar)
    if (!id) {
      id = (await api().createFolder(part, parent)).id
      known.set(sofar, id)
    }
    parent = id
  }
  return parent
}

const b64ToBlob = (data: string, mime: string) => {
  const bin = atob(data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

let pulling: Promise<number> | null = null
/**
 * Brings the food photos the server holds into Photo Locker on this device
 * (tag `food`, the meal type, folder Food/YYYY-MM, named by date, time and
 * meal). Each is fetched once; one already here or already in Drive is not
 * fetched again (and is erased on the server once it is in Drive). Returns how
 * many came in. The sync pass then uploads them and erases them on the server.
 */
export function pullFoodInbox(): Promise<number> {
  if (pulling) return pulling
  pulling = (async () => {
    const g = life.google
    if (!g?.foodInbox || !g.foodInboxGet || !life.vault) return 0
    const held = await g.foodInbox()
    if (!held.length) return 0
    const ix = await life.vault.index()
    const added: VaultItem[] = []
    const inDrive: string[] = []
    for (const h of held.slice(0, 20)) {
      const have = await getItem(h.id)
      if (have || ix.items[h.id]) {
        if (have?.driveFileId || ix.items[h.id]?.driveFileId) inDrive.push(h.id)
        continue
      }
      const got = await g.foodInboxGet(h.id).catch(() => null)
      if (!got) continue
      const blob = b64ToBlob(got.data, got.mime)
      const at = Number(h.at) || Date.now()
      const tags = [FOOD_TAG, ...(h.type ? [h.type] : [])]
      added.push({ id: h.id, kind: 'photo', name: foodPhotoName(at, h.type, h.name, foodPhotoNumber(h.id)), tags, takenAt: at, sizeBytes: blob.size, mime: got.mime, blob, thumb: (await thumbOf(blob, 'photo').catch(() => null)) ?? undefined, folderPath: foodFolderPath(at), updatedAt: Date.now() })
    }
    if (inDrive.length) await g.foodInboxDone?.(inDrive).catch(() => null)
    if (added.length) {
      for (const it of added) await putItem(it)
      await life.vault.saveIndex({ v: 1, folder: ix.folder, items: Object.fromEntries(added.map((it) => [it.id, toIndex(it)])) })
      window.dispatchEvent(new CustomEvent('life-vault-changed', { detail: { fromSync: true } }))
    }
    return added.length
  })().finally(() => {
    pulling = null
  })
  return pulling
}

/**
 * Meal photos taken or dropped in the app go into Photo Locker too (tag
 * `food`, Food/YYYY-MM, named by date, time and meal), like the Telegram ones,
 * and up to Drive with the usual sync. Returns the Locker ids for the meal.
 */
export async function addFoodPhotos(photos: { mime: string; data: string }[], ids: string[], at: number, type?: string, name?: string): Promise<string[]> {
  const items: VaultItem[] = []
  for (let i = 0; i < Math.min(photos.length, ids.length); i++) {
    if (await getItem(ids[i]).catch(() => undefined)) continue
    const blob = b64ToBlob(photos[i].data, photos[i].mime)
    items.push({ id: ids[i], kind: 'photo', name: foodPhotoName(at, type, name, i + 1), tags: [FOOD_TAG, ...(type ? [type] : [])], takenAt: at, sizeBytes: blob.size, mime: photos[i].mime, blob, thumb: (await thumbOf(blob, 'photo').catch(() => null)) ?? undefined, folderPath: foodFolderPath(at), updatedAt: Date.now() })
  }
  if (items.length) await addItems(items)
  return ids.slice(0, photos.length)
}

/** The Locker items (with their thumbnails) for a meal's photo ids, on this device. */
export async function mealPhotos(ids: string[]): Promise<VaultItem[]> {
  const out: VaultItem[] = []
  for (const id of ids) {
    const it = await getItem(id).catch(() => undefined)
    if (it) out.push(it)
  }
  return out
}
