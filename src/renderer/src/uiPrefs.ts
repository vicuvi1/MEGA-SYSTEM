// Per-viewer look-and-feel choices (theme, sounds, name). Kept in localStorage:
// they are conveniences, not data, and the app works the same without them.
import { useEffect, useState } from 'react'

export type AccentColor = 'lime' | 'orange' | 'cyan' | 'purple' | 'pink'

export interface UiPrefs {
  theme: 'dark' | 'light' | 'system'
  accent: AccentColor
  sound: boolean
  volume: number
  name: string
  /** Lighter: looping effects play once, no glass blur, no scanlines (Settings → Appearance). */
  calm: boolean
  /** Today's sections, in your order; `on: false` hides one (Settings → Today screen). */
  today: { id: TodaySectionId; on: boolean }[]
  /** Pages you don't use: hidden from the sidebar and the phone menu. */
  hiddenPages: string[]
  /** Everything bigger or smaller: 90, 100, 110, 125 (%). */
  textSize: number
}

export type TodaySectionId = 'greeting' | 'checklist' | 'todoist' | 'reps' | 'apps' | 'plan' | 'quicklog' | 'pillars' | 'raids'

/** What each Today section is, and whether it shows on a new device. */
export const TODAY_SECTIONS: { id: TodaySectionId; label: string; hint: string; on: boolean }[] = [
  { id: 'greeting', label: 'Greeting', hint: 'Your day in one line: blocks, tasks, coins today', on: true },
  { id: 'checklist', label: "Today's checklist", hint: 'Oath, clean day, workout, focus, skincare, spending', on: true },
  { id: 'todoist', label: 'Todoist', hint: 'Your Todoist tasks for today: tick them off for coins, add new ones', on: true },
  { id: 'reps', label: 'Reps & water', hint: 'Push-ups, sit-ups, press and hydration with quick +10 buttons', on: true },
  { id: 'apps', label: 'Your apps', hint: 'Coins, Waky, Finance Helper, MAN and Sport Track at a glance', on: true },
  { id: 'plan', label: 'Schedule & tasks', hint: "Today's blocks and open tasks", on: true },
  { id: 'quicklog', label: 'Quick log & recent', hint: 'One tap for anything else, and what you logged', on: true },
  { id: 'pillars', label: '4-pillar day', hint: 'Sleep, discipline, sport, money (also in the checklist)', on: false },
  { id: 'raids', label: 'Dungeon raids', hint: 'Bet coins on a challenge', on: false }
]

/** Your Today layout with any section added later appended (in its default state). */
export function todayLayout(p: UiPrefs): { id: TodaySectionId; on: boolean }[] {
  const known = new Set(TODAY_SECTIONS.map((x) => x.id))
  const mine = (Array.isArray(p.today) ? p.today : []).filter((x) => known.has(x.id))
  const have = new Set(mine.map((x) => x.id))
  return [...mine, ...TODAY_SECTIONS.filter((x) => !have.has(x.id)).map((x) => ({ id: x.id, on: x.on }))]
}

export const ACCENTS: Record<AccentColor, string> = {
  lime: '#C8F135',
  orange: '#FF8A3D',
  cyan: '#6EE7D8',
  purple: '#B892FF',
  pink: '#FF6B8B'
}


const KEY = 'ls.ui'
const DEFAULTS: UiPrefs = { theme: 'dark', accent: 'lime', sound: true, volume: 80, name: '', calm: true, today: [], hiddenPages: [], textSize: 100 }

function load(): UiPrefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

let current = load()
const listeners = new Set<(p: UiPrefs) => void>()

export function getUiPrefs(): UiPrefs {
  return current
}

export function setUiPrefs(p: Partial<UiPrefs>): void {
  current = { ...current, ...p }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // storage unavailable: the choice lasts until restart
  }
  applyTheme()
  listeners.forEach((l) => l(current))
}

export function useUiPrefs(): [UiPrefs, (p: Partial<UiPrefs>) => void] {
  const [p, setP] = useState(current)
  useEffect(() => {
    listeners.add(setP)
    return () => {
      listeners.delete(setP)
    }
  }, [])
  return [p, setUiPrefs]
}

const systemDark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

/** Sets html[data-theme] from the choice (system follows Windows). */
export function applyTheme(): void {
  const t = current.theme === 'system' ? (systemDark?.matches === false ? 'light' : 'dark') : current.theme
  document.documentElement.dataset.theme = t
  document.documentElement.classList.toggle('calm', current.calm !== false)
  // zoom scales the whole app (sizes are in px, so a root font size would not)
  const size = [90, 100, 110, 125].includes(Number(current.textSize)) ? Number(current.textSize) : 100
  document.documentElement.style.setProperty('zoom', size === 100 ? '' : String(size / 100))
}

systemDark?.addEventListener('change', () => current.theme === 'system' && applyTheme())

// ---------- Last place ----------

export interface LastPlace {
  page: string
  view: Record<string, 'app' | 'system'>
}

export function loadLastPlace(): LastPlace | null {
  try {
    return JSON.parse(localStorage.getItem('ls.last') ?? 'null')
  } catch {
    return null
  }
}

export function saveLastPlace(p: LastPlace): void {
  try {
    localStorage.setItem('ls.last', JSON.stringify(p))
  } catch {
    // not critical
  }
}
