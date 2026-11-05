// The island's buttons fire on the release of the mouse, not on the browser's
// "click": a click needs the press and the release on the very same element,
// and the island redraws itself a lot (the timer's digits, a new snapshot, a
// view opening), so a button could be replaced between the two and the click
// never came. Here each button has a name (data-tap); the press and the
// release are matched by that name, the release is read where the pointer
// really is, and a release whose press Windows swallowed still counts.
// The keyboard (Enter / Space on a focused button) still works through onClick.
import { PRESS_HOLD_MS, tapVerdict } from '@core/islandClicks'

export interface TapInfo { el: HTMLElement; x: number; y: number; keyboard: boolean }
type TapFn = (t: TapInfo) => void

const handlers = new Map<string, TapFn>()
/** What the debug overlay shows: presses, releases, clicks and what they hit. */
export const tapStats = {
  downs: 0,
  ups: 0,
  clicks: 0,
  fired: 0,
  upNoDown: 0,
  last: null as null | { at: number; down: string; up: string; click: string; fired: string }
}

/** A short, private description of an element (no text from your data): tag, button name, first class. */
export function describeEl(el: Element | null): string {
  const h = el as HTMLElement | null
  if (!h || typeof h.tagName !== 'string') return 'nothing'
  const tap = h.closest?.('[data-tap]') as HTMLElement | null
  const cls = typeof h.className === 'string' ? h.className.split(/\s+/).filter(Boolean)[0] : ''
  return `${h.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${tap ? ` [${tap.dataset.tap}]` : ''}`
}

/**
 * The props for a button that fires on release: `id` names it (the same id
 * for the same button, however often it is redrawn).
 */
export function tp(id: string, fn: TapFn): { 'data-tap': string; onClick: (e: React.MouseEvent<HTMLElement>) => void } {
  handlers.set(id, fn)
  return {
    'data-tap': id,
    onClick: (e) => {
      // Mouse clicks already fired on release; this is the keyboard's click (Enter / Space).
      if (e.detail !== 0) return
      e.stopPropagation()
      handlers.get(id)?.({ el: e.currentTarget, x: 0, y: 0, keyboard: true })
    }
  }
}

const pressSubs = new Set<(pressed: boolean) => void>()
/** Told when a press starts (true) and 150 ms after its release (false). */
export function onPress(fn: (pressed: boolean) => void): () => void {
  pressSubs.add(fn)
  return () => void pressSubs.delete(fn)
}
let pressed = false
let releaseT = 0
let safetyT = 0
const setPressed = (on: boolean) => {
  if (pressed === on) return
  pressed = on
  for (const f of pressSubs) f(on)
}
/** A mouse button is down on the island (or was released less than 150 ms ago). */
export const isPressed = () => pressed

let down: { id: string | null; at: number; x: number; y: number } = { id: null, at: 0, x: 0, y: 0 }
let lastFire = { id: null as string | null, at: 0 }
let suppressUntil = 0
const tapAt = (x: number, y: number, fallback: EventTarget | null): HTMLElement | null => {
  const hit = (typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null) as HTMLElement | null
  return (hit?.closest?.('[data-tap]') as HTMLElement | null) ?? ((fallback as HTMLElement | null)?.closest?.('[data-tap]') as HTMLElement | null) ?? null
}

let installed = 0
/** Listens on the whole page (once); returns the stop function. */
export function installTaps(): () => void {
  installed++
  if (installed > 1) return () => void installed--
  const onDown = (e: PointerEvent) => {
    tapStats.downs++
    const el = tapAt(e.clientX, e.clientY, e.target)
    down = { id: e.button === 0 ? el?.dataset.tap ?? null : null, at: Date.now(), x: e.clientX, y: e.clientY }
    tapStats.last = { at: Date.now(), down: describeEl(e.target as Element), up: '', click: '', fired: '' }
    clearTimeout(releaseT)
    clearTimeout(safetyT)
    setPressed(true)
    // A release that never comes (the pointer left the window) doesn't freeze the island.
    safetyT = window.setTimeout(() => setPressed(false), 3000)
  }
  const release = () => {
    clearTimeout(releaseT)
    clearTimeout(safetyT)
    releaseT = window.setTimeout(() => setPressed(false), PRESS_HOLD_MS)
  }
  const onUp = (e: PointerEvent) => {
    tapStats.ups++
    const now = Date.now()
    const el = tapAt(e.clientX, e.clientY, e.target)
    const upId = e.button === 0 ? el?.dataset.tap ?? null : null
    const verdict = tapVerdict({
      downId: down.id, downAt: down.at, upId, now,
      moved: down.at ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 0,
      dragging: document.documentElement.classList.contains('di-dragging'),
      lastFireAt: lastFire.at, lastFireId: lastFire.id
    })
    if (!down.at || now - down.at > 3000) tapStats.upNoDown++
    const last = tapStats.last && now - tapStats.last.at < 3000 ? tapStats.last : { at: now, down: 'nothing (no press seen)', up: '', click: '', fired: '' }
    tapStats.last = { ...last, up: describeEl(e.target as Element) }
    down = { id: null, at: 0, x: 0, y: 0 }
    release()
    if (verdict === 'none' || !el || !upId) return
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return
    const fn = handlers.get(upId)
    if (!fn) return
    lastFire = { id: upId, at: now }
    suppressUntil = now + 500
    tapStats.fired++
    tapStats.last = { ...tapStats.last, fired: `${upId}${verdict === 'lost-down' ? ' (press was lost)' : ''}` }
    fn({ el, x: e.clientX, y: e.clientY, keyboard: false })
  }
  const onCancel = () => {
    down = { id: null, at: 0, x: 0, y: 0 }
    release()
  }
  // The browser's own click after a release that already fired: stopped, so
  // the peek or pill around the button doesn't also open the panel.
  const onClick = (e: MouseEvent) => {
    tapStats.clicks++
    if (tapStats.last) tapStats.last = { ...tapStats.last, click: describeEl(e.target as Element) }
    if (e.detail !== 0 && Date.now() < suppressUntil) {
      e.stopPropagation()
      e.preventDefault()
    }
  }
  window.addEventListener('pointerdown', onDown, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onCancel, true)
  window.addEventListener('click', onClick, true)
  return () => {
    if (--installed > 0) return
    window.removeEventListener('pointerdown', onDown, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onCancel, true)
    window.removeEventListener('click', onClick, true)
  }
}
