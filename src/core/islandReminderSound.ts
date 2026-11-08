// The island's body reminders (water, the 20-20-20 eye break, the move break
// and the screen-time break): when one is allowed, it opens as the real card
// AND plays its own clear sound, once. Pure logic, tested; the island page
// (DesktopIsland.tsx) plays the sound through the one sound kit.
//
// Who may stop it: the usual gates already ran (alertGate + modeGate: your
// rule per kind, quiet hours, a call, the gap between two; the chain in
// dayNudges.ts: calls, focus, classes, quiet hours, bedtime − 60, after bed,
// 30 min gap, 3 an hour, daily caps, learning). On top, the sound alone stays
// silent in a call, a focus timer, a class, quiet hours, after bed is logged,
// when the system says audio is off, or when you turned it off.
import type { AlertGate } from './islandModel'
import { isBodyCard, presentAs, type IslandMode } from './islandCalm'

export type BodyReminder = 'water' | 'eyes' | 'move' | 'screen'
export const BODY_REMINDERS: readonly BodyReminder[] = ['water', 'eyes', 'move', 'screen']
export const BODY_REMINDER_LABEL: Record<BodyReminder, string> = { water: 'Water', eyes: 'Eye break (20-20-20)', move: 'Move break', screen: 'Screen break' }
/** Which sound of the kit each plays (core/sounds.ts): a drop, a soft glass chime, an energetic climb, a calm bell. */
export const BODY_REMINDER_SOUND = { water: 'remindWater', eyes: 'remindEyes', move: 'remindMove', screen: 'remindScreen' } as const satisfies Record<BodyReminder, string>

/** Which body reminder an island alert is (null: not one). */
export function bodyReminderOf(a: { kind: string; id: string }): BodyReminder | null {
  if (!isBodyCard(a)) return null
  if (a.kind === 'water') return 'water'
  if (a.kind === 'eyes') return 'eyes'
  return a.id.startsWith('coach:break:') ? 'screen' : 'move'
}

/** Settings → Sound → Island reminders: a switch per kind and one volume (0–100). Saved on this device (uiPrefs.sounds). */
export interface ReminderSounds {
  on: Record<BodyReminder, boolean>
  volume: number
}
export const DEFAULT_REMINDER_SOUNDS: ReminderSounds = { on: { water: true, eyes: true, move: true, screen: true }, volume: 80 }
export function cleanReminderSounds(p: unknown): ReminderSounds {
  const o = (p && typeof p === 'object' ? p : {}) as Partial<ReminderSounds>
  const on = { ...DEFAULT_REMINDER_SOUNDS.on }
  for (const k of BODY_REMINDERS) if (typeof o.on?.[k] === 'boolean') on[k] = o.on[k] as boolean
  const v = Number(o.volume)
  return { on, volume: Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : DEFAULT_REMINDER_SOUNDS.volume }
}

/**
 * The reminder's loudness for the sound kit. The kit's reminder notes are soft
 * (made for the app's taps), so the island's reminders get a lift: 80 % here
 * is about 2× the old island reminder (0.7 × the same notes). The kit's
 * limiter keeps it from clipping.
 */
export const REMINDER_LIFT = 2.4
export const reminderGain = (volume: number) => Math.max(0, Math.min(100, volume)) / 100 * REMINDER_LIFT

/** Eye breaks are on unless you turned them off (the island Day page / Nudges switch, `ls.eyeBreaks`). */
export const EYE_BREAKS_DEFAULT = true

/** Why the sound must stay silent right now, as the island's snapshot says (IslandFeed.tsx). */
export type Hush = 'call' | 'focus' | 'class' | 'bed'
export function hushOf(o: { call: boolean; focus: boolean; event: boolean; asleep: boolean }): Hush | null {
  if (o.call) return 'call'
  if (o.focus) return 'focus'
  if (o.event) return 'class'
  if (o.asleep) return 'bed'
  return null
}

export interface ReminderPlan {
  /** It opens as the full card (the pill grows into it). */
  expand: boolean
  /** The body reminder whose sound plays, or null. */
  sound: BodyReminder | null
  /** Why no sound (for the island log), or null. */
  why: string | null
}

/**
 * What a new island alert does. `gate`: after alertGate + modeGate. `played`:
 * this alert's sound already rang (no repeat on a re-render or when it comes
 * back). `blocked`: the sound kit's own reason (quiet hours, a meeting, the
 * system muted), or null.
 */
export function reminderPlan(o: {
  mode: IslandMode
  alert: { kind: string; id: string; meeting?: boolean }
  gate: AlertGate
  /** The island's Sounds switch and this kind's 🔔 (Settings → Desktop island). */
  islandSound: boolean
  kindSound: boolean
  prefs: ReminderSounds
  hush: Hush | null
  quiet: boolean
  call: boolean
  blocked: string | null
  played: boolean
}): ReminderPlan {
  const shows = presentAs({ mode: o.mode, kind: o.alert.kind, id: o.alert.id, meeting: o.alert.meeting, gate: o.gate })
  const body = bodyReminderOf(o.alert)
  const expand = shows === 'card'
  const no = (why: string): ReminderPlan => ({ expand, sound: null, why })
  if (!body) return no('not a body reminder')
  if (o.gate !== 'peek') return no(o.gate === 'drop' ? 'not shown' : 'waits as a dot')
  if (o.played) return no('already rang')
  if (!o.islandSound) return no('island sounds are off')
  if (!o.kindSound) return no('this kind has no sound (Desktop island → Reminders)')
  if (!o.prefs.on[body]) return no('its sound is off (Sound → Island reminders)')
  if (!(o.prefs.volume > 0)) return no('island reminder volume is 0')
  if (o.call) return no('in a call')
  if (o.quiet) return no('quiet')
  if (o.hush) return no(o.hush === 'bed' ? 'after bed' : o.hush === 'class' ? 'in a class' : o.hush === 'focus' ? 'focus timer' : 'in a call')
  if (o.blocked) return no(o.blocked)
  return { expand, sound: body, why: null }
}
