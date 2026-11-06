// Pure helpers for the desktop island window (no Electron here, so they can
// be tested): where the window goes, how big it may be, where it takes
// clicks, which shortcuts it uses and what the Windows watcher said.
import { isAltGrCombo, normalizeAccelerator } from '../core/islandKeys'
import { cleanHide, cleanSpots, SHOWN, type HideState, type ScreenSpot } from '../core/islandMove'

export interface Box { x: number; y: number; width: number; height: number }
/** A clickable area as the island page reports it (CSS pixels of the page). */
export interface HotRect { x: number; y: number; w: number; h: number }
/** Top center ('top'), the top left / right corner, docked on a side, or floating where you dropped it (IF1). */
export type Placement = 'top' | 'top-left' | 'top-right' | 'left' | 'right' | 'free'
export const PLACEMENTS: readonly Placement[] = ['top-left', 'top', 'top-right', 'left', 'right', 'free']
export const PLACEMENT_LABEL: Record<Placement, string> = { 'top-left': 'Top left', top: 'Top center', 'top-right': 'Top right', left: 'Docked left', right: 'Docked right', free: 'Floating (where you drop it)' }
export const isPlacement = (p: unknown): p is Placement => typeof p === 'string' && (PLACEMENTS as readonly string[]).includes(p)

/** The window's own size before the size setting: room for the widest view (IF3). */
export const WIN_BASE = { width: 500, height: 660 }
export function islandBase(p: { peekWidth?: number; panelWidth?: number }): { width: number; height: number } {
  const widest = Math.max(Number(p.peekWidth) || 0, Number(p.panelWidth) || 0)
  return { width: Math.max(WIN_BASE.width, Math.round(widest + 40)), height: WIN_BASE.height }
}

/**
 * The window size: the base size times the size setting, but never taller
 * or wider than the screen's work area (small or zoomed screens).
 */
export function islandSize(base: { width: number; height: number }, scale: number, wa: Box): { width: number; height: number } {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1
  return {
    width: Math.max(1, Math.min(Math.round(base.width * s), Math.floor(wa.width))),
    height: Math.max(1, Math.min(Math.round(base.height * s), Math.floor(wa.height)))
  }
}

/**
 * Where the window goes on its screen (IF1), plus your exact pixel offset.
 * The top of the work area wins over the bottom (clamped last), so the pill
 * never ends up above the screen.
 */
export function placeIsland(o: { wa: Box; width: number; height: number; place: Placement; pos: { cx: number; top: number; cy: number }; sidePillY: number; offset?: { x: number; y: number } }): { x: number; y: number } {
  const { wa, width, height } = o
  const dx = Number.isFinite(o.offset?.x) ? o.offset!.x : 0
  const dy = Number.isFinite(o.offset?.y) ? o.offset!.y : 0
  const clampX = (x: number) => Math.round(Math.max(wa.x, Math.min(wa.x + wa.width - width, x + dx)))
  const clampY = (y: number) => Math.round(Math.max(wa.y, Math.min(wa.y + wa.height - height, y + dy)))
  if (o.place === 'left' || o.place === 'right') {
    const x = o.place === 'left' ? wa.x : wa.x + wa.width - width
    return { x: clampX(x), y: clampY(wa.y + o.pos.cy * wa.height - o.sidePillY) }
  }
  if (o.place === 'top-left') return { x: clampX(wa.x), y: clampY(wa.y) }
  if (o.place === 'top-right') return { x: clampX(wa.x + wa.width - width), y: clampY(wa.y) }
  return { x: clampX(wa.x + o.pos.cx * wa.width - width / 2), y: clampY(o.place === 'free' ? wa.y + o.pos.top : wa.y) }
}

const finite = (...n: unknown[]) => n.every((v) => typeof v === 'number' && Number.isFinite(v))

/**
 * What the island page sent on island:hot: the new `{ rects: [{x,y,w,h}] }`
 * or the old single `{x,y,width,height}`. Null when it's nonsense.
 */
export function hotRects(payload: unknown): HotRect[] | null {
  const p = payload as any
  if (!p || typeof p !== 'object') return null
  if (Array.isArray(p.rects)) {
    const list = p.rects
      .slice(0, 16)
      .map((r: any) => (r && finite(r.x, r.y, r.w ?? r.width, r.h ?? r.height) ? { x: r.x, y: r.y, w: Math.max(0, r.w ?? r.width), h: Math.max(0, r.h ?? r.height) } : null))
      .filter((r: HotRect | null): r is HotRect => !!r)
    return list
  }
  if (finite(p.x, p.y, p.width, p.height)) return [{ x: p.x, y: p.y, w: Math.max(0, p.width), h: Math.max(0, p.height) }]
  return null
}

/** CSS pixels of the page → window pixels (DIP), with the page's real zoom. */
export function rectsToDip(rects: HotRect[], zoom: number): HotRect[] {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return rects.map((r) => ({ x: r.x * z, y: r.y * z, w: r.w * z, h: r.h * z }))
}

/** Is the point (window pixels) over one of the areas (with a small margin)? */
export function overRects(x: number, y: number, rects: HotRect[], pad = 4): boolean {
  return rects.some((r) => r.w > 0 && r.h > 0 && x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad)
}

// ---- Shortcuts --------------------------------------------------------------
// Ctrl+Alt on Windows is the same as AltGr: Ctrl+Alt+Q is "@" on a German
// keyboard, Ctrl+Alt+L is "ł" on a Polish one. So the defaults stay away from it.

export const ISLAND_SHORTCUT_DEFAULT = 'Control+Shift+Space'
export const QUIET_SHORTCUT_DEFAULT = 'Alt+Shift+Q'
/** H1: hide / bring back. Not Ctrl+Alt+I by default: that is AltGr+I, a letter on some keyboards. */
export const HIDE_SHORTCUT_DEFAULT = 'Alt+Shift+I'
// Not Ctrl+Shift+N / Ctrl+Shift+B by default: those are a new private window,
// a new folder in Explorer and the bookmarks bar.
/** Quick picks; any real shortcut you record works too (IF9). */
export const CAPTURE_SHORTCUTS = ['Alt+Shift+N', 'Control+Shift+N', 'Control+Alt+N', ''] as const
export const VOICE_SHORTCUTS = ['Alt+Shift+B', 'Control+Shift+B', 'Control+Alt+B', ''] as const

export { isAltGrCombo }

/** Which screen it lives on (IF2): the one you picked (or dropped it on), the main one, or it follows the mouse / the window you work in. */
export type MonitorMode = 'fixed' | 'main' | 'mouse' | 'window'
/** Where it was, for one set of screens (IP5). */
export interface IslandLayout { place: Placement; pos: { cx: number; top: number; cy: number }; offset: { x: number; y: number }; displayId: number; size?: 'compact' | 'normal' | 'large' }

/** The island's own settings that live only on this PC (Settings → Desktop island). */
export interface IslandDeskPrefs {
  /** A full-screen app (video, game, slides) on the island's screen: hide it, shrink it to a dot, or leave it. */
  fullscreen: 'hide' | 'dot' | 'show'
  /** Add a task from anywhere, or '' for none. */
  captureShortcut: string
  /** Talk to Ben from anywhere, or '' for none. */
  voiceShortcut: string
  /** Exact pixels added to where it sits (IF1). */
  offset: { x: number; y: number }
  /** Which screen (IF2). */
  monitor: MonitorMode
  /** Remember where it was for each set of screens, and switch by itself (IP5). */
  perScreen: boolean
  /** Saved spots, by set of screens (see displayKey). */
  layouts: Record<string, IslandLayout>
  /** Apps it always hides over, by their program name ("vlc", "eldenring") (IF6). */
  hideApps: string[]
  /** Island debug is on until this time (ms), 0 = off (IC13). */
  debugUntil: number
  /** H1: hide it / bring it back from anywhere, or '' for none. */
  hideShortcut: string
  /** H1: slide out of the way for a moment when the mouse rushes at it. */
  dodge: boolean
  /** H1: where it was on each screen (see screenKey). */
  spots: Record<string, ScreenSpot>
  /** H1: hidden for a while, or tucked into a dot. */
  hidden: HideState
}
export const DEFAULT_DESK_PREFS: IslandDeskPrefs = {
  fullscreen: 'hide', captureShortcut: CAPTURE_SHORTCUTS[0], voiceShortcut: VOICE_SHORTCUTS[0],
  offset: { x: 0, y: 0 }, monitor: 'fixed', perScreen: true, layouts: {}, hideApps: [], debugUntil: 0,
  hideShortcut: HIDE_SHORTCUT_DEFAULT, dodge: false, spots: {}, hidden: SHOWN
}

const clampInt = (v: unknown, min: number, max: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : d)
const cleanPos = (p: any) => ({ cx: Number.isFinite(p?.cx) ? Math.min(1, Math.max(0, p.cx)) : 0.5, top: Number.isFinite(p?.top) ? Math.max(0, p.top) : 0, cy: Number.isFinite(p?.cy) ? Math.min(1, Math.max(0, p.cy)) : 0.5 })
const cleanOffset = (o: any) => ({ x: clampInt(o?.x, -4000, 4000, 0), y: clampInt(o?.y, -4000, 4000, 0) })
/** A program name as Windows reports it, lower case, without ".exe". */
export const appKey = (proc: string) => String(proc ?? '').trim().toLowerCase().replace(/\.exe$/, '').slice(0, 80)

export function cleanLayout(l: any): IslandLayout | null {
  if (!l || typeof l !== 'object' || !isPlacement(l.place)) return null
  return {
    place: l.place, pos: cleanPos(l.pos), offset: cleanOffset(l.offset), displayId: Number.isFinite(l.displayId) ? l.displayId : -1,
    ...(['compact', 'normal', 'large'].includes(l.size) ? { size: l.size } : {})
  }
}

export function cleanDeskPrefs(p: any): IslandDeskPrefs {
  const d = DEFAULT_DESK_PREFS
  const layouts: Record<string, IslandLayout> = {}
  if (p?.layouts && typeof p.layouts === 'object') {
    for (const [k, v] of Object.entries(p.layouts).slice(-LAYOUTS_MAX)) {
      const l = cleanLayout(v)
      if (l && k.length <= 400) layouts[k] = l
    }
  }
  const cleanKey = (v: unknown, def: string) => (v === '' ? '' : normalizeAccelerator(v) ?? def)
  return {
    fullscreen: ['hide', 'dot', 'show'].includes(p?.fullscreen) ? p.fullscreen : d.fullscreen,
    // IF9: any real shortcut you record.
    captureShortcut: cleanKey(p?.captureShortcut, d.captureShortcut),
    voiceShortcut: cleanKey(p?.voiceShortcut, d.voiceShortcut),
    offset: cleanOffset(p?.offset),
    monitor: ['fixed', 'main', 'mouse', 'window'].includes(p?.monitor) ? p.monitor : d.monitor,
    perScreen: p?.perScreen !== false,
    layouts,
    hideApps: Array.isArray(p?.hideApps) ? [...new Set(p.hideApps.map(appKey).filter(Boolean) as string[])].slice(0, 40) : [],
    debugUntil: typeof p?.debugUntil === 'number' && Number.isFinite(p.debugUntil) && p.debugUntil > 0 ? Math.round(p.debugUntil) : 0,
    hideShortcut: p?.hideShortcut === undefined ? d.hideShortcut : cleanKey(p.hideShortcut, d.hideShortcut),
    dodge: p?.dodge === true,
    spots: cleanSpots(p?.spots),
    hidden: cleanHide(p?.hidden, Date.now())
  }
}

// ---- Screens (IF2, IP5) ---------------------------------------------------------

export interface DisplayInfo { id: number; bounds: Box; primary?: boolean }

/** Which screen it should be on now. Follow modes use the screen seen last (mouse / active window), else where it is, else the main one. */
export function chooseDisplay(o: { mode: MonitorMode; ids: number[]; primaryId: number; savedId: number; followId: number | null; currentId: number | null }): number {
  const has = (id: number | null | undefined): id is number => id != null && o.ids.includes(id)
  if (o.mode === 'main') return o.primaryId
  if (o.mode === 'mouse' || o.mode === 'window') return has(o.followId) ? o.followId : has(o.currentId) ? o.currentId : o.primaryId
  return has(o.savedId) ? o.savedId : o.primaryId
}

/**
 * Following the mouse or the active window (IF2): a new screen counts only
 * once it has been seen for `holdMs` (a quick trip across doesn't move it).
 */
export function followTick(st: { candidate: number | null; since: number }, seen: number | null, current: number | null, now: number, holdMs = 1500): { st: { candidate: number | null; since: number }; moveTo: number | null } {
  if (seen == null || seen === current) return { st: { candidate: null, since: 0 }, moveTo: null }
  if (st.candidate !== seen) return { st: { candidate: seen, since: now }, moveTo: holdMs <= 0 ? seen : null }
  return now - st.since >= holdMs ? { st: { candidate: null, since: 0 }, moveTo: seen } : { st, moveTo: null }
}

/** One set of screens, the same whatever order Windows lists them in: "id:WxH" sorted (IP5). */
export function displayKey(displays: DisplayInfo[]): string {
  return displays.map((d) => `${d.id}:${Math.round(d.bounds.width)}x${Math.round(d.bounds.height)}`).sort().join('|')
}
export const LAYOUTS_MAX = 8
/** Remember this spot for this set of screens; the oldest one goes after 8. */
export function rememberLayout(all: Record<string, IslandLayout>, key: string, l: IslandLayout): Record<string, IslandLayout> {
  const rest = Object.entries(all).filter(([k]) => k !== key)
  return Object.fromEntries([...rest.slice(-(LAYOUTS_MAX - 1)), [key, l]])
}

/** "Screen 2 · 2560 × 1440 (main)" for the settings and the tray. */
export function displayLabel(d: DisplayInfo, i: number): string {
  return `Screen ${i + 1} · ${Math.round(d.bounds.width)} × ${Math.round(d.bounds.height)}${d.primary ? ' (main)' : ''}`
}

/** IF6: the app in front is one you hide it over (and on the island's screen, when known). */
export function hideOverApp(o: { proc: string | null; hideApps: string[]; onIslandScreen: boolean }): boolean {
  return !!o.proc && o.onIslandScreen && o.hideApps.includes(appKey(o.proc))
}

/** Remember the apps seen in front (memory only, for picking in Settings), newest first, at most 20. */
export function noteRecentApp(list: string[], proc: string): string[] {
  const k = appKey(proc)
  if (!k || /^(life system|electron|explorer|searchhost|shellexperiencehost|startmenuexperiencehost|lockapp)$/.test(k)) return list
  return [k, ...list.filter((x) => x !== k)].slice(0, 20)
}

/** The version of island.json that has the new shortcuts. */
export const SHORTCUTS_VERSION = 2

/**
 * Older island.json (version < 2): the old Ctrl+Alt defaults (and any
 * Ctrl+Alt+letter, which AltGr types) move to the new ones; a shortcut you
 * picked that doesn't clash is kept. Newer files are left as they are.
 */
export function migrateShortcuts<T extends { shortcut: string; quietShortcut: string }>(p: T, version: number): T {
  if (version >= SHORTCUTS_VERSION) return p
  return {
    ...p,
    shortcut: p.shortcut && isAltGrCombo(p.shortcut) ? ISLAND_SHORTCUT_DEFAULT : p.shortcut,
    quietShortcut: p.quietShortcut && isAltGrCombo(p.quietShortcut) ? QUIET_SHORTCUT_DEFAULT : p.quietShortcut
  }
}

// ---- The Windows watcher -------------------------------------------------------

export interface WatcherLine {
  /** SHQueryUserNotificationState (system-wide). */
  qs: number
  /** Some app is using the microphone or camera. */
  media: boolean
  /** The app in front covers its whole monitor: that monitor's middle (physical pixels). */
  fs: { x: number; y: number } | null
  app: { proc: string; title: string | null } | null
  /** The middle of the screen the window in front is on (physical pixels): "follow the active window" (IF2). */
  fg?: { x: number; y: number }
  /** A normal window in front is maximized: its monitor's middle (the thin-bar look). */
  max?: { x: number; y: number }
  /** The program in front, always (IF6: apps it hides over; kept in memory only). */
  proc?: string
}

/** "qs=5 media=0 fs=1920,540 fgm=1920,540 fgp=chrome app=chrome|Lofi - YouTube" → its parts. */
export function parseWatcherLine(line: string): WatcherLine | null {
  if (!line.startsWith('qs=')) return null
  const qs = Number(/^qs=(-?\d+)/.exec(line)?.[1] ?? 0)
  const fm = / fs=(-?\d+),(-?\d+)/.exec(line)
  const am = / app=([^|]*)\|?(.*)$/.exec(line)
  // Before " app=" (its title may hold anything).
  const head = line.split(' app=')[0]
  const gm = / fgm=(-?\d+),(-?\d+)/.exec(head)
  const pm = / fgp=([^\s|]+)/.exec(head)
  const xm = / max=(-?\d+),(-?\d+)/.exec(head)
  return {
    qs,
    media: / media=1/.test(line),
    fs: fm ? { x: Number(fm[1]), y: Number(fm[2]) } : null,
    app: am && am[1].trim() ? { proc: am[1].trim(), title: am[2]?.trim() || null } : null,
    ...(gm ? { fg: { x: Number(gm[1]), y: Number(gm[2]) } } : {}),
    ...(pm ? { proc: pm[1] } : {}),
    ...(xm ? { max: { x: Number(xm[1]), y: Number(xm[2]) } } : {})
  }
}

/** 4 = presentation mode (you turned it on): hide on every screen. The rest is per screen. */
export const QUNS_PRESENTATION = 4

/** Seconds since the last sample, for the app-time totals (between 1 and 15). */
export const sampleSeconds = (now: number, prev: number) => (prev > 0 ? Math.min(15, Math.max(1, Math.round((now - prev) / 1000))) : 4)

/** A small rate limit for log lines: the same key at most once per `ms`. */
export function rateLimit(ms: number) {
  const last = new Map<string, number>()
  return (key: string, now = Date.now()) => {
    const t = last.get(key) ?? -Infinity
    if (now - t < ms) return false
    last.set(key, now)
    if (last.size > 200) last.clear()
    return true
  }
}

/** A drag that got stuck (no movement for this long) ends by itself. */
export const DRAG_STALE_MS = 10_000
export function dragStale(o: { now: number; lastMove: number; startedAt: number }, maxStill = DRAG_STALE_MS, maxTotal = 120_000): boolean {
  return o.now - o.lastMove > maxStill || o.now - o.startedAt > maxTotal
}
