// Custom Center on this page: one copy of your set-up and today's custom
// numbers, shared by the Custom Center page and the app background. Changes
// show at once (and are saved next); each set-up change can be undone. The
// synced settings are the truth; a copy of the background in localStorage
// paints the right one at start-up before the data is ready.
import { useEffect, useState } from 'react'
import { activeLayout, defaultSetup, EMPTY_STATE, NO_BACKGROUND, cleanBackground, type Background, type CustomSetup, type CustomState } from '@core/custom'
import { life } from '../bridge'

const EVENT = 'life-custom'
const BG_KEY = 'ls.customBg'
const UNDO_MAX = 20

export interface CustomStore {
  setup: CustomSetup
  state: CustomState
  loaded: boolean
  /** The synced set-up came from a newer app: this one only reads it. */
  newer: boolean
  /** How many changes Undo can take back. */
  undo: number
}

let store: CustomStore = { setup: defaultSetup(), state: EMPTY_STATE, loaded: false, newer: false, undo: 0 }
const history: CustomSetup[] = []

function publish(next: Partial<CustomStore>): void {
  store = { ...store, ...next, undo: history.length }
  cacheBackground()
  window.dispatchEvent(new CustomEvent(EVENT))
}

/** The background on now, kept on this device for the first paint. */
function cacheBackground(): void {
  try {
    localStorage.setItem(BG_KEY, JSON.stringify(activeLayout(store.setup, Date.now()).background))
  } catch {
    /* private window: it shows once the data is read */
  }
}
export function cachedBackground(): Background {
  try {
    return cleanBackground(JSON.parse(localStorage.getItem(BG_KEY) || 'null'))
  } catch {
    return NO_BACKGROUND
  }
}

export const getCustom = (): CustomStore => store

let loading: Promise<void> | null = null
/** Reads the synced set-up (again). */
export function loadCustom(): Promise<void> {
  if (!life.custom) {
    if (!store.loaded) publish({ loaded: true })
    return Promise.resolve()
  }
  return (loading ??= life.custom
    .get()
    .then((r) => publish({ setup: r.setup, state: r.state, newer: r.newer, loaded: true }))
    .catch(() => publish({ loaded: true }))
    .finally(() => (loading = null)))
}

let saving: Promise<unknown> = Promise.resolve()
/**
 * Changes the set-up: it shows at once, then is saved (in order). `undoable`
 * keeps the old one for Undo. A refused save goes back and throws its reason.
 */
export async function changeSetup(fn: (s: CustomSetup) => CustomSetup, undoable = true): Promise<CustomSetup> {
  const before = store.setup
  const next = { ...fn(before), savedAt: Date.now() }
  if (undoable) {
    history.push(before)
    if (history.length > UNDO_MAX) history.shift()
  }
  publish({ setup: next })
  if (!life.custom) return next
  const run = saving.then(() => life.custom!.save(next))
  saving = run.catch(() => null)
  try {
    const saved = await run
    // Only take the saved copy if nothing changed in between.
    if (store.setup === next) publish({ setup: saved })
    return saved
  } catch (e) {
    if (undoable && history[history.length - 1] === before) history.pop()
    if (store.setup === next) publish({ setup: before })
    throw e
  }
}

/** Takes back the last set-up change. False when there is nothing to undo. */
export async function undoSetup(): Promise<boolean> {
  const prev = history.pop()
  if (!prev) return false
  await changeSetup(() => prev, false)
  return true
}

/** Changes today's custom numbers (shown at once, saved next; no undo stack: each tap has its own way back). */
export async function changeState(fn: (s: CustomState) => CustomState): Promise<void> {
  const next = fn(store.state)
  publish({ state: next })
  if (!life.custom) return
  const run = saving.then(() => life.custom!.saveState(next))
  saving = run.catch(() => null)
  await run.catch(() => null)
}

/** The shared store; re-renders on every change. */
export function useCustom(): CustomStore {
  const [v, setV] = useState(store)
  useEffect(() => {
    const on = () => setV(store)
    window.addEventListener(EVENT, on)
    setV(store)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  return v
}
