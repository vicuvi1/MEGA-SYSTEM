// The sidebar's sections (pure): Today on top, your pinned pages, then Plan,
// Body, Money and Me, and the pages you use less under "More". Pins and the
// More fold are kept per device (`ls.nav`); every page stays reachable.
import type { PageId } from './modules'

export type NavSectionId = 'top' | 'pinned' | 'plan' | 'body' | 'money' | 'me' | 'more'
export interface NavSection {
  id: NavSectionId
  /** Empty for the top row (Today): it needs no heading. */
  title: string
  ids: PageId[]
}
export interface NavPrefs {
  pins: PageId[]
  more: boolean
}

export const NAV_SECTIONS: NavSection[] = [
  { id: 'top', title: '', ids: ['today'] },
  { id: 'plan', title: 'Plan', ids: ['calendar', 'tasks', 'goals', 'season'] },
  { id: 'body', title: 'Body', ids: ['body', 'sleep'] },
  { id: 'money', title: 'Money', ids: ['money', 'shop'] },
  { id: 'me', title: 'Me', ids: ['coach', 'progress', 'discipline'] },
  { id: 'more', title: 'More', ids: ['career', 'notebook', 'locker', 'custom', 'music'] }
]

/** Every page the sidebar can show, in its default order. */
export const NAV_PAGES: PageId[] = NAV_SECTIONS.flatMap((s) => s.ids)
export const MAX_PINS = 6
export const NAV_KEY = 'ls.nav'

/** Pins from storage: known pages only, no repeats, never Today (it is always on top), at most MAX_PINS. */
export function cleanNavPrefs(raw: unknown): NavPrefs {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const pins: PageId[] = []
  for (const p of Array.isArray(o.pins) ? o.pins : []) {
    if (typeof p === 'string' && p !== 'today' && NAV_PAGES.includes(p as PageId) && !pins.includes(p as PageId)) pins.push(p as PageId)
    if (pins.length >= MAX_PINS) break
  }
  return { pins, more: o.more === true }
}

/** The sections to draw: pinned pages leave their own section; hidden pages are left out (Today never is). */
export function buildNav(prefs: NavPrefs, hidden: ReadonlySet<string> = new Set()): NavSection[] {
  const shown = (id: PageId) => id === 'today' || !hidden.has(id)
  const pins = prefs.pins.filter(shown)
  const out: NavSection[] = []
  for (const s of NAV_SECTIONS) {
    if (s.id === 'plan' && pins.length) out.push({ id: 'pinned', title: 'Pinned', ids: pins })
    const ids = s.ids.filter((id) => shown(id) && !pins.includes(id))
    if (ids.length) out.push({ ...s, ids })
  }
  return out
}

/** Pin or unpin a page (new pins go to the end). */
export function togglePin(prefs: NavPrefs, id: PageId): NavPrefs {
  if (id === 'today') return prefs
  const pins = prefs.pins.includes(id) ? prefs.pins.filter((p) => p !== id) : [...prefs.pins, id].slice(-MAX_PINS)
  return { ...prefs, pins }
}

/** Move a pinned page up (-1) or down (+1), or to the place of another pinned page. */
export function movePin(prefs: NavPrefs, id: PageId, to: number | PageId): NavPrefs {
  const from = prefs.pins.indexOf(id)
  if (from < 0) return prefs
  const target = typeof to === 'number' ? from + to : prefs.pins.indexOf(to)
  if (target < 0 || target >= prefs.pins.length || target === from) return prefs
  const pins = [...prefs.pins]
  pins.splice(from, 1)
  pins.splice(target, 0, id)
  return { ...prefs, pins }
}

/** The pages Alt+1…9 open: the sidebar's visible order (More's pages only while it is open). */
export function shortcutOrder(sections: NavSection[], moreOpen: boolean): PageId[] {
  return sections.filter((s) => s.id !== 'more' || moreOpen).flatMap((s) => s.ids)
}
