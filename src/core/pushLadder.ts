// DX4: the push ladder. When you drift off a planned block (the PC coach saw
// video, games or social) or a block started and nothing is running, the push
// gets harder in up to 3 steps, each with its own sound:
//   1. a soft chime and a short card ("Lab 4 is on. Back to it?");
//   2. a sharp alarm and a firmer card;
//   3. Ben's voice line, plus a Telegram message with a stake you can take
//      (the stake is only made when you tap it: points stay honest).
// It resets the moment you start (a focus timer runs) or the trigger is gone.
// Each area's push level (Settings → Ben → Pushes) sets how far it goes and
// how fast: Soft stops at step 2 and waits longer; Hard climbs sooner. Quiet
// hours and meetings hold it (nothing fires, it doesn't jump ahead after).
// A Skip you tapped is your choice: it never starts a ladder (the "why I'm
// stalling" sheet asks instead). Pure and tested (pushLadder.test.ts).
import type { AreaLevel } from './benPushes'
import type { MomentId } from './soundMoments'

export type LadderStep = 1 | 2 | 3
export type LadderWhy = 'drift' | 'late'

export interface LadderPrefs {
  on: boolean
  /** Step 3 says Ben's line out loud (the device's own voice). */
  voice: boolean
  /** Step 3 also goes to Telegram. */
  telegram: boolean
  /** Step 3 on Telegram offers a stake (Ben's usual one: 25 min by a time, 50 points; made only if you tap it). */
  stake: boolean
}
export const DEFAULT_LADDER: LadderPrefs = { on: true, voice: true, telegram: true, stake: true }
export function cleanLadder(raw: unknown): LadderPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<LadderPrefs>
  const b = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d)
  return { on: b(o.on, DEFAULT_LADDER.on), voice: b(o.voice, DEFAULT_LADDER.voice), telegram: b(o.telegram, DEFAULT_LADDER.telegram), stake: b(o.stake, DEFAULT_LADDER.stake) }
}

/** What is wrong right now (null: nothing). `key` is the block (or the drift) it is about. */
export interface LadderTrigger {
  key: string
  title: string
  why: LadderWhy
  /** When it began (the drift was first seen, or the block's grace ran out). */
  since: number
}

export interface LadderState {
  key: string
  title: string
  why: LadderWhy
  step: 0 | LadderStep
  /** When the last step fired (or the ladder began, for step 0). */
  at: number
}

/** How a push level climbs: minutes before each step, and the top step. */
export interface LadderTuning {
  /** Minutes after the trigger before step 1. */
  first: number
  /** Minutes between steps. */
  gap: number
  top: LadderStep
}
export function ladderTuning(level: AreaLevel): LadderTuning {
  if (level === 'soft') return { first: 2, gap: 15, top: 2 }
  if (level === 'normal') return { first: 0, gap: 8, top: 3 }
  return { first: 0, gap: 5, top: 3 }
}

export const STEP_SOUND: Record<LadderStep, MomentId> = { 1: 'push1', 2: 'push2', 3: 'push3' }
export const STEP_KIND: Record<LadderStep, 'push1' | 'push2' | 'push3'> = { 1: 'push1', 2: 'push2', 3: 'push3' }

export interface LadderFire {
  step: LadderStep
  key: string
  title: string
  why: LadderWhy
  level: AreaLevel
  /** The card's words. */
  head: string
  text: string
  face: string
  sound: MomentId
  /** Step 3: what Ben says out loud (null: no voice). */
  voice: string | null
  /** Step 3: the Telegram message, and whether a stake is offered with it. */
  telegram: { text: string; stake: boolean } | null
}

export interface LadderInput {
  now: number
  prefs: LadderPrefs
  level: AreaLevel
  trigger: LadderTrigger | null
  /** A focus timer runs (you started): the ladder resets. */
  started: boolean
  /** Quiet hours, bed logged, a paused day. */
  quiet: boolean
  /** In a call, a meeting or a class. */
  meeting: boolean
  state: LadderState | null
}

const LINES: Record<LadderStep, Record<LadderWhy, string[]>> = {
  1: {
    drift: ['{title} is on. Back to it?', 'Drifting a bit. {title} is waiting.'],
    late: ['{title} started a while ago. Start the timer?', '{title} is on and the timer isn’t. Ready?']
  },
  2: {
    drift: ['Still off {title}. Close it and get back now.', 'That’s {m} min off {title}. Back to it, now.'],
    late: ['{m} min into {title} and nothing started. Start it now.', '{title}: {m} min gone. Timer on, now.']
  },
  3: {
    drift: ['{m} minutes gone from {title}. I’m not letting this one slide 😤', 'Enough. {title}, right now 😤'],
    late: ['{title} began {m} min ago and you still haven’t started 😤', 'No more waiting on {title}. Start now 😤']
  }
}
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''))
const pick = (a: string[], seed: number) => a[Math.abs(Math.floor(seed)) % a.length]
const HEAD: Record<LadderStep, string> = { 1: 'Back to it?', 2: 'Come back now', 3: 'Ben is calling you out' }

/** The words for a step (shared by the island card, the voice line and Telegram). */
export function ladderWords(step: LadderStep, why: LadderWhy, title: string, minutes: number, seed = 0): string {
  return fill(pick(LINES[step][why], seed), { title, m: Math.max(1, Math.round(minutes)) })
}

/**
 * One step of the ladder, or nothing. Returns the state to keep (null: reset)
 * and the step to fire now (at most one per call). Never fires in quiet hours
 * or a meeting; after one, the next step still waits its full gap.
 */
export function ladderTick(i: LadderInput): { state: LadderState | null; fire: LadderFire | null } {
  if (!i.prefs.on || i.started || !i.trigger) return { state: null, fire: null }
  const t = i.trigger
  const st: LadderState = i.state && i.state.key === t.key ? i.state : { key: t.key, title: t.title, why: t.why, step: 0, at: t.since }
  const tune = ladderTuning(i.level)
  if (st.step >= tune.top) return { state: st, fire: null }
  const next = (st.step + 1) as LadderStep
  const due = st.step === 0 ? t.since + tune.first * 60_000 : st.at + tune.gap * 60_000
  if (i.now < due) return { state: st, fire: null }
  // Held, not skipped: when the meeting ends the step comes, then the full gap again.
  if (i.quiet || i.meeting) return { state: st, fire: null }
  const minutes = (i.now - t.since) / 60_000
  const seed = Math.floor(t.since / 60_000) + next
  const text = ladderWords(next, t.why, t.title, minutes, seed)
  const top = next === 3
  const stake = top && i.level !== 'soft' && i.prefs.stake
  const fire: LadderFire = {
    step: next,
    key: t.key,
    title: t.title,
    why: t.why,
    level: i.level,
    head: HEAD[next],
    text,
    face: next === 1 ? '👀' : next === 2 ? '😠' : '😡',
    sound: STEP_SOUND[next],
    voice: top && i.prefs.voice ? text.replace(/\s*[\u{1F300}-\u{1FAFF}☀-➿]️?/gu, '').trim() : null,
    telegram: top && i.prefs.telegram ? { text: `😡 ${text}`, stake } : null
  }
  return { state: { ...st, title: t.title, step: next, at: i.now }, fire }
}

/** The ladder's Telegram key (one per block per day, shared with the push log so it goes once). */
export const ladderKey = (key: string) => `ladder3:${key}`.slice(0, 60)

/**
 * The trigger from what the island knows: a drift card naming the block, or
 * a focus block that started `graceMin` ago with no timer and no answer
 * (Skip and "10 min later" are your answers: the ladder waits for those).
 */
export function ladderTrigger(o: {
  now: number
  drift: { title: string; since: number } | null
  blocks: { id?: string; title: string; start: number; end: number; focus: boolean }[]
  running: boolean
  answers: Record<string, { ans?: string; until?: number } | undefined>
  graceMin?: number
}): LadderTrigger | null {
  // Drifting counts even with a timer on (the timer runs, you're on video).
  if (o.drift) return { key: `drift:${o.drift.title}`.slice(0, 80), title: o.drift.title, why: 'drift', since: o.drift.since }
  if (o.running) return null
  const grace = (o.graceMin ?? 12) * 60_000
  const b = o.blocks
    .filter((x) => x.focus && x.start + grace <= o.now && x.end - o.now >= 10 * 60_000)
    .sort((x, y) => y.start - x.start)[0]
  if (!b) return null
  const id = b.id ?? `${b.title}@${b.start}`
  const a = o.answers[`checkin:${id}`] ?? o.answers[`checkin-firm:${id}`]
  if (a?.ans === 'skip' || a?.ans === 'start') return null
  if (a?.ans === 'later' && (a.until ?? 0) > o.now) return null
  return { key: id, title: b.title, why: 'late', since: b.start + grace }
}
