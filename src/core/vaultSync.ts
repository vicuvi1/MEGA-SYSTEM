// Photo Locker (docs/areas/vault.md): the pure decisions. Progress photos,
// short videos and private files are kept on every device (IndexedDB) and
// backed up to a folder in the owner's own Google Drive. NOT encrypted (the
// owner's choice): anyone with access to his Drive can see them.
//
// Three views of the same items meet here:
//   - local: what this device holds (with or without the file itself);
//   - index: the synced setting `vault_index`, metadata only (no image data),
//     so every device knows which items exist and which are backed up;
//   - remote: the files in the chosen Drive folder, each carrying the item's
//     app id in Drive appProperties (`lsId`), so nothing is ever uploaded twice.
// Pure: no DOM, no network, no database.
import { calendarDay } from './dates'

export type VaultKind = 'photo' | 'video' | 'file'

/** Limits (the owner's choices). */
export const VIDEO_MAX_SECONDS = 60
export const VIDEO_MAX_BYTES = 150 * 1024 * 1024
export const FILE_MAX_BYTES = 200 * 1024 * 1024
/** A photo is made smaller before it is kept: longest side. */
export const PHOTO_MAX_SIDE = 2000
/** The synced index stays small: metadata only. */
export const INDEX_MAX_ITEMS = 3000
export const INDEX_MAX_BYTES = 400_000
export const NAME_MAX = 80
export const TAG_MAX = 24
export const TAGS_MAX = 8
/** Resumable uploads go in pieces of this size (a multiple of 256 KiB, as Google asks). */
export const CHUNK_BYTES = 8 * 256 * 1024 * 4 // 8 MiB
/** The tag every progress photo carries. */
export const PROGRESS_TAG = 'progress'
export const VAULT_INDEX_KEY = 'vault_index'

/** One item as the synced index knows it (short keys keep the setting small). */
export interface IndexEntry {
  id: string
  kind: VaultKind
  name: string
  tags: string[]
  /** When it was taken or added (ms since 1970). */
  takenAt: number
  sizeBytes: number
  mime: string
  /** Drive file id once it is backed up. */
  driveFileId?: string
  driveFolderId?: string
  /** Deleted everywhere (ms): a tombstone, so another device drops it too. */
  deletedAt?: number
  /** Last change (ms): the later one wins when two devices disagree. */
  updatedAt: number
  /** Video length in seconds; photo size in px. */
  durationS?: number
  w?: number
  h?: number
}

export interface VaultIndex {
  v: 1
  /** The Drive folder the owner chose (or the app made), null until then. */
  folder: { id: string; name: string } | null
  items: Record<string, IndexEntry>
}

/** What this device holds for one item (the file itself is not needed here). */
export interface LocalMeta {
  id: string
  kind: VaultKind
  name: string
  tags: string[]
  takenAt: number
  sizeBytes: number
  mime: string
  /** The file is on this device. */
  hasBlob: boolean
  driveFileId?: string
  driveFolderId?: string
  syncedAt?: number
  /** 'here': removed from this device only (kept in Drive, not downloaded again by itself). */
  removedHere?: boolean
  updatedAt: number
  durationS?: number
  w?: number
  h?: number
}

/** A file in the Drive folder, as Drive lists it. */
export interface RemoteFile {
  fileId: string
  name: string
  mime: string
  sizeBytes: number
  parents: string[]
  appProperties: Record<string, string>
}

export const emptyIndex = (): VaultIndex => ({ v: 1, folder: null, items: {} })

const KINDS: VaultKind[] = ['photo', 'video', 'file']
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
const str = (v: unknown, max: number): string => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max)
const okId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{3,64}$/.test(v)
const okDriveId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{5,128}$/.test(v)

/** Tags: lower case, short, no repeats, at most 8. */
export function cleanTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,#]/) : []
  const out: string[] = []
  for (const t of list) {
    const v = str(t, TAG_MAX).toLowerCase().replace(/\s+/g, ' ')
    if (v && !out.includes(v)) out.push(v)
    if (out.length >= TAGS_MAX) break
  }
  return out
}

function cleanEntry(id: string, e: any): IndexEntry | null {
  if (!okId(id) || !e || typeof e !== 'object') return null
  const kind = KINDS.includes(e.kind) ? (e.kind as VaultKind) : null
  if (!kind) return null
  const out: IndexEntry = {
    id,
    kind,
    name: str(e.name, NAME_MAX) || 'Untitled',
    tags: cleanTags(e.tags),
    takenAt: num(e.takenAt) ?? 0,
    sizeBytes: Math.round(num(e.sizeBytes) ?? 0),
    mime: str(e.mime, 100) || 'application/octet-stream',
    updatedAt: num(e.updatedAt) ?? 0
  }
  if (okDriveId(e.driveFileId)) out.driveFileId = e.driveFileId
  if (okDriveId(e.driveFolderId)) out.driveFolderId = e.driveFolderId
  if (num(e.deletedAt)) out.deletedAt = e.deletedAt
  if (num(e.durationS) !== undefined) out.durationS = Math.round(e.durationS * 10) / 10
  if (num(e.w)) out.w = Math.round(e.w)
  if (num(e.h)) out.h = Math.round(e.h)
  return out
}

/** The synced index, checked and capped (metadata only: anything else is dropped). */
export function cleanIndex(raw: unknown): VaultIndex {
  const r = raw && typeof raw === 'object' ? (raw as any) : {}
  const folder = r.folder && okDriveId(r.folder.id) ? { id: r.folder.id as string, name: str(r.folder.name, 120) || 'Photo Locker' } : null
  const items: Record<string, IndexEntry> = {}
  const src = r.items && typeof r.items === 'object' ? r.items : {}
  for (const [id, e] of Object.entries(src)) {
    const c = cleanEntry(id, e)
    if (c) items[id] = c
  }
  return capIndex({ v: 1, folder, items })
}

/** Keeps the index under its limits: old tombstones go first, then the oldest items. */
export function capIndex(ix: VaultIndex): VaultIndex {
  let list = Object.values(ix.items)
  const size = (l: IndexEntry[]) => JSON.stringify({ ...ix, items: Object.fromEntries(l.map((e) => [e.id, e])) }).length
  if (list.length <= INDEX_MAX_ITEMS && size(list) <= INDEX_MAX_BYTES) return ix
  // Tombstones oldest first, then live items oldest first.
  list.sort((a, b) => Number(!a.deletedAt) - Number(!b.deletedAt) || (a.deletedAt ?? a.takenAt) - (b.deletedAt ?? b.takenAt))
  while (list.length > INDEX_MAX_ITEMS) list = list.slice(1)
  while (list.length && size(list) > INDEX_MAX_BYTES) list = list.slice(Math.max(1, Math.floor(list.length / 50)))
  return { ...ix, items: Object.fromEntries(list.map((e) => [e.id, e])) }
}

/** Two copies of one entry: a tombstone or the later change wins; a known Drive file is never forgotten. */
export function mergeEntry(a: IndexEntry | undefined, b: IndexEntry | undefined): IndexEntry | undefined {
  if (!a) return b
  if (!b) return a
  const win = b.updatedAt > a.updatedAt ? b : a
  const lose = win === a ? b : a
  const out = { ...win }
  if (!out.driveFileId && lose.driveFileId && !out.deletedAt) (out.driveFileId = lose.driveFileId), (out.driveFolderId = lose.driveFolderId)
  if (lose.deletedAt && !out.deletedAt) out.deletedAt = lose.deletedAt
  return out
}

/** Joins two indexes (another device saved in between). The newer folder choice wins. */
export function mergeIndex(a: VaultIndex, b: VaultIndex): VaultIndex {
  const items: Record<string, IndexEntry> = {}
  for (const id of new Set([...Object.keys(a.items), ...Object.keys(b.items)])) {
    const m = mergeEntry(a.items[id], b.items[id])
    if (m) items[id] = m
  }
  return capIndex({ v: 1, folder: b.folder ?? a.folder, items })
}

/** Drive appProperties for an item (each key + value at most 124 bytes; Drive's rule). */
export function driveProps(e: Pick<IndexEntry, 'id' | 'kind' | 'takenAt' | 'tags' | 'durationS'>): Record<string, string> {
  const props: Record<string, string> = { lsApp: 'locker', lsId: e.id, lsKind: e.kind, lsAt: String(Math.round(e.takenAt)) }
  let tags = e.tags.join(',')
  while (new TextEncoder().encode(tags).length > 110) tags = tags.split(',').slice(0, -1).join(',')
  if (tags) props.lsTags = tags
  if (e.durationS != null) props.lsDur = String(e.durationS)
  return props
}

/** A Drive file back to an index entry (null when it is not one of ours). */
export function fromRemote(f: RemoteFile, now = 0): IndexEntry | null {
  const p = f.appProperties ?? {}
  if (p.lsApp !== 'locker' || !okId(p.lsId)) return null
  const kind = KINDS.includes(p.lsKind as VaultKind) ? (p.lsKind as VaultKind) : 'file'
  const e: IndexEntry = {
    id: p.lsId,
    kind,
    name: str(f.name, NAME_MAX) || 'Untitled',
    tags: cleanTags(p.lsTags ?? ''),
    takenAt: Number(p.lsAt) || 0,
    sizeBytes: Math.round(Number(f.sizeBytes) || 0),
    mime: str(f.mime, 100) || 'application/octet-stream',
    driveFileId: f.fileId,
    driveFolderId: f.parents[0],
    updatedAt: now
  }
  if (p.lsDur && Number.isFinite(Number(p.lsDur))) e.durationS = Number(p.lsDur)
  return e
}

export const toEntry = (l: LocalMeta): IndexEntry => {
  const e: IndexEntry = { id: l.id, kind: l.kind, name: l.name, tags: l.tags, takenAt: l.takenAt, sizeBytes: l.sizeBytes, mime: l.mime, updatedAt: l.updatedAt }
  if (l.driveFileId) (e.driveFileId = l.driveFileId), (e.driveFolderId = l.driveFolderId)
  if (l.durationS != null) e.durationS = l.durationS
  if (l.w) e.w = l.w
  if (l.h) e.h = l.h
  return e
}

export interface SyncPlan {
  /** Local items to upload (the file is here, Drive does not have it). */
  uploads: string[]
  /** Local items already in Drive under the same app id: link them, never upload again. */
  adopt: { id: string; fileId: string; folderId?: string }[]
  /** Items in Drive or the index that this device lacks: fetch them. */
  downloads: { id: string; fileId: string; kind: VaultKind; sizeBytes: number }[]
  /** Items known elsewhere that this device should list (metadata only, no file yet). */
  learn: IndexEntry[]
  /** Deleted on another device: drop them here. */
  drop: string[]
  /** The index after this plan (with every link and every new item). */
  index: VaultIndex
  /** Things not in Drive yet. */
  notBackedUp: { here: number; elsewhere: number; bytes: number }
}

/**
 * What to do now. `remote` is the folder's file list, or null when Drive is
 * not reachable (then nothing is uploaded or downloaded, only counted).
 * Never plans an upload for an item Drive already has (matched by app id).
 */
export function planSync(input: { local: LocalMeta[]; index: VaultIndex; remote: RemoteFile[] | null; folderId: string | null; now: number }): SyncPlan {
  const { local, remote, folderId, now } = input
  let index = input.index
  const byId = new Map(local.map((l) => [l.id, l]))
  const remoteById = new Map<string, IndexEntry>()
  for (const f of remote ?? []) {
    const e = fromRemote(f, 0)
    if (!e) continue
    // Two Drive files with one app id (a crash between upload and save): keep the first, never a third.
    if (!remoteById.has(e.id)) remoteById.set(e.id, e)
  }
  const items: Record<string, IndexEntry> = { ...index.items }
  // What Drive has is known everywhere.
  for (const [id, e] of remoteById) {
    const cur = items[id]
    if (cur?.deletedAt) continue
    items[id] = cur ? { ...cur, driveFileId: e.driveFileId, driveFolderId: e.driveFolderId } : { ...e, updatedAt: now }
  }
  const plan: SyncPlan = { uploads: [], adopt: [], downloads: [], learn: [], drop: [], index, notBackedUp: { here: 0, elsewhere: 0, bytes: 0 } }
  for (const l of local) {
    const ix = items[l.id]
    if (ix?.deletedAt) {
      plan.drop.push(l.id)
      continue
    }
    const r = remoteById.get(l.id)
    if (r && l.driveFileId !== r.driveFileId) plan.adopt.push({ id: l.id, fileId: r.driveFileId!, folderId: r.driveFolderId })
    // Drive's list is the truth when we have it; offline, the best link we know.
    const fileId = remote !== null ? r?.driveFileId : (l.driveFileId ?? ix?.driveFileId)
    const folder = remote !== null ? r?.driveFolderId : (l.driveFolderId ?? ix?.driveFolderId)
    // A file Drive lost (or one deleted in Drive by hand) goes up again from here.
    if (!fileId && l.hasBlob) {
      plan.notBackedUp.here++
      plan.notBackedUp.bytes += l.sizeBytes
      if (remote !== null && folderId) plan.uploads.push(l.id)
    } else if (!fileId && !l.hasBlob && !l.removedHere) plan.notBackedUp.elsewhere++
    const base: IndexEntry = ix && ix.updatedAt > l.updatedAt ? { ...ix } : toEntry(l)
    delete base.driveFileId
    delete base.driveFolderId
    if (fileId) (base.driveFileId = fileId), (base.driveFolderId = folder)
    if (ix?.driveFileId !== base.driveFileId) base.updatedAt = Math.max(now, base.updatedAt)
    items[l.id] = base
  }
  for (const e of Object.values(items)) {
    if (e.deletedAt) continue
    const l = byId.get(e.id)
    if (l) {
      if (!l.hasBlob && !l.removedHere && e.driveFileId) plan.downloads.push({ id: e.id, fileId: e.driveFileId, kind: e.kind, sizeBytes: e.sizeBytes })
      continue
    }
    plan.learn.push(e)
    if (e.driveFileId) plan.downloads.push({ id: e.id, fileId: e.driveFileId, kind: e.kind, sizeBytes: e.sizeBytes })
    else plan.notBackedUp.elsewhere++
  }
  index = capIndex({ ...index, items })
  plan.index = index
  return plan
}

/** The warning line, or null when everything is in Drive. */
export function notBackedUpLine(n: SyncPlan['notBackedUp'], connected: boolean): string | null {
  if (!n.here && !n.elsewhere) return null
  const parts: string[] = []
  if (n.here) parts.push(`${n.here} item${n.here === 1 ? '' : 's'} on this device`)
  if (n.elsewhere) parts.push(`${n.elsewhere} on another device`)
  return `Not backed up yet: ${parts.join(', ')}${connected ? '' : ' (connect Google Drive to back them up)'}`
}

/** Deleting: "everywhere" trashes the Drive file and leaves a tombstone; "here" keeps Drive and stops the download. */
export function deletePlan(e: IndexEntry | undefined, local: LocalMeta | undefined, everywhere: boolean, now: number): { trashFileId: string | null; entry: IndexEntry | null; removeLocal: 'all' | 'blob' } {
  if (everywhere) {
    const base = e ?? (local ? toEntry(local) : null)
    return { trashFileId: e?.driveFileId ?? local?.driveFileId ?? null, entry: base ? { ...base, deletedAt: now, updatedAt: now } : null, removeLocal: 'all' }
  }
  // Only on this device: if Drive has no copy, this is the only one; it goes for good.
  const inDrive = !!(e?.driveFileId || local?.driveFileId)
  return { trashFileId: null, entry: inDrive ? null : e ? { ...e, deletedAt: now, updatedAt: now } : null, removeLocal: inDrive ? 'blob' : 'all' }
}

/**
 * Changing the folder: the files the app put in the old folder are MOVED to
 * the new one (a metadata change in Drive, nothing is uploaded again), so the
 * Locker always has one home and never two copies.
 */
export function folderMovePlan(remoteInOld: RemoteFile[], oldId: string | null, newId: string): { fileId: string; from: string }[] {
  if (!oldId || oldId === newId) return []
  return remoteInOld.filter((f) => fromRemote(f) && f.parents.includes(oldId) && !f.parents.includes(newId)).map((f) => ({ fileId: f.fileId, from: oldId }))
}

export const VIDEO_LENGTH_UNKNOWN = "Couldn't read this video's length; try again."
/** A length we can trust: a real number of seconds above 0 (not NaN, Infinity or 0). */
export const knownDuration = (d: unknown): d is number => typeof d === 'number' && Number.isFinite(d) && d > 0

/** Checks a video before it is kept. Null = fine, else a plain message. An unknown length is refused, never kept. */
export function checkVideo(durationS: number, sizeBytes: number): string | null {
  if (!knownDuration(durationS)) return VIDEO_LENGTH_UNKNOWN
  if (durationS > VIDEO_MAX_SECONDS + 0.5) return `This video is ${Math.round(durationS)} seconds long. Videos can be at most ${VIDEO_MAX_SECONDS} seconds: trim it first.`
  if (sizeBytes > VIDEO_MAX_BYTES) return `This video is ${mb(sizeBytes)}. Videos can be at most ${mb(VIDEO_MAX_BYTES)}.`
  return null
}

/** Checks any other file. Null = fine. */
export function checkFile(sizeBytes: number): string | null {
  if (!(sizeBytes > 0)) return 'This file is empty.'
  if (sizeBytes > FILE_MAX_BYTES) return `This file is ${mb(sizeBytes)}. Files can be at most ${mb(FILE_MAX_BYTES)}.`
  return null
}

export function kindOf(mime: string): VaultKind {
  if (/^image\//.test(mime)) return 'photo'
  if (/^video\//.test(mime)) return 'video'
  return 'file'
}

export function mb(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** The size that fits in max × max, never bigger. */
export function fitSide(w: number, h: number, max = PHOTO_MAX_SIDE): { width: number; height: number } {
  const W = Math.max(1, Math.round(w || 1))
  const H = Math.max(1, Math.round(h || 1))
  const k = Math.min(1, max / Math.max(W, H))
  return { width: Math.max(1, Math.round(W * k)), height: Math.max(1, Math.round(H * k)) }
}

export type VaultFilter = 'all' | 'progress' | 'video' | 'file'

/** The items a filter and a search show, newest first. */
export function filterItems<T extends Pick<IndexEntry, 'kind' | 'name' | 'tags' | 'takenAt'>>(items: T[], filter: VaultFilter, q: string): T[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  return items
    .filter((e) => (filter === 'all' ? true : filter === 'progress' ? e.kind === 'photo' && e.tags.includes(PROGRESS_TAG) : e.kind === filter))
    .filter((e) => words.every((w) => e.name.toLowerCase().includes(w) || e.tags.some((t) => t.includes(w.replace(/^#/, '')))))
    .sort((a, b) => b.takenAt - a.takenAt)
}

/** Groups by month for the timeline ("November 2026"), newest month first. */
export function byMonth<T extends { takenAt: number }>(items: T[]): { key: string; label: string; items: T[] }[] {
  const out: { key: string; label: string; items: T[] }[] = []
  for (const it of [...items].sort((a, b) => b.takenAt - a.takenAt)) {
    const d = new Date(it.takenAt)
    const key = calendarDay(d).slice(0, 7)
    let g = out.find((x) => x.key === key)
    if (!g) out.push((g = { key, label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), items: [] }))
    g.items.push(it)
  }
  return out
}

/** A new item id: time + random (letters and digits only). */
export const newVaultId = (now: number, rnd: () => number = Math.random) => `v${now.toString(36)}${Math.floor(rnd() * 36 ** 6).toString(36).padStart(6, '0')}`
