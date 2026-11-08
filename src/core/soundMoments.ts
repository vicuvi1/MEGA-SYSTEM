// A different sound for different things (Settings → Sound → "Which sound
// for what"): Ben's message, your reminders, water, a move break, an eye
// break, a timer ending, a meeting soon, a task done, points, bedtime and an
// error each get their own pleasant synthesized sound, and you can pick
// another one (or None) for each. Pure: soundKit.ts and islandSounds.ts play
// them through the one sound engine, so Off / Subtle / Full, ducking under
// music and silence in calls and quiet hours still apply. Tested in
// soundMoments.test.ts. No audio files.
import type { SoundCategory, SoundName, Voice } from './sounds'

export type MomentId = 'ben' | 'reminder' | 'water' | 'move' | 'eyes' | 'screen' | 'timer' | 'meeting' | 'done' | 'points' | 'bed' | 'error' | 'praise' | 'drift' | 'checkin' | 'push1' | 'push2' | 'push3'
export type MomentSound = 'chime' | 'bell' | 'pop' | 'marimba' | 'glass' | 'drop' | 'rise' | 'gong' | 'coin' | 'hum' | 'knock' | 'pulse' | 'cheer' | 'tap' | 'softchime' | 'alarm' | 'horn' | 'calmbell' | 'none'

export const MOMENTS: { id: MomentId; label: string; icon: string }[] = [
  { id: 'ben', label: 'Ben writes to you', icon: '💬' },
  { id: 'reminder', label: 'A reminder you set', icon: '⏰' },
  { id: 'water', label: 'Water', icon: '💧' },
  { id: 'move', label: 'Move break', icon: '🤸' },
  { id: 'eyes', label: 'Eye break', icon: '👀' },
  { id: 'screen', label: 'Screen break', icon: '🖥️' },
  { id: 'timer', label: 'Timer ends', icon: '⏱' },
  { id: 'meeting', label: 'Meeting soon', icon: '📅' },
  { id: 'done', label: 'Task or must-do done', icon: '✅' },
  { id: 'points', label: 'Points and rewards', icon: '⭐' },
  { id: 'bed', label: 'Bedtime and wind-down', icon: '🌙' },
  { id: 'error', label: 'Something went wrong', icon: '⚠️' },
  { id: 'praise', label: 'Ben cheers your work', icon: '🔥' },
  { id: 'drift', label: 'Ben calls you back to work', icon: '👀' },
  { id: 'checkin', label: 'A planned block starts', icon: '🎯' },
  { id: 'push1', label: 'Push ladder, step 1 (gentle)', icon: '🔔' },
  { id: 'push2', label: 'Push ladder, step 2 (sharp)', icon: '🚨' },
  { id: 'push3', label: 'Push ladder, step 3 (Ben calls you out)', icon: '📣' }
]

/** The built-in sounds to pick from (and None). */
export const MOMENT_SOUNDS: { id: MomentSound; label: string }[] = [
  { id: 'chime', label: 'Chime' },
  { id: 'bell', label: 'Bell' },
  { id: 'rise', label: 'Sparkle' },
  { id: 'pop', label: 'Pop' },
  { id: 'marimba', label: 'Marimba' },
  { id: 'glass', label: 'Glass' },
  { id: 'drop', label: 'Water drop' },
  { id: 'pulse', label: 'Three beeps' },
  { id: 'coin', label: 'Coin' },
  { id: 'gong', label: 'Gong' },
  { id: 'hum', label: 'Soft hum' },
  { id: 'knock', label: 'Low knock' },
  { id: 'cheer', label: 'Cheer' },
  { id: 'tap', label: 'Shoulder tap' },
  { id: 'softchime', label: 'Soft chime' },
  { id: 'alarm', label: 'Sharp alarm' },
  { id: 'horn', label: 'Low horn' },
  { id: 'calmbell', label: 'Calm bell' },
  { id: 'none', label: 'None' }
]

/** Every moment its own sound out of the box. */
export const DEFAULT_MOMENTS: Record<MomentId, MomentSound> = {
  ben: 'rise',
  reminder: 'bell',
  water: 'drop',
  move: 'marimba',
  eyes: 'glass',
  screen: 'calmbell',
  timer: 'gong',
  meeting: 'pulse',
  done: 'chime',
  points: 'coin',
  bed: 'hum',
  error: 'knock',
  praise: 'cheer',
  drift: 'tap',
  checkin: 'pop',
  push1: 'softchime',
  push2: 'alarm',
  push3: 'horn'
}

const SOUND_IDS = new Set<string>(MOMENT_SOUNDS.map((s) => s.id))
export function cleanMoments(raw: unknown): Record<MomentId, MomentSound> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = { ...DEFAULT_MOMENTS }
  for (const m of MOMENTS) if (typeof o[m.id] === 'string' && SOUND_IDS.has(o[m.id] as string)) out[m.id] = o[m.id] as MomentSound
  return out
}

/** Which of your sound switches (Settings → Sound) each moment follows. */
export const MOMENT_CATEGORY: Record<MomentId, SoundCategory> = {
  ben: 'alerts', reminder: 'alerts', water: 'alerts', move: 'alerts', eyes: 'alerts', screen: 'alerts', meeting: 'alerts', bed: 'alerts', error: 'alerts', praise: 'alerts', drift: 'alerts', checkin: 'alerts', push1: 'alerts', push2: 'alerts', push3: 'alerts',
  timer: 'focus', done: 'success', points: 'money'
}

/** The app's sounds that belong to a moment (the rest, like clicks and the focus swell, keep their own). */
const BY_SOUND: Partial<Record<SoundName, MomentId>> = {
  ben: 'ben',
  notify: 'reminder', remind: 'reminder',
  water: 'water', remindWater: 'water',
  remindMove: 'move',
  remindEyes: 'eyes',
  remindScreen: 'screen',
  focusEnd: 'timer',
  remindMeeting: 'meeting',
  mustDo: 'done', success: 'done', habit: 'done',
  coin: 'points', reward: 'points', remindReward: 'points',
  remindBed: 'bed',
  remindPraise: 'praise',
  remindDrift: 'drift',
  remindCheckin: 'checkin',
  remindPush1: 'push1',
  remindPush2: 'push2',
  remindPush3: 'push3',
  error: 'error'
}
export const momentForSound = (name: SoundName): MomentId | null => BY_SOUND[name] ?? null

/** The moment for an island card (its kind; `meeting`: a calendar meeting starting soon). */
export function momentForAlert(kind: string, meeting = false): MomentId {
  if (meeting) return 'meeting'
  const m: Record<string, MomentId> = { ben: 'ben', remind: 'reminder', water: 'water', move: 'move', eyes: 'eyes', over: 'timer', end: 'timer', winddown: 'bed', sleep: 'bed', late: 'bed', reward: 'points', highlight: 'points', praise: 'praise', refocus: 'drift', coach: 'ben', checkin: 'checkin', brief: 'ben', shutdown: 'bed', push1: 'push1', push2: 'push2', push3: 'push3', launch: 'ben', win: 'points' }
  return m[kind] ?? 'reminder'
}

/** The moment for an app notification (the bell's kinds). */
export function momentForNotif(kind: string): MomentId {
  const m: Record<string, MomentId> = { ben: 'ben', plan: 'ben', review: 'ben', week: 'ben', reminder: 'reminder', water: 'water', training: 'move', event: 'meeting', leave: 'meeting', bedtime: 'bed', health: 'error' }
  return m[kind] ?? 'reminder'
}

const v = (f: number, at: number, len: number, gain: number, more: Partial<Voice> = {}): Voice => ({ f, at, len, gain, ...more })

/** The notes of each built-in sound (before the theme; "fixed" ones keep their own colour). */
export function momentRecipe(sound: MomentSound): Voice[] {
  switch (sound) {
    // Two bright notes up.
    case 'chime': return [v(659.25, 0, 0.16, 0.09), v(987.77, 0.09, 0.3, 0.1)]
    // A bell ringing out, two notes.
    case 'bell': return [v(880, 0, 0.32, 0.12), v(1760, 0, 0.18, 0.025), v(1174.66, 0.13, 0.5, 0.12), v(2349.32, 0.13, 0.25, 0.022)]
    // A quick sparkle up five notes.
    case 'rise': return [1046.5, 1318.5, 1567.98, 1975.53, 2093].map((f, i) => v(f, i * 0.06, 0.22 + i * 0.05, 0.08))
    // A round little bubble.
    case 'pop': return [v(420, 0, 0.07, 0.12, { f2: 980, wave: 'sine', attack: 0.003 }), v(1180, 0.06, 0.09, 0.05, { attack: 0.003 })]
    // A wooden three-note climb.
    case 'marimba': return [v(523.25, 0, 0.14, 0.1, { wave: 'triangle' }), v(659.25, 0.1, 0.14, 0.1, { wave: 'triangle' }), v(783.99, 0.2, 0.22, 0.1, { wave: 'triangle' })]
    // Two clear glassy pings.
    case 'glass': return [v(1567.98, 0, 0.3, 0.07, { attack: 0.002, fixed: true }), v(1567.98 * 2.76, 0, 0.12, 0.018, { attack: 0.002, fixed: true }), v(2093, 0.22, 0.36, 0.07, { attack: 0.002, fixed: true }), v(2093 * 2.76, 0.22, 0.14, 0.016, { attack: 0.002, fixed: true })]
    // A falling water glug.
    case 'drop': return [v(900, 0, 0.2, 0.13, { f2: 280, lp: [2400, 500], fixed: true }), v(720, 0.13, 0.18, 0.09, { f2: 240, lp: [1800, 400], fixed: true })]
    // Three short soft beeps (a heads-up).
    case 'pulse': return [0, 0.17, 0.34].map((t) => v(987.77, t, 0.09, 0.08, { wave: 'sine', attack: 0.004 }))
    // A coin.
    case 'coin': return [v(1567.98, 0, 0.08, 0.07, { wave: 'triangle' }), v(2093, 0.06, 0.24, 0.07, { wave: 'triangle' })]
    // A gong: inharmonic partials, a long fade.
    case 'gong': return ([[1, 0.14, 3.6], [2.32, 0.08, 2.6], [4.25, 0.05, 1.8], [6.63, 0.035, 1.2], [9.38, 0.02, 0.8]] as const).map(([r, g, len]) => v(160 * r, 0, len, g, { attack: 0.006, fixed: true }))
    // A slow, sleepy hum stepping down.
    case 'hum': return [v(329.63, 0, 0.9, 0.09, { attack: 0.25 }), v(246.94, 0.35, 1.1, 0.08, { attack: 0.3 })]
    // A low, soft thud (not a buzzer).
    case 'knock': return [v(150, 0, 0.18, 0.18, { f2: 70, lp: [600, 200], fixed: true })]
    // A happy little "nice!": up, up, a bright top note that rings.
    case 'cheer': return [v(783.99, 0, 0.1, 0.08, { wave: 'triangle' }), v(1046.5, 0.08, 0.1, 0.08, { wave: 'triangle' }), v(1567.98, 0.16, 0.38, 0.09), v(2093, 0.16, 0.3, 0.03)]
    // Two soft taps on the shoulder (a heads-up, not an alarm).
    case 'tap': return [v(392, 0, 0.08, 0.13, { wave: 'triangle', lp: [1800, 500], attack: 0.003, fixed: true }), v(392, 0.16, 0.08, 0.11, { wave: 'triangle', lp: [1800, 500], attack: 0.003, fixed: true })]
    // A soft, airy two-note chime (the ladder's first, gentle step).
    case 'softchime': return [v(587.33, 0, 0.5, 0.06, { attack: 0.03 }), v(880, 0.18, 0.7, 0.05, { attack: 0.04 })]
    // A sharp alarm: four quick high square-ish beeps (step 2: hard to ignore, still short).
    case 'alarm': return [0, 0.12, 0.24, 0.36].map((t, i) => v(i % 2 ? 1318.5 : 1760, t, 0.08, 0.07, { wave: 'square', attack: 0.002, lp: [5200, 2600], fixed: true }))
    // A low, firm horn (step 3, before Ben's line).
    case 'horn': return [v(196, 0, 0.7, 0.14, { wave: 'sawtooth', lp: [1400, 500], attack: 0.04, fixed: true }), v(293.66, 0.05, 0.65, 0.08, { wave: 'sawtooth', lp: [1400, 500], attack: 0.05, fixed: true })]
    // A calm, low bell that rings out (the screen-time break): one warm note and its soft octave.
    case 'calmbell': return [v(523.25, 0, 1.1, 0.12, { attack: 0.004 }), v(1046.5, 0, 0.6, 0.035, { attack: 0.004 }), v(1318.51, 0.02, 0.4, 0.018, { attack: 0.004 })]
    case 'none': return []
  }
}

/** The sound to play for one of the app's sounds: your pick for its moment, null for None, or 'own' (not a moment, or a default that keeps its own special notes). */
export function pickFor(name: SoundName, moments: Record<MomentId, MomentSound>): MomentSound | 'own' | null {
  const m = momentForSound(name)
  if (!m) return 'own'
  const pick = moments[m] ?? DEFAULT_MOMENTS[m]
  if (pick === 'none') return null
  // The habit pluck climbs with each habit done: kept while "done" is on its default.
  if (name === 'habit' && pick === DEFAULT_MOMENTS.done) return 'own'
  return pick
}
