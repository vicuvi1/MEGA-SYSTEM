// One rule for the island's notification sound: every alert that drops down
// (a peek: the slim line in Calm, or a card) rings once, at the "Island
// reminders" volume, with a switch per kind (Settings → Sound → Island
// reminders). A dot that waits stays silent. Every skip has a reason the
// island writes to its log (Settings → Island log), so "why no sound?" always
// has an answer. Pure logic, tested; the island page plays the sound.
//
// Why this exists (2026-11-09): the island was silent on the owner's Windows
// PC for most notifications. Electron already allows audio without a click,
// so the autoplay switch was never the problem. The real gaps were: the
// non-body notifications played at about 5 % loudness (0.08 notes × 0.7 ×
// the app volume), an opened panel skipped the sound and left it to a bell
// that refused to play until the island had been clicked, a timed-out
// AudioContext resume failed silently, and nothing said why a sound was
// skipped.
import type { AlertGate } from './islandModel'
import { bodyReminderOf, reminderGain, type BodyReminder, type Hush, type OtherCardSound } from './islandReminderSound'
import { remindSound, type SoundName } from './sounds'

/** The switch each notification sound has. */
export type CardSoundKey = BodyReminder | OtherCardSound
export const CARD_SOUND_KEYS: readonly CardSoundKey[] = ['water', 'eyes', 'move', 'screen', 'ben', 'remind', 'timer', 'meeting', 'plan', 'bed', 'other']
export const CARD_SOUND_LABEL: Record<CardSoundKey, string> = {
  water: 'Water',
  eyes: 'Eye break (20-20-20)',
  move: 'Move break',
  screen: 'Screen break',
  ben: 'Ben and his pushes',
  remind: 'Your reminders',
  timer: "Time's up",
  meeting: 'A meeting soon',
  plan: 'Plan blocks',
  bed: 'Bedtime',
  other: 'Everything else'
}

/** Which switch an island alert uses. */
export function cardSoundKey(a: { kind: string; id: string; meeting?: boolean }): CardSoundKey {
  const body = bodyReminderOf(a)
  if (body) return body
  if (a.meeting) return 'meeting'
  const k = a.kind
  if (k === 'remind') return 'remind'
  if (k === 'over' || k === 'end' || k === 'back' || k === 'countdown') return 'timer'
  if (k === 'ben' || k === 'checkin' || k === 'brief' || k === 'launch' || k === 'win' || k === 'coach' || k === 'praise' || k === 'refocus') return 'ben'
  if (k === 'block' || k === 'push1' || k === 'push2' || k === 'push3' || k === 'drift' || k === 'quality' || k === 'distract') return 'plan'
  if (k === 'bed' || k === 'winddown' || k === 'sleep' || k === 'late' || k === 'shutdown') return 'bed'
  return 'other'
}

/** The kit sound for an alert: body reminders their own, your Custom Center reminders the bell, the rest by kind. */
export function cardSoundName(a: { kind: string; id: string; meeting?: boolean }): SoundName {
  const body = bodyReminderOf(a)
  if (body) return ({ water: 'remindWater', eyes: 'remindEyes', move: 'remindMove', screen: 'remindScreen' } as const)[body]
  if (a.kind === 'remind' && a.id.startsWith('custom:')) return 'remind'
  return remindSound(a.kind, !!a.meeting)
}

/** The Settings button's alert: the same path as a real one (snapshot → island → this rule → the kit). */
export const TEST_SOUND_PREFIX = 'test:sound:'
export const isTestSound = (id: string) => id.startsWith(TEST_SOUND_PREFIX)

export interface CardSoundIn {
  alert: { kind: string; id: string; meeting?: boolean }
  /** After alertGate + modeGate (the Settings test always counts as a peek). */
  gate: AlertGate
  /** The island's Sounds switch (Settings → Desktop island) and the island look's pack ('none' = off). */
  islandSound: boolean
  /** This kind's 🔔 in Settings → Desktop island → Reminders (true when the kind has none). */
  kindSound: boolean
  /** Settings → Sound → Island reminders: a switch per key and one volume (0–100). */
  on: Partial<Record<CardSoundKey, boolean>>
  volume: number
  hush: Hush | null
  quiet: boolean
  call: boolean
  /** The kit's own reason (quiet hours, a meeting, the system muted), or null. */
  blocked: string | null
  /** This alert already rang. */
  played: boolean
}
export interface CardSoundPlan {
  ring: boolean
  key: CardSoundKey
  sound: SoundName
  /** Loudness for the kit (`loud`: above 1 is lifted, the limiter keeps it clean). */
  loud: number
  /** Why no sound (for the island log), or null. For the test: why a real one would be silent. */
  why: string | null
}

/** Time's up is yours: it rings through a focus timer (it is the timer) and a class. */
const URGENT: ReadonlySet<CardSoundKey> = new Set(['timer'])

export function cardSoundPlan(o: CardSoundIn): CardSoundPlan {
  const key = cardSoundKey(o.alert)
  const sound = cardSoundName(o.alert)
  const loud = reminderGain(o.volume)
  const test = isTestSound(o.alert.id)
  const no = (why: string): CardSoundPlan => ({ ring: false, key, sound, loud, why })
  if (!test && o.gate !== 'peek') return no(o.gate === 'drop' ? 'not shown' : 'waits as a dot (no sound for dots)')
  if (!test && o.played) return no('already rang')
  if (!o.islandSound) return no('island sounds are off (Settings → Desktop island → Sounds)')
  if (!o.kindSound) return no('this kind has no sound (Settings → Desktop island → Reminders)')
  if (o.on[key] === false) return no(`its sound is off (Settings → Sound → Island reminders → ${CARD_SOUND_LABEL[key]})`)
  if (!(o.volume > 0)) return no('island reminder volume is 0')
  // The test rings anyway (that is the point), but says what would stop a real one now.
  const real = o.call
    ? key === 'timer' ? null : 'in a call (mic or camera in use)'
    : o.quiet
      ? 'quiet for a while'
      : o.hush && !(URGENT.has(key) && o.hush !== 'bed')
        ? o.hush === 'bed' ? 'after bed' : o.hush === 'class' ? 'in a class' : o.hush === 'focus' ? 'a focus timer is running' : 'in a call'
        : o.blocked
  if (real && !test) return no(real)
  return { ring: true, key, sound, loud, why: test && real ? `a real one would be silent now: ${real}` : null }
}

/** One island log line for a sound decision. */
export function cardSoundLine(id: string, p: Pick<CardSoundPlan, 'ring' | 'key' | 'why'>, result?: string): string {
  if (!p.ring) return `${id}: skipped, ${p.why ?? 'no reason'}`
  return `${id}: ${CARD_SOUND_LABEL[p.key].toLowerCase()} sound ${result ?? 'played'}${p.why ? ` (${p.why})` : ''}`
}
