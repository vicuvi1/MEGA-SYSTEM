// AU1: what's playing on this PC, and play/pause/next (Windows media
// controls, through one short PowerShell call; the media keys when those
// can't be read). Asked only on demand: never polled from here.
import { mediaKeyScript, mediaScript, parseMedia, type MediaNow, type MediaOp } from '../../core/pcMedia'
import { runPs } from './ps'

let last: { at: number; m: MediaNow | null } = { at: 0, m: null }

/** Runs one op and gives what's playing after it (null: Windows couldn't say). */
export async function media(op: MediaOp): Promise<{ now: MediaNow | null; via: 'controls' | 'keys' | 'none' }> {
  // A "get" right after another one is answered from the last (two windows asking at once).
  if (op === 'get' && Date.now() - last.at < 5000) return { now: last.m, via: last.m ? 'controls' : 'none' }
  const out = await runPs(mediaScript(op), { timeoutMs: 8000, lane: `media:${op}` })
  const now = out == null ? null : parseMedia(out)
  if (now || op === 'get') {
    last = { at: Date.now(), m: now }
    if (now) return { now, via: 'controls' }
    return { now: null, via: 'none' }
  }
  // The media controls didn't answer: press the key (works with any player, no state).
  const ok = (await runPs(mediaKeyScript(op), { timeoutMs: 5000, lane: 'mediakey' })) != null
  last = { at: 0, m: null }
  return { now: null, via: ok ? 'keys' : 'none' }
}
