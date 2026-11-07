// The coach in Sport Track: what to aim for today, what to do next time, and a
// line after every log. Double progression: do more reps in each set until every
// set reaches the top of the move's range, then try the harder move. After two
// tough sessions in a row it suggests an easier version, framed as smart
// training. Also: a missing muscle group, and a form tip at the right time.
// Pure and tested; nothing here pays points.
import { moveById, type Move } from './sportMoves'
import { moveOf, nextStep, prevStep, type SportEx } from './sportLadders'
import { muscleOf, setsOn, type Muscle } from './sportSets'
import { placeFamily, trackOf, estimateSets, type HistoryInput, type Placement } from './sportLevels'
import { rangeFor } from './sportProgress'

export interface CoachInput extends HistoryInput {
  exId: string
  /** move id → the day it may come back ("Not yet"). */
  notYet?: Record<string, string>
  /** An easy week: fewer sets, no new reps. */
  deload?: boolean
  /** Strength mode: 5–8 reps on the hardest move you can do, 4 sets, harder move once you hit 3×8. */
  strength?: boolean
  /** How the sessions of this exercise felt, by day (easy speeds progress up, hard holds it). */
  efforts?: Record<string, 'easy' | 'good' | 'hard'>
  /** "Too easy" / "Too hard" today: the goal (and sets) you picked, valid on `day` only. */
  override?: { goal: number; sets?: number; day: string } | null
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

export type CoachStatus = 'new' | 'building' | 'top' | 'ready' | 'stuck' | 'comeback' | 'deload'

export interface Coach {
  exId: string
  move: Move
  place: Placement | null
  sets: number
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

function aimAfter(list: Session[], o: { lo: number; hi: number; sets: number; unit: 'reps' | 'sec'; start: number; deload: boolean; efforts?: Record<string, 'easy' | 'good' | 'hard'> }): number {
  const last = list[list.length - 1]
  if (!last) return o.start
  const min = Math.min(...workingSets(last, o.sets))
  const eff = o.efforts?.[last.day]
  const base = o.unit === 'sec' ? 5 : 1
  const step = eff === 'hard' ? 0 : eff === 'easy' ? base * 2 : base
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
  const fallback = rangeFor(move)
  const strong = !!input.strength && move.unit === 'reps'
  const lo = strong ? 5 : onMove[0]?.reps ?? fallback.lo
  const hi = strong ? 8 : onMove.length ? onMove[onMove.length - 1].reps : fallback.hi
  const mine = onMove.filter((l) => place && l.n <= place.level).pop() ?? onMove[0]
  const ov = input.override && input.override.day === input.today ? input.override : null
  const sets = ov?.sets ? clamp(ov.sets, 1, 6) : clamp((strong ? (input.deload ? 3 : 4) : input.deload ? (mine?.sets ?? 3) - 1 : mine?.sets ?? 3) || 3, 1, 5)
  const all = sessionsFor(input, ex, input.today)
  const past = all.filter((s) => s.day < input.today)
  const todays = all.find((s) => s.day === input.today) ?? null
  const last = past[past.length - 1] ?? null
  const startGoal = place && place.lv && place.lv.move === move.id ? place.lv.reps : clamp(Math.round((Number(ex.target) || lo * 3) / 3), lo, hi)
  const o = { lo, hi, sets, unit, start: startGoal, deload: !!input.deload, efforts: input.efforts }
  let goal = ov ? Math.max(1, ov.goal) : aimAfter(past, o)
  const nextGoal = aimAfter(todays ? [...past, todays] : past, o)
  const recent = todays && todays.reps.length >= sets ? [...past, todays] : past

  let status: CoachStatus = last ? 'building' : 'new'
  let line = ''
  let ready: Coach['ready'] = null
  let stepBack: Coach['stepBack'] = null
  let tip: string | null = null

  // Ready for a harder move: the top of every set, two sessions in a row.
  // Strength: 3×8 is enough. An easy-rated session at the top counts for both of the 2 sessions.
  const topSets = strong ? 3 : sets
  const needTop = strong ? 1 : NEED_TOP
  let run = 0
  for (let i = recent.length - 1; i >= 0 && atTop(recent[i], topSets, hi); i--) run++
  const lastTop = recent[recent.length - 1]
  if (!strong && run === 1 && lastTop && atTop(lastTop, topSets, hi) && input.efforts?.[lastTop.day] === 'easy') run = NEED_TOP
  const harder = nextStep(move)
  const back = harder && input.notYet?.[harder.id]
  if (run >= needTop) {
    if (harder && !(back && back > input.today)) {
      const firstOn = track?.levels.find((l) => l.move === harder.id)
      ready = { to: harder, sets: 1, reps: firstOn?.reps ?? harder.set, why: strong ? `${topSets}×${hi} reached` : run === 1 ? `${sets}×${hi}${u(unit)} and it felt easy` : `${sets}×${hi}${u(unit)} ${NEED_TOP} sessions in a row` }
      status = 'ready'
      tip = formTip(harder)
      line = `Ready for ${harder.name}? Try 1 set of ${ready.reps}${u(harder.unit)}. You did ${ready.why}.`
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
  if (input.deload && status !== 'ready' && status !== 'stuck') {
    status = 'deload'
    line = `Easy week: ${sets}×${goal}${u(unit)}, stop 3 reps before it gets hard. You grow while you recover.`
  }
  if (status === 'new') line = `First time: aim for ${sets}×${goal}${u(unit)} and stop 1–2 reps before you can't do another.`
  if (status === 'building') line = `Beat last time: ${sets}×${goal}${u(unit)}${last!.est ? '' : ` (last: ${last!.reps.join(' · ')})`}.`
  const chips = (last ? last.reps.slice(0, Math.max(sets, 1)) : Array.from({ length: sets }, () => goal)).slice(0, 6)
  return {
    exId: String(ex.id),
    move,
    place,
    sets,
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
  const top = atTop({ day: input.today, reps: c.today, est: false }, c.sets, c.hi)
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
