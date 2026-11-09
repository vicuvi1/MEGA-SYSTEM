// Photo Locker: getting a photo, video or file ready to keep, in the browser.
//   - photos: the right way up, longest side 2000 px, JPEG 0.86 (drawing it
//     again drops EXIF, location included), plus a 360 px thumbnail;
//   - videos: at most 60 seconds and 150 MB, kept as they are (re-encoding to
//     720p in a browser is slow and unreliable on phones, so it is not done),
//     plus a thumbnail from the first second;
//   - other files: up to 200 MB, kept as they are.
import { checkFile, checkVideo, fitSide, kindOf, newVaultId, PROGRESS_TAG, type VaultKind } from '@core/vaultSync'
import type { VaultItem } from './vaultStore'

const THUMB_SIDE = 360

async function decodeImage(file: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { img: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() }
    } catch {
      /* an older browser: an <img> applies EXIF orientation too */
    }
  }
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new Error("That photo can't be opened in this browser. Try a JPEG or PNG.")
  }
  return { img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) }
}

function draw(src: CanvasImageSource, w: number, h: number, max: number, quality: number): Promise<{ blob: Blob; w: number; h: number }> {
  const { width, height } = fitSide(w, h, max)
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('This browser cannot prepare the photo.')
  ctx.drawImage(src, 0, 0, width, height)
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok({ blob: b, w: width, h: height }) : no(new Error('Could not save the photo'))), 'image/jpeg', quality))
}

export async function prepPhoto(file: Blob): Promise<{ blob: Blob; thumb: Blob; w: number; h: number }> {
  const { img, w, h, done } = await decodeImage(file)
  try {
    const big = await draw(img, w, h, 2000, 0.86)
    const small = await draw(img, w, h, THUMB_SIDE, 0.75)
    return { blob: big.blob, thumb: small.blob, w: big.w, h: big.h }
  } finally {
    done()
  }
}

/** A video's length and size, and a thumbnail (null when the browser can't play it). */
export async function videoInfo(file: Blob): Promise<{ durationS: number; w: number; h: number; thumb: Blob | null }> {
  const url = URL.createObjectURL(file)
  const v = document.createElement('video')
  v.preload = 'metadata'
  v.muted = true
  v.playsInline = true
  v.src = url
  try {
    await new Promise<void>((ok, no) => {
      const t = setTimeout(() => no(new Error("This video's length can't be read. Try another file.")), 15_000)
      v.onloadedmetadata = () => (clearTimeout(t), ok())
      v.onerror = () => (clearTimeout(t), no(new Error("This video can't be opened in this browser. Try an MP4 file.")))
    })
    // Some files say Infinity until the end is reached.
    if (!Number.isFinite(v.duration)) {
      v.currentTime = 1e9
      await new Promise((ok) => setTimeout(ok, 400))
    }
    const durationS = v.duration
    let thumb: Blob | null = null
    try {
      v.currentTime = Math.min(1, (durationS || 1) / 2)
      await new Promise<void>((ok) => {
        const t = setTimeout(ok, 3000)
        v.onseeked = () => (clearTimeout(t), ok())
      })
      if (v.videoWidth) thumb = (await draw(v, v.videoWidth, v.videoHeight, THUMB_SIDE, 0.75)).blob
    } catch {
      thumb = null
    }
    return { durationS, w: v.videoWidth, h: v.videoHeight, thumb }
  } finally {
    v.removeAttribute('src')
    v.load()
    URL.revokeObjectURL(url)
  }
}

/** A thumbnail for a file that came down from Drive (null for other files). */
export async function thumbOf(blob: Blob, kind: VaultKind): Promise<Blob | null> {
  if (kind === 'photo') {
    const { img, w, h, done } = await decodeImage(blob)
    try {
      return (await draw(img, w, h, THUMB_SIDE, 0.75)).blob
    } finally {
      done()
    }
  }
  if (kind === 'video') return (await videoInfo(blob)).thumb
  return null
}

/** One picked file → an item ready to keep. Throws a plain message (a video over 60 s, a file too big). */
export async function prepare(file: File, opts: { progress?: boolean; tags?: string[]; now?: number } = {}): Promise<VaultItem> {
  const now = opts.now ?? Date.now()
  const mime = file.type || 'application/octet-stream'
  let kind: VaultKind = kindOf(mime)
  const tags = [...(opts.tags ?? [])]
  const base = { id: newVaultId(now), name: (file.name || `${kind}-${new Date(now).toISOString().slice(0, 10)}`).slice(0, 80), takenAt: file.lastModified && file.lastModified < now ? file.lastModified : now, updatedAt: now }
  if (kind === 'photo' && !/^image\/(svg|gif)/.test(mime)) {
    const p = await prepPhoto(file)
    if (opts.progress && !tags.includes(PROGRESS_TAG)) tags.unshift(PROGRESS_TAG)
    return { ...base, kind, name: base.name.replace(/\.(heic|heif|png|webp|jpe?g)$/i, '') + '.jpg', tags, mime: 'image/jpeg', blob: p.blob, thumb: p.thumb, w: p.w, h: p.h, sizeBytes: p.blob.size }
  }
  if (kind === 'video') {
    const info = await videoInfo(file)
    const bad = checkVideo(info.durationS, file.size)
    if (bad) throw new Error(bad)
    return { ...base, kind, tags, mime, blob: file, thumb: info.thumb ?? undefined, w: info.w, h: info.h, durationS: Math.round(info.durationS * 10) / 10, sizeBytes: file.size }
  }
  kind = 'file'
  const bad = checkFile(file.size)
  if (bad) throw new Error(bad)
  return { ...base, kind, tags, mime, blob: file, sizeBytes: file.size }
}
