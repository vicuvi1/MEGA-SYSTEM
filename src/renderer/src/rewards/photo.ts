// A reward's photo, made small on the device (RF1): the longest side at most
// 360 px, a JPEG of about 20 KB, kept as a data link in the reward itself.
export const PHOTO_MAX = 360

export async function shrinkPhoto(file: File, max = PHOTO_MAX, quality = 0.72): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Pick a photo (JPG, PNG or WebP)')
  if (file.size > 15 * 1024 * 1024) throw new Error('That photo is too big (15 MB at most)')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => bad(new Error('Could not read that photo'))
      i.src = url
    })
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * k))
    const h = Math.max(1, Math.round(img.naturalHeight * k))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    if (!g) throw new Error('Could not shrink that photo')
    g.drawImage(img, 0, 0, w, h)
    return c.toDataURL('image/jpeg', quality)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** A photo the page can show: a web address or one of our small data links. */
export const isPhotoUrl = (s: string) => /^https:\/\/\S+$/i.test(s) || /^data:image\/(jpeg|png|webp);base64,/.test(s)
