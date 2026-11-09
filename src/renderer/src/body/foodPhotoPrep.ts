// Food photo logging, the page side: makes the meal photo small before it is
// sent (longest side 1024 px, JPEG about 0.8, so about 100–250 KB), the right
// way up (the browser applies the camera's EXIF orientation when it decodes;
// drawing to a canvas then drops all EXIF, location included), and asks
// /api/ai {op:'foodPhoto'}. The photo is not kept anywhere: only the foods
// the owner saves.
import { currentSession } from '../web/session'
import type { SavedFoodRef } from '@core/foodVision'

export const MAX_SIDE = 1024
export const JPEG_QUALITY = 0.8
/** Above this the quality steps down (0.7, then 0.6). */
export const TARGET_BYTES = 260_000

/** The size that fits in max × max, keeping the shape (never made bigger). */
export function fitSize(w: number, h: number, max = MAX_SIDE): { width: number; height: number } {
  const W = Math.max(1, Math.round(Number(w) || 1))
  const H = Math.max(1, Math.round(Number(h) || 1))
  const s = Math.min(1, max / Math.max(W, H))
  return { width: Math.max(1, Math.round(W * s)), height: Math.max(1, Math.round(H * s)) }
}

/** Bytes in a base64 string. */
export const b64Bytes = (b64: string) => Math.floor((b64.replace(/=+$/, '').length * 3) / 4)

export interface PreparedPhoto {
  mime: 'image/jpeg'
  /** Base64 without the "data:" prefix. */
  data: string
  /** A data URL for the thumbnail. */
  url: string
  width: number
  height: number
  bytes: number
}

/** Decodes the picture the right way up (EXIF orientation applied). */
async function decode(file: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { img: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() }
    } catch {
      /* an older browser: use an <img> (it applies EXIF orientation by default too) */
    }
  }
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  try {
    await img.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new Error("That file isn't a photo this browser can open. Try a JPEG or PNG.")
  }
  return { img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) }
}

/** The photo, small and as JPEG. Throws a plain message for a file that isn't a picture. */
export async function prepFoodPhoto(file: Blob): Promise<PreparedPhoto> {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Pick a photo (JPEG, PNG or HEIC from the camera).')
  const { img, w, h, done } = await decode(file)
  try {
    const { width, height } = fitSize(w, h)
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('This browser cannot shrink the photo.')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    let q = JPEG_QUALITY
    let url = c.toDataURL('image/jpeg', q)
    while (b64Bytes(url.slice(url.indexOf(',') + 1)) > TARGET_BYTES && q > 0.6) url = c.toDataURL('image/jpeg', (q = Math.round((q - 0.1) * 10) / 10))
    const data = url.slice(url.indexOf(',') + 1)
    return { mime: 'image/jpeg', data, url, width, height, bytes: b64Bytes(data) }
  } finally {
    done()
  }
}

/** The first picture in a paste or a drop, or null. */
export function imageFrom(list: DataTransferItemList | FileList | null | undefined): File | null {
  if (!list) return null
  for (const x of Array.from(list as ArrayLike<DataTransferItem | File>)) {
    const f = x instanceof File ? x : x.kind === 'file' ? x.getAsFile() : null
    if (f && /^image\//.test(f.type)) return f
  }
  return null
}

export interface PhotoAsk {
  image: { mime: string; data: string }
  note: string
  saved: SavedFoodRef[]
  today: { kcal: number; protein: number; items?: string[] }
  targets: { kcal: number; protein: number }
}
export type PhotoAnswer = { ok: true; result: unknown } | { ok: false; error: string; fallback?: string; limit?: 'day' | 'budget' }

/** Asks the server to read the photo (session required). Never throws: a failure is {ok:false, error}. */
export async function askFoodPhoto(ask: PhotoAsk, fetchImpl: typeof fetch = fetch): Promise<PhotoAnswer> {
  try {
    const r = await fetchImpl('/api/ai', {
      method: 'POST',
      headers: { Authorization: `Bearer ${currentSession() ?? ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'foodPhoto', ...ask }),
      signal: AbortSignal.timeout(58_000)
    })
    const j = await r.json().catch(() => ({}))
    if (r.status === 401) return { ok: false, error: 'Locked: enter your PIN again, then retry.' }
    if (!r.ok) return { ok: false, error: j?.error || `The server answered ${r.status}. Try again.` }
    if (j?.ok === true) return { ok: true, result: j.result }
    return { ok: false, error: String(j?.error || 'The photo could not be read.'), ...(j?.fallback ? { fallback: String(j.fallback) } : {}), ...(j?.limit ? { limit: j.limit } : {}) }
  } catch (e: any) {
    const slow = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    return { ok: false, error: slow ? 'Reading the photo took too long. Try again.' : 'No connection to the server. Try again, or copy the prompt instead.' }
  }
}
