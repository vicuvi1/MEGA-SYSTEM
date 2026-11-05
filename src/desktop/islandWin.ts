// Pure helpers for the desktop island window (no Electron here, so they can
// be tested): where the window goes, how big it may be, where it takes
// clicks, which shortcuts it uses and what the Windows watcher said.

export interface Box { x: number; y: number; width: number; height: number }
/** A clickable area as the island page reports it (CSS pixels of the page). */
export interface HotRect { x: number; y: number; w: number; h: number }
export type Placement = 'top' | 'left' | 'right' | 'free'

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
 * Where the window goes on its screen. The top of the work area wins over the
 * bottom (clamped last), so the pill never ends up above the screen.
 */
export function placeIsland(o: { wa: Box; width: number; height: number; place: Placement; pos: { cx: number; top: number; cy: number }; sidePillY: number }): { x: number; y: number } {
  const { wa, width, height } = o
  const clampX = (x: number) => Math.round(Math.max(wa.x, Math.min(wa.x + wa.width - width, x)))
  const clampY = (y: number) => Math.round(Math.max(wa.y, Math.min(wa.y + wa.height - height, y)))
  if (o.place === 'left' || o.place === 'right') {
    const x = o.place === 'left' ? wa.x : wa.x + wa.width - width
    return { x: clampX(x), y: clampY(wa.y + o.pos.cy * wa.height - o.sidePillY) }
  }
  return { x: clampX(wa.x + o.pos.cx * wa.width - width / 2), y: o.place === 'free' ? clampY(wa.y + o.pos.top) : Math.round(wa.y) }
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
// Not Ctrl+Shift+N / Ctrl+Shift+B by default: those are a new private window,
// a new folder in Explorer and the bookmarks bar.
export const CAPTURE_SHORTCUTS = ['Alt+Shift+N', 'Control+Shift+N', 'Control+Alt+N', ''] as const
export const VOICE_SHORTCUTS = ['Alt+Shift+B', 'Control+Shift+B', 'Control+Alt+B', ''] as const

/** Ctrl+Alt+<key> without Shift/Win: what AltGr types on many keyboards. */
export const isAltGrCombo = (acc: string) => {
  const parts = acc.split('+').map((p) => p.trim().toLowerCase())
  const ctrl = parts.some((p) => p === 'control' || p === 'ctrl' || p === 'commandorcontrol' || p === 'cmdorctrl')
  return ctrl && parts.includes('alt') && !parts.includes('shift') && !parts.includes('super')
}

/** The island's own settings that live only on this PC (Settings → Desktop island). */
export interface IslandDeskPrefs {
  /** A full-screen app (video, game, slides) on the island's screen: hide it, shrink it to a dot, or leave it. */
  fullscreen: 'hide' | 'dot' | 'show'
  /** Add a task from anywhere, or '' for none. */
  captureShortcut: string
  /** Talk to Ben from anywhere, or '' for none. */
  voiceShortcut: string
}
export const DEFAULT_DESK_PREFS: IslandDeskPrefs = { fullscreen: 'hide', captureShortcut: CAPTURE_SHORTCUTS[0], voiceShortcut: VOICE_SHORTCUTS[0] }

export function cleanDeskPrefs(p: any): IslandDeskPrefs {
  const d = DEFAULT_DESK_PREFS
  return {
    fullscreen: ['hide', 'dot', 'show'].includes(p?.fullscreen) ? p.fullscreen : d.fullscreen,
    captureShortcut: (CAPTURE_SHORTCUTS as readonly string[]).includes(p?.captureShortcut) ? p.captureShortcut : d.captureShortcut,
    voiceShortcut: (VOICE_SHORTCUTS as readonly string[]).includes(p?.voiceShortcut) ? p.voiceShortcut : d.voiceShortcut
  }
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
}

/** "qs=5 media=0 fs=1920,540 app=chrome|Lofi - YouTube" → its parts. */
export function parseWatcherLine(line: string): WatcherLine | null {
  if (!line.startsWith('qs=')) return null
  const qs = Number(/^qs=(-?\d+)/.exec(line)?.[1] ?? 0)
  const fm = / fs=(-?\d+),(-?\d+)/.exec(line)
  const am = / app=([^|]*)\|?(.*)$/.exec(line)
  return {
    qs,
    media: / media=1/.test(line),
    fs: fm ? { x: Number(fm[1]), y: Number(fm[2]) } : null,
    app: am && am[1].trim() ? { proc: am[1].trim(), title: am[2]?.trim() || null } : null
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
