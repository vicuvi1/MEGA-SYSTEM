// PL6: pages in the opened island (Day, Music, Home, PC, Fun…), switched by
// a swipe or drag, the scroll wheel, a key or the page dots. Pages can follow
// the time of day or the island profile. Pure and tested (pages.test.ts); the
// React side and the tiny registration API are in
// src/renderer/src/widgets/islandPages.tsx.

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night'
export type PageFollow = 'off' | 'time' | 'profile'

/** The pages the island ships with. Other builders add theirs with registerIslandPage. */
export const BUILTIN_PAGES = ['day', 'music', 'home', 'pc', 'fun'] as const
export const DAY_PARTS: DayPart[] = ['morning', 'afternoon', 'evening', 'night']
export const DAY_PART_LABEL: Record<DayPart, string> = { morning: 'Morning (5–12)', afternoon: 'Afternoon (12–17)', evening: 'Evening (17–22)', night: 'Night (22–5)' }

export interface PagesPrefs {
  /** Your page order; switched-off pages have no dot. */
  order: { id: string; on: boolean }[]
  follow: PageFollow
  /** follow 'time': the page that opens in each part of the day. */
  byTime: Partial<Record<DayPart, string>>
  /** follow 'profile': the page that opens with each island profile (work, study, gaming, night). */
  byProfile: Record<string, string>
}

export const DEFAULT_PAGES: PagesPrefs = {
  order: BUILTIN_PAGES.map((id) => ({ id, on: true })),
  follow: 'off',
  byTime: { morning: 'day', afternoon: 'day', evening: 'fun', night: 'music' },
  byProfile: { work: 'day', study: 'day', gaming: 'fun', night: 'music' }
}

const PAGE_ID = /^[a-z][a-z0-9-]{0,23}$/
export const isPageId = (v: unknown): v is string => typeof v === 'string' && PAGE_ID.test(v)

/** Any saved value → valid page prefs (unknown pages are kept: a builder may register them later). */
export function cleanPagesPrefs(v: any): PagesPrefs {
  const d = DEFAULT_PAGES
  const order: PagesPrefs['order'] = []
  for (const x of Array.isArray(v?.order) ? v.order : []) {
    if (x && isPageId(x.id) && !order.some((y) => y.id === x.id) && order.length < 12) order.push({ id: x.id, on: x.on !== false })
  }
  for (const x of d.order) if (!order.some((y) => y.id === x.id)) order.push({ ...x })
  // Day is the home of the island: it can be moved, never switched off.
  for (const x of order) if (x.id === 'day') x.on = true
  const byTime: PagesPrefs['byTime'] = {}
  for (const p of DAY_PARTS) {
    const id = v?.byTime?.[p]
    byTime[p] = isPageId(id) ? id : d.byTime[p]
  }
  const byProfile: Record<string, string> = { ...d.byProfile }
  if (v?.byProfile && typeof v.byProfile === 'object') {
    for (const [k, id] of Object.entries(v.byProfile)) if (/^[a-z]{1,12}$/.test(k) && isPageId(id)) byProfile[k] = id
  }
  return { order, follow: ['off', 'time', 'profile'].includes(v?.follow) ? v.follow : d.follow, byTime, byProfile }
}

export function dayPartOf(hour: number): DayPart {
  return hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 22 ? 'evening' : 'night'
}

/**
 * The pages to show, in your order: registered and switched on. Pages that
 * were registered but aren't in your order yet come at the end.
 */
export function visiblePages(prefs: PagesPrefs, registered: string[]): string[] {
  const out = prefs.order.filter((x) => x.on && registered.includes(x.id)).map((x) => x.id)
  for (const id of registered) if (!prefs.order.some((x) => x.id === id)) out.push(id)
  return out.length ? out : registered.slice(0, 1)
}

/** The page that opens by itself (time of day or profile), or null when it doesn't follow anything. */
export function autoPage(prefs: PagesPrefs, o: { hour: number; profile?: string | null }, shown: string[]): string | null {
  const want = prefs.follow === 'time' ? prefs.byTime[dayPartOf(o.hour)] : prefs.follow === 'profile' && o.profile && o.profile !== 'none' ? prefs.byProfile[o.profile] : null
  return want && shown.includes(want) ? want : null
}

/** One page left (−1) or right (+1); stops at the ends. */
export function stepPage(shown: string[], cur: string, dir: number): string {
  const i = Math.max(0, shown.indexOf(cur))
  return shown[Math.max(0, Math.min(shown.length - 1, i + Math.sign(dir)))] ?? cur
}

/**
 * A drag across the page: far enough sideways (a quarter of the width, or a
 * quick flick), and more sideways than up/down (that one scrolls).
 * −1 = to the previous page, +1 = to the next, 0 = stay.
 */
export function swipeDir(dx: number, dy: number, ms: number, width: number): -1 | 0 | 1 {
  if (Math.abs(dx) < 1.5 * Math.abs(dy)) return 0
  const fast = Math.abs(dx) / Math.max(1, ms) > 0.5 && Math.abs(dx) > 30
  if (!fast && Math.abs(dx) < Math.max(48, width / 4)) return 0
  return dx < 0 ? 1 : -1
}

/** The scroll wheel: a sideways scroll (touchpad, tilt wheel) or Shift + wheel turns the page; plain up/down scrolls. */
export function wheelDir(deltaX: number, deltaY: number, shift: boolean): -1 | 0 | 1 {
  const d = shift && Math.abs(deltaX) < 1 ? deltaY : Math.abs(deltaX) > Math.abs(deltaY) * 1.2 ? deltaX : 0
  return Math.abs(d) < 8 ? 0 : d > 0 ? 1 : -1
}

/** Keys: Ctrl+← / Ctrl+→, or [ and ] (outside a text box). */
export function keyDir(key: string, ctrl: boolean, inText: boolean): -1 | 0 | 1 {
  if (ctrl && key === 'ArrowLeft') return -1
  if (ctrl && key === 'ArrowRight') return 1
  if (inText) return 0
  return key === '[' ? -1 : key === ']' ? 1 : 0
}
