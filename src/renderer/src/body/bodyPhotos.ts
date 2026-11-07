// BD10: progress photos, ON THIS DEVICE ONLY. They live in this browser's
// (or the desktop app's) IndexedDB, database "life-body-photos". They are
// never put in the synced database, never sent to the server or Ben, and
// never in a backup. Clearing the site's data or "Delete" removes them.
import type { PhotoMeta } from '@core/bodyPhotos'

const DB_NAME = 'life-body-photos'
const STORE = 'photos'

export interface StoredPhoto extends PhotoMeta {
  at: number
  blob: Blob
  w: number
  h: number
}

function open(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    if (typeof indexedDB === 'undefined') return no(new Error('This browser cannot keep photos'))
    const r = indexedDB.open(DB_NAME, 1)
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    r.onsuccess = () => ok(r.result)
    r.onerror = () => no(r.error ?? new Error('Photos could not be opened'))
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((ok, no) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => ok(req.result)
      req.onerror = () => no(req.error ?? new Error('Photo store error'))
    })
  } finally {
    db.close()
  }
}

export async function listPhotos(): Promise<StoredPhoto[]> {
  try {
    const all = (await tx('readonly', (s) => s.getAll())) as StoredPhoto[]
    return all.filter((p) => p && p.blob && p.day).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.at - b.at))
  } catch {
    return []
  }
}

export const savePhoto = (p: StoredPhoto) => tx('readwrite', (s) => s.put(p))
export const deletePhoto = (id: string) => tx('readwrite', (s) => s.delete(id))

/** Makes a picture small (at most 960 px tall, JPEG) before it is kept. */
export async function shrink(src: Blob | HTMLVideoElement, maxH = 960): Promise<{ blob: Blob; w: number; h: number }> {
  let el: CanvasImageSource
  let w: number
  let h: number
  let url: string | null = null
  if (src instanceof Blob) {
    url = URL.createObjectURL(src)
    const img = new Image()
    img.src = url
    await img.decode()
    el = img
    w = img.naturalWidth
    h = img.naturalHeight
  } else {
    el = src
    w = src.videoWidth
    h = src.videoHeight
  }
  try {
    const k = Math.min(1, maxH / Math.max(1, h))
    const c = document.createElement('canvas')
    c.width = Math.round(w * k)
    c.height = Math.round(h * k)
    c.getContext('2d')!.drawImage(el, 0, 0, c.width, c.height)
    const blob = await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('Could not save the photo'))), 'image/jpeg', 0.85))
    return { blob, w: c.width, h: c.height }
  } finally {
    if (url) URL.revokeObjectURL(url)
  }
}
