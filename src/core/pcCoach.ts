// Ben on your PC, the live coach (pure, tested in pcCoach.test.ts). With
// "Let Ben see what I'm doing" on (Settings → Ben on this PC), the island
// reacts to what you really do on this computer, from the same title-free
// activity stream the Smart island uses (activityStream.ts: kinds of doing
// and app names only, never window titles):
// - praise for real work: 25 / 50 / 90 min of coding, study, CTF or writing
//   in a row (a look elsewhere under SESSION_GAP_SEC doesn't break it), and
//   the day's goal of real work hit;
// - drift: 10+ min on video, games or social during a planned block, a focus
//   timer or your work hours → "Back to <block>?";
// - a break card after ~50–60 min at the PC: water, 10 push-ups, stand up
//   (each logs only when you tap it: points stay honest);
// - the bedtime guard: from 30 min before your bedtime, firmer after it;
//   a good-morning line on the first use after your wake time;
// - welcome back after 15+ min away, and a short day recap in the evening.
// At most one reaction every 15–25 min (by how hard Ben pushes), a daily cap,
// nothing in meetings, and "Less of this" is remembered per kind.
import { minutesIn, type ActivitySession } from './activityStream'
import { DISTRACT_CONTEXTS, WORK_CONTEXTS, type ContextKind } from './activityContext'
import type { IslandAlert } from './islandModel'
import type { PcPrefs } from './pcActivity'
import type { PushLevel } from './lifeFit'
import { calendarDay } from './dates'

export type CoachKind = 'setup' | 'praise' | 'milestone' | 'drift' | 'break' | 'bed' | 'morning' | 'back' | 'recap'
/** The kinds you can turn down or off ("Less of this"); the setup card is only asked once. */
export const COACH_KINDS: CoachKind[] = ['praise', 'milestone', 'drift', 'break', 'bed', 'morning', 'back', 'recap']
export const COACH_LABEL: Record<CoachKind, string> = {
  setup: 'Asking to switch this on',
  praise: 'Praise for real work',
  milestone: 'Day goal hit',
  drift: 'Back to it',
  break: 'Breaks: water, push-ups, stretch',
  bed: 'Bedtime guard',
  morning: 'Good morning',
  back: 'Welcome back',
  recap: 'Evening recap'
}

/** What a button on a coach card does. */
export type CoachOp = 'ok' | 'less' | 'snooze' | 'back' | 'more5' | 'onBreak' | 'water' | 'pushups' | 'stretch' | 'bed' | 'start' | 'enable' | 'later' | 'never'
export interface CoachButton { label: string; op: CoachOp; primary?: boolean; subject?: string; minutes?: number }
export interface CoachReaction {
  id: string
  kind: CoachKind
  title: string
  text: string
  face: string
  /** When it came up, and until when it stays (then it's gone, unanswered). */
  at: number
  until: number
  buttons: CoachButton[]
}

/** The switch turns on what the coach needs (titles stay their own choice). */
export function coachOnPatch(): Partial<PcPrefs> {
  return { coach: true, activeApp: true, smart: true, idle: true, history: true }
}
/** Off: Ben stops looking (the app sensor and the Smart island go off with it; the day's file stays until you delete it). */
export function coachOffPatch(): Partial<PcPrefs> {
  return { coach: false, activeApp: false, titles: false, smart: false }
}
export const coachReady = (p: Pick<PcPrefs, 'coach' | 'activeApp' | 'smart'> | null | undefined) => !!p?.coach && !!p.activeApp && !!p.smart

// ---- how hard Ben pushes ----

export interface CoachTuning {
  /** Minutes between two reactions (bedtime and drift may come sooner). */
  gapMin: number
  /** Reactions a day at most (bedtime doesn't count against it). */
  dailyCap: number
  /** Minutes of real work in a row that get a word. */
  praiseAt: number[]
  /** Minutes on video / games / social before "back to it?". */
  driftMin: number
  /** Minutes at the PC before the break card. */
  breakMin: number
  /** Minutes between two bedtime lines once it's bedtime. */
  bedEveryMin: number
}
export function coachTuning(push: PushLevel): CoachTuning {
  if (push === 'gentle') return { gapMin: 25, dailyCap: 8, praiseAt: [50, 90], driftMin: 15, breakMin: 60, bedEveryMin: 20 }
  if (push === 'firm') return { gapMin: 20, dailyCap: 12, praiseAt: [25, 50, 90], driftMin: 12, breakMin: 55, bedEveryMin: 15 }
  return { gapMin: 15, dailyCap: 16, praiseAt: [25, 50, 90], driftMin: 10, breakMin: 50, bedEveryMin: 10 }
}
/** "Less of this" once: rarer; twice: off (Settings → Ben on this PC turns it back on). */
export const LESS_OFF = 2

// ---- the state (kept on this PC, in the app window's storage) ----

export interface CoachState {
  day: string
  lastAt: number
  count: number
  /** The last line used from each pool (no repeats back to back). */
  last: Record<string, number>
  /** The work stretch being praised, and the steps it already got. */
  session: { start: number; steps: number[] } | null
  milestone: boolean
  morning: boolean
  recap: boolean
  breakAt: number
  driftAt: number
  /** The drift stretch it already spoke about (its start), and how many times. */
  drift: { start: number; n: number } | null
  /** "5 more min" / "I'm on a break": no drift word until then. */
  driftQuiet: number
  bedAt: number
  /** Bedtime lines tonight, and which night that is (the day the evening began). */
  bedN: number
  bedNight: string
  /** The time away it already greeted (the end of that away stretch). */
  backKey: number
  /** Per kind: "Less of this" taps (kept across days). */
  less: Partial<Record<CoachKind, number>>
  /** Per kind: "Not now" until. */
  snooze: Partial<Record<CoachKind, number>>
  active: CoachReaction | null
  /** The one-time "switch it on?" card. */
  setup: { asked: string[]; answered: boolean; later: number }
}

export function newCoachState(day: string): CoachState {
  return { day, lastAt: 0, count: 0, last: {}, session: null, milestone: false, morning: false, recap: false, breakAt: 0, driftAt: 0, drift: null, driftQuiet: 0, bedAt: 0, bedN: 0, bedNight: '', backKey: 0, less: {}, snooze: {}, active: null, setup: { asked: [], answered: false, later: 0 } }
}

const num = (x: unknown, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d)
/** A saved state, checked; a new day keeps only what you told it (less, snoozes, the setup answer) and tonight's bedtime count. */
export function cleanCoachState(raw: unknown, day: string): CoachState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<CoachState>
  const base = newCoachState(day)
  const less: Partial<Record<CoachKind, number>> = {}
  for (const k of COACH_KINDS) if (num(o.less?.[k]) > 0) less[k] = Math.min(LESS_OFF, Math.round(num(o.less?.[k])))
  const snooze: Partial<Record<CoachKind, number>> = {}
  for (const k of COACH_KINDS) if (num(o.snooze?.[k]) > 0) snooze[k] = num(o.snooze?.[k])
  const setup = o.setup && typeof o.setup === 'object' ? { asked: Array.isArray(o.setup.asked) ? o.setup.asked.filter((d) => typeof d === 'string').slice(-5) : [], answered: o.setup.answered === true, later: num(o.setup.later) } : base.setup
  const kept = { ...base, less, snooze, setup, lastAt: num(o.lastAt), bedAt: num(o.bedAt), bedN: num(o.bedN), bedNight: typeof o.bedNight === 'string' ? o.bedNight : '', backKey: num(o.backKey) }
  if (o.day !== day) return kept
  return {
    ...kept,
    count: num(o.count),
    last: o.last && typeof o.last === 'object' ? (o.last as Record<string, number>) : {},
    session: o.session && typeof o.session.start === 'number' && Array.isArray(o.session.steps) ? { start: o.session.start, steps: o.session.steps.filter((x) => typeof x === 'number') } : null,
    milestone: o.milestone === true,
    morning: o.morning === true,
    recap: o.recap === true,
    breakAt: num(o.breakAt),
    driftAt: num(o.driftAt),
    drift: o.drift && typeof o.drift.start === 'number' ? { start: o.drift.start, n: num(o.drift.n) } : null,
    driftQuiet: num(o.driftQuiet),
    active: o.active && typeof o.active.id === 'string' && typeof o.active.until === 'number' ? (o.active as CoachReaction) : null
  }
}

// ---- what it reads ----

export interface CoachInput {
  now: number
  /** The local calendar day. */
  day: string
  /** "Let Ben see what I'm doing" is on and its sensors work. */
  on: boolean
  /** The desktop app (the setup card only shows there). */
  desktop: boolean
  /** The last two hours as sessions (activityStream.sessionize). */
  sessions: ActivitySession[]
  /** Seconds since the last mouse / key (null: unknown). */
  idleSec: number | null
  /** At the PC without a 5-minute pause since (null: away). */
  activeSince: number | null
  /** Today's real work (coding, study, writing, CTF) in minutes, by kind, and distracting minutes (this PC's day totals). */
  dayWork: { min: number; by: Partial<Record<ContextKind, number>>; distractMin: number }
  /** Real work a day that counts as "the goal hit". */
  workGoalMin: number
  push: PushLevel
  focus: { subject: string } | null
  /** The planned block on now (not a meeting, not an event). */
  block: { title: string; end: number } | null
  /** Inside your work window (Settings → Ben → My life). */
  workHour: boolean
  meeting: boolean
  /** "HH:MM" each. */
  bedTarget: string
  latestBed?: string
  wakeTime: string
  bedLogged: boolean
  /** What's next (a block or a must-do), for "welcome back" and the morning. */
  nextUp: { title: string; minutes?: number } | null
  /** Another surface moved you or asked you to move (ms; 0: never). */
  lastMoveAt: number
  /** The morning card already showed today (from another rule). */
  morningShown: boolean
  /** When Ben's evening review comes ("HH:MM"). */
  eveningAt: string
}

// ---- small helpers ----

const isHm = (t: unknown): t is string => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t)
const minOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
/** Minutes since noon (so 23:30 < 00:30 < 05:00 on one night). */
const night = (m: number) => (m - 720 + 1440) % 1440
const clock = (now: number) => new Date(now).toTimeString().slice(0, 5)
const nowMin = (now: number) => {
  const d = new Date(now)
  return d.getHours() * 60 + d.getMinutes()
}
const hm = (min: number) => {
  const m = Math.round(min)
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`
}
const short = (min: number) => {
  const m = Math.round(min)
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m}m`
}
const WHAT: Partial<Record<ContextKind, string>> = { coding: 'coding', study: 'study', writing: 'writing', ctf: 'CTF and lab work', video: 'video', gaming: 'gaming', social: 'chat and social', browsing: 'browsing' }
const what = (k: ContextKind) => WHAT[k] ?? k
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''))

/** A line from a pool, never the same one twice in a row. */
function line(s: CoachState, pool: string, lines: string[], seed: number): { text: string; last: Record<string, number> } {
  let i = Math.abs(Math.floor(seed)) % lines.length
  if (lines.length > 1 && s.last[pool] === i) i = (i + 1) % lines.length
  return { text: lines[i], last: { ...s.last, [pool]: i } }
}

// ---- the lines (plain, short; Ben's voice) ----

const PRAISE = [
  '{m} min of {what}. Keep it up 🔥',
  '{m} min of solid {what}. That’s how it’s done 💪',
  '{m} min in and still locked in. Keep going 😎',
  '{m} min of {what} without drifting. Proud of you.',
  '{m} min of real work. This is the version of you that wins.'
]
const PRAISE_LONG = [
  '{m} min of {what}. Beast mode. Water and a stretch soon?',
  '{m} min straight. Huge. Take 5 before your brain melts 🧠',
  '{m} min of {what}. That’s a real session. Stand up for a minute after this.'
]
const MILESTONE = [
  '{h} of real work today. That’s your goal hit 🎯',
  '{h} of real work. Goal done. Anything more is a bonus 😎',
  'Goal hit: {h} of real work today. Strong day 🔥'
]
const DRIFT: Record<PushLevel, string[]> = {
  gentle: ['{m} min on {what}. Back to {target} when you’re ready?', '{m} min of {what}. Shall we get back to {target}?'],
  firm: ['{m} min on {what} during {target}. Back to it?', '{m} min of {what}. {target} is waiting. Back to it?'],
  push: ['{m} min of {what}. {target} won’t do itself. Back to it 😤', '{m} min on {what}. You planned {target}. Close it and go 😤', 'That’s {m} min of {what}. Back to {target}, now.']
}
const DRIFT_AGAIN = ['That was more than 5 minutes. Close {what} and go back to {target} 😠', 'Still on {what}. You said 5 minutes. {target}, now.']
const BREAK = [
  '{m} min at the PC. Quick reset?',
  '{m} min sitting. Your back wants a break.',
  '{m} min straight. Water, push-ups or a stretch: pick one.'
]
const BED_SOON = ['Bed at {bed}. Start winding down: save your work, tomorrow’s top 3, screens off.', '{left} min to bed ({bed}). Finish this one thing, then wind down 🌙']
const BED_NOW: Record<PushLevel, string[]> = {
  gentle: ['It’s {now}, bedtime was {bed}. Time to wrap up 🌙', 'Bedtime ({bed}). You’re up at {wake}. Close up soon?'],
  firm: ['It’s {now}. Bedtime was {bed}. Wrap up now: you’re up at {wake}.', 'Past {bed}. Save, close, bed. Up at {wake}.'],
  push: ['It’s {now}. Bedtime was {bed}. Save and shut it down 😤', 'Past {bed} and still here. Up at {wake}. Bed. Now.']
}
const BED_LATE = ['It’s {now}. You’re up at {wake}: that’s {sleep} of sleep if you stop now. Shut it down 😠', '{now}. Every minute now comes off tomorrow. Bed 😠']
const BED_FUN = ['It’s {now} and you’re {doing}. Save, shut it down, bed 😠', '{now} and {doing}? No. You’re up at {wake}. Off 😡']
const MORNING = ['Good morning ☀️ Glass of water first. Then: {first}.', 'Morning ☀️ Water, then {first}. Let’s go.', 'Good morning. Big glass of water, then {first} 💪']
const MORNING_PLAIN = ['Good morning ☀️ Glass of water first, then your first block.', 'Morning ☀️ Water first. Then pick the one thing that matters today.']
const BACK = ['Welcome back. Next up: {next}.', 'Back after {away}. Next up: {next}. Let’s go.', 'Welcome back 👋 {next} is next.']
const BACK_PLAIN = ['Welcome back after {away}. What’s the one thing now?', 'Welcome back 👋 Pick up where you left off?']

// ---- the decision ----

const TTL: Record<CoachKind, number> = { setup: 30, praise: 4, milestone: 6, drift: 10, break: 20, bed: 10, morning: 45, back: 6, recap: 15 }
const make = (kind: CoachKind, key: string | number, now: number, title: string, text: string, face: string, buttons: CoachButton[]): CoachReaction => ({ id: `coach:${kind}:${key}`, kind, title, text, face, at: now, until: now + TTL[kind] * 60_000, buttons })
const LESS: CoachButton = { label: 'Less of this', op: 'less' }

/** Off for good ("Less of this" twice) or snoozed now. */
const muted = (s: CoachState, k: CoachKind, now: number) => (s.less[k] ?? 0) >= LESS_OFF || (s.snooze[k] ?? 0) > now

/** The bedtime phase now: soon (30 min before), now (bedtime until the latest bedtime), late (after it, until 05:00), or null. */
export function bedPhase(now: number, bed: string, latest?: string): { phase: 'soon' | 'now' | 'late'; left: number } | null {
  if (!isHm(bed)) return null
  const m = night(nowMin(now))
  const b = night(minOf(bed))
  // A bedtime before 18:00 isn't a night: no guard.
  if (b < 360) return null
  const lateAt = Math.max(b + 30, isHm(latest) && night(minOf(latest)) > b ? night(minOf(latest)) : b + 30)
  const end = night(5 * 60)
  if (m < b - 30 || m >= end) return null
  if (m < b) return { phase: 'soon', left: b - m }
  return { phase: m < lateAt ? 'now' : 'late', left: b - m }
}

/** Hours of sleep left from now to the wake time. */
const sleepLeft = (now: number, wake: string) => {
  const w = isHm(wake) ? minOf(wake) : 7 * 60
  return (w - nowMin(now) + 1440) % 1440
}

/** The day's real work by kind, as a short line: "coding 1h30, study 40m". */
export function workLine(by: Partial<Record<ContextKind, number>>): string {
  return (Object.entries(by) as [ContextKind, number][])
    .filter(([k, v]) => WORK_CONTEXTS.includes(k) && v >= 5)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k === 'ctf' ? 'CTF' : k} ${short(v)}`)
    .join(', ')
}

/** The kind you spent most of the last `min` minutes on (among these kinds). */
function mainKind(sessions: ActivitySession[], kinds: ContextKind[], now: number, min: number): ContextKind | null {
  const from = now - min * 60_000
  const by: Partial<Record<ContextKind, number>> = {}
  for (const x of sessions) {
    if (!kinds.includes(x.context)) continue
    const a = Math.max(from, x.start)
    const b = Math.min(now, x.end)
    if (b > a) by[x.context] = (by[x.context] ?? 0) + (b - a)
  }
  return ((Object.entries(by) as [ContextKind, number][]).sort((a, b) => b[1] - a[1])[0]?.[0]) ?? null
}

/**
 * The coach's reaction now (the one still showing, a new one, or none) and
 * its new state. Call it on every island build (every ~15 s); it never logs
 * anything: that's your tap (answerCoach + the island's own logging).
 */
export function decideCoach(i: CoachInput, prev: CoachState): { reaction: CoachReaction | null; state: CoachState } {
  let s = prev.day === i.day ? prev : cleanCoachState(prev, i.day)
  const now = i.now
  const atPc = i.idleSec != null && i.idleSec < 120
  const t = coachTuning(i.push)

  // Off: only the one-time "switch it on?" card (desktop, a calm moment, at most on 2 days).
  if (!i.on) {
    if (s.active?.kind === 'setup' && s.active.until > now) return { reaction: s.active, state: s }
    const h = new Date(now).getHours()
    const asked = s.setup.asked.length >= 2 && !s.setup.asked.includes(i.day)
    if (!i.desktop || s.setup.answered || s.setup.later > now || asked || s.setup.asked.includes(i.day) || i.meeting || i.focus || !atPc || h < 9 || h >= 22) return { reaction: null, state: { ...s, active: s.active?.kind === 'setup' ? null : s.active } }
    const r = make('setup', i.day, now, 'Let Ben see what you’re doing?', 'He’ll cheer real work, call you back from YouTube, remind you to move and to sleep. Only app names, worked out on this PC. Nothing leaves it.', '👁', [
      { label: 'Turn it on', op: 'enable', primary: true },
      { label: 'Not now', op: 'later' },
      { label: 'No thanks', op: 'never' }
    ])
    return { reaction: r, state: { ...s, active: r, setup: { ...s.setup, asked: [...s.setup.asked, i.day].slice(-5) } } }
  }

  // Quiet in meetings: nothing new, and nothing stays up.
  if (i.meeting) return { reaction: null, state: s.active ? { ...s, active: null } : s }

  const cur = i.sessions[i.sessions.length - 1]
  const ctxNow: ContextKind | null = cur && cur.end >= now - 60_000 ? cur.context : null
  const distractMin = minutesIn(i.sessions, DISTRACT_CONTEXTS, now)

  // The one showing stays until it's answered or its time is up (a drift word goes once you're back).
  if (s.active && s.active.until > now) {
    const gone = s.active.kind === 'drift' && (!ctxNow || !DISTRACT_CONTEXTS.includes(ctxNow))
    const asleep = s.active.kind === 'bed' && i.bedLogged
    if (!gone && !asleep) return { reaction: s.active, state: s }
    s = { ...s, active: null }
  } else if (s.active) s = { ...s, active: null }

  if (!atPc) return { reaction: null, state: s }

  const seed = Math.floor(now / 60_000) + s.count
  const sinceLast = (now - s.lastAt) / 60_000
  const gapOk = sinceLast >= t.gapMin
  const capOk = s.count < t.dailyCap
  const shown = (r: CoachReaction, patch: Partial<CoachState>, counts = true): { reaction: CoachReaction; state: CoachState } => ({ reaction: r, state: { ...s, ...patch, active: r, lastAt: now, count: s.count + (counts ? 1 : 0) } })
  const nextTitle = i.focus?.subject || i.block?.title || null

  // 1. Bedtime guard (may come sooner than the usual gap, and doesn't count against the day's cap).
  const bp = i.bedLogged ? null : bedPhase(now, i.bedTarget, i.latestBed)
  const tonight = calendarDay(new Date(now - 12 * 3600_000))
  if (s.bedNight !== tonight) s = { ...s, bedNight: tonight, bedN: 0 }
  if (bp && !muted(s, 'bed', now)) {
    const every = (bp.phase === 'soon' ? 60 : t.bedEveryMin) * ((s.less.bed ?? 0) > 0 ? 2 : 1)
    const firstSoon = bp.phase === 'soon' && s.bedN === 0
    if ((now - s.bedAt) / 60_000 >= every && (bp.phase !== 'soon' || firstSoon) && sinceLast >= 5) {
      const fun = ctxNow === 'gaming' || ctxNow === 'video' ? (ctxNow === 'gaming' ? 'gaming' : 'watching videos') : null
      const v = { bed: i.bedTarget, now: clock(now), wake: i.wakeTime, left: Math.max(1, bp.left), sleep: hm(sleepLeft(now, i.wakeTime)), doing: fun ?? '' }
      const pool = bp.phase === 'soon' ? BED_SOON : fun ? BED_FUN : bp.phase === 'late' ? BED_LATE : BED_NOW[i.push]
      const l = line(s, `bed:${bp.phase}${fun ? ':fun' : ''}`, pool, seed)
      const title = bp.phase === 'soon' ? `Bed in ${Math.max(1, bp.left)} min` : bp.phase === 'now' ? 'Bedtime' : 'Way past bedtime'
      const r = make('bed', now, now, title, fill(l.text, v), bp.phase === 'soon' ? '🌙' : bp.phase === 'now' ? '😴' : '😠', [
        { label: '🌙 Going to bed', op: 'bed', primary: true },
        { label: bp.phase === 'soon' ? '15 more min' : '10 more min', op: 'snooze', minutes: bp.phase === 'soon' ? 15 : 10 },
        LESS
      ])
      return shown(r, { last: l.last, bedAt: now, bedN: s.bedN + 1 }, false)
    }
  }

  // 2. Drift: 10+ min on video / games / social while you planned to work (sooner than the gap; 5 min after anything else).
  const planned = !!i.focus || !!i.block || i.workHour
  if (planned && ctxNow && DISTRACT_CONTEXTS.includes(ctxNow) && !muted(s, 'drift', now) && s.driftQuiet <= now && sinceLast >= 5) {
    const need = t.driftMin + ((s.less.drift ?? 0) > 0 ? 10 : 0)
    const start = now - distractMin * 60_000
    const same = s.drift && Math.abs(s.drift.start - start) < 3 * 60_000
    const again = same && s.drift!.n > 0
    if (distractMin >= need && (!same || (now - s.driftAt) / 60_000 >= (again ? 5 : 10))) {
      const target = nextTitle ?? 'work'
      const kind = mainKind(i.sessions, DISTRACT_CONTEXTS, now, distractMin) ?? ctxNow
      const v = { m: Math.round(distractMin), what: what(kind), target }
      const l = again ? line(s, 'drift:again', DRIFT_AGAIN, seed) : line(s, `drift:${i.push}`, DRIFT[i.push], seed)
      const left = i.block ? Math.max(5, Math.min(180, Math.round((i.block.end - now) / 60_000))) : 25
      const r = make('drift', `${start}:${(s.drift?.n ?? 0) + 1}`, now, `Back to ${target}?`, fill(l.text, v), again ? '😠' : '👀', [
        i.focus || !i.block ? { label: '↩ Back to it', op: 'back', primary: true } : { label: `▶ Back to it · ${left} min`, op: 'start', primary: true, subject: i.block.title, minutes: left },
        { label: '5 more min', op: 'more5' },
        { label: 'I’m on a break', op: 'onBreak' }
      ])
      return shown(r, { last: l.last, driftAt: now, drift: { start: same ? s.drift!.start : start, n: (same ? s.drift!.n : 0) + 1 } })
    }
  }

  if (!gapOk || !capOk) return { reaction: null, state: s }

  // 3. Morning: the first use after your wake time (before noon), once.
  const m = nowMin(now)
  if (!s.morning && !i.morningShown && !muted(s, 'morning', now) && isHm(i.wakeTime) && m >= minOf(i.wakeTime) && m < 12 * 60) {
    const first = i.nextUp?.title
    const l = first ? line(s, 'morning', MORNING, seed) : line(s, 'morning:plain', MORNING_PLAIN, seed)
    const r = make('morning', i.day, now, 'Good morning', fill(l.text, { first: first ?? '' }), '☀️', [
      { label: '💧 Drank a glass', op: 'water', primary: true },
      { label: '👍 On it', op: 'ok' }
    ])
    return shown(r, { last: l.last, morning: true })
  }
  if (!s.morning && m >= 12 * 60) s = { ...s, morning: true }

  // 4. Welcome back after 15+ min away (not after a whole night: that's the morning).
  const away = [...i.sessions].reverse().find((x, k, arr) => x.context === 'idle' && k > 0 && arr[k - 1].context !== 'idle')
  if (away && !muted(s, 'back', now)) {
    const awayMin = (away.end - away.start) / 60_000
    if (awayMin >= 15 && awayMin < 4 * 60 && now - away.end < 3 * 60_000 && away.end !== s.backKey) {
      const next = i.nextUp?.title ?? null
      const l = next ? line(s, 'back', BACK, seed) : line(s, 'back:plain', BACK_PLAIN, seed)
      const buttons: CoachButton[] = next && !i.focus ? [{ label: `▶ Start ${next.length > 22 ? `${next.slice(0, 21)}…` : next}`, op: 'start', primary: true, subject: next, minutes: Math.max(10, Math.min(90, i.nextUp?.minutes ?? 25)) }, { label: '👍 OK', op: 'ok' }] : [{ label: '👍 OK', op: 'ok', primary: true }]
      const r = make('back', away.end, now, 'Welcome back', fill(l.text, { next: next ?? '', away: hm(awayMin) }), '👋', buttons)
      return shown(r, { last: l.last, backKey: away.end })
    }
  }

  // 5. A break after ~50–60 min at the PC (not in a focus timer: right after it). Water / push-ups / stretch, logged only on your tap.
  const sitting = i.activeSince ? (now - i.activeSince) / 60_000 : 0
  const breakMin = t.breakMin + ((s.less.break ?? 0) > 0 ? 20 : 0)
  if (!i.focus && !bp && !muted(s, 'break', now) && sitting >= breakMin && (now - i.lastMoveAt) / 60_000 >= breakMin && (now - s.breakAt) / 60_000 >= breakMin) {
    const l = line(s, 'break', BREAK, seed)
    const r = make('break', now, now, 'Break time', fill(l.text, { m: Math.round(sitting) }), '🧍', [
      { label: '💧 Water', op: 'water', primary: true },
      { label: '💪 10 push-ups', op: 'pushups' },
      { label: '🧍 Stretched', op: 'stretch' },
      { label: '⏰ 15 min', op: 'snooze', minutes: 15 }
    ])
    return shown(r, { last: l.last, breakAt: now })
  }

  // 6. The day's goal of real work hit.
  if (!s.milestone && !muted(s, 'milestone', now) && i.workGoalMin > 0 && i.dayWork.min >= i.workGoalMin) {
    const l = line(s, 'milestone', MILESTONE, seed)
    const r = make('milestone', i.day, now, 'Goal hit', fill(l.text, { h: hm(i.dayWork.min) }), '🎯', [{ label: '😎 Thanks', op: 'ok', primary: true }, LESS])
    return shown(r, { last: l.last, milestone: true })
  }

  // 7. Praise for real work in a row: 25 / 50 / 90 min (once each per stretch).
  const workMin = minutesIn(i.sessions, WORK_CONTEXTS, now)
  if (ctxNow && WORK_CONTEXTS.includes(ctxNow) && workMin >= 20 && !muted(s, 'praise', now)) {
    const start = now - workMin * 60_000
    const sess = s.session && Math.abs(s.session.start - start) < 10 * 60_000 ? s.session : { start, steps: [] as number[] }
    const steps = (s.less.praise ?? 0) > 0 ? t.praiseAt.filter((x) => x >= 50) : t.praiseAt
    const due = steps.filter((x) => x <= workMin && !sess.steps.includes(x))
    if (due.length) {
      const step = due[due.length - 1]
      const kind = mainKind(i.sessions, WORK_CONTEXTS, now, workMin) ?? ctxNow
      const l = step >= 90 ? line(s, 'praise:long', PRAISE_LONG, seed) : line(s, 'praise', PRAISE, seed)
      const r = make('praise', `${start}:${step}`, now, step >= 90 ? 'Beast mode' : step >= 50 ? 'On fire' : 'Locked in', fill(l.text, { m: step, what: what(kind) }), step >= 90 ? '🏆' : step >= 50 ? '🔥' : '💪', [{ label: '💪 Keep going', op: 'ok', primary: true }, LESS])
      return shown(r, { last: l.last, session: { start: sess.start, steps: [...sess.steps, ...due] } })
    }
    if (sess !== s.session) s = { ...s, session: sess }
  }

  // 8. The evening recap (before the bedtime guard starts), once, if there was real work.
  const bedAt = isHm(i.bedTarget) ? night(minOf(i.bedTarget)) : night(23 * 60)
  const recapAt = Math.min(isHm(i.eveningAt) ? night(minOf(i.eveningAt)) : night(21 * 60), bedAt - 45)
  const nm = night(m)
  if (!s.recap && !muted(s, 'recap', now) && nm >= recapAt && nm < bedAt - 30 && i.dayWork.min >= 15) {
    const by = workLine(i.dayWork.by)
    const distract = i.dayWork.distractMin >= 10 ? ` · ${short(i.dayWork.distractMin)} on video, games and social` : ''
    const text = `${short(i.dayWork.min)} of real work${by ? ` (${by})` : ''}${distract}. ${i.dayWork.min >= i.workGoalMin ? 'Good day. Now wind down on time 🌙' : 'Tomorrow: start with the hardest thing.'}`
    const r = make('recap', i.day, now, 'Your day on the PC', text, '📊', [{ label: '👍 Nice', op: 'ok', primary: true }, LESS])
    return shown(r, { recap: true })
  }

  return { reaction: null, state: s }
}

/** Your answer on a coach card: what it remembers, and a few words back (the island's own logging does the rest). */
export function answerCoach(prev: CoachState, kind: CoachKind, op: CoachOp, now: number, minutes?: number): { state: CoachState; said: string | null } {
  let s: CoachState = { ...prev, active: prev.active && prev.active.kind === kind ? null : prev.active }
  let said: string | null = null
  switch (op) {
    case 'less': {
      const n = Math.min(LESS_OFF, (s.less[kind] ?? 0) + 1)
      s = { ...s, less: { ...s.less, [kind]: n } }
      said = n >= LESS_OFF ? `OK, no more ${COACH_LABEL[kind].toLowerCase()}. Turn it back on in Settings → Ben on this PC.` : 'OK, less of this'
      break
    }
    case 'snooze': {
      const m = Math.max(5, Math.min(120, minutes ?? 15))
      s = { ...s, snooze: { ...s.snooze, [kind]: now + m * 60_000 } }
      said = `OK, ${m} more min`
      break
    }
    case 'more5':
      s = { ...s, driftQuiet: now + 5 * 60_000 }
      said = '5 more minutes. I’m watching 👀'
      break
    case 'onBreak':
      s = { ...s, driftQuiet: now + 20 * 60_000, drift: null }
      said = 'Enjoy the break. 20 min, then back to it.'
      break
    case 'back':
    case 'start':
      s = { ...s, driftQuiet: now + 10 * 60_000, drift: null }
      said = kind === 'drift' ? 'That’s it. Go 💪' : null
      break
    case 'water':
    case 'pushups':
    case 'stretch':
      s = { ...s, breakAt: now }
      break
    case 'bed':
      s = { ...s, bedAt: now }
      break
    case 'enable':
      s = { ...s, setup: { ...s.setup, answered: true } }
      said = '👁 Ben sees what you’re doing now (only on this PC)'
      break
    case 'later':
      s = { ...s, setup: { ...s.setup, later: now + 3 * 864e5 } }
      said = 'OK, maybe later (Settings → Ben on this PC)'
      break
    case 'never':
      s = { ...s, setup: { ...s.setup, answered: true } }
      said = 'OK. You can still turn it on in Settings → Ben on this PC'
      break
    case 'ok':
      break
  }
  return { state: s, said }
}

/** Settings: the kinds you turned off, and turning one back on. */
export const coachMuted = (s: CoachState): CoachKind[] => COACH_KINDS.filter((k) => (s.less[k] ?? 0) > 0)
export function coachResume(s: CoachState, k: CoachKind): CoachState {
  const less = { ...s.less }
  delete less[k]
  const snooze = { ...s.snooze }
  delete snooze[k]
  return { ...s, less, snooze }
}

/** The island card: its kind picks the sound (Settings → Sound) and whether it peeks in Calm. */
export function coachAlertKind(k: CoachKind): IslandAlert['kind'] {
  if (k === 'praise' || k === 'milestone' || k === 'recap') return 'praise'
  if (k === 'drift') return 'refocus'
  if (k === 'break') return 'move'
  if (k === 'bed') return 'late'
  return 'coach'
}

export function coachAlert(r: CoachReaction): IslandAlert {
  return {
    id: r.id,
    kind: coachAlertKind(r.kind),
    title: r.title,
    text: r.text,
    face: r.face,
    actions: r.buttons.map((b) => ({ label: b.label, ...(b.primary ? { primary: true } : {}), action: { kind: 'coach' as const, op: b.op, ck: r.kind, alertId: r.id, ...(b.subject ? { subject: b.subject } : {}), ...(b.minutes ? { minutes: b.minutes } : {}) } }))
  }
}
