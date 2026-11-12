// Money receipts, the IO (Money v2 plan D6; decisions in core/receiptIndex.ts).
// Finance Helper (an iframe, same origin) hands a receipt photo or PDF to this
// page. Here it is:
//   1. kept on this device at once (IndexedDB "life-receipts"), so it is never lost;
//   2. noted in the synced index `money_receipts` (metadata only, outside
//      Finance's data; read → merge → write);
//   3. uploaded straight from this device to the owner's Google Drive, folder
//      "Life System/Receipts/YYYY-MM", with the drive.file key Photo Locker
//      uses (never through our server). While Drive is not connected, or the
//      device is offline, it waits and goes later (app start, back online,
//      every 30 minutes, and after each new receipt).
// Receipts are Money's: this runs while the Photo Locker module is off.
// The local copy is kept after the upload (it is the fast way to open it).
import { checkReceipt, cleanReceipts, emptyReceipts, mergeReceipts, planReceiptSync, receiptDriveLink, receiptFileName, receiptFolderPath, receiptProps, RECEIPT_FOLDER_APP, validReceiptId, type ReceiptEntry, type ReceiptIndex } from '@core/receiptIndex'

export interface StoredReceipt {
  id: string
  blob: Blob
  name: string
  mime: string
  size: number
  date: string
  tx: string | null
  addedAt: number
  /** A resumable upload in progress (Google's session link). */
  upload?: { url: string; at: number }
}

export interface ReceiptStore {
  get(id: string): Promise<StoredReceipt | undefined>
  put(r: StoredReceipt): Promise<void>
  list(): Promise<StoredReceipt[]>
}

export interface ReceiptDrive {
  /** The folder for a path, made once when missing. */
  folder(path: string[]): Promise<string>
  /** Receipt files already in Drive, by app id (lsId → Drive id). */
  findByIds(ids: string[]): Promise<Record<string, string>>
  /** Starts (or resumes) an upload; resolves with the Drive file id. */
  upload(meta: { name: string; mime: string; size: number; folderId: string; appProperties: Record<string, string> }, blob: Blob, resumeUrl?: string, onUrl?: (url: string) => void): Promise<string>
  download(driveId: string, mime: string): Promise<Blob>
}

export interface ReceiptIndexIO {
  read(): Promise<ReceiptIndex>
  /** Joins `next` with the saved copy and returns what was saved. */
  save(next: ReceiptIndex): Promise<ReceiptIndex>
}

export interface ReceiptDeps {
  store: ReceiptStore
  index: ReceiptIndexIO
  /** Drive when it is connected, else null (receipts wait on this device). */
  drive: () => Promise<ReceiptDrive | null>
  now?: () => number
  /** Optional: makes a photo smaller and drops its EXIF (location). */
  shrink?: (blob: Blob, mime: string) => Promise<{ blob: Blob; mime: string }>
}

export interface AddInput {
  rid: string
  txId: string
  date: string
  note: string
  name: string
  mime: string
  bytes: ArrayBuffer | Blob
}

export function createReceipts(deps: ReceiptDeps) {
  const now = () => (deps.now ? deps.now() : Date.now())
  let running: Promise<{ uploaded: number; waiting: number; error: string | null }> | null = null

  async function patch(id: string, p: Partial<ReceiptEntry>): Promise<ReceiptIndex> {
    const cur = await deps.index.read()
    const e = cur.items[id]
    if (!e) return cur
    return deps.index.save({ v: 1, items: { [id]: { ...e, ...p, updatedAt: Math.max(now(), e.updatedAt + 1) } } })
  }

  /** Keeps the file on this device and notes it in the index. The upload follows. */
  async function add(input: AddInput): Promise<{ rid: string; entry: ReceiptEntry }> {
    if (!validReceiptId(input.rid)) throw new Error('Bad receipt id')
    let blob = input.bytes instanceof Blob ? input.bytes : new Blob([input.bytes], { type: input.mime })
    let mime = input.mime
    const bad = checkReceipt(mime, blob.size)
    if (bad) throw new Error(bad)
    if (deps.shrink && /^image\/(jpeg|png|webp)$/.test(mime)) {
      try {
        const s = await deps.shrink(blob, mime)
        if (s.blob.size > 0) ({ blob, mime } = s)
      } catch {
        /* keep the photo as it came */
      }
    }
    const at = now()
    const rec: StoredReceipt = { id: input.rid, blob, name: String(input.name || 'receipt').slice(0, 120), mime, size: blob.size, date: input.date, tx: input.txId || null, addedAt: at }
    await deps.store.put(rec)
    const entry: ReceiptEntry = { tx: rec.tx, name: rec.name, mime, size: rec.size, date: rec.date, updatedAt: at }
    await deps.index.save({ v: 1, items: { [rec.id]: entry } })
    return { rid: rec.id, entry }
  }

  /** Uploads what waits on this device. One run at a time. */
  function uploadPending(): Promise<{ uploaded: number; waiting: number; error: string | null }> {
    if (running) return running
    running = (async () => {
      const local = await deps.store.list()
      let ix = await deps.index.read()
      const drive = await deps.drive().catch(() => null)
      const waitingNow = () => planReceiptSync(ix, local.map((l) => ({ id: l.id, hasFile: !!l.blob })), {}).uploads.length
      if (!drive) return { uploaded: 0, waiting: waitingNow(), error: null }
      let uploaded = 0
      let error: string | null = null
      try {
        const todo = local.filter((l) => !ix.items[l.id]?.driveId && !ix.items[l.id]?.gone)
        const inDrive = todo.length ? await drive.findByIds(todo.map((l) => l.id)) : {}
        const plan = planReceiptSync(ix, local.map((l) => ({ id: l.id, hasFile: !!l.blob })), inDrive)
        for (const a of plan.adopt) ix = await patch(a.id, { driveId: a.driveId, uploadedAt: now() })
        for (const id of plan.uploads) {
          const r = local.find((l) => l.id === id)!
          const e = ix.items[id] ?? { tx: r.tx, name: r.name, mime: r.mime, size: r.size, date: r.date, updatedAt: r.addedAt }
          if (!ix.items[id]) ix = await deps.index.save({ v: 1, items: { [id]: e } })
          const folderId = await drive.folder(receiptFolderPath(e.date || r.date))
          const name = receiptFileName(id, e.date || r.date, e.name.replace(/\.[a-z0-9]{2,5}$/i, ''), r.mime)
          const driveId = await drive.upload({ name, mime: r.mime, size: r.blob.size, folderId, appProperties: receiptProps(id, e.tx) }, r.blob, r.upload?.url, (url) => void deps.store.put({ ...r, upload: { url, at: now() } }))
          await deps.store.put({ ...r, upload: undefined })
          ix = await patch(id, { driveId, uploadedAt: now() })
          uploaded++
        }
      } catch (err) {
        error = (err as Error).message || 'Google Drive upload failed'
      }
      return { uploaded, waiting: waitingNow(), error }
    })().finally(() => {
      running = null
    })
    return running
  }

  /** The index entries for these ids (all when none given). */
  async function entries(ids?: string[] | null): Promise<Record<string, ReceiptEntry & { webLink?: string }>> {
    const ix = await deps.index.read()
    const out: Record<string, ReceiptEntry & { webLink?: string }> = {}
    for (const [id, e] of Object.entries(ix.items)) if (!ids || ids.includes(id)) out[id] = { ...e, ...(e.driveId ? { webLink: receiptDriveLink(e.driveId) } : {}) }
    return out
  }

  /** The file: this device's copy, else downloaded from Drive (and kept here). */
  async function open(rid: string): Promise<{ bytes: ArrayBuffer; mime: string; name: string; webLink?: string }> {
    const ix = await deps.index.read()
    const e = ix.items[rid]
    const webLink = e?.driveId ? receiptDriveLink(e.driveId) : undefined
    const mine = await deps.store.get(rid)
    if (mine?.blob) return { bytes: await mine.blob.arrayBuffer(), mime: mine.mime, name: mine.name, webLink }
    if (!e?.driveId) throw new Error('This receipt is on another device and not in Google Drive yet')
    const drive = await deps.drive()
    if (!drive) throw new Error('Connect Google Drive to open receipts from other devices')
    const blob = await drive.download(e.driveId, e.mime)
    await deps.store.put({ id: rid, blob, name: e.name, mime: e.mime, size: blob.size, date: e.date, tx: e.tx, addedAt: now() })
    return { bytes: await blob.arrayBuffer(), mime: e.mime, name: e.name, webLink }
  }

  return { add, uploadPending, entries, open }
}

export type Receipts = ReturnType<typeof createReceipts>

// ---------- The real pieces: IndexedDB, Google Drive, the synced index ----------

const DB_NAME = 'life-receipts'
const STORE = 'items'

function openDb(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    if (typeof indexedDB === 'undefined') return no(new Error('This browser cannot keep files'))
    const r = indexedDB.open(DB_NAME, 1)
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    r.onsuccess = () => ok(r.result)
    r.onerror = () => no(r.error ?? new Error('Receipts could not be opened'))
  })
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((ok, no) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      let result: T
      req.onsuccess = () => (result = req.result)
      req.onerror = () => no(req.error ?? new Error('Receipt store error'))
      tx.oncomplete = () => ok(result)
      tx.onerror = () => no(tx.error ?? new Error('Receipt store error'))
    })
  } finally {
    db.close()
  }
}

export const idbReceiptStore: ReceiptStore = {
  get: (id) => idb('readonly', (s) => s.get(id) as IDBRequest<StoredReceipt | undefined>),
  put: async (r) => void (await idb('readwrite', (s) => s.put(r))),
  list: () => idb('readonly', (s) => s.getAll() as IDBRequest<StoredReceipt[]>)
}

const FOLDER_MIME = 'application/vnd.google-apps.folder'
/** Quotes a value for a Drive search (letters, digits, spaces, - _ / only). */
const qv = (v: string) => `'${String(v).replace(/[^\w /-]/g, '')}'`

/**
 * Google Drive for receipts, from this device with a short-lived drive.file key
 * (the app sees only files and folders it made). Folders are found by their
 * appProperties path (never by name alone), made once, and remembered.
 */
export function createReceiptDrive(getToken: () => Promise<string>, fetchImpl: typeof fetch = (...a) => fetch(...a), base = 'https://www.googleapis.com', folderCache: Map<string, string> = new Map()): ReceiptDrive {
  const call = async (path: string, init: RequestInit = {}, retry = true): Promise<Response> => {
    const res = await fetchImpl(path.startsWith('http') ? path : base + path, { ...init, headers: { Authorization: `Bearer ${await getToken()}`, ...(init.headers as Record<string, string>) } })
    if ((res.status === 429 || res.status >= 500) && retry) {
      await new Promise((ok) => setTimeout(ok, 1500))
      return call(path, init, false)
    }
    if (!res.ok && res.status !== 308) throw new Error(res.status === 401 ? 'Google Drive sign-in expired: connect Google Drive again' : res.status === 403 ? 'Google Drive said no: check the Drive API is on and your Drive is not full' : `Google Drive could not save the receipt (${res.status})`)
    return res
  }
  const list = async (q: string) => ((await (await call(`/drive/v3/files?${new URLSearchParams({ q, fields: 'files(id,appProperties)', pageSize: '1000', spaces: 'drive' })}`)).json()).files ?? []) as { id: string; appProperties?: Record<string, string> }[]
  const rangeEnd = (h: string | null) => {
    const m = /bytes=0-(\d+)/.exec(h ?? '')
    return m ? Number(m[1]) + 1 : 0
  }
  return {
    async folder(path) {
      let parent: string | null = null
      for (let i = 0; i < path.length; i++) {
        const key = path.slice(0, i + 1).join('/')
        let id = folderCache.get(key)
        if (!id) {
          const found = await list(`mimeType = '${FOLDER_MIME}' and trashed = false and appProperties has { key='lsApp' and value='${RECEIPT_FOLDER_APP}' } and appProperties has { key='lsPath' and value=${qv(key)} }`)
          id = found[0]?.id
          if (!id) {
            const meta: Record<string, unknown> = { name: path[i], mimeType: FOLDER_MIME, appProperties: { lsApp: RECEIPT_FOLDER_APP, lsPath: key }, ...(parent ? { parents: [parent] } : {}) }
            id = String((await (await call('/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) })).json()).id)
          }
          folderCache.set(key, id)
        }
        parent = id
      }
      return parent as string
    },
    async findByIds(ids) {
      const out: Record<string, string> = {}
      for (let i = 0; i < ids.length; i += 20) {
        const part = ids.slice(i, i + 20).filter(validReceiptId)
        if (!part.length) continue
        const q = `trashed = false and appProperties has { key='lsApp' and value='receipt' } and (${part.map((id) => `appProperties has { key='lsId' and value=${qv(id)} }`).join(' or ')})`
        for (const f of await list(q)) if (f.appProperties?.lsId) out[f.appProperties.lsId] = f.id
      }
      return out
    },
    async upload(meta, blob, resumeUrl, onUrl) {
      let url = resumeUrl
      if (url) {
        // Where did Google stop? A dead session starts over once.
        const ask = await fetchImpl(url, { method: 'PUT', headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Range': `bytes */${blob.size}` } }).catch(() => null)
        if (ask && (ask.status === 200 || ask.status === 201)) return String((await ask.json()).id)
        if (!ask || ask.status !== 308) url = undefined
      }
      if (!url) {
        const res = await call('/upload/drive/v3/files?uploadType=resumable&fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': meta.mime, 'X-Upload-Content-Length': String(meta.size) }, body: JSON.stringify({ name: meta.name, mimeType: meta.mime, parents: [meta.folderId], appProperties: meta.appProperties }) })
        url = res.headers.get('Location') || res.headers.get('location') || undefined
        if (!url) throw new Error('Google Drive did not give an upload link')
        onUrl?.(url)
      }
      const res = await call(url, { method: 'PUT', headers: { 'Content-Range': `bytes ${0}-${blob.size - 1}/${blob.size}` }, body: blob })
      if (res.status === 308) {
        // Google took part of it: send the rest.
        const from = rangeEnd(res.headers.get('Range'))
        const rest = await call(url, { method: 'PUT', headers: { 'Content-Range': `bytes ${from}-${blob.size - 1}/${blob.size}` }, body: blob.slice(from) })
        if (rest.status === 308) throw new Error('Google Drive did not confirm the upload')
        return String((await rest.json()).id)
      }
      return String((await res.json()).id)
    },
    async download(driveId, mime) {
      const res = await call(`/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`)
      return new Blob([await res.arrayBuffer()], { type: mime })
    }
  }
}

/** The synced index through the Life bridge, or this device only when there is none. */
export function bridgeIndex(api: { index(): Promise<unknown>; saveIndex(next: ReceiptIndex): Promise<unknown> } | undefined): ReceiptIndexIO {
  const KEY = 'ls.moneyReceipts'
  const localRead = () => {
    try {
      return cleanReceipts(JSON.parse(localStorage.getItem(KEY) || 'null'))
    } catch {
      return emptyReceipts()
    }
  }
  if (!api) {
    return {
      read: async () => localRead(),
      save: async (next) => {
        const merged = mergeReceipts(localRead(), cleanReceipts(next))
        try {
          localStorage.setItem(KEY, JSON.stringify(merged))
        } catch {
          /* full: the synced copy is the one that counts */
        }
        return merged
      }
    }
  }
  return { read: async () => cleanReceipts(await api.index()), save: async (next) => cleanReceipts(await api.saveIndex(next)) }
}
