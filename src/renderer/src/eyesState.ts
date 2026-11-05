// Island eyes: the desktop's eyes state, one listener shared by the page (Settings, the island).
import type { EyesState } from '../../shared/eyes'

const subs = new Set<(s: EyesState) => void>()
let hooked = false
export function onEyesState(cb: (s: EyesState) => void): () => void {
  const eyes = window.desktop?.eyes
  if (!eyes) return () => {}
  if (!hooked) {
    hooked = true
    eyes.onState((s) => {
      for (const f of subs) f(s)
    })
  }
  subs.add(cb)
  return () => void subs.delete(cb)
}

