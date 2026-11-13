// Simple mode (feature freeze, 2026-11-11): ON by default. Pure and tested
// (simpleMode.test.ts). Stored in the synced `simple_mode` setting.
//
// While it is on, the game parts nobody used stay hidden inside the modules that
// are on: loot / chests, buffs, the inventory, goal check-ins, focus goals and the
// focus cards. Which parts of the app exist at all is the module switch
// (core/modules.ts, Settings → Modules), which replaced Simple mode's Archive group
// on 2026-11-12. Nothing is deleted. Its `budget` part is the daily push budget
// (core/notifyBudget.ts).

export const SIMPLE_KEY = 'simple_mode'

export type HiddenModule = 'loot' | 'buffs' | 'inventory' | 'goalCheckins' | 'focusGoals' | 'focusCards'

export const HIDDEN_MODULES: { id: HiddenModule; label: string }[] = [
  { id: 'loot', label: 'Loot and chests' },
  { id: 'buffs', label: 'Buffs' },
  { id: 'inventory', label: 'Inventory (shields, coupons)' },
  { id: 'goalCheckins', label: 'Goal check-ins' },
  { id: 'focusGoals', label: 'Focus goals' },
  { id: 'focusCards', label: 'Focus goal and "how did it go?" cards, and the dimmed screen while a timer runs' }
]

export interface SimpleMode {
  on: boolean
  /** The daily push budget (4 a day). */
  budget: boolean
  /** The optional afternoon nudge. */
  afternoon: boolean
  /** Show coins and rewards (the wallet display). Off by default; coins are still earned and stored. */
  coins: boolean
}

export const DEFAULT_SIMPLE: SimpleMode = { on: true, budget: true, afternoon: false, coins: false }

/** Missing or unreadable = the defaults (on). An old `shown` list (the Archive) is ignored. */
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
  return { on: r.on !== false, budget: r.budget !== false, afternoon: r.afternoon === true, coins: r.coins === true }
}

/** Is this game part hidden right now? */
export const isHidden = (m: SimpleMode, _id: HiddenModule): boolean => m.on
