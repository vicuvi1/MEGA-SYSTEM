// Custom Center on the desktop island, the app window's side (IslandFeed.tsx
// calls these once per island build). It reads your set-up from the one
// shared store, builds the island's view (core/islandCenter.ts), fires your
// reminder rules through the gate, answers the island's taps (counters log
// through `counterRoute`, so only the real logs' own rules can pay points),
// keeps the island where the Center puts it, and changes the Windows
// wallpaper per mode when you switched that on (desktop only).
import { activeLayout, nextModeChange, noteFired, toggleCheck, type RealNumbers } from '@core/custom'
import { CENTER_CARD_MS, CENTER_LATER_MIN, centerIslandView, centerReminderAlert, centerReminderTick, wallpaperFor, type CenterIsland } from '@core/islandCenter'
import { placementOf } from '@core/islandLooks'
import type { GateWhy } from '@core/custom'
import type { IslandAction, IslandAlert } from '@core/islandModel'
import { life } from '../bridge'
import { changeSetup, changeState, getCustom, loadCustom } from './customStore'
import { localUrl } from './localFiles'
import { tapCounter } from './runner'

const LATER = 'ls.centerLater'
const PLACE = 'ls.centerPlace'
const RELOAD_MS = 2 * 60_000

const read = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k)
    return v == null ? d : (JSON.parse(v) as T)
  } catch {
    return d
  }
}
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* private window: fine for this session */
  }
}

let loadedAt = 0
/** The island's view of your set-up (null: nothing to show, today's island). */
export async function centerForIsland(now: number, real: RealNumbers): Promise<CenterIsland | null> {
  // Another device's change arrives through sync: read the shared copy again now and then.
  if (!getCustom().loaded || now - loadedAt > RELOAD_MS) {
    loadedAt = now
    await loadCustom().catch(() => {})
  }
  const { setup, state } = getCustom()
  try {
    return centerIslandView(setup, state, real, now)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- reminders

let active: { alert: IslandAlert; rule: string; until: number } | null = null
let held: Record<string, GateWhy> = {}
/** Why each due custom reminder waited at the last check (for the Center page). */
export const centerHeld = () => held

/**
 * Your custom reminder for the island, if one fires now (or the one still up).
 * It is called last in the island's chain, so it only fires when nothing more
 * important is showing; the gate keeps calls, focus, quiet, bedtime, the gap
 * and the caps.
 */
export function centerReminder(now: number, o: { activeSince: number | null; call: boolean; focus: boolean; quiet: boolean; bedtime: string | null; wake: string | null; lastInterruptAt: number }): IslandAlert | null {
  if (active && now < active.until) return active.alert
  active = null
  const { setup, state, loaded } = getCustom()
  if (!loaded) return null
  const later = read<Record<string, number>>(LATER, {})
  const t = centerReminderTick({ setup, state, now, activeSince: o.activeSince, later, ctx: { call: o.call, focus: o.focus, quiet: o.quiet, bedtime: o.bedtime, wake: o.wake, lastInterruptAt: o.lastInterruptAt } })
  held = t.held
  if (!t.fire) return null
  const r = t.fire
  if (later[r.id] != null) {
    delete later[r.id]
    write(LATER, later)
  }
  const logW = r.log ? setup.widgets.find((w) => w.id === r.log!.widget) : null
  const alert = centerReminderAlert(r, now, logW?.title) as IslandAlert
  active = { alert, rule: r.id, until: now + CENTER_CARD_MS }
  // It counts the moment it shows (the rule's cap and the day's cap).
  void changeState((s) => noteFired(s, r.id, now))
  return alert
}

/** The island closed a card: a custom reminder that was up is gone. */
export function centerDismiss(alertId: string | undefined): void {
  if (active && alertId && active.alert.id === alertId) active = null
}

// ---------------------------------------------------------------- the island's taps

const undos = new Map<string, { at: number; undo: () => Promise<void> }>()
export const hasCenterUndo = (tapId: string | undefined) => !!tapId && undos.has(tapId)

/** Answers a Custom Center tap from the island. Returns the line the island shows. */
export async function centerAct(a: IslandAction): Promise<string | null> {
  if (a.kind === 'undo') {
    const u = undos.get(a.of)
    if (!u) return null
    undos.delete(a.of)
    await u.undo()
    return 'Taken back'
  }
  if (a.kind !== 'center') return null
  const { setup } = getCustom()
  const now = Date.now()
  switch (a.op) {
    case 'count': {
      const w = setup.widgets.find((x) => x.id === a.widget)
      if (w?.kind !== 'counter') throw new Error('That counter is gone')
      const amount = Math.max(-10_000, Math.min(10_000, Math.round(Number(a.amount) || 0)))
      if (!amount) return null
      // counterRoute: water → the water log, reps → Sport Track + its workout log, else only the Center (pays nothing).
      const r = await tapCounter(w, amount)
      for (const [k, v] of undos) if (now - v.at > 10 * 60_000) undos.delete(k)
      if (a.id) undos.set(a.id, { at: now, undo: r.undo })
      return `✓ ${r.said}`
    }
    case 'check': {
      const w = setup.widgets.find((x) => x.id === a.widget)
      if (w?.kind !== 'checklist') throw new Error('That checklist is gone')
      const item = w.items.find((x) => x.id === a.item)
      if (!item) return null
      let ticked = false
      await changeState((s) => {
        const next = toggleCheck(s, w, a.item, now)
        ticked = next.checks[w.id]?.done.includes(a.item) ?? false
        return next
      })
      return ticked ? `✓ ${item.text}` : `Unticked: ${item.text}`
    }
    case 'mode': {
      const m = setup.modes.find((x) => x.id === a.mode)
      if (!m) throw new Error('That mode is gone')
      await changeSetup((s) => ({ ...s, manual: { mode: m.id, at: Date.now(), until: null } }), false)
      return `${m.icon} ${m.name} mode`
    }
    case 'timer': {
      const w = setup.widgets.find((x) => x.id === a.widget)
      if (w?.kind !== 'timer') throw new Error('That timer is gone')
      const st = await life.focus.start(w.subject || w.title, w.focusMin, null)
      window.dispatchEvent(new Event('life-focus-changed'))
      return st?.running ? `⏱ ${w.subject || w.title} · ${w.focusMin} min` : 'The timer did not start'
    }
    case 'remind': {
      if (active?.rule === a.rule) active = null
      const r = setup.reminders.find((x) => x.id === a.rule)
      if (!r) return null
      if (a.answer === 'later') {
        write(LATER, { ...read<Record<string, number>>(LATER, {}), [r.id]: now + CENTER_LATER_MIN * 60_000 })
        return `Again in ${CENTER_LATER_MIN} min`
      }
      // Done: it already counted when it showed; "Done" may also add to a counter (that counter's own route).
      const w = r.log ? setup.widgets.find((x) => x.id === r.log!.widget) : null
      if (r.log && w?.kind === 'counter') {
        const t = await tapCounter(w, r.log.amount)
        return `✓ ${r.text} · ${t.said}`
      }
      return `✓ ${r.text}`
    }
  }
  return null
}

// ---------------------------------------------------------------- the desktop: position, mode changes, wallpaper

/** The Center's island position (when set) goes to the desktop once per change: a later drag still wins. */
export function applyCenterPlace(c: CenterIsland | null): void {
  const place = placementOf(c?.looks.position ?? null)
  const key = place ?? ''
  if (read<string>(PLACE, '') === key) return
  write(PLACE, key)
  if (place) void window.desktop?.setIslandPrefs?.({ place } as never)
}

let modeTimer = 0
/** One timer to the next scheduled mode change, so the island swaps right then (not up to 15 s later). */
export function scheduleModeChange(now: number, send: () => void): void {
  clearTimeout(modeTimer)
  const { setup, loaded } = getCustom()
  if (!loaded) return
  const t = nextModeChange(setup.modes, now)
  if (t == null || t - now > 6 * 3600_000) return
  modeTimer = window.setTimeout(send, Math.max(1000, t - now + 500))
}

let wp = { key: '', at: 0, on: null as boolean | null, onAt: 0 }
/** Tells the desktop which wallpaper this mode wants (only with "Change my Windows wallpaper" on). */
export async function wallpaperTick(now: number): Promise<void> {
  const desk = window.desktop
  if (!desk?.wallpaper) return
  if (wp.on == null || now - wp.onAt > 5 * 60_000) {
    const st = await desk.wallpaper({ op: 'get' }).catch(() => null)
    wp = { ...wp, on: !!st?.on, onAt: now }
  }
  if (!wp.on) return
  const { setup, loaded } = getCustom()
  if (!loaded) return
  const mode = activeLayout(setup, now).mode
  const ref = wallpaperFor(mode.desktopWallpaper, now)
  const key = `${mode.id}|${ref ?? ''}`
  // A new picture is sent once; a folder is checked again every 5 minutes (the desktop picks the picture for the time).
  if (key === wp.key && now - wp.at < 5 * 60_000) return
  const image = key !== wp.key && ref ? await localUrl(ref) : null
  wp = { ...wp, key, at: now }
  await desk.wallpaper({ op: 'apply', mode: mode.id, image }).catch(() => null)
}
/** The Center page switched it on or off: read it again at the next build. */
export function wallpaperChanged(): void {
  wp = { key: '', at: 0, on: null, onAt: 0 }
}
