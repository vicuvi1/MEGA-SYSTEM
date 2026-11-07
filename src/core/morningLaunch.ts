// DX19: the morning launch countdown. After you log the wake-up (or open the
// morning brief), the island runs three steps:
//   1. 💧 a glass of water (logged only when you tap "Drank it");
//   2. 💪 10 push-ups (logged only when you tap "Did them": points stay honest);
//   3. ▶ the first must-do opened within 2 minutes, with its launch kit.
// Each step can be skipped; the whole thing runs once a day, only in the 3
// hours after waking, never in a call or quiet hours. It ties to the morning
// brief: opening the brief starts it too. Pure and tested.

export interface MorningPrefs {
  on: boolean
  waterMl: number
  pushups: number
  /** Seconds for the last step (open the first must-do). */
  seconds: number
}
export const DEFAULT_MORNING: MorningPrefs = { on: true, waterMl: 250, pushups: 10, seconds: 120 }
export function cleanMorning(raw: unknown): MorningPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<MorningPrefs>
  const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d)
  return { on: typeof o.on === 'boolean' ? o.on : DEFAULT_MORNING.on, waterMl: n(o.waterMl, 100, 750, 250), pushups: n(o.pushups, 1, 50, 10), seconds: n(o.seconds, 60, 600, 120) }
}

export type LaunchStep = 'water' | 'pushups' | 'mustdo'
export const LAUNCH_STEPS: LaunchStep[] = ['water', 'pushups', 'mustdo']
export type StepMark = 'done' | 'skip'

export interface MorningRun {
  day: string
  startedAt: number
  marks: Partial<Record<LaunchStep, StepMark>>
  /** When the last step began (its 2-minute countdown). */
  lastAt?: number
}

export function cleanRun(raw: unknown, day: string): MorningRun | null {
  const o = raw as Partial<MorningRun> | null
  if (!o || o.day !== day || typeof o.startedAt !== 'number') return null
  const marks: MorningRun['marks'] = {}
  for (const s of LAUNCH_STEPS) if (o.marks?.[s] === 'done' || o.marks?.[s] === 'skip') marks[s] = o.marks[s]
  return { day, startedAt: o.startedAt, marks, ...(typeof o.lastAt === 'number' ? { lastAt: o.lastAt } : {}) }
}

/** Starts today's run (once): after the wake-up is logged or the brief was opened, within 3 hours of waking. */
export function morningBegin(o: { run: MorningRun | null; day: string; now: number; prefs: MorningPrefs; wokeAt: number | null; briefOpenedAt: number | null }): MorningRun | null {
  if (o.run) return o.run
  if (!o.prefs.on) return null
  const from = o.wokeAt ?? o.briefOpenedAt
  if (from == null || o.now < from || o.now - from > 3 * 3600_000) return null
  return { day: o.day, startedAt: o.now, marks: {} }
}

/** The step showing now (null: finished or nothing to do). The must-do step is skipped when there is none. */
export function currentStep(run: MorningRun | null, hasMustdo: boolean): LaunchStep | null {
  if (!run) return null
  for (const s of LAUNCH_STEPS) {
    if (s === 'mustdo' && !hasMustdo) continue
    if (!run.marks[s]) return s
  }
  return null
}

/** Marks a step; reaching the last step starts its countdown. */
export function markStep(run: MorningRun, step: LaunchStep, mark: StepMark, now: number, hasMustdo = true): MorningRun {
  const next = { ...run, marks: { ...run.marks, [step]: mark } }
  if (currentStep(next, hasMustdo) === 'mustdo' && next.lastAt == null) next.lastAt = now
  return next
}

/** Seconds left on the last step (0 once the time is up). */
export function secondsLeft(run: MorningRun, now: number, prefs: MorningPrefs): number {
  const at = run.lastAt ?? now
  return Math.max(0, Math.ceil((at + prefs.seconds * 1000 - now) / 1000))
}

export interface LaunchCard {
  id: string
  step: LaunchStep
  /** 1 of 3. */
  n: number
  of: number
  title: string
  text: string
  face: string
  buttons: { label: string; op: 'water' | 'pushups' | 'open' | 'skip'; primary?: boolean }[]
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/** The island card for the step now. */
export function launchCard(o: { run: MorningRun; now: number; prefs: MorningPrefs; mustdo: string | null; kit: string | null }): LaunchCard | null {
  const step = currentStep(o.run, !!o.mustdo)
  if (!step) return null
  const steps = LAUNCH_STEPS.filter((s) => s !== 'mustdo' || o.mustdo)
  const n = steps.indexOf(step) + 1
  const id = `launch:${o.run.day}:${step}`
  if (step === 'water')
    return { id, step, n, of: steps.length, title: `Launch ${n}/${steps.length} · Water`, text: `A glass of water first (${o.prefs.waterMl} ml). Then the phone stays down.`, face: '💧', buttons: [{ label: `💧 Drank it · ${o.prefs.waterMl} ml`, op: 'water', primary: true }, { label: 'Skip', op: 'skip' }] }
  if (step === 'pushups')
    return { id, step, n, of: steps.length, title: `Launch ${n}/${steps.length} · ${o.prefs.pushups} push-ups`, text: `${o.prefs.pushups} push-ups to wake the body. Tap only when you did them.`, face: '💪', buttons: [{ label: `💪 Did ${o.prefs.pushups}`, op: 'pushups', primary: true }, { label: 'Skip', op: 'skip' }] }
  const left = secondsLeft(o.run, o.now, o.prefs)
  return {
    id,
    step,
    n,
    of: steps.length,
    title: `Launch ${n}/${steps.length} · ${left > 0 ? mmss(left) : 'now'}`,
    text: left > 0 ? `Open “${o.mustdo}” before the clock runs out${o.kit ? ` (your ${o.kit} kit opens with it)` : ''}.` : `Time's up. Open “${o.mustdo}” now: just the first 5 minutes.`,
    face: left > 0 ? '🚀' : '⏰',
    buttons: [{ label: `▶ Open it${o.kit ? ' + kit' : ''}`, op: 'open', primary: true }, { label: 'Skip', op: 'skip' }]
  }
}
