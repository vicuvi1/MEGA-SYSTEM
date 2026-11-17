// Money privacy on the Life side: the same state as Finance Helper (its
// js/privacy.js), so Space, the eye and the idle timer act on both at once.
// A component that prints an amount calls useMoneyHidden() so it redraws when
// the state changes; the amounts themselves are hidden by the shared
// formatter (core/moneyText -> finance money.js).
import { useEffect, useSyncExternalStore } from 'react'
// @ts-ignore plain JS module shared with the embedded Finance Helper
import * as P from '../../public/apps/finance/js/privacy.js'

type Api = {
  isHidden(): boolean
  subscribe(fn: (hidden: boolean) => void): () => void
  toggle(): boolean
  start(o?: { keys?: boolean }): void
  onKey(e: KeyboardEvent): boolean
  onKeyUp(e: KeyboardEvent): boolean
}
const api = P as Api

export const moneyHidden = (): boolean => api.isHidden()
export const toggleMoneyHidden = (): boolean => api.toggle()

/** True while amounts are hidden. Starts the shared timers and window listeners once. */
export function useMoneyHidden(): boolean {
  useEffect(() => api.start(), [])
  return useSyncExternalStore(api.subscribe, api.isHidden, api.isHidden)
}

/** Space shows or hides amounts while `active` (the Money page, or Finance Helper, is open). */
export function useMoneyPrivacyKeys(active: boolean): void {
  useEffect(() => {
    if (!active) return
    api.start()
    const down = (e: KeyboardEvent) => void api.onKey(e)
    const up = (e: KeyboardEvent) => void api.onKeyUp(e)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [active])
}
