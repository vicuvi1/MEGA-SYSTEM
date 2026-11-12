// Simple mode (feature freeze, 2026-11-11): ON by default. Pure and tested
// (simpleMode.test.ts). Stored in the synced `simple_mode` setting.
//
// While it is on, the modules nobody used are hidden from the navigation,
// Today and notifications: loot / chests, buffs, the inventory, goal
// check-ins, focus goals, the focus cards and the Tasks tab. The menu shows
// only Today, Study Time, Sport Track and Money; every other page sits under one
// closed "Archive" group (simpleMenu). Nothing is deleted: their data and code
// stay, and Settings → Simple mode brings pages back or turns it all off.
// Its `budget` part is the daily push budget (core/notifyBudget.ts).

export const SIMPLE_KEY = 'simple_mode'

export type HiddenModule = 'loot' | 'buffs' | 'inventory' | 'goalCheckins' | 'focusGoals' | 'tasks' | 'focusCards'

export const HIDDEN_MODULES: { id: HiddenModule; label: string }[] = [
  { id: 'loot', label: 'Loot and chests' },
  { id: 'buffs', label: 'Buffs' },
  { id: 'inventory', label: 'Inventory (shields, coupons)' },
  { id: 'goalCheckins', label: 'Goal check-ins' },
  { id: 'focusGoals', label: 'Focus goals' },
  { id: 'tasks', label: 'Tasks tab on Today' },
  { id: 'focusCards', label: 'Focus goal and "how did it go?" cards, and the dimmed screen while a timer runs' }
]

/** The menu in Simple mode (usability pass, 2026-11-12): the 3 daily places, and Money (the owner keeps it, never archived). */
export const SIMPLE_CORE = ['today', 'study', 'body', 'money'] as const

/** Everything else, in this order, under one closed "Archive" group. Nothing is deleted. */
export const ARCHIVE_PAGES = ['calendar', 'coach', 'goals', 'season', 'career', 'progress', 'shop', 'sleep', 'locker', 'discipline', 'music', 'custom', 'tasks'] as const

export interface SimpleMode {
  on: boolean
  /** The daily push budget (4 a day). */
  budget: boolean
  /** The optional afternoon nudge. */
  afternoon: boolean
  /** Archive pages brought back into the menu (Settings → Simple mode). */
  shown: string[]
}

export const DEFAULT_SIMPLE: SimpleMode = { on: true, budget: true, afternoon: false, shown: [] }

/** Missing or unreadable = the defaults (on). */
export function readSimple(raw: unknown): SimpleMode {
  let r: any = raw
  if (typeof raw === 'string') {
    try {
      r = JSON.parse(raw)
    } catch {
      r = null
    }
  }
  if (!r || typeof r !== 'object') return { ...DEFAULT_SIMPLE }
  const shown = Array.isArray(r.shown) ? ARCHIVE_PAGES.filter((p) => r.shown.includes(p)) : []
  return { on: r.on !== false, budget: r.budget !== false, afternoon: r.afternoon === true, shown }
}

/** Is this module hidden right now? */
export const isHidden = (m: SimpleMode, _id: HiddenModule): boolean => m.on

/**
 * The menu while Simple mode is on: Today, Study Time, Sport Track and Money, then any
 * archive page you brought back (in archive order), and the rest under Archive.
 * Off: null (the full menu as before).
 */
export function simpleMenu(m: SimpleMode): { main: string[]; archive: string[] } | null {
  if (!m.on) return null
  const shown = new Set(m.shown)
  return { main: [...SIMPLE_CORE, ...ARCHIVE_PAGES.filter((p) => shown.has(p))], archive: ARCHIVE_PAGES.filter((p) => !shown.has(p)) }
}

/** Show or hide one archive page in the menu (returns the new `shown` list). */
export function toggleShown(m: SimpleMode, page: string, on: boolean): string[] {
  const set = new Set(m.shown)
  if (on) set.add(page)
  else set.delete(page)
  return ARCHIVE_PAGES.filter((p) => set.has(p))
}

/**
 * Alt+1…9: the n-th page in the menu as you see it (the archive is not counted).
 * `full` is the full menu's order and `hidden` the pages you hid there (Simple mode off).
 */
export function altTarget(m: SimpleMode, full: string[], hidden: string[], n: number): string | null {
  const menu = simpleMenu(m)
  const hide = new Set(hidden)
  const list = menu ? menu.main : full.filter((p) => !hide.has(p))
  return list[n - 1] ?? null
}
