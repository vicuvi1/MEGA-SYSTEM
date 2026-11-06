// The wallpaper choice for this page: one copy shared by the layer and
// Settings → Look → Wallpaper. The synced settings are the truth; a copy in
// localStorage paints the right picture at start-up before the data is ready.
import { useEffect, useState } from 'react'
import { cleanWallpaper, okWallpaperPhoto, DEFAULT_WALLPAPER, type WallpaperPrefs } from '@core/wallpaper'
import { life } from '../bridge'

export interface WallpaperState {
  prefs: WallpaperPrefs
  photo: string | null
  /** A picture shown for a moment while you hover it in the gallery (not saved). */
  preview: string | null
}

const KEY = 'ls.wallpaper'
const PHOTO_KEY = 'ls.wallpaper.photo'
const EVENT = 'life-wallpaper'

function readCache(): WallpaperState {
  try {
    const prefs = cleanWallpaper(JSON.parse(localStorage.getItem(KEY) || 'null'))
    const photo = localStorage.getItem(PHOTO_KEY)
    return { prefs, photo: okWallpaperPhoto(photo) ? photo : null, preview: null }
  } catch {
    return { prefs: DEFAULT_WALLPAPER, photo: null, preview: null }
  }
}

let state: WallpaperState = typeof localStorage === 'undefined' ? { prefs: DEFAULT_WALLPAPER, photo: null, preview: null } : readCache()

function writeCache(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state.prefs))
    if (state.photo) localStorage.setItem(PHOTO_KEY, state.photo)
    else localStorage.removeItem(PHOTO_KEY)
  } catch {
    // private window or full storage: the synced copy still has it
  }
}

function publish(next: Partial<WallpaperState>): void {
  const before = JSON.stringify([state.prefs, state.preview, state.photo?.length, state.photo?.slice(-40)])
  state = { ...state, ...next }
  if (JSON.stringify([state.prefs, state.preview, state.photo?.length, state.photo?.slice(-40)]) === before) return
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function getWallpaper(): WallpaperState {
  return state
}

let loading: Promise<void> | null = null
/** Reads the synced choice (and your picture when it is in use). */
export function loadWallpaper(): Promise<void> {
  return (loading ??= (async () => {
    const api = life.look
    if (!api) return
    const prefs = await api.wallpaper()
    const photo = prefs.id === 'photo' || state.photo ? await api.photo().catch(() => state.photo) : null
    publish({ prefs, photo })
    writeCache()
  })()
    .catch(() => {})
    .finally(() => (loading = null)))
}

/** Saves a change (it shows at once; the synced copy follows). */
export async function saveWallpaper(patch: Partial<WallpaperPrefs>): Promise<WallpaperPrefs> {
  const local = cleanWallpaper({ ...state.prefs, ...patch })
  publish({ prefs: local })
  writeCache()
  const api = life.look
  if (!api) return local
  const saved = await api.setWallpaper(patch)
  publish({ prefs: saved })
  writeCache()
  return saved
}

/** Saves your own picture (a data URL made small on this device), or removes it. */
export async function saveWallpaperPhoto(url: string | null): Promise<void> {
  if (url !== null && !okWallpaperPhoto(url)) throw new Error('That picture is too big or not an image')
  await life.look?.setPhoto(url)
  publish({ photo: url })
  writeCache()
}

/** Shows a picture while you hover it (null goes back to your choice). */
export function previewWallpaper(id: string | null): void {
  publish({ preview: id })
}

/** The shared wallpaper state; re-renders when it changes. */
export function useWallpaper(): WallpaperState {
  const [v, setV] = useState(state)
  useEffect(() => {
    const on = () => setV(state)
    window.addEventListener(EVENT, on)
    setV(state)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  return v
}

/** A picture you picked, made small on this device: at most 1600 px on its longest side, a JPEG under the size limit. */
export async function wallpaperFromFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Pick a picture (JPG, PNG or WebP)')
  if (file.size > 25 * 1024 * 1024) throw new Error('That picture is too big (25 MB at most)')
  try {
    // Read as a data URL: the app's Content-Security-Policy allows data: images, not blob: ones.
    const src = await new Promise<string>((ok, bad) => {
      const fr = new FileReader()
      fr.onload = () => ok(String(fr.result))
      fr.onerror = () => bad(new Error('Could not read that picture'))
      fr.readAsDataURL(file)
    })
    const img = new Image()
    img.src = src
    await img.decode()
    for (const [max, quality] of [[1600, 0.78], [1400, 0.7], [1200, 0.62], [1000, 0.55]] as const) {
      const k = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round((img.naturalWidth || 1) * k))
      c.height = Math.max(1, Math.round((img.naturalHeight || 1) * k))
      const g = c.getContext('2d')
      if (!g) throw new Error('Could not read that picture')
      g.drawImage(img, 0, 0, c.width, c.height)
      const url = c.toDataURL('image/jpeg', quality)
      if (okWallpaperPhoto(url)) return url
    }
    throw new Error('That picture is too detailed to keep small; try another one')
  } catch (e) {
    if (e instanceof Error && /too|Pick|Could not/.test(e.message)) throw e
    throw new Error('Could not read that picture')
  }
}
