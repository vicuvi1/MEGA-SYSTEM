// Custom Center: the templates gallery. Each template is a ready mode with
// its widgets, an action, reminders, looks and a schedule. Applying one ADDS
// a copy to your set-up (new ids, nothing of yours replaced) and switches to
// its mode, so you can change it right away. Made-up, generic content only.
import { calendarDay } from '../dates'
import { cleanSetup } from './validate'
import type { CustomAction, CustomSetup, Mode, ReminderRule, Widget } from './model'

export type TemplateId = 'study' | 'gym' | 'night' | 'gaming'

export interface Template {
  id: TemplateId
  name: string
  icon: string
  blurb: string
  widgets: Widget[]
  actions: CustomAction[]
  reminders: ReminderRule[]
  mode: Omit<Mode, 'id'>
}

const rule = (r: Partial<ReminderRule> & Pick<ReminderRule, 'id' | 'text'>): ReminderRule => ({ icon: '⏰', on: true, kind: 'every', everyMin: 45, atPc: true, at: '21:00', days: [], from: '', to: '', cap: 8, log: null, ...r })
const WEEKDAYS = [1, 2, 3, 4, 5]

export const TEMPLATES: Template[] = [
  {
    id: 'study',
    name: 'Study',
    icon: '📚',
    blurb: 'Focus 50 / break 10, an exam countdown, a study checklist and a move break every 45 minutes.',
    widgets: [
      { id: 'timer', kind: 'timer', title: 'Study timer', icon: '⏱', color: null, focusMin: 50, breakMin: 10, restMin: 20, subject: 'Study' },
      { id: 'exam', kind: 'countdown', title: 'Exam', icon: '🎓', color: '#7cc4ff', date: '2030-06-15' },
      { id: 'list', kind: 'checklist', title: 'Study list', icon: '✅', color: null, resetAt: '04:00', items: [{ id: 'read', text: 'Read one chapter' }, { id: 'cards', text: '20 flashcards' }, { id: 'notes', text: 'Clean up notes' }] },
      { id: 'ring', kind: 'ring', title: 'Study progress', icon: '🎯', color: null, of: 'list' }
    ],
    actions: [{ id: 'start', name: 'Start study', icon: '📚', steps: [{ do: 'focus', minutes: 50, subject: 'Study' }, { do: 'music', station: 'Lo-fi' }, { do: 'quiet', minutes: 50 }] }],
    reminders: [rule({ id: 'stand', text: 'Stand up and stretch', icon: '🧍', everyMin: 45 })],
    mode: { name: 'Study', icon: '📚', layout: { pill: ['timer', 'exam'], island: ['ring'], home: ['list'] }, looks: { colors: { accent: '#7cc4ff', glow: 0.35, blur: 10, theme: 'auto' } }, background: { kind: 'gradient', colors: ['#0f2027', '#203a43', '#2c5364'], angle: 160, animate: false, image: '', strength: 0.35 }, desktopWallpaper: null, reminders: ['stand'], schedule: [{ days: WEEKDAYS, from: '09:00', to: '17:00' }] }
  },
  {
    id: 'gym',
    name: 'Gym',
    icon: '🏋',
    blurb: 'A push-up counter that logs to Sport Track, a rest timer, water and a gym checklist.',
    widgets: [
      { id: 'push', kind: 'counter', title: 'Push-ups', icon: '💪', color: '#ff8a3d', goal: 100, steps: [10, 25, 50], unit: 'reps', resetAt: '04:00', track: 'reps', exercise: 'pushups' },
      { id: 'water', kind: 'counter', title: 'Water', icon: '💧', color: '#4cc9f0', goal: 2500, steps: [250, 500], unit: 'ml', resetAt: '04:00', track: 'water', exercise: '' },
      { id: 'rest', kind: 'timer', title: 'Rest timer', icon: '⏱', color: null, focusMin: 45, breakMin: 2, restMin: 0, subject: 'Workout' },
      { id: 'ring', kind: 'ring', title: 'Push-up goal', icon: '🎯', color: '#ff8a3d', of: 'push' }
    ],
    actions: [{ id: 'go', name: 'Start workout', icon: '🏋', steps: [{ do: 'focus', minutes: 45, subject: 'Workout' }, { do: 'music', station: 'Workout' }] }],
    reminders: [rule({ id: 'drink', text: 'Drink some water', icon: '💧', everyMin: 30, atPc: false, cap: 4, log: { widget: 'water', amount: 250 } })],
    mode: { name: 'Gym', icon: '🏋', layout: { pill: ['push', 'rest'], island: ['ring'], home: ['water'] }, looks: { colors: { accent: '#ff8a3d', glow: 0.5, blur: 8, theme: 'auto' }, celebrate: 'confetti' }, background: { kind: 'gradient', colors: ['#3a1c71', '#d76d77', '#ffaf7b'], angle: 135, animate: true, image: '', strength: 0.3 }, desktopWallpaper: null, reminders: ['drink'], schedule: [{ days: [1, 3, 5], from: '18:00', to: '' }] }
  },
  {
    id: 'night',
    name: 'Night',
    icon: '🌙',
    blurb: 'A calm, dim look, a wind-down checklist and "log food" at 21:00.',
    widgets: [
      { id: 'clock', kind: 'clock', title: 'Clock', icon: '🕰', color: null },
      { id: 'wind', kind: 'checklist', title: 'Wind down', icon: '🌙', color: '#b892ff', resetAt: '12:00', items: [{ id: 'food', text: 'Log food' }, { id: 'top3', text: "Tomorrow's top 3" }, { id: 'screen', text: 'Screens off' }] }
    ],
    actions: [{ id: 'calm', name: 'Wind down', icon: '🌙', steps: [{ do: 'stopFocus' }, { do: 'quiet', minutes: 90 }, { do: 'music', station: 'Sleep' }] }],
    reminders: [rule({ id: 'food', text: 'Log your food for today', icon: '🍽', kind: 'at', at: '21:00', atPc: false, cap: 1 })],
    mode: { name: 'Night', icon: '🌙', layout: { pill: ['clock'], island: [], home: ['wind'] }, looks: { colors: { accent: '#b892ff', glow: 0.2, blur: 12, theme: 'dark' }, motion: { style: 'smooth', speed: 0.8, bounce: 0, events: { open: 'smooth', notify: 'smooth', celebrate: 'smooth' } }, celebrate: 'glow' }, background: { kind: 'gradient', colors: ['#0b0f1f', '#1a1440'], angle: 180, animate: false, image: '', strength: 0.4 }, desktopWallpaper: null, reminders: ['food'], schedule: [{ days: [], from: '23:00', to: '07:00' }] }
  },
  {
    id: 'gaming',
    name: 'Gaming',
    icon: '🎮',
    blurb: 'A session timer with a break, a stretch reminder every hour and a bright look.',
    widgets: [
      { id: 'session', kind: 'timer', title: 'Session', icon: '🎮', color: '#39ff14', focusMin: 60, breakMin: 10, restMin: 0, subject: 'Gaming' },
      { id: 'clock', kind: 'clock', title: 'Clock', icon: '🕰', color: null }
    ],
    actions: [{ id: 'play', name: 'Game time', icon: '🎮', steps: [{ do: 'focus', minutes: 60, subject: 'Gaming' }] }],
    reminders: [rule({ id: 'stretch', text: 'Stretch your hands and eyes', icon: '🙌', everyMin: 60, cap: 4 })],
    mode: { name: 'Gaming', icon: '🎮', layout: { pill: ['session'], island: [], home: ['clock'] }, looks: { colors: { accent: '#39ff14', glow: 0.7, blur: 6, theme: 'dark' }, motion: { style: 'snappy', speed: 1.3, bounce: 0.4, events: { open: 'snappy', notify: 'snappy', celebrate: 'spring' } } }, background: { kind: 'gradient', colors: ['#000000', '#0f9b0f'], angle: 120, animate: true, image: '', strength: 0.3 }, desktopWallpaper: null, reminders: ['stretch'], schedule: [] }
  }
]

/**
 * Adds a copy of a template to the set-up: every id gets a fresh prefix so
 * nothing clashes, and its mode is switched on by hand (`now`).
 */
export function applyTemplate(setup: CustomSetup, id: TemplateId, now: number): { setup: CustomSetup; modeId: string } {
  const t = TEMPLATES.find((x) => x.id === id)
  if (!t) return { setup, modeId: setup.baseMode }
  const used = new Set([...setup.widgets.map((w) => w.id), ...setup.actions.map((a) => a.id), ...setup.reminders.map((r) => r.id), ...setup.modes.map((m) => m.id)])
  let n = 1
  while ([...used].some((u) => u.startsWith(`${t.id}${n}-`)) || used.has(`${t.id}${n}`)) n++
  const p = `${t.id}${n}-`
  const re = (x: string) => `${p}${x}`
  // A countdown starts 30 days out (change the date after); a ring points at its copy.
  const soon = calendarDay(new Date(now + 30 * 864e5))
  const widgets = t.widgets.map((w) => ({ ...w, id: re(w.id), ...(w.kind === 'ring' ? { of: re(w.of) } : w.kind === 'countdown' ? { date: soon } : {}) })) as Widget[]
  const reminders = t.reminders.map((r) => ({ ...r, id: re(r.id), log: r.log ? { ...r.log, widget: re(r.log.widget) } : null }))
  const modeId = `${t.id}${n}`
  const actions = t.actions.map((a) => ({ ...a, id: re(a.id), steps: a.steps.map((s) => (s.do === 'count' ? { ...s, widget: re(s.widget) } : s)) }))
  const L = t.mode.layout
  const mode: Mode = { ...t.mode, id: modeId, name: n > 1 ? `${t.mode.name} ${n}` : t.mode.name, layout: { pill: L.pill.map(re), island: L.island.map(re), home: L.home.map(re) }, reminders: t.mode.reminders.map(re) }
  const next = cleanSetup({
    ...setup,
    widgets: [...setup.widgets, ...widgets],
    actions: [...setup.actions, ...actions],
    reminders: [...setup.reminders, ...reminders],
    modes: [...setup.modes, mode],
    manual: { mode: modeId, at: now, until: null },
    savedAt: now
  })
  return { setup: next, modeId: next.modes.some((m) => m.id === modeId) ? modeId : next.baseMode }
}
