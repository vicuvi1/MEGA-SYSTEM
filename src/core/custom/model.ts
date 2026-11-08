// Custom Center: the data model of "your own stuff" (docs/areas/custom.md).
//
// One synced setting, `custom_setup`, holds the whole set-up: your widgets
// (counters, timers, countdowns, checklists, rings, clocks), where each one
// sits (the island pill, the open island, the app's home), your one-tap
// actions, your reminder rules, your modes (Study, Gym, Night, Gaming…) with
// their schedules, and the looks (island size and shape, motion, colours,
// fonts, clock, celebration, sound pack, app background).
//
// The day-to-day numbers of purely custom counters and checklists live in a
// second, small synced setting, `custom_state`; a counter that matches a real
// tracked thing (water, push-ups…) never keeps its own number: it reads and
// writes the one body log, so points and streaks stay exactly as they are.
//
// Uploaded sounds and pictures stay on the device (IndexedDB) and are only
// referenced here by id ("local:<id>"). Nothing in here is code: every field
// is data, cleaned by `cleanSetup` (validate.ts), and an import never runs
// anything.
//
// Pure: no DOM, no database.

/** The set-up's schema version. Bump it with a step in migrate.ts. */
export const CUSTOM_VERSION = 2
/** The synced setting that holds the set-up. */
export const CUSTOM_SETUP_KEY = 'custom_setup'
/** The synced setting that holds today's numbers of custom counters and checklists. */
export const CUSTOM_STATE_KEY = 'custom_state'
/** The set-up as JSON stays under this (the synced settings are small). */
export const CUSTOM_MAX_BYTES = 48_000

export const WIDGETS_MAX = 40
export const ACTIONS_MAX = 20
export const STEPS_MAX = 6
export const REMINDERS_MAX = 30
export const MODES_MAX = 8
export const WINDOWS_MAX = 6
export const CHECK_ITEMS_MAX = 12
export const COUNTER_STEPS_MAX = 4
/** How many widgets fit in each place. */
export const SLOT_MAX = { pill: 3, island: 8, home: 12 } as const

export type Slot = keyof typeof SLOT_MAX
export const SLOTS: Slot[] = ['pill', 'island', 'home']
export const SLOT_LABEL: Record<Slot, string> = { pill: 'Island pill', island: 'Open island', home: 'App home' }

// ---------------------------------------------------------------- widgets

export type WidgetKind = 'counter' | 'timer' | 'countdown' | 'checklist' | 'ring' | 'clock'
export const WIDGET_KINDS: WidgetKind[] = ['counter', 'timer', 'countdown', 'checklist', 'ring', 'clock']
export const WIDGET_LABEL: Record<WidgetKind, string> = { counter: 'Counter', timer: 'Timer', countdown: 'Countdown', checklist: 'Checklist', ring: 'Ring', clock: 'Clock' }

/**
 * What a counter counts. `none`: only here (pays nothing). `water`: the one
 * water log (ml). `reps`: Sport Track's reps for one exercise (its usual
 * workout log, points as today).
 */
export type CounterTrack = 'none' | 'water' | 'reps'

interface WidgetBase {
  id: string
  title: string
  /** An emoji or a short symbol. */
  icon: string
  /** Your colour for this widget (#rrggbb), or null for the accent. */
  color: string | null
}
export interface CounterWidget extends WidgetBase {
  kind: 'counter'
  goal: number
  /** The + buttons, e.g. [10, 25, 50]. */
  steps: number[]
  unit: string
  /** When the count starts again each day (HH:MM, local). */
  resetAt: string
  track: CounterTrack
  /** Sport Track's exercise id or name, for track 'reps'. */
  exercise: string
}
export interface TimerWidget extends WidgetBase {
  kind: 'timer'
  focusMin: number
  breakMin: number
  /** A longer rest after a few rounds (0 = none). */
  restMin: number
  /** What the focus timer is called. */
  subject: string
}
export interface CountdownWidget extends WidgetBase {
  kind: 'countdown'
  /** YYYY-MM-DD (local). */
  date: string
}
export interface ChecklistWidget extends WidgetBase {
  kind: 'checklist'
  items: { id: string; text: string }[]
  resetAt: string
}
export interface RingWidget extends WidgetBase {
  kind: 'ring'
  /** A counter or checklist widget whose progress the ring shows. */
  of: string
}
export interface ClockWidget extends WidgetBase {
  kind: 'clock'
}
export type Widget = CounterWidget | TimerWidget | CountdownWidget | ChecklistWidget | RingWidget | ClockWidget

// ---------------------------------------------------------------- layout, actions, reminders, modes

/** Widget ids in each place, in order. */
export interface Layout {
  pill: string[]
  island: string[]
  home: string[]
}

/**
 * One step of an action. A closed list: each one calls an existing
 * operation of the app (the focus timer, the music player, the island's quiet
 * time, Do Not Disturb, a page, a mode, a counter). No code, no shell, no links.
 */
export type ActionStep =
  | { do: 'focus'; minutes: number; subject: string }
  | { do: 'stopFocus' }
  | { do: 'music'; station: string }
  | { do: 'quiet'; minutes: number }
  | { do: 'dnd' }
  | { do: 'mode'; mode: string }
  | { do: 'open'; page: string }
  | { do: 'count'; widget: string; amount: number }
export type StepKind = ActionStep['do']

export interface CustomAction {
  id: string
  name: string
  icon: string
  steps: ActionStep[]
}

export interface ReminderRule {
  id: string
  text: string
  icon: string
  on: boolean
  /** `every`: every N minutes (only while at the PC if `atPc`); `at`: at a time of day. */
  kind: 'every' | 'at'
  everyMin: number
  atPc: boolean
  /** HH:MM for kind 'at'. */
  at: string
  /** Weekdays it runs on (0 = Sunday). Empty = every day. */
  days: number[]
  /** Only between these times (HH:MM), both empty = all day. */
  from: string
  to: string
  /** At most this many a day. */
  cap: number
  /** "Done" also adds this to a counter widget (the counter's own rules apply). */
  log: { widget: string; amount: number } | null
}

/** A time window for a mode: on these weekdays from `from`, until `to` (or until the next window starts). */
export interface ModeWindow {
  days: number[]
  from: string
  /** HH:MM, or '' for "until the next window starts". `to` before `from` runs past midnight. */
  to: string
}

export type SoundKind = 'open' | 'notify' | 'done' | 'timer' | 'reminder' | 'celebrate'
export const SOUND_KINDS: SoundKind[] = ['open', 'notify', 'done', 'timer', 'reminder', 'celebrate']

export interface SoundPack {
  /** A built-in pack, or 'off'. */
  pack: 'default' | 'soft' | 'arcade' | 'glass' | 'off'
  /** 0–1 for everything, then per kind. */
  volume: number
  kinds: Record<SoundKind, number>
  /** Your own sounds for a kind: "local:<id>" in this device's storage. */
  files: Partial<Record<SoundKind, string>>
}

export type MotionStyle = 'spring' | 'smooth' | 'snappy' | 'off'
export type IslandPosition = 'auto' | 'top-center' | 'top-left' | 'top-right'
export type MotionEvent = 'open' | 'notify' | 'celebrate'

/** How the island and the app look. Every part is optional in a mode (it falls back to the base). */
export interface Looks {
  /**
   * The island: its size, shape and corners, where it sits ('auto' = where you
   * dragged it) and the open island's size in px (0 = fits your screen).
   */
  island: { size: 's' | 'm' | 'l'; shape: 'notch' | 'capsule' | 'bar'; radius: number; position: IslandPosition; openW: number; openH: number }
  motion: { style: MotionStyle; speed: number; bounce: number; events: Record<MotionEvent, MotionStyle> }
  colors: { accent: string; glow: number; blur: number; theme: 'auto' | 'dark' | 'light' }
  font: { family: 'system' | 'rounded' | 'mono' | 'serif'; numbers: 'plain' | 'tabular' | 'segment' }
  clock: { style: 'digital' | 'analog'; h24: boolean; seconds: boolean; date: boolean; zone2: string }
  celebrate: 'confetti' | 'burst' | 'glow' | 'none'
  sounds: SoundPack
}

/** The app's background, behind every page. */
export interface Background {
  kind: 'none' | 'gradient' | 'image'
  /** 2–3 colours of the gradient. */
  colors: string[]
  angle: number
  /** A slow drift (never with reduced motion, paused while hidden). */
  animate: boolean
  /** "local:<id>": a picture kept on this device. */
  image: string
  /** How much of it shows through (0.1–0.4, the wallpaper limit); the page colour covers the rest so text stays readable. */
  strength: number
}

/**
 * The Windows wallpaper for a mode (desktop app only, and only with "Change
 * my Windows wallpaper" on): a picture kept on this device, and an optional
 * second one for the evening (20:00–06:00). A folder to rotate through is
 * picked on each PC and kept there (src/desktop/wallpaper.ts), never synced.
 */
export interface DesktopWallpaper {
  image: string
  /** "local:<id>" for the evening, or '' for the same picture all day. */
  night: string
}

export interface Mode {
  id: string
  name: string
  icon: string
  layout: Layout
  /** Overrides on top of the base looks. */
  looks: Partial<Looks>
  background: Background | null
  desktopWallpaper: DesktopWallpaper | null
  /** Reminder ids that run in this mode (empty = all that are on). */
  reminders: string[]
  schedule: ModeWindow[]
}

export interface CustomSetup {
  version: number
  widgets: Widget[]
  actions: CustomAction[]
  reminders: ReminderRule[]
  modes: Mode[]
  /** The mode used when no schedule window is on. */
  baseMode: string
  /** A mode picked by hand: it holds until a scheduled window starts after `at`, or `until`. */
  manual: { mode: string; at: number; until: number | null } | null
  looks: Looks
  background: Background
  /** When it was last changed (ms). */
  savedAt: number
}

/** Today's numbers of custom counters and ticks of checklists (synced setting custom_state). */
export interface CustomState {
  counters: Record<string, { day: string; n: number }>
  checks: Record<string, { day: string; done: string[] }>
  /** Reminder rules: when each last fired and how many today. */
  fired: Record<string, { at: number; day: string; n: number }>
}

// ---------------------------------------------------------------- defaults

export const DEFAULT_SOUNDS: SoundPack = {
  pack: 'default',
  volume: 0.7,
  kinds: { open: 0.5, notify: 0.8, done: 0.8, timer: 1, reminder: 0.9, celebrate: 0.8 },
  files: {}
}

export const DEFAULT_LOOKS: Looks = {
  island: { size: 'm', shape: 'notch', radius: 18, position: 'auto', openW: 0, openH: 0 },
  motion: { style: 'spring', speed: 1, bounce: 0.3, events: { open: 'spring', notify: 'smooth', celebrate: 'spring' } },
  colors: { accent: '#b8f53d', glow: 0.4, blur: 10, theme: 'auto' },
  font: { family: 'system', numbers: 'tabular' },
  clock: { style: 'digital', h24: true, seconds: false, date: false, zone2: '' },
  celebrate: 'burst',
  sounds: DEFAULT_SOUNDS
}

export const NO_BACKGROUND: Background = { kind: 'none', colors: ['#1d2b64', '#6a3093'], angle: 135, animate: false, image: '', strength: 0.35 }

export const EMPTY_LAYOUT: Layout = { pill: [], island: [], home: [] }

export const DEFAULT_MODE: Mode = {
  id: 'everyday',
  name: 'Everyday',
  icon: '🌤',
  layout: EMPTY_LAYOUT,
  looks: {},
  background: null,
  desktopWallpaper: null,
  reminders: [],
  schedule: []
}

export const EMPTY_STATE: CustomState = { counters: {}, checks: {}, fired: {} }

export function defaultSetup(): CustomSetup {
  return {
    version: CUSTOM_VERSION,
    widgets: [],
    actions: [],
    reminders: [],
    modes: [{ ...DEFAULT_MODE, layout: { pill: [], island: [], home: [] } }],
    baseMode: DEFAULT_MODE.id,
    manual: null,
    looks: DEFAULT_LOOKS,
    background: NO_BACKGROUND,
    savedAt: 0
  }
}

/** A new short id (letters and digits), unique enough for one person's set-up. */
export const newId = (prefix: string, now = Date.now()) => `${prefix}${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
