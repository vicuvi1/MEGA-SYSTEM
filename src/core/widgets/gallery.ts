// PL3: the widget gallery (widgets/gallery.json in the repo). Each entry
// names a widget, its author, version, the sha256 of its widget.js and a
// screenshot. Installing pins the hash: a widget whose code doesn't match the
// hash you installed never runs. Pure and tested (gallery.test.ts).

export interface GalleryEntry {
  id: string
  name: string
  author: string
  version: string
  /** sha256 of widget.js, lower-case hex. */
  sha256: string
  /** A picture in the repo (widgets/<id>/screenshot.png). */
  screenshot: string
  about: string
}

const HEX64 = /^[0-9a-f]{64}$/
const ID = /^[a-z][a-z0-9-]{1,31}$/

export function cleanGallery(v: any): GalleryEntry[] {
  const out: GalleryEntry[] = []
  for (const e of Array.isArray(v?.widgets) ? v.widgets : []) {
    if (!e || !ID.test(String(e.id)) || !HEX64.test(String(e.sha256)) || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(String(e.version))) continue
    if (out.some((x) => x.id === e.id)) continue
    const shot = typeof e.screenshot === 'string' && /^[a-z0-9-]+\/[a-z0-9-]+\.png$/.test(e.screenshot) ? e.screenshot : ''
    out.push({ id: e.id, name: String(e.name ?? e.id).slice(0, 40), author: String(e.author ?? '').slice(0, 40), version: e.version, sha256: e.sha256, screenshot: shot, about: String(e.about ?? '').slice(0, 140) })
  }
  return out
}

/** sha256 of a text (UTF-8), lower-case hex. Works in the browser and in Node (WebCrypto). */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Does this code match the hash you installed? */
export async function matchesPin(code: string, pinned: string): Promise<boolean> {
  if (!HEX64.test(pinned)) return false
  return (await sha256Hex(code)) === pinned
}
