// Sport Track's Training home: today's real progressive workout, on the same
// engine as Body → Training (trainWeek, trainLadders, trainLog), so the two
// never disagree. Today's session comes from the weekly split (or rest +
// mobility); each move sits on your current ladder level and shows sets ×
// range at an effort target (stop 1–2 reps before failure). Every set is
// logged with its effort (and the optional form check) into Sport Track's set
// log and the training log. Double progression: the top of the range in every
// set, not Hard and form OK, 2 sessions in a row, unlocks the next variation;
// you choose Apply or Keep (applyOffer / keepOffer). Make easier / Make
// harder move one level at once and keep every log (shiftMove /
// shiftWorkout). Full / Lighter / Short are sets (doseSets). Pure and tested
// (sportTrain.test.ts). Nothing here pays points: Finish gives the page the
// usual workout to log, built only from the sets you logged.
import { MOVES, moveById } from './sportMoves'
import { setsOn, setsText, type SetEntry } from './sportSets'
import { laddersFor, moveInfo, rangeText, type LadderId } from './trainLadders'
import {
  LADDER_MUSCLE, declineLevel, doneSessions, effortOf, ensureExercise, exIdsFor, formOk, keepLevel, ladderSets, logSet, saveSession, sessionFromSets, sessionItems, sessionMinutes, setLevel, shiftLevel, trainOf, unlogSet, weeklySets, workoutOf,
  type Dose, type Feel, type Offer, type PlanItem, type TrainSession
} from './trainLog'
import { atTop } from './sportProgress'
import { daysBetween, dowOf, planned, todayPlan, TYPE_NAME, WARMUP, WEEKDAYS, SHORT_DAYS, type DayType, type SessionType, type TodayPlan } from './trainWeek'
import { shiftDay } from './sportSets'

export const DOSE_LABEL: Record<Dose, string> = { full: 'Full', light: 'Lighter', short: 'Short' }
/** The effort target every set aims for. */
export const EFFORT_LINE = 'stop 1–2 reps before failure'
export const holdLine = 'stop 1–2 s before your form breaks'

/** The Tracker's session id for a day and session type (one per day and type). */
export const trackerSessionId = (day: string, type: SessionType) => `trk-${day}-${type}`

/** Rest between sets: longer for heavy, low-rep levels. */
export const restSecFor = (lv: { hi: number; unit: 'reps' | 'sec' }) => (lv.unit === 'sec' ? 60 : lv.hi <= 8 ? 120 : lv.hi <= 12 ? 90 : 75)

export interface TrackerItem extends PlanItem {
  /** The Sport Track exercise this move is logged on (null: none yet, made on the first set). */
  exId: string | null
  /** Today's sets of this move (any device, any page), in order. */
  done: SetEntry[]
  /** What to aim for in each set: last time with one more rep on the lowest set, inside the range. */
  aim: number[]
  /** "4 × 6–12" */
  target: string
  /** "stop 1–2 reps before failure" */
  effort: string
  rest: number
  /** A library move has a demo. */
  demo: string | null
  /** "Level 3 of 8" */
  levelText: string
}

export interface TrackerView {
  day: string
  plan: TodayPlan
  /** What Today shows: a session, or rest. */
  type: DayType
  /** rest: a rest day · ready: not started · going: sets logged · done: finished. */
  stage: 'rest' | 'ready' | 'going' | 'done'
  /** You chose to train on a rest day. */
  byChoice: boolean
  /** You said "I can't train today". */
  skipped: boolean
  title: string
  line: string
  dose: Dose
  items: TrackerItem[]
  minutes: number
  setsPlanned: number
  setsDone: number
  warmup: string[]
  /** On a rest day: the session you could do instead (null: none keeps 48 hours). */
  anyway: SessionType | null
  /** A short mobility routine for a rest day (library moves with a demo). */
  mobility: { id: string; name: string; set: number; unit: string }[]
  /** Hard sets a week per muscle group from the split (10–20 each). */
  weekly: Record<'push' | 'pull' | 'legs' | 'core', number>
  sessionId: string | null
  /** "Level 3": the average level of today's moves (null on a rest day). */
  level: number | null
}

/** Aim for each set: last time's reps (the last one repeated), the lowest one +1 (+5 s for holds), inside the range. */
export function aimFor(it: Pick<PlanItem, 'last' | 'level' | 'sets'>): number[] {
  const { level, sets, last } = it
  if (!last || !last.reps.length) return Array.from({ length: sets }, () => level.lo)
  const aim = Array.from({ length: sets }, (_, i) => Math.max(level.lo, Math.min(level.hi, last.reps[Math.min(i, last.reps.length - 1)])))
  const low = aim.indexOf(Math.min(...aim))
  aim[low] = Math.min(level.hi, aim[low] + (level.unit === 'sec' ? 5 : 1))
  return aim
}

/** A short mobility routine for rest days, from the library (a different start each day). */
export function restMobility(day: string, n = 4): TrackerView['mobility'] {
  const mob = MOVES.filter((m) => m.group === 'mobility')
  if (!mob.length) return []
  const start = Number(day.slice(8, 10)) % mob.length
  return Array.from({ length: Math.min(n, mob.length) }, (_, i) => mob[(start + i) % mob.length]).map((m) => ({ id: m.id, name: m.name, set: m.set, unit: m.unit }))
}

/** Today's training sessions (with at least one set), newest first. */
const todaySessions = (st: any, day: string): TrainSession[] =>
  trainOf(st)
    .log.filter((s) => s.date === day && s.exercises.some((e) => e.sets.length))
    .sort((a, b) => b.startedAt - a.startedAt)

/** Today's sets of a move, oldest first. */
const setsToday = (st: any, day: string, move: string) =>
  exIdsFor(st?.exercises, move)
    .flatMap((id) => setsOn(st?.sets, day, id))
    .filter((s) => !s.test)
    .sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))

/**
 * Today's training. `anyway`: the session you picked on a rest day (Train anyway). `dose`: Full / Lighter /
 * Short from readiness or your pick. `skip`: you said "I can't train today" (rest or mobility; once you log a
 * set the session counts as usual).
 */
export function trackerToday(st: any, day: string, opts: { dose?: Dose; anyway?: SessionType | null; skip?: boolean } = {}): TrackerView {
  const data = trainOf(st)
  const dose = opts.dose ?? 'full'
  const plan = todayPlan(data.week, doneSessions(data.log), day)
  const mine = todaySessions(st, day)
  const started = mine[0] ?? null
  const finished = mine.some((s) => s.done)
  const skipped = !started && !!opts.skip
  const byChoice = !started && !skipped && plan.type === 'rest' && !!opts.anyway
  const type: DayType = started ? started.type : skipped ? 'rest' : byChoice ? (opts.anyway as SessionType) : plan.type
  const base = { day, plan, dose, byChoice, skipped, anyway: !skipped && plan.why === 'rest' ? plan.anyway : null, mobility: restMobility(day), weekly: weeklySets(data) }
  if (type === 'rest')
    return {
      ...base,
      type,
      stage: 'rest',
      title: skipped ? 'Rest today' : 'Rest day',
      line: skipped ? 'No training today, and that is fine. 8 minutes of mobility below keeps you loose; your plan picks up next session.' : plan.line,
      items: [],
      minutes: 0,
      setsPlanned: 0,
      setsDone: 0,
      warmup: [],
      sessionId: null,
      level: null
    }
  const items: TrackerItem[] = sessionItems(st, data, type, day, dose).map((it) => {
    const ids = exIdsFor(st?.exercises, it.level.move)
    return {
      ...it,
      exId: ids[0] ?? null,
      done: setsToday(st, day, it.level.move),
      aim: aimFor(it),
      target: `${it.sets} × ${rangeText(it.level)}`,
      effort: it.level.unit === 'sec' ? holdLine : EFFORT_LINE,
      rest: restSecFor(it.level),
      demo: moveById(it.level.move) ? it.level.move : null,
      levelText: `Level ${it.index + 1} of ${it.ladder.levels.length}`
    }
  })
  const setsPlanned = items.reduce((n, it) => n + it.sets, 0)
  const setsDone = items.reduce((n, it) => n + Math.min(it.sets, it.done.length), 0)
  const stage = finished ? 'done' : started || setsDone ? 'going' : 'ready'
  const name = TYPE_NAME[type]
  const line =
    stage === 'done'
      ? 'Done for today. Eat well and sleep: that is when muscle grows.'
      : byChoice
        ? `${name} today, by your choice. Every set: ${EFFORT_LINE}.`
        : plan.why === 'catch-up' || plan.why === 'moved'
          ? plan.line
          : `${WEEKDAYS[dowOf(day)]}: ${name}. Every set: ${EFFORT_LINE}.`
  const level = items.length ? Math.round(items.reduce((n, it) => n + it.index + 1, 0) / items.length) : null
  return { ...base, type, stage, title: stage === 'done' ? `Done: ${name}` : name, line, items, minutes: sessionMinutes(items), setsPlanned, setsDone, warmup: WARMUP[type], sessionId: started?.id ?? trackerSessionId(day, type), level }
}

/** The session record for the Tracker's session today, read back from the set log. */
function recordFor(st: any, day: string, type: SessionType, now: number, done = false): TrainSession {
  const id = trackerSessionId(day, type)
  const data = trainOf(st)
  const old = data.log.find((s) => s.id === id)
  const items = new Map<string, { ladder: LadderId; move: string; exId: string }>()
  // The moves of today's session, plus any move this session already logged (a level you changed mid-way).
  for (const e of old?.exercises ?? []) items.set(e.exId, { ladder: e.ladder, move: e.move, exId: e.exId })
  for (const it of sessionItems(st, data, type, day)) {
    const exId = exIdsFor(st?.exercises, it.level.move)[0] ?? `ex_t_${it.level.move}`
    if (!items.has(exId)) items.set(exId, { ladder: it.ladder.id, move: it.level.move, exId })
  }
  return sessionFromSets(st, { id, date: day, type, items: [...items.values()], startedAt: old?.startedAt ?? now, now, done: done || !!old?.done })
}

/**
 * Logs one set of a move in today's session (changes Sport Track's state in place): the exercise is made
 * when needed, placement becomes your saved level, the set goes into the set log with its effort and form,
 * the day total and today's count, and the session record is updated.
 */
export function trackerLog(st: any, input: { day: string; type: SessionType; ladder: LadderId; reps: number; feel?: Feel | null; formOff?: boolean; kg?: number; now: number; dose?: Dose; salt?: string }): { set: SetEntry; item: PlanItem } | null {
  const data = trainOf(st)
  const item = sessionItems(st, data, input.type, input.day, input.dose).find((x) => x.ladder.id === input.ladder)
  if (!item || !(input.reps > 0)) return null
  const exId = ensureExercise(st, item.level.move, item.level, item.sets)
  keepLevel(st, item.ladder.id, item.index, input.now, input.day)
  const set = logSet(st, {
    day: input.day,
    exId,
    set: { reps: input.reps, ...(input.kg ? { kg: input.kg } : {}), ...(input.feel ? { feel: input.feel } : {}), ...(input.formOff ? { form: 'off' as const } : {}) },
    session: trackerSessionId(input.day, input.type),
    now: input.now,
    salt: input.salt
  })
  saveSession(st, recordFor(st, input.day, input.type, input.now))
  return { set, item }
}

/** Takes a set back out (by its id) and updates the session record. */
export function trackerUndo(st: any, input: { day: string; type: SessionType; setId: string; now: number }): boolean {
  for (const [exId, list] of Object.entries<any>(st?.sets?.[input.day] ?? {}))
    if (Array.isArray(list) && list.some((s: SetEntry) => s.id === input.setId)) {
      unlogSet(st, input.day, exId, input.setId)
      saveSession(st, recordFor(st, input.day, input.type, input.now))
      return true
    }
  return false
}

/** Finishes today's session: the record is marked done; the workout to log comes only from logged sets (null: none). */
export function trackerFinish(st: any, input: { day: string; type: SessionType; now: number }): ReturnType<typeof workoutOf> {
  const rec = recordFor(st, input.day, input.type, input.now, true)
  if (!rec.exercises.some((e) => e.sets.length)) return null
  saveSession(st, rec)
  return workoutOf(rec)
}

// ---------- choices: Apply / Keep, Make easier / Make harder ----------

/** Apply: move up to the unlocked level (its sessions start counting from today). Null: nothing unlocked. */
export function applyOffer(st: any, input: { day: string; type: SessionType; ladder: LadderId; now: number }): Offer | null {
  const it = sessionItems(st, trainOf(st), input.type, input.day).find((x) => x.ladder.id === input.ladder)
  if (!it?.offer) return null
  keepLevel(st, input.ladder, it.index, input.now)
  setLevel(st, input.ladder, it.offer.to, input.day, input.now)
  return it.offer
}

/** Keep: stay on this level; the offer comes back after a newer session at the top. */
export function keepOffer(st: any, input: { day: string; type: SessionType; ladder: LadderId; now: number }): boolean {
  const it = sessionItems(st, trainOf(st), input.type, input.day).find((x) => x.ladder.id === input.ladder)
  if (!it?.offer) return false
  keepLevel(st, input.ladder, it.index, input.now)
  declineLevel(st, input.ladder, it.index, input.day, input.now)
  return true
}

export interface Shift {
  ladder: LadderId
  from: string
  to: string
}

/** Make easier / Make harder on one move: one level, at once; every log stays. Null: the end of the ladder. */
export function shiftMove(st: any, input: { day: string; ladder: LadderId; delta: -1 | 1; now: number }): Shift | null {
  const data = trainOf(st)
  const ladder = data.ladders.find((l) => l.id === input.ladder)
  if (!ladder) return null
  const before = sessionItems(st, data, ladder.type, input.day).find((x) => x.ladder.id === input.ladder)
  const to = shiftLevel(st, data, ladder, input.delta, input.day, input.now)
  if (to == null || !before) return null
  return { ladder: input.ladder, from: before.name, to: moveInfo(ladder.levels[to].move)?.name ?? ladder.levels[to].move }
}

/** Make the whole workout easier or harder: every move of the session one level, at once (moves at the end stay). */
export function shiftWorkout(st: any, input: { day: string; type: SessionType; delta: -1 | 1; now: number }): Shift[] {
  const out: Shift[] = []
  for (const l of laddersFor(trainOf(st).ladders, input.type)) {
    const s = shiftMove(st, { day: input.day, ladder: l.id, delta: input.delta, now: input.now })
    if (s) out.push(s)
  }
  return out
}

// ---------- what the next level needs ----------

export interface Requirement {
  id: 'sessions' | 'reps' | 'effort' | 'form'
  label: string
  done: boolean
  /** "1 of 2", "10 · 11 · 12" */
  detail: string
}

/** What unlocks the next level of a move, as ticks (from your sessions on this level). */
export function requirementsOf(it: Pick<PlanItem, 'status' | 'latest' | 'level' | 'fullSets' | 'since'>): Requirement[] {
  const { level, fullSets: sets, status } = it
  const u = level.unit === 'sec' ? ' s' : ''
  const latest = it.latest && (!it.since || it.latest.day >= it.since) ? it.latest : null
  const r = { lo: level.lo, hi: level.hi, sets, unit: level.unit }
  const effort = latest ? effortOf(latest, sets) : null
  return [
    { id: 'sessions', label: `${status.need} sessions in a row at the top`, done: status.hits >= status.need, detail: `${status.hits} of ${status.need}` },
    { id: 'reps', label: `Every set at ${level.hi}${u} (${sets} sets)`, done: !!latest && atTop(latest, r), detail: latest ? setsText(latest.reps.slice(0, Math.max(sets, 1)), level.unit) : 'no session yet' },
    { id: 'effort', label: 'Effort OK or Easy (1–2 reps left)', done: !!latest && effort !== 'hard', detail: latest ? (effort ?? 'not tapped') : '—' },
    { id: 'form', label: 'Form OK on every set', done: !!latest && formOk(latest, sets), detail: latest ? (formOk(latest, sets) ? 'OK' : 'form broke') : '—' }
  ]
}

// ---------- the coach line ----------

/** One honest line from the engine (no made-up numbers): what matters most today. */
export function coachLine(v: TrackerView, readiness: number | null = null): string {
  if (v.skipped) return 'Resting today is fine. Do the 8-minute mobility if you can; nothing is lost.'
  const offer = v.items.find((it) => it.offer)
  if (offer?.offer) return `${offer.offer.name} is unlocked: ${offer.offer.reason}. Apply it, or keep ${offer.name} a bit longer.`
  if (v.stage === 'done') return 'Done for today. Eat your protein and sleep: that is when muscle grows.'
  if (v.stage === 'rest') return v.plan.why === 'rest' ? 'Rest day: muscles grow while you rest. A walk and full meals help.' : v.line
  if (readiness != null && readiness < 50) return `Readiness ${readiness}: rest, or go Short today (2 sets a move).`
  if (readiness != null && readiness < 80 && v.dose === 'full') return `Readiness ${readiness}: Lighter today (one set less a move), same effort.`
  const close = v.items.find((it) => it.status.hits === 1 && it.next)
  if (close?.next) return `One more session at the top of ${close.name} (${close.fullSets}×${close.level.hi}${close.level.unit === 'sec' ? ' s' : ''}, not hard) unlocks ${moveInfo(close.next.move)?.name ?? close.next.move}.`
  const low = v.items.find((it) => it.status.state === 'struggling')
  if (low) return `${low.name} stayed under ${low.level.lo} twice. Make it easier for a while: your history stays.`
  if (v.items.every((it) => !it.last)) return 'First session on these moves: start at the bottom of each range and tap how hard every set felt.'
  return `${TYPE_NAME[v.type]}: beat last time by one rep on your lowest set, and ${EFFORT_LINE}.`
}

// ---------- the week ----------

export interface WeekDay {
  day: string
  short: string
  type: DayType
  /** Working sets logged in training sessions that day. */
  done: number
  /** Sets the split plans for that day at the full dose (0 on a rest day). */
  planned: number
  /** 0–1 */
  pct: number
  today: boolean
}

/** Monday–Sunday of this week: planned sets from the split against the sets you logged in sessions. */
export function weekBars(st: any, today: string): { days: WeekDay[]; done: number; planned: number; pct: number | null; hard: Record<'push' | 'pull' | 'legs' | 'core', number> } {
  const data = trainOf(st)
  const monday = shiftDay(today, -dowOf(today))
  const hard = { push: 0, pull: 0, legs: 0, core: 0 }
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const day = shiftDay(monday, i)
    const type = planned(data.week, day)
    const plannedSets = type === 'rest' ? 0 : laddersFor(data.ladders, type).reduce((n, l) => n + ladderSets(data.week, data.ladders, l), 0)
    let done = 0
    for (const s of data.log)
      if (s.date === day)
        for (const e of s.exercises) {
          done += e.sets.length
          // A hard set: the effort target (not tapped Easy).
          if (LADDER_MUSCLE[e.ladder]) hard[LADDER_MUSCLE[e.ladder]] += e.sets.filter((x) => x.feel !== 'easy').length
        }
    return { day, short: SHORT_DAYS[i], type, done, planned: plannedSets, pct: plannedSets ? Math.min(1, done / plannedSets) : done ? 1 : 0, today: day === today }
  })
  const plannedAll = days.reduce((n, d) => n + d.planned, 0)
  const doneAll = days.reduce((n, d) => n + Math.min(d.done, d.planned || d.done), 0)
  return { days, done: doneAll, planned: plannedAll, pct: plannedAll ? Math.min(1, doneAll / plannedAll) : null, hard }
}

// ---------- the 12-week home program ----------

export interface Phase {
  id: string
  name: string
  weeks: [number, number]
  what: string
  state: 'done' | 'current' | 'next'
}
export const PHASES: Omit<Phase, 'state'>[] = [
  { id: 'foundation', name: 'Foundation', weeks: [1, 2], what: 'Learn every move; sets inside the range; honest effort taps.' },
  { id: 'build', name: 'Build', weeks: [3, 4], what: 'One more rep on your lowest set each session.' },
  { id: 'strength', name: 'Strength', weeks: [5, 6], what: 'Your first harder variations unlock: apply them.' },
  { id: 'advanced', name: 'Advanced', weeks: [7, 8], what: 'Harder moves on every ladder; full food and sleep.' },
  { id: 'athlete', name: 'Athlete', weeks: [9, 12], what: 'Skill moves (archer, pistol, handstand work).' }
]

/** Where you are in the 12-week program: from your first training session (null: not started yet). */
export function programPhases(st: any, today: string): { week: number | null; start: string | null; phases: Phase[]; levelsUp: number } {
  const data = trainOf(st)
  const first = data.log.filter((s) => s.exercises.some((e) => e.sets.length)).map((s) => s.date).sort()[0] ?? null
  const week = first ? Math.floor(Math.max(0, daysBetween(first, today)) / 7) + 1 : null
  let levelsUp = 0
  // Levels reached since you started (the first entry of a ladder is where you were placed, not a step up).
  if (first)
    for (const lv of Object.values(data.levels)) {
      const steps = Object.entries(lv?.reached ?? {}).sort((a, b) => a[1].localeCompare(b[1]) || Number(a[0]) - Number(b[0]))
      levelsUp += steps.slice(1).filter(([, d]) => d >= first).length
    }
  const phases = PHASES.map((p) => ({ ...p, state: (week == null ? 'next' : week > p.weeks[1] ? 'done' : week >= p.weeks[0] ? 'current' : 'next') as Phase['state'] }))
  // After week 12 the last phase stays current (a new round of the same rules).
  if (week != null && week > 12) phases[phases.length - 1].state = 'current'
  return { week, start: first, phases, levelsUp }
}

// ---------- after Finish ----------

export interface FinishRow {
  ladder: LadderId
  name: string
  /** "12 · 12 · 12" */
  sets: string
  /** The unlocked level (Apply / Keep), if any. */
  offer: Offer | null
  /** What next time looks like. */
  line: string
}

/** What changed after today's session: per move today's sets and the next step (offers first). */
export function finishReport(v: TrackerView): FinishRow[] {
  const rows = v.items
    .filter((it) => it.done.length)
    .map((it) => ({ ladder: it.ladder.id, name: it.name, sets: setsText(it.done.map((s) => s.reps), it.level.unit), offer: it.offer, line: it.offer ? it.offer.line : it.nextTime?.line ?? '' }))
  return rows.sort((a, b) => Number(!!b.offer) - Number(!!a.offer))
}

/** "4×12 easy", for a set chip: the reps (or seconds) and the effort tap. */
export const setChip = (s: SetEntry, unit: 'reps' | 'sec') => `${s.reps}${unit === 'sec' ? ' s' : ''}${s.feel ? ` ${s.feel}` : ''}`

/** The unit of a move, for the page. */
export const unitOfMove = (move: string): 'reps' | 'sec' => moveInfo(move)?.unit ?? 'reps'
