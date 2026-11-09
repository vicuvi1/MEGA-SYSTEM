// Where the desktop app finds its page files, and how the island's sound gets
// out when its own audio won't start. Pure (no Electron), tested.
//
// Sounds: the island's sounds are all synthesized by the sound kit (soundKit.ts,
// notes in core/sounds.ts), so there are no sound files to package. Your own
// sounds (Custom Center → Looks → Sounds) live in this device's IndexedDB as
// data: URLs (CSP media-src allows data: and blob:). The page itself is served
// from out/renderer through the life-system:// protocol, the same folder in a
// dev build (`npm run build:electron`) and inside app.asar in the installed app.
import { resolve, sep } from 'node:path'

/**
 * The file on disk for a life-system://app path, or null when it would leave
 * the page folder. `root` is out/renderer (next to out/main in both dev and
 * the packaged app.asar).
 */
export function appFile(root: string, pathname: string): string | null {
  let p: string
  try {
    p = decodeURIComponent(pathname === '/' || pathname === '' ? '/index.html' : pathname)
  } catch {
    return null
  }
  if (p.includes('\0')) return null
  const base = resolve(root)
  const target = resolve(base, '.' + (p.startsWith('/') ? p : '/' + p))
  return target.startsWith(base + sep) ? target : null
}

/** The page folder from the compiled main script's folder (out/main → out/renderer). */
export const rendererRoot = (mainDir: string) => resolve(mainDir, '../renderer')

/** Who plays the island's sound when the island's own audio didn't start. */
export type SoundFallback = 'app window' | 'system beep'
export const soundFallbackRoute = (appWindowAlive: boolean): SoundFallback => (appWindowAlive ? 'app window' : 'system beep')
