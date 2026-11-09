// Custom Center: pictures and sounds you upload, ON THIS DEVICE ONLY. They
// live in this browser's (or the desktop app's) IndexedDB ("life-custom-files")
// as small data URLs (the app's Content-Security-Policy allows data: images and
// sounds) and the synced set-up only names them ("local:<id>"). Never synced,
// never sent anywhere, never in an export.

const DB_NAME = 'life-custom-files'
const STORE = 'files'
/** A picture is made small first; a sound must already be short. */
export const IMAGE_MAX_BYTES = 900_000
export const SOUND_MAX_BYTES = 600_000

export interface LocalFile {
  id: string
  kind: 'image' | 'sound'
  name: string
  url: string
  at: number
}

function open(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    if (typeof indexedDB === 'undefined') return no(new Error('This browser cannot keep files'))
    const r = indexedDB.open(DB_NAME, 1)
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    r.onsuccess = () => ok(r.result)
    r.onerror = () => no(r.error ?? new Error('Your files could not be opened'))
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((ok, no) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => ok(req.result)
      req.onerror = () => no(req.error ?? new Error('File store error'))
    })
  } finally {
    db.close()
  }
}

const cache = new Map<string, string>()

/** The data URL for "local:<id>", or null when this device doesn't have it. */
export async function localUrl(ref: string): Promise<string | null> {
  if (!ref.startsWith('local:')) return null
  const id = ref.slice(6)
  if (cache.has(id)) return cache.get(id)!
  try {
    const f = (await tx('readonly', (s) => s.get(id))) as LocalFile | undefined
    if (f?.url) cache.set(id, f.url)
    return f?.url ?? null
  } catch {
    return null
  }
}

export async function listLocal(kind: LocalFile['kind']): Promise<LocalFile[]> {
  try {
    return ((await tx('readonly', (s) => s.getAll())) as LocalFile[]).filter((f) => f && f.kind === kind).sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

export async function removeLocal(ref: string): Promise<void> {
  const id = ref.replace(/^local:/, '')
  cache.delete(id)
  await tx('readwrite', (s) => s.delete(id)).catch(() => {})
}

const readAsDataUrl = (file: Blob) =>
  new Promise<string>((ok, no) => {
    const fr = new FileReader()
    fr.onload = () => ok(String(fr.result))
    fr.onerror = () => no(new Error('Could not read that file'))
    fr.readAsDataURL(file)
  })

async function put(kind: LocalFile['kind'], name: string, url: string): Promise<string> {
  const id = `${kind[0]}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
  await tx('readwrite', (s) => s.put({ id, kind, name: name.slice(0, 60), url, at: Date.now() } satisfies LocalFile))
  cache.set(id, url)
  return `local:${id}`
}

/** Keeps a picture on this device (made at most 1600 px wide, a JPEG). Returns its reference. */
export async function saveImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Pick a picture (JPG, PNG or WebP)')
  if (file.size > 25 * 1024 * 1024) throw new Error('That picture is too big (25 MB at most)')
  const src = await readAsDataUrl(file)
  const img = new Image()
  img.src = src
  await img.decode().catch(() => {
    throw new Error('Could not read that picture')
  })
  for (const [max, q] of [[1600, 0.8], [1200, 0.7], [900, 0.6]] as const) {
    const k = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round((img.naturalWidth || 1) * k))
    c.height = Math.max(1, Math.round((img.naturalHeight || 1) * k))
    const g = c.getContext('2d')
    if (!g) break
    g.drawImage(img, 0, 0, c.width, c.height)
    const url = c.toDataURL('image/jpeg', q)
    if (url.length <= IMAGE_MAX_BYTES) return put('image', file.name, url)
  }
  throw new Error('That picture is too detailed to keep small; try another one')
}

/** Keeps a short sound on this device. Returns its reference. */
export async function saveSound(file: File): Promise<string> {
  if (!file.type.startsWith('audio/')) throw new Error('Pick a sound file (MP3, OGG or WAV)')
  if (file.size > SOUND_MAX_BYTES * 0.74) throw new Error('That sound is too long: keep it to a few seconds (about 400 KB)')
  return put('sound', file.name, await readAsDataUrl(file))
}

/** Plays a sound you uploaded once, at a volume (0–1). Never before a tap (the browser asks for one). */
export async function playLocal(ref: string, volume: number): Promise<boolean> {
  const url = await localUrl(ref)
  if (!url) return false
  const a = new Audio(url)
  a.volume = Math.max(0, Math.min(1, volume))
  // A file that won't play (gone, wrong format) says so, so the caller can ring the built-in sound instead.
  return a.play().then(() => true, () => false)
}
