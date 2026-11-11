// Simple mode (feature freeze, 2026-11-11): ON by default. Pure and tested
// (simpleMode.test.ts). Stored in the synced `simple_mode` setting.
//
// While it is on, the modules nobody used are hidden from the navigation,
// Today and notifications: loot / chests, buffs, the inventory, goal
// check-ins, focus goals and the Tasks page. Nothing is deleted: their data
// and code stay, and Settings → Simple mode turns them back on.
// Its `budget` part is the daily push budget (core/notifyBudget.ts).

export const SIMPLE_KEY = 'simple_mode'

export type HiddenModule = 'loot' | 'buffs' | 'inventory' | 'goalCheckins' | 'focusGoals' | 'tasks'

export const HIDDEN_MODULES: { id: HiddenModule; label: string }[] = [
  { id: 'loot', label: 'Loot and chests' },
  { id: 'buffs', label: 'Buffs' },
  { id: 'inventory', label: 'Inventory (shields, coupons)' },
  { id: 'goalCheckins', label: 'Goal check-ins' },
  { id: 'focusGoals', label: 'Focus goals' },
  { id: 'tasks', label: 'Tasks page' }
]

export interface SimpleMode {
  on: boolean
  /** The daily push budget (4 a day). */
  budget: boolean
  /** The optional afternoon nudge. */
  afternoon: boolean
}

export const DEFAULT_SIMPLE: SimpleMode = { on: true, budget: true, afternoon: false }

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
  return { on: r.on !== false, budget: r.budget !== false, afternoon: r.afternoon === true }
}

/** Is this module hidden right now? */
export const isHidden = (m: SimpleMode, _id: HiddenModule): boolean => m.on

/** Pages taken out of the navigation while Simple mode is on. */
export const simpleHiddenPages = (m: SimpleMode): string[] => (m.on ? ['tasks'] : [])
