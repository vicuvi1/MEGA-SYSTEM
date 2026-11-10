// Per-viewer look-and-feel choices (theme, sounds, name). Kept in localStorage:
// they are conveniences, not data, and the app works the same without them.
import { useEffect, useState } from 'react'
import type { SoundPrefs } from '@core/sounds'
import { applyPageZoom } from './zoom'

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
  /** Which one-time layout clean-up this device has had (see load). */
  layoutV?: number
  /** How new notifications reach you on this device (Settings → Notifications). */
  notif?: NotifPrefs
  /** Sound kinds, theme, focus background, phone buzz (Settings → Sound). */
  sounds?: SoundPrefs
}

export interface NotifPrefs {
  /** Windows pop-ups (desktop) / a card sliding in (website). */
  popups: boolean
  /** A soft chime, even when other sound effects are off. */
  sound: boolean
  /** Quiet hours: nothing pops or rings, it all waits in the inbox. */
  quiet: boolean
  quietFrom: string
  quietTo: string
  /** Nothing pops up while a focus timer runs. */
  focusQuiet: boolean
}
export const DEFAULT_NOTIF: NotifPrefs = { popups: true, sound: true, quiet: true, quietFrom: '23:00', quietTo: '07:30', focusQuiet: true }

export type TodaySectionId = 'timeline' | 'day' | 'progress' | 'fun' | 'reps' | 'quicklog'

/** What each Today section is, and whether it shows on a new device. */
export const TODAY_SECTIONS: { id: TodaySectionId; label: string; hint: string; on: boolean }[] = [
  { id: 'day', label: 'Now & today’s list', hint: 'Morning plan, evening shut-down, the next step, habits and one list by area', on: true },
  { id: 'timeline', label: 'Your day (timeline)', hint: 'Calendar events, timed tasks, free gaps and Plan my day (side column)', on: true },
  { id: 'progress', label: 'This week', hint: 'Am I improving? One line and a chip per area (side column)', on: true },
  { id: 'fun', label: 'Treat yourself', hint: 'What your points buy now (side column)', on: false },
  { id: 'reps', label: 'Reps & water', hint: 'Push-ups, sit-ups, press and water with quick + buttons (side column)', on: true },
  { id: 'quicklog', label: 'Quick log & recent', hint: 'One tap for anything else, and what you logged', on: false },
]

/** Your Today layout with any section added later appended (in its default state). */
export function todayLayout(p: UiPrefs): { id: TodaySectionId; on: boolean }[] {
  const known = new Set(TODAY_SECTIONS.map((x) => x.id))
  // A layout saved before "Now & today's list" existed starts over with the new one.
  const saved = Array.isArray(p.today) && p.today.some((x) => x.id === 'day') ? p.today : []
  const mine = saved.filter((x) => known.has(x.id))
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

/** Pages most people don't need day to day: hidden once (Settings → Layout brings them back). */
const QUIET_PAGES = ['schedule', 'journey', 'rules']
const LAYOUT_V = 7

function load(): UiPrefs {
  try {
    const p: UiPrefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
    // One-time clean-up: Today goes back to the calm defaults (Now, this week,
    // focus, reps) and rarely used pages leave the menu.
    const v = p.layoutV ?? 1
    if (v < LAYOUT_V) {
      // v6: Today opens with your timeline.
      // v7: Today is one command screen (main list + side column).
      if (v < 7) p.today = []
      p.hiddenPages = [...new Set([...(p.hiddenPages ?? []), ...QUIET_PAGES])]
      // One task list: Todoist. The app's own Tasks page leaves the menu (Layout brings it back).
      if (v < 4) p.hiddenPages = [...new Set([...p.hiddenPages, 'tasks'])]
      // Tasks is your Todoist now: back in the menu.
      if (v < 5) p.hiddenPages = p.hiddenPages.filter((x) => x !== 'tasks')
      p.layoutV = LAYOUT_V
      try {
        localStorage.setItem(KEY, JSON.stringify(p))
      } catch {
        // storage unavailable: it runs again next time, same result
      }
    }
    return p
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

// Another window of the app (the desktop island) changed them: follow.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    current = load()
    listeners.forEach((l) => l(current))
  })
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
  // Zoom (Settings → Look, zoom.tsx): the old "Text size" is where it starts.
  const size = [90, 100, 110, 125].includes(Number(current.textSize)) ? Number(current.textSize) : 100
  applyPageZoom(size)
}

systemDark?.addEventListener('change', () => current.theme === 'system' && applyTheme())

// ---------- Last place ----------

/**
 * Which tab a section shows: the embedded app or Life System's view. Sport Track: 'train' (Dashboard),
 * 'workout', 'exercises', 'progress', 'system' (Body & Food) and 'app' (the Classic tracker, in its ⋯ menu).
 */
export type SectionView = 'app' | 'system' | 'train' | 'workout' | 'exercises' | 'progress'
export interface LastPlace {
  page: string
  view: Record<string, SectionView>
}

/**
 * Sport Track opens on the Training home now (2026-11-10). A device that last showed the old tracker
 * ("app") moves to the Training home once; after that your own choice is remembered as before.
 */
export function trainingHomeFirst(view: Record<string, SectionView>): Record<string, SectionView> {
  try {
    if (localStorage.getItem('ls.trainHome') === '1') return view
    localStorage.setItem('ls.trainHome', '1')
  } catch {
    return view
  }
  if (view.body !== 'app') return view
  const { body: _old, ...rest } = view
  return rest
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
