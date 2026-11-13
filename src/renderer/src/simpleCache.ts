// The last simple-mode setting read on this screen. Kept apart from useSimple so the sound engine and the
// island can ask "are coins shown?" without loading the data layer.
import { DEFAULT_SIMPLE, type SimpleMode } from '@core/simpleMode'

let cached: SimpleMode = DEFAULT_SIMPLE
export const simpleNow = (): SimpleMode => cached
export const setSimpleNow = (v: SimpleMode): void => {
  cached = v
}
/** Coins shown right now, for code outside React (island text, toasts, sounds). Off until the setting is read. */
export const coinsShownNow = (): boolean => cached.coins
