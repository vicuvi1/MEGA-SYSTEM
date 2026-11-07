// The coach in Sport Track: what to aim for today, what to do next time, and a
// line after every log. Double progression: do more reps in each set until every
// set reaches the top of the move's range, then try the harder move. After two
// tough sessions in a row it suggests an easier version, framed as smart
// training. Also: a missing muscle group, and a form tip at the right time.
// Pure and tested; nothing here pays points.
import { FAMILIES, moveById, type Move } from './sportMoves'
import { moveOf, nextStep, prevStep, type SportEx } from './sportLadders'
import { muscleOf, setsOn, type Muscle } from './sportSets'
import { placeFamily, trackOf, estimateSets, type HistoryInput, type Placement } from './sportLevels'
import { rangeFor, needFor, restFor, strengthSets, STRENGTH_LO, type ProgMode } from './sportProgress'

export interface CoachInput extends HistoryInput {
  exId: string
  /** move id → the day it may come back ("Not yet"). */
  notYet?: Record<string, string>
  /** An easy week: fewer sets, no new reps. */
  deload?: boolean
  /** strength (default), grow or endurance. */
  mode?: ProgMode
  /** "Too easy" / "Too hard" taps per exercise. */
  feel?: FeelLog | null
  /** Effort ratings (1–5), per session or per exercise. */
  effort?: EffortLog | null
}

// ---------------------------------------------------------------- feedback: too easy / too hard, and effort

export type Feel = 'easy' | 'hard' | 'ok'
export interface FeelEntry { d: string; v: Feel }
/** exercise id → taps, oldest first. 'ok' is a marker for "the coach acted on it": older taps stop counting. */
export type FeelLog = Record<string, FeelEntry[]>
/** 'YYYY-MM-DD' (the whole session) or 'YYYY-MM-DD:exerciseId' → effort 1 (very light) … 5 (all out). */
export type EffortLog = Record<string, number>

export const FEEL_KEEP = 12
const FEEL_DAYS = 28
const feelOrder: Record<Feel, number> = { easy: 0, hard: 0, ok: 1 }
const sortFeel = (l: FeelEntry[]) => [...l].sort((a, b) => (a.d === b.d ? feelOrder[a.v] - feelOrder[b.v] : a.d < b.d ? -1 : 1))

/** One tap of "Too easy" / "Too hard" for an exercise on a day (one of each kind per day; the later tap replaces the other). */
export function addFeel(log: FeelLog | null | undefined, exId: string, v: 'easy' | 'hard', day: string): FeelLog {
  const mine = (log?.[exId] ?? []).filter((e) => !(e.d === day && e.v !== 'ok'))
  return { ...(log ?? {}), [exId]: sortFeel([...mine, { d: day, v }]).slice(-FEEL_KEEP) }
}

/** The coach acted on the taps (a harder move, more sets, an easier step): start counting from zero. */
export function resetFeel(log: FeelLog | null | undefined, exId: string, day: string): FeelLog {
  const mine = (log?.[exId] ?? []).filter((e) => !(e.d === day && e.v === 'ok'))
  return { ...(log ?? {}), [exId]: sortFeel([...mine, { d: day, v: 'ok' as Feel }]).slice(-FEEL_KEEP) }
}

/** An effort rating (clamped to 1–5) for the session, or for one exercise of it. */
export function setEffort(log: EffortLog | null | undefined, day: string, rating: number, exId?: string): EffortLog {
  const r = Math.max(1, Math.min(5, Math.round(Number.isFinite(Number(rating)) ? Number(rating) : 3)))
  return { ...(log ?? {}), [exId ? `${day}:${exId}` : day]: r }
}

/** Both devices' taps joined (same day and kind once), the newest 12 per exercise. */
export function mergeFeel(a: FeelLog | null | undefined, b: FeelLog | null | undefined): FeelLog {
  const out: FeelLog = {}
  for (const id of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const seen = new Map<string, FeelEntry>()
    for (const e of [...(a?.[id] ?? []), ...(b?.[id] ?? [])]) if (e && e.d && (e.v === 'easy' || e.v === 'hard' || e.v === 'ok')) seen.set(`${e.d}|${e.v}`, { d: e.d, v: e.v })
    out[id] = sortFeel([...seen.values()]).slice(-FEEL_KEEP)
  }
  return out
}

/** Efforts of both devices; the newer device wins a day it rated differently. Only the last 90 days are kept. */
export function mergeEffort(older: EffortLog | null | undefined, newer: EffortLog | null | undefined): EffortLog {
  const all = { ...(older ?? {}), ...(newer ?? {}) }
  const days = [...new Set(Object.keys(all).map((k) => k.slice(0, 10)))].sort().slice(-90)
  const keep = new Set(days)
  return Object.fromEntries(Object.entries(all).filter(([k, v]) => keep.has(k.slice(0, 10)) && Number(v) >= 1 && Number(v) <= 5))
}

export interface Signal {
  /** What you told the coach (or what your effort says). */
  kind: 'easy' | 'hard' | null
  /** Two taps in a row (or two sessions of effort). */
  strong: boolean
  from: 'tap' | 'effort' | null
}

const dayBack = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)

/**
 * Easy or hard? Two "too easy" taps in a row mean easy, a "too hard" tap means hard (two mean strongly hard).
 * With no taps, effort speaks: 1–2 in your last two sessions of the exercise is easy, 5 twice is hard.
 */
export function signalFor(input: { feel?: FeelLog | null; effort?: EffortLog | null; exId: string; today: string }): Signal {
  const none: Signal = { kind: null, strong: false, from: null }
  const taps = sortFeel(input.feel?.[input.exId] ?? []).filter((e) => e.d <= input.today && dayBack(e.d, input.today) <= FEEL_DAYS)
  const lastOk = taps.filter((e) => e.v === 'ok').pop()
  const live = taps.filter((e) => e.v !== 'ok' && (!lastOk || e.d > lastOk.d))
  const last2 = live.slice(-2)
  if (last2.length === 2 && last2.every((e) => e.v === 'easy')) return { kind: 'easy', strong: true, from: 'tap' }
  if (last2.length && last2[last2.length - 1].v === 'hard') return { kind: 'hard', strong: last2.length === 2 && last2[0].v === 'hard', from: 'tap' }
  if (last2.length) return none
  const fx = input.effort ?? {}
  const rated = Object.keys(fx)
    .filter((k) => k.endsWith(':' + input.exId) && k.slice(0, 10) <= input.today && dayBack(k.slice(0, 10), input.today) <= FEEL_DAYS && (!lastOk || k.slice(0, 10) > lastOk.d))
    .sort()
    .slice(-2)
    .map((k) => Number(fx[k]))
  if (rated.length === 2 && rated.every((r) => r <= 2)) return { kind: 'easy', strong: true, from: 'effort' }
  if (rated.length === 2 && rated.every((r) => r >= 5)) return { kind: 'hard', strong: true, from: 'effort' }
  return none
}

/** The average effort you gave this exercise lately (null: never rated). */
export function effortAvg(effort: EffortLog | null | undefined, exId: string, today: string): number | null {
  const v = Object.keys(effort ?? {})
    .filter((k) => k.endsWith(':' + exId) && k.slice(0, 10) <= today && dayBack(k.slice(0, 10), today) <= FEEL_DAYS)
    .map((k) => Number(effort![k]))
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null
}

export interface Session {
  day: string
  reps: number[]
  est: boolean
}

/** One exercise's sessions up to `until`, oldest first: real sets, else an estimate from the day total. */
export function sessionsFor(input: HistoryInput, ex: SportEx, until: string): Session[] {
  const move = moveOf(ex)
  const keys = new Set([...Object.keys(input.days ?? {}), ...Object.keys(input.sets ?? {})])
  const out: Session[] = []
  for (const day of [...keys].sort()) {
    if (day > until) continue
    const real = setsOn(input.sets, day, String(ex.id)).map((s) => s.reps)
    if (real.length) out.push({ day, reps: real, est: false })
    else {
      const t = Number(input.days?.[day]?.[String(ex.id)]) || 0
      if (t > 0) out.push({ day, reps: estimateSets(t, move?.unit ?? (ex.unit === 'sec' ? 'sec' : 'reps')), est: true })
    }
  }
  return out
}

export type CoachStatus = 'new' | 'building' | 'top' | 'ready' | 'stuck' | 'comeback' | 'deload' | 'eased'

export interface Coach {
  exId: string
  move: Move
  place: Placement | null
  sets: number
  mode: ProgMode
  /** Rest between sets, in seconds. */
  rest: number
  /** Sets that must reach the top of the range for the next variation (strength: 3). */
  topSets: number
  /** What "Too easy" / "Too hard" (or effort) says right now, and how it changed today's plan. */
  signal: Signal
  /** Average effort 1–5 on this exercise lately. */
  effort: number | null
  /** Reps (or seconds) to aim for in each set today. */
  goal: number
  /** The range of this move: bottom and top of a set. */
  lo: number
  hi: number
  unit: 'reps' | 'sec'
  /** "3×17" (seconds get an s). */
  label: string
  /** What you did last time (before today). */
  last: Session | null
  /** Today's sets so far. */
  today: number[]
  /** Target for next session, once today's sets count ("Next: 3×17"). */
  next: { sets: number; goal: number; label: string }
  status: CoachStatus
  /** One line for the card. */
  line: string
  /** Prefill for quick logging: last time's sets, or the goal. */
  chips: number[]
  /** Sessions in a row at the top of the range. */
  hits: number
  /** A harder move you are ready for, with why. */
  ready: { to: Move; sets: number; reps: number; why: string } | null
  /** An easier move or a lighter plan after two tough sessions. */
  stepBack: { to: Move | null; text: string } | null
  /** A one-line technique tip when you level up or struggle. */
  tip: string | null
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const u = (unit: string) => (unit === 'sec' ? ' s' : '')
export const NEED_TOP = 2
const trackFamily = (m: Move) => FAMILIES[m.family]?.steps

const TIPS: Record<string, string> = {
  pushup: 'Keep one straight line from head to heels, and lower your chest to a fist above the floor.',
  squat: 'Push your knees out over your toes and keep your heels on the floor.',
  core: 'Exhale as you curl up, and never pull on your neck.',
  plank: 'Squeeze your glutes and tuck the ribs in: a short, tight plank beats a long sagging one.',
  row: 'Pull your elbows back and squeeze your shoulder blades together at the top.',
  lunge: 'Take a big step and keep your front knee over your ankle, your chest tall.',
  bridge: 'Push through your heels and squeeze your glutes hard at the top for a second.',
  calf: 'Pause one second at the top and lower slowly, all the way down.',
  dips: 'Keep your back close to the chair and your elbows pointing straight back.',
  pike: 'Make an upside-down V and lower the top of your head between your hands.',
  back: 'Lift with your back, not your neck: look at the floor and move slowly.',
  burpee: 'Land softly and keep your core tight when you drop to the floor.'
}

/** A one-line form tip for a move: its family tip, else the common mistake. */
export function formTip(move: Move): string {
  return TIPS[move.family] ?? `Watch out: ${move.mistake.replace(/^./, (c) => c.toLowerCase())}`
}

const workingSets = (s: Session, n: number) => s.reps.slice(0, n)
const atTop = (s: Session, sets: number, hi: number) => s.reps.length >= sets && workingSets(s, sets).every((r) => r >= hi)
const missed = (s: Session, lo: number) => Math.max(...s.reps) < lo

function aimAfter(list: Session[], o: { lo: number; hi: number; sets: number; unit: 'reps' | 'sec'; start: number; deload: boolean }): number {
  const last = list[list.length - 1]
  if (!last) return o.start
  const min = Math.min(...workingSets(last, o.sets))
  const step = o.unit === 'sec' ? 5 : 1
  return clamp(o.deload ? min : min + step, o.lo, o.hi + (atTop(last, o.sets, o.hi) ? step : 0))
}

/** Where an exercise stands and what to aim for. Null for exercises that are not library moves. */
export function coachFor(input: CoachInput): Coach | null {
  const ex = input.exercises.find((e) => String(e.id) === String(input.exId))
  const move = ex && moveOf(ex)
  if (!ex || !move) return null
  const unit: 'reps' | 'sec' = move.unit
  const track = trackOf(move.family)
  const place = placeFamily(input, move.family)
  const onMove = track ? track.levels.filter((l) => l.move === move.id) : []
  const mode: ProgMode = input.mode ?? 'strength'
  const strength = mode === 'strength'
  const fallback = rangeFor(move, mode)
  const lo = strength ? fallback.lo : onMove[0]?.reps ?? fallback.lo
  const hi = strength ? fallback.hi : onMove.length ? onMove[onMove.length - 1].reps : fallback.hi
  const mine = onMove.filter((l) => place && l.n <= place.level).pop() ?? onMove[0]
  const harderMove = nextStep(move)
  // Strength: 3 sets (4 for a hard move or the top of the ladder), up to 5; the others follow your level.
  let sets = strength ? strengthSets(move, harderMove ? 0 : 1) : clamp((mine?.sets ?? 3) || 3, 1, 5)
  if (input.deload) sets = Math.max(strength ? 2 : 1, sets - 1)
  const topSets = strength ? 3 : sets
  const needTop = needFor(mode)
  const all = sessionsFor(input, ex, input.today)
  const past = all.filter((s) => s.day < input.today)
  const todays = all.find((s) => s.day === input.today) ?? null
  const last = past[past.length - 1] ?? null
  const startGoal = clamp(place && place.lv && place.lv.move === move.id ? place.lv.reps : Math.round((Number(ex.target) || lo * 3) / 3), lo, hi)
  const o = { lo, hi, sets, unit, start: startGoal, deload: !!input.deload }
  let goal = aimAfter(past, o)
  const nextGoal = aimAfter(todays ? [...past, todays] : past, o)
  const recent = todays && todays.reps.length >= sets ? [...past, todays] : past

  let status: CoachStatus = last ? 'building' : 'new'
  let line = ''
  let ready: Coach['ready'] = null
  let stepBack: Coach['stepBack'] = null
  let tip: string | null = null

  // Ready for a harder move: the top of every set, two sessions in a row.
  let run = 0
  for (let i = recent.length - 1; i >= 0 && atTop(recent[i], topSets, hi); i--) run++
  // Strength: one set far above the range (12+ when the top is 8) means this move is too easy to train strength.
  const lastSet = recent.length ? Math.max(...recent[recent.length - 1].reps) : 0
  const big = strength && unit === 'reps' && !recent[recent.length - 1]?.est && lastSet >= Math.ceil(hi * 1.5)
  if (big) run = Math.max(run, needTop)
  const harder = harderMove
  const blocked = (m: Move | null) => !!m && !!input.notYet?.[m.id] && input.notYet[m.id] > input.today
  // Your best set may put you more than one step up: go straight to the move you are placed on.
  const placed = place?.lv ? moveById(place.lv.move) : null
  const idx = (m: Move) => (trackFamily(m) ?? []).indexOf(m.id)
  const target = strength && harder && placed && placed.family === move.family && idx(placed) > idx(harder) && !blocked(placed) ? placed : harder
  const startReps = (m: Move) => (strength ? STRENGTH_LO : track?.levels.find((l) => l.move === m.id)?.reps ?? m.set)
  if (run >= needTop) {
    if (target && !blocked(harder)) {
      ready = { to: target, sets: 1, reps: startReps(target), why: big ? `a single set of ${lastSet}${u(unit)}` : `${topSets}×${hi}${u(unit)}${needTop > 1 ? ` ${needTop} sessions in a row` : ''}` }
      status = 'ready'
      tip = formTip(target)
      line = `Ready for ${target.name}? Try 1 set of ${ready.reps}${u(target.unit)}. You did ${ready.why}.`
    } else if (!harder) {
      status = 'top'
      line = 'Top of this ladder. Add a 4th set, or lower slowly (3 seconds down).'
    }
  }
  // Two tough sessions in a row: an easier version, no shame.
  const lastTwo = recent.slice(-2)
  if (status !== 'ready' && lastTwo.length === 2 && lastTwo.every((s) => missed(s, lo))) {
    const easier = prevStep(move)
    status = 'stuck'
    goal = lo
    stepBack = {
      to: easier,
      text: easier
        ? `Two tough sessions in a row is information, not failure. Smart training: go back to ${easier.name} for a week, or do ${sets}×${lo}${u(unit)} with 2–3 min rest.`
        : `Two tough sessions in a row is information, not failure. Smart training: do ${sets}×${lo}${u(unit)} with 2–3 min rest and sleep well.`
    }
    tip = formTip(move)
    line = stepBack.text
  }
  // A comeback after a break.
  if (status === 'building' && place?.comeback && place.comeback.hits < place.comeback.need && last) {
    status = 'comeback'
    const lastMin = Math.min(...workingSets(last, sets))
    goal = clamp(Math.round(lastMin * 0.75), lo, hi)
    const n = place.comeback.need - place.comeback.hits
    line = `Welcome back. Start at ${sets}×${goal}${u(unit)} (a bit under your best) and build fast: hit your old level ${n} more ${n === 1 ? 'time' : 'times'}.`
  }
  // "Too easy" / "Too hard" (or effort) speaks now, before the next session.
  const signal = signalFor({ feel: input.feel, effort: input.effort, exId: String(ex.id), today: input.today })
  const why = signal.from === 'effort' ? 'your effort ratings' : signal.strong ? 'you said so twice' : 'you said so'
  if (signal.kind === 'easy' && status !== 'comeback' && status !== 'stuck') {
    if (status !== 'ready' && harder && !blocked(harder)) {
      const pick = target ?? harder
      ready = { to: pick, sets: 1, reps: startReps(pick), why: `"too easy": ${why}` }
      status = 'ready'
      tip = formTip(pick)
      line = `Too easy, so let's go up: try 1 set of ${ready.reps}${u(pick.unit)} of ${pick.name}.`
    } else if (status !== 'ready') {
      // No harder move to go to: more reps, then more sets.
      if (goal < hi) {
        goal = Math.min(hi, goal + 2)
        line = `Too easy, so ${sets}×${goal}${u(unit)} today (2 more reps per set).`
      } else {
        sets = Math.min(5, sets + 1)
        line = `Too easy, so add a set today: ${sets}×${goal}${u(unit)}.`
      }
      status = 'building'
    }
  }
  if (signal.kind === 'hard' && status !== 'comeback') {
    const easier = prevStep(move)
    if (signal.strong && easier) {
      status = 'stuck'
      goal = lo
      stepBack = { to: easier, text: `Too hard twice: that is useful to know. Go back to ${easier.name} for a week, then come back stronger.` }
      line = stepBack.text
      ready = null
    } else {
      status = 'eased'
      goal = Math.max(lo, goal - 2)
      sets = Math.max(2, sets - (signal.strong ? 1 : 0))
      ready = null
      line = `Too hard, so go lighter today: ${sets}×${goal}${u(unit)} and take a long rest between sets.`
    }
  }
  if (input.deload && status !== 'ready' && status !== 'stuck') {
    status = 'deload'
    line = `Easy week: ${sets}×${goal}${u(unit)}, stop 3 reps before it gets hard. You grow while you recover.`
  }
  const rest = restFor(move, mode)
  if (status === 'new') line = strength ? `First time: ${sets}×${goal}${u(unit)}, hard reps with good form, ${Math.round(rest / 6) / 10} minutes rest between sets.` : `First time: aim for ${sets}×${goal}${u(unit)} and stop 1–2 reps before you can't do another.`
  if (status === 'building' && !signal.kind) line = `Beat last time: ${sets}×${goal}${u(unit)}${last!.est ? '' : ` (last: ${last!.reps.join(' · ')})`}.`
  const chips = (last ? last.reps.slice(0, Math.max(sets, 1)) : Array.from({ length: sets }, () => goal)).slice(0, 6)
  return {
    exId: String(ex.id),
    move,
    place,
    sets,
    mode,
    rest,
    topSets,
    signal,
    effort: effortAvg(input.effort, String(ex.id), input.today),
    goal,
    lo,
    hi,
    unit,
    label: `${sets}×${goal}${u(unit)}`,
    last,
    today: todays?.reps ?? [],
    next: { sets, goal: nextGoal, label: `${sets}×${nextGoal}${u(unit)}` },
    status,
    line,
    chips: chips.length ? chips : [goal],
    hits: run,
    ready,
    stepBack,
    tip
  }
}

export type Tone = 'first' | 'good' | 'same' | 'ease' | 'top' | 'easy'

export interface Feedback {
  tone: Tone
  text: string
  /** "Next: 3×17" */
  next: string
  /** A form tip, only when it helps (level up, a struggle). */
  tip: string | null
}

/** One honest line right after you log. `input` already holds the sets just logged. */
export function feedbackFor(input: CoachInput): Feedback | null {
  const c = coachFor(input)
  if (!c || !c.today.length) return null
  const unit = u(c.unit)
  const sum = (r: number[]) => r.reduce((a, b) => a + b, 0)
  const nextTxt = `Next: ${c.next.label}`
  const mk = (tone: Tone, text: string, tip: string | null = null): Feedback => ({ tone, text, next: nextTxt, tip })
  if (!c.last) return mk('first', `First log saved: this sets your level. Next time aim for ${c.next.label}.`)
  // The same number of sets as today so far, so a half-done workout is not compared with a whole one.
  const t = sum(c.today)
  const l = sum(c.last.reps.slice(0, c.today.length))
  const diff = t - l
  const left = c.sets - c.today.length
  const more = left > 0 ? ` ${left} more ${left === 1 ? 'set' : 'sets'} to match the plan.` : ''
  const top = atTop({ day: input.today, reps: c.today, est: false }, c.topSets, c.hi)
  if (top && c.ready) return mk('top', `Hit the top of the range! ${c.ready.why}. Ready for ${c.ready.to.name}: try 1 set of ${c.ready.reps}${u(c.ready.to.unit)} next time.`, c.tip)
  if (top) return mk('top', `Hit the top of the range. Next time try ${c.sets}×${c.hi + (c.unit === 'sec' ? 5 : 1)}${unit}.`)
  if (c.status === 'stuck') return mk('ease', c.stepBack?.text ?? 'A tougher day. Rest well.', c.tip)
  if (c.today.length >= c.sets && l > 0 && t >= l * 1.25) return mk('easy', `Easier than usual (${diff} more than last time): add a set next time, ${c.sets + 1}×${Math.min(...c.today)}${unit}.`)
  if (diff > 0) return mk('good', `Good, ${diff} more than last time.${more}`)
  if (diff === 0) return mk('same', `Same as last time: steady wins. Try ${c.next.goal}${unit} on your last set.${more}`)
  return mk('ease', `${-diff} fewer than last time. That happens: rest 2 minutes between sets and sleep well.${more}`)
}

// ---------------------------------------------------------------- a missing muscle group

export interface MissingGroup {
  muscle: Muscle
  move: Move
  text: string
}

const STARTERS: Record<Muscle, string> = { legs: 'squat', pull: 'door_row', core: 'plank', push: 'pushup' }
const ORDER: Muscle[] = ['legs', 'pull', 'core', 'push']

/** A muscle group with no exercise in your routine and no logs for 14 days: "Your legs have no training: add Squats?" */
export function missingGroups(input: HistoryInput & { notYet?: Record<string, string> }): MissingGroup[] {
  const covered = new Set<Muscle>()
  for (const ex of input.exercises.filter((e) => e.active !== false)) {
    const mu = muscleOf(moveOf(ex)?.group)
    if (mu) covered.add(mu)
  }
  const from = new Date(Date.parse(input.today + 'T12:00:00Z') - 13 * 86400000).toISOString().slice(0, 10)
  const recent = new Set<Muscle>()
  for (const ex of input.exercises) {
    const mu = muscleOf(moveOf(ex)?.group)
    if (!mu) continue
    for (const d of Object.keys(input.days ?? {})) if (d >= from && d <= input.today && Number(input.days?.[d]?.[String(ex.id)]) > 0) recent.add(mu)
  }
  const names: Record<Muscle, string> = { legs: 'legs', pull: 'back and pulling muscles', core: 'core', push: 'chest and shoulders' }
  return ORDER.filter((m) => !covered.has(m) && !recent.has(m))
    .map((m) => {
      const mv = moveById(STARTERS[m])!
      return { muscle: m, move: mv, text: `Your ${names[m]} have no training: add ${mv.name}?` }
    })
    .filter((x) => !((input.notYet ?? {})['miss_' + x.muscle] > input.today))
}
