// Photo Locker, this device's copy: every item and its file in IndexedDB
// (database "life-vault"), the same way progress photos are kept
// (body/bodyPhotos.ts). The files are NOT encrypted (the owner's choice).
// What every device knows goes in the synced setting `vault_index`
// (metadata only); the files go to Google Drive (driveSync.ts).
import type { LocalMeta, VaultKind } from '@core/vaultSync'

const DB_NAME = 'life-vault'
const STORE = 'items'

export interface VaultItem {
  id: string
  kind: VaultKind
  name: string
  tags: string[]
  /** When it was taken or added (ms). */
  takenAt: number
  sizeBytes: number
  mime: string
  /** The file itself; missing until it is downloaded (or after "remove from this device"). */
  blob?: Blob
  /** A small JPEG for the timeline (photos and videos). */
  thumb?: Blob
  w?: number
  h?: number
  durationS?: number
  driveFileId?: string
  driveFolderId?: string
  syncedAt?: number
  /** Removed from this device only: kept in Drive, not downloaded again by itself. */
  removedHere?: boolean
  /** A resumable upload in progress (Google's session link, valid about a week). */
  upload?: { url: string; folderId: string; at: number }
  /** A folder under the Locker's folder in Drive ("Food/2026-11" for a Telegram meal photo); none = the folder itself. */
  folderPath?: string
  updatedAt: number
}

function open(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    if (typeof indexedDB === 'undefined') return no(new Error('This browser cannot keep files'))
    const r = indexedDB.open(DB_NAME, 1)
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    r.onsuccess = () => ok(r.result)
    r.onerror = () => no(r.error ?? new Error('Photo Locker could not be opened'))
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((ok, no) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => ok(req.result)
      req.onerror = () => no(req.error ?? new Error('Photo Locker store error'))
    })
  } finally {
    db.close()
  }
}

const changed = () => {
  try {
    window.dispatchEvent(new CustomEvent('life-vault-changed'))
  } catch {
    /* not in a page */
  }
}

export async function listItems(): Promise<VaultItem[]> {
  try {
    return ((await tx('readonly', (s) => s.getAll())) as VaultItem[]).filter((x) => x && x.id)
  } catch {
    return []
  }
}

export const getItem = async (id: string): Promise<VaultItem | undefined> => (await tx('readonly', (s) => s.get(id))) as VaultItem | undefined

export async function putItem(it: VaultItem, quiet = false): Promise<void> {
  await tx('readwrite', (s) => s.put(it))
  if (!quiet) changed()
}

/** Changes a few fields of an item (no-op when it is gone). */
export async function patchItem(id: string, patch: Partial<VaultItem>, quiet = false): Promise<VaultItem | undefined> {
  const cur = await getItem(id)
  if (!cur) return undefined
  const next = { ...cur, ...patch }
  for (const k of Object.keys(patch) as (keyof VaultItem)[]) if (patch[k] === undefined) delete next[k]
  await putItem(next, quiet)
  return next
}

export async function removeItem(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
  changed()
}

/** What the sync plan needs to know (no file data). */
export const metaOf = (it: VaultItem): LocalMeta => ({
  id: it.id,
  kind: it.kind,
  name: it.name,
  tags: it.tags,
  takenAt: it.takenAt,
  sizeBytes: it.sizeBytes,
  mime: it.mime,
  hasBlob: !!it.blob,
  driveFileId: it.driveFileId,
  driveFolderId: it.driveFolderId,
  syncedAt: it.syncedAt,
  removedHere: it.removedHere,
  updatedAt: it.updatedAt,
  durationS: it.durationS,
  w: it.w,
  h: it.h
})
