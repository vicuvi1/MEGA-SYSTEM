// The goal ladder: a 12-week quarter (the Season) with up to 3 critical goals
// → monthly milestones → this week's steps (the weekly top 3) → today.
//
// It connects what is already there instead of adding a fourth system:
// - the quarter IS the current Season (core/season.ts; 12 weeks, an old one 8);
// - each critical goal is scored on ACTIONS (workouts, protein days, focus
//   hours…) counted from the app's own data, never typed in; results (weight,
//   levels, hours in total) are shown but do not set the traffic light;
// - this week's steps pre-fill the Sunday "top 3" (core/weekPlan.ts);
// - study steps go to the planner as deadline sessions (core/ladderPlan.ts).
// Pure: no DOM, no database. Saved in the synced setting `goal_ladder`.
// Nothing here pays points: setting goals and doing reviews pay nothing.
import { addDays, daysBetween } from './dates'

export const LADDER_KEY = 'goal_ladder'
export const MAX_ACTIVE = 3
export const QUARTER_WEEKS = 12
/** Traffic light: share of this week's actions done (on pace). */
export const GREEN_AT = 0.8
export const YELLOW_AT = 0.5

// ---------------------------------------------------------------- actions

export type Metric = 'workouts' | 'proteinDays' | 'weighIns' | 'sessions' | 'hardSets' | 'focusHours' | 'deadlineSessions' | 'moneySaved' | 'applications' | 'portfolio' | 'flashcardDays' | 'sleepNights'

interface MetricDef {
  /** "3/5 workouts": the words after the numbers. */
  short: string
  /** The week's step for the top 3 ("5 workouts"). */
  step: (target: number) => string
  /** One plain fix when behind (left = still to do, days = days left this week, today included). */
  fix: (left: number, days: number) => string
  /** Hours and money show one decimal / whole numbers; counts are whole. */
  hours?: boolean
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const fmtH = (h: number) => `${Math.round(h * 10) / 10} h`

export const METRICS: Record<Metric, MetricDef> = {
  workouts: { short: 'workouts', step: (t) => plural(t, 'workout'), fix: (l, d) => (l <= d ? `${plural(l, 'workout')} to go in ${plural(d, 'day')}: put the next one on tomorrow's plan.` : `${d} days left: every workout you fit in still counts.`) },
  proteinDays: { short: 'protein days', step: (t) => `Protein goal on ${t} of 7 days`, fix: () => 'Reach the protein goal today: one extra portion or a shake does it.' },
  weighIns: { short: 'weigh-ins', step: (t) => plural(t, 'weigh-in'), fix: () => 'Weigh in tomorrow morning, before breakfast.' },
  sessions: { short: 'planned sessions', step: (t) => `${plural(t, 'training session')} from your split`, fix: () => 'Do the next session from your split: it is on Body → Training.' },
  hardSets: { short: 'hard sets', step: (t) => `${t} hard sets (about ${Math.round(t / 4)} per muscle group)`, fix: () => 'Add 2–3 hard sets to your next session.' },
  focusHours: { short: 'h focus', hours: true, step: (t) => `${fmtH(t)} of focus`, fix: (l, d) => `${fmtH(l)} of focus left: about ${Math.max(25, Math.round(((l * 60) / Math.max(1, d)) / 5) * 5)} min a day covers it.` },
  deadlineSessions: { short: 'study sessions', step: (t) => plural(t, 'planned study session'), fix: () => 'Do one planned study session today.' },
  moneySaved: { short: 'saved', step: (t) => `Save ${Math.round(t)} this week`, fix: () => 'Skip one spend you do not need this week.' },
  applications: { short: 'applications', step: (t) => plural(t, 'job application'), fix: () => 'Send one application today: 20 minutes is enough.' },
  portfolio: { short: 'portfolio pieces', step: (t) => plural(t, 'portfolio piece'), fix: () => 'Write up one thing you built or solved for the portfolio.' },
  flashcardDays: { short: 'flashcard days', step: (t) => `Flashcards on ${t} days`, fix: () => 'A 5-minute flashcard review today.' },
  sleepNights: { short: 'good nights', step: (t) => `${plural(t, 'good night')} (in bed on time, 7.5 h)`, fix: () => 'In bed on time tonight, for 7.5 hours.' }
}

// ---------------------------------------------------------------- templates

export type TemplateId = 'gain' | 'strong' | 'study' | 'money' | 'career' | 'sleep'
/** What the result line shows (results are shown, never scored). */
export type ResultKind = 'weight' | 'levels' | 'focusTotal' | 'moneyMonth' | 'applicationsTotal' | 'sleepAvg'

export interface Template {
  id: TemplateId
  title: string
  emoji: string
  result: ResultKind
  /** The result target: kg to gain, money a month… (null: you set it). */
  resultTarget: number | null
  /** Weekly action targets (null: comes from your data, e.g. the split's sessions). */
  actions: { metric: Metric; target: number | null }[]
  /** The quarter's final result in words (milestones end here). */
  finalText: string
}

/** Generic starting templates: no personal numbers (those come from your data at runtime). */
export const TEMPLATES: Template[] = [
  { id: 'gain', title: 'Gain about 4 kg lean', emoji: '⚖️', result: 'weight', resultTarget: 4, actions: [{ metric: 'workouts', target: 5 }, { metric: 'proteinDays', target: 6 }, { metric: 'weighIns', target: 3 }], finalText: '+4 kg on the weekly average' },
  { id: 'strong', title: 'Get much stronger', emoji: '💪', result: 'levels', resultTarget: null, actions: [{ metric: 'sessions', target: null }, { metric: 'hardSets', target: 40 }], finalText: 'Archer push-ups 3×8 and a first full pull-up' },
  { id: 'study', title: 'Study and pass the exams', emoji: '📚', result: 'focusTotal', resultTarget: null, actions: [{ metric: 'focusHours', target: 10 }, { metric: 'deadlineSessions', target: 4 }], finalText: 'Every exam prepared on time' },
  { id: 'money', title: 'Earn or save money', emoji: '💰', result: 'moneyMonth', resultTarget: null, actions: [{ metric: 'moneySaved', target: null }], finalText: 'The monthly savings target, three months in a row' },
  { id: 'career', title: 'Career: get the job', emoji: '🧭', result: 'applicationsTotal', resultTarget: null, actions: [{ metric: 'applications', target: 3 }, { metric: 'portfolio', target: 1 }, { metric: 'flashcardDays', target: 5 }], finalText: 'Applications out every week and a portfolio to show' },
  { id: 'sleep', title: 'Sleep better', emoji: '🌙', result: 'sleepAvg', resultTarget: null, actions: [{ metric: 'sleepNights', target: 5 }], finalText: '7.5 hours, in bed on time, most nights' }
]
export const templateOf = (id: TemplateId): Template => TEMPLATES.find((t) => t.id === id)!
const DEFAULT_ACTIVE: TemplateId[] = ['gain', 'strong', 'study']

// ---------------------------------------------------------------- the saved ladder

export interface LadderMilestone {
  /** 1-based month of the quarter (4 weeks each). */
  month: number
  text: string
  /** The number to reach by the month's end (null: judged by the month's weeks). */
  value: number | null
}

export interface LadderGoal {
  id: TemplateId
  title: string
  /** One of the up to 3 critical goals (false: on "Not now"). */
  on: boolean
  /** Your weekly targets where you changed them. */
  targets: Partial<Record<Metric, number>>
  /** Your result target where you changed it (kg to gain, money a month). */
  resultTarget: number | null
  /** Confirmed monthly milestones (null: only the suggestion so far). */
  milestones: LadderMilestone[] | null
}

export interface Ladder {
  v: 1
  goals: LadderGoal[]
  /** The quarter's first Monday when there is no Season (null: this week's Monday). */
  start: string | null
  /** Weeks (their Monday) whose Sunday review you did. */
  reviews: string[]
  /** Months reviewed, as "<quarter start>:<month>". */
  monthReviews: string[]
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const str = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const isMetric = (m: string): m is Metric => Object.prototype.hasOwnProperty.call(METRICS, m)

const freshGoal = (t: Template, on: boolean): LadderGoal => ({ id: t.id, title: t.title, on, targets: {}, resultTarget: null, milestones: null })

export const defaultLadder = (): Ladder => ({ v: 1, goals: TEMPLATES.map((t) => freshGoal(t, DEFAULT_ACTIVE.includes(t.id))), start: null, reviews: [], monthReviews: [] })

function cleanMilestones(raw: unknown): LadderMilestone[] | null {
  if (!Array.isArray(raw)) return null
  const out = raw
    .map((m: any) => ({ month: Math.round(Number(m?.month)), text: str(m?.text, 120), value: num(m?.value) }))
    .filter((m) => m.month >= 1 && m.month <= 3 && m.text)
    .slice(0, 3)
  return out.length ? out : null
}

/** Cleans a saved ladder; every template is always there (the missing ones on "Not now"), at most 3 on. */
export function cleanLadder(raw: unknown): Ladder {
  const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, any> | null
  if (!r || !Array.isArray(r.goals)) return defaultLadder()
  const seen = new Set<string>()
  const goals: LadderGoal[] = []
  for (const g of r.goals) {
    const id = String(g?.id ?? '') as TemplateId
    if (!TEMPLATES.some((t) => t.id === id) || seen.has(id)) continue
    seen.add(id)
    const targets: Partial<Record<Metric, number>> = {}
    for (const [k, v] of Object.entries(g?.targets ?? {})) {
      const n = num(v)
      if (isMetric(k) && n != null && n >= 0 && n <= 10000) targets[k] = Math.round(n * 10) / 10
    }
    const rt = num(g?.resultTarget)
    goals.push({ id, title: str(g?.title, 60) || templateOf(id).title, on: !!g?.on, targets, resultTarget: rt != null && Math.abs(rt) <= 1e7 ? rt : null, milestones: cleanMilestones(g?.milestones) })
  }
  for (const t of TEMPLATES) if (!seen.has(t.id)) goals.push(freshGoal(t, false))
  let on = 0
  for (const g of goals) if (g.on && ++on > MAX_ACTIVE) g.on = false
  const days = (v: unknown, n: number) => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x)).filter((x) => DAY.test(x.slice(0, 10))))].sort().slice(-n)
  return { v: 1, goals, start: typeof r.start === 'string' && DAY.test(r.start) ? r.start : null, reviews: days(r.reviews, 30), monthReviews: days(r.monthReviews, 12) }
}

export const activeGoals = (l: Ladder) => l.goals.filter((g) => g.on)
export const notNowGoals = (l: Ladder) => l.goals.filter((g) => !g.on)

/** Make a goal critical. Up to 3: a 4th needs a swap. */
export function activate(l: Ladder, id: TemplateId): Ladder {
  const g = l.goals.find((x) => x.id === id)
  if (!g) throw new Error('No such goal')
  if (g.on) return l
  if (activeGoals(l).length >= MAX_ACTIVE) throw new Error(`Up to ${MAX_ACTIVE} critical goals at once: swap one to "Not now" first`)
  return { ...l, goals: l.goals.map((x) => (x.id === id ? { ...x, on: true } : x)) }
}

/** Put a goal on "Not now" (its targets and milestones are kept for later). */
export function park(l: Ladder, id: TemplateId): Ladder {
  return { ...l, goals: l.goals.map((x) => (x.id === id ? { ...x, on: false } : x)) }
}

/** One tap: a critical goal goes to "Not now" and a "Not now" one takes its place (and its spot in the order). */
export function swap(l: Ladder, outId: TemplateId, inId: TemplateId): Ladder {
  const a = l.goals.find((x) => x.id === outId)
  const b = l.goals.find((x) => x.id === inId)
  if (!a || !b || !a.on || b.on) throw new Error('Pick one critical goal and one from "Not now"')
  const goals = l.goals.map((x) => (x.id === outId ? { ...b, on: true } : x.id === inId ? { ...a, on: false } : x))
  return { ...l, goals }
}

export function setTarget(l: Ladder, id: TemplateId, metric: Metric, target: number): Ladder {
  if (!Number.isFinite(target) || target < 0 || target > 10000) throw new Error('That target is not a number we can use')
  return { ...l, goals: l.goals.map((x) => (x.id === id ? { ...x, targets: { ...x.targets, [metric]: Math.round(target * 10) / 10 } } : x)) }
}

export function setResultTarget(l: Ladder, id: TemplateId, value: number | null): Ladder {
  if (value != null && (!Number.isFinite(value) || Math.abs(value) > 1e7)) throw new Error('That target is not a number we can use')
  return { ...l, goals: l.goals.map((x) => (x.id === id ? { ...x, resultTarget: value } : x)) }
}

export function confirmMilestones(l: Ladder, id: TemplateId, ms: LadderMilestone[]): Ladder {
  const clean = cleanMilestones(ms)
  if (!clean) throw new Error('Add at least one milestone')
  return { ...l, goals: l.goals.map((x) => (x.id === id ? { ...x, milestones: clean } : x)) }
}

// ---------------------------------------------------------------- facts (from the app's data)

/** Everything the ladder reads, counted by the data layer from existing logs. */
export interface LadderFacts {
  /** metric → day → amount (hours for focusHours, net money for moneySaved, else counts). */
  daily: Partial<Record<Metric, Record<string, number>>>
  /** Weekly average weight by Monday (oldest first). */
  weights: { week: string; avg: number }[]
  /** Training days in your split (the weekly target for planned sessions). */
  splitDays: number
  /** Open deadline goals exist (else study sessions are not scored). */
  hasDeadlines: boolean
  /** Current level names, e.g. "Push: archer push-up". */
  levels: string[]
  /** Level-ups since the quarter started. */
  levelUps: number
  /** Average sleep hours of the last 14 logged nights (null: none). */
  sleepAvg: number | null
}

export const EMPTY_FACTS: LadderFacts = { daily: {}, weights: [], splitDays: 4, hasDeadlines: false, levels: [], levelUps: 0, sleepAvg: null }

// ---------------------------------------------------------------- the quarter

export interface Quarter {
  start: string
  weeks: number
  end: string
  /** 1-based week of today (0 before the start, weeks after the end). */
  week: number
  /** 1-based month (4 weeks each). */
  month: number
  months: number
  /** The Season it is, when there is one. */
  season: string | null
}

export const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7))

/** The quarter is the current Season; without one, 12 weeks from the ladder's own start (rolling on). */
export function quarterOf(season: { start: string; weeks: number; name: string } | null, ladderStart: string | null, today: string): Quarter {
  let start: string
  let weeks: number
  if (season) {
    start = season.start
    weeks = season.weeks
  } else {
    start = mondayOf(ladderStart ?? today)
    weeks = QUARTER_WEEKS
    while (daysBetween(start, today) >= weeks * 7) start = addDays(start, weeks * 7)
  }
  const idx = daysBetween(start, today)
  const week = idx < 0 ? 0 : Math.min(weeks, Math.floor(idx / 7) + 1)
  return { start, weeks, end: addDays(start, weeks * 7 - 1), week, month: week ? Math.ceil(week / 4) : 0, months: Math.ceil(weeks / 4), season: season?.name ?? null }
}

/** First and last week (1-based) of a month of the quarter. */
export const monthWeeks = (q: Pick<Quarter, 'weeks'>, month: number) => ({ from: (month - 1) * 4 + 1, to: Math.min(q.weeks, month * 4) })
export const weekStart = (q: Pick<Quarter, 'start'>, week: number) => addDays(q.start, (week - 1) * 7)

// ---------------------------------------------------------------- scoring (actions, never results)

export type Light = 'green' | 'yellow' | 'red' | 'none'

export interface ActionWeek {
  metric: Metric
  done: number
  /** The week's target (null: not set yet or nothing to plan, so not scored). */
  target: number | null
  /** On-pace share 0..1 (null: not scored). */
  ratio: number | null
  /** "3/5 workouts". */
  text: string
}

export interface GoalWeek {
  week: string
  actions: ActionWeek[]
  /** 0..100, from the actions (null: nothing to score yet). */
  score: number | null
  light: Light
}

/** The weekly target of an action: yours, else the template's, else from your data. */
export function targetOf(g: LadderGoal, metric: Metric, facts: LadderFacts): number | null {
  if (g.targets[metric] != null) return g.targets[metric]!
  if (metric === 'sessions') return facts.splitDays || null
  if (metric === 'deadlineSessions' && !facts.hasDeadlines) return null
  if (metric === 'moneySaved') return g.resultTarget != null && g.resultTarget > 0 ? Math.round((g.resultTarget * 12) / 52) : null
  return templateOf(g.id).actions.find((a) => a.metric === metric)?.target ?? null
}

export const lightOf = (score: number | null): Light => (score == null ? 'none' : score >= GREEN_AT * 100 ? 'green' : score >= YELLOW_AT * 100 ? 'yellow' : 'red')

const fmtNum = (m: Metric, n: number) => (METRICS[m].hours ? String(Math.round(n * 10) / 10) : String(Math.round(n)))

/**
 * One goal's week. The current week is judged only on its finished days
 * (Monday counts as on pace until it is over), so a new week starts calm.
 */
export function goalWeek(g: LadderGoal, facts: LadderFacts, monday: string, today: string): GoalWeek {
  const sunday = addDays(monday, 6)
  const judged = today > sunday ? 7 : today < monday ? 0 : daysBetween(monday, today)
  const actions = templateOf(g.id).actions.map(({ metric }) => {
    const byDay = facts.daily[metric] ?? {}
    let done = 0
    for (let d = monday; d <= sunday && d <= today; d = addDays(d, 1)) done += Number(byDay[d]) || 0
    done = Math.round(done * 10) / 10
    const target = targetOf(g, metric, facts)
    const expected = target != null ? (target * judged) / 7 : 0
    const ratio = target == null || target <= 0 ? null : expected <= 0 ? null : Math.max(0, Math.min(1, done / expected))
    return { metric, done, target, ratio, text: `${fmtNum(metric, done)}/${target == null ? '?' : fmtNum(metric, target)} ${METRICS[metric].short}` }
  })
  const scored = actions.filter((a) => a.ratio != null)
  const score = scored.length ? Math.round((scored.reduce((t, a) => t + a.ratio!, 0) / scored.length) * 100) : null
  return { week: monday, actions, score, light: lightOf(score) }
}

/** One plain fix for the action furthest behind (null when on track). No guilt, just the next step. */
export function fixLine(gw: GoalWeek, today: string): string | null {
  if (gw.light === 'green' || gw.light === 'none') return null
  const worst = gw.actions.filter((a) => a.ratio != null && a.ratio < GREEN_AT).sort((a, b) => a.ratio! - b.ratio!)[0]
  if (!worst || worst.target == null) return null
  const days = Math.max(1, 7 - Math.max(0, daysBetween(gw.week, today)))
  const left = Math.max(0, Math.round((worst.target - worst.done) * 10) / 10)
  return left > 0 ? METRICS[worst.metric].fix(left, days) : null
}

export type TimelineWeek = { week: number; start: string; light: Light | 'future' }

/** The quarter strip: each week green, yellow or red (weeks to come are "future"). */
export function timeline(g: LadderGoal, facts: LadderFacts, q: Quarter, today: string): TimelineWeek[] {
  return Array.from({ length: q.weeks }, (_, i) => {
    const start = addDays(q.start, i * 7)
    return { week: i + 1, start, light: start > today ? ('future' as const) : goalWeek(g, facts, start, today).light }
  })
}

// ---------------------------------------------------------------- results (shown, not scored)

export interface ResultView {
  /** "71.2 kg → 75.2 kg", "Push: archer push-up". */
  line: string
  /** 0..100 toward the result target when there is a number (null: none). */
  pct: number | null
  start: number | null
  now: number | null
  target: number | null
}

const r1 = (n: number) => Math.round(n * 10) / 10
const sumRange = (m: Record<string, number> | undefined, from: string, to: string) => Object.entries(m ?? {}).reduce((t, [d, v]) => (d >= from && d <= to ? t + (Number(v) || 0) : t), 0)

/** The weight the quarter started from: the first weekly average in the quarter, else the latest one before it. */
export function startWeight(facts: LadderFacts, q: Pick<Quarter, 'start'>): number | null {
  const inside = facts.weights.find((w) => w.week >= q.start)
  const before = [...facts.weights].reverse().find((w) => w.week < q.start)
  return before?.avg ?? inside?.avg ?? null
}

export function resultOf(g: LadderGoal, facts: LadderFacts, q: Quarter, today: string): ResultView {
  const t = templateOf(g.id)
  const target = g.resultTarget ?? t.resultTarget
  const none = { pct: null, start: null, now: null, target: null }
  switch (t.result) {
    case 'weight': {
      const start = startWeight(facts, q)
      const now = facts.weights.length ? facts.weights[facts.weights.length - 1].avg : null
      if (start == null || now == null || target == null) return { line: 'Weigh in 3 times a week to see your weekly average', ...none }
      const goal = r1(start + target)
      const pct = target ? Math.max(0, Math.min(100, Math.round(((now - start) / target) * 100))) : null
      return { line: `${r1(start)} kg → ${r1(now)} kg (target ${goal} kg, weekly average)`, pct, start: r1(start), now: r1(now), target: goal }
    }
    case 'levels':
      return { line: [facts.levels.join(' · ') || 'Start the training roadmap to see your levels', facts.levelUps ? `${plural(facts.levelUps, 'level-up')} this quarter` : ''].filter(Boolean).join(' · '), ...none }
    case 'focusTotal': {
      const h = r1(sumRange(facts.daily.focusHours, q.start, today))
      return { line: `${fmtH(h)} of focus this quarter`, ...none, now: h }
    }
    case 'moneyMonth': {
      const from = `${today.slice(0, 7)}-01`
      const now = Math.round(sumRange(facts.daily.moneySaved, from, today))
      if (target == null) return { line: `Saved ${now} this month · set a monthly target`, ...none, now }
      return { line: `Saved ${now} of ${Math.round(target)} this month`, pct: target > 0 ? Math.max(0, Math.min(100, Math.round((now / target) * 100))) : null, start: 0, now, target }
    }
    case 'applicationsTotal': {
      const n = Math.round(sumRange(facts.daily.applications, q.start, today))
      return { line: `${plural(n, 'application')} this quarter`, ...none, now: n }
    }
    case 'sleepAvg':
      return { line: facts.sleepAvg != null ? `${r1(facts.sleepAvg)} h a night lately` : 'Log your sleep to see your nights', ...none, now: facts.sleepAvg }
  }
}

// ---------------------------------------------------------------- milestones (backward from the quarter)

/**
 * Monthly milestones worked backward from the quarter's result: an even
 * share of the target per month (+4 kg in 12 weeks → about +1.33 kg a month).
 * Only a suggestion until you confirm or edit it.
 */
export function suggestMilestones(g: LadderGoal, facts: LadderFacts, q: Quarter): LadderMilestone[] {
  const t = templateOf(g.id)
  const target = g.resultTarget ?? t.resultTarget
  const out: LadderMilestone[] = []
  for (let m = 1; m <= q.months; m++) {
    const last = m === q.months
    const share = monthWeeks(q, m).to / q.weeks
    const weeksIn = monthWeeks(q, m).to
    const wk = (metric: Metric) => targetOf(g, metric, facts) ?? 0
    switch (t.result) {
      case 'weight': {
        const start = startWeight(facts, q)
        const gain = target != null ? r1(target * share) : null
        const value = start != null && target != null ? r1(start + target * share) : null
        out.push({ month: m, text: gain == null ? `Month ${m}: weekly average up` : `Month ${m}: +${gain} kg${value != null ? ` (${value} kg weekly average)` : ''}`, value })
        break
      }
      case 'levels':
        out.push({ month: m, text: last ? `Month ${m}: ${t.finalText}` : `Month ${m}: one level up on push and on pull`, value: null })
        break
      case 'focusTotal':
        out.push({ month: m, text: `Month ${m}: ${Math.round(wk('focusHours') * weeksIn)} h of focus in total`, value: Math.round(wk('focusHours') * weeksIn) })
        break
      case 'moneyMonth':
        out.push({ month: m, text: target != null ? `Month ${m}: ${Math.round(target)} saved this month` : `Month ${m}: set a monthly target first`, value: null })
        break
      case 'applicationsTotal':
        out.push({ month: m, text: `Month ${m}: ${Math.round(wk('applications') * weeksIn)} applications in total`, value: Math.round(wk('applications') * weeksIn) })
        break
      case 'sleepAvg':
        out.push({ month: m, text: `Month ${m}: ${wk('sleepNights')} good nights in at least 3 of 4 weeks`, value: null })
        break
    }
  }
  return out
}

export const milestonesOf = (g: LadderGoal, facts: LadderFacts, q: Quarter) => g.milestones ?? suggestMilestones(g, facts, q)

/** Was a month's milestone hit? A number: the result at the month's end; else 3 of 4 weeks green-ish (score ≥ 80). */
export function milestoneHit(g: LadderGoal, facts: LadderFacts, q: Quarter, month: number, today: string): boolean | null {
  const ms = milestonesOf(g, facts, q).find((m) => m.month === month)
  if (!ms) return null
  const { from, to } = monthWeeks(q, month)
  const end = addDays(weekStart(q, to), 6)
  if (end >= today) return null
  const kind = templateOf(g.id).result
  if (ms.value != null && kind === 'weight') {
    const w = [...facts.weights].reverse().find((x) => x.week <= weekStart(q, to))
    return w ? w.avg >= ms.value : null
  }
  if (ms.value != null && kind === 'focusTotal') return sumRange(facts.daily.focusHours, q.start, end) >= ms.value
  if (ms.value != null && kind === 'applicationsTotal') return sumRange(facts.daily.applications, q.start, end) >= ms.value
  let good = 0
  for (let w = from; w <= to; w++) if ((goalWeek(g, facts, weekStart(q, w), today).score ?? 0) >= GREEN_AT * 100) good++
  return good >= Math.min(3, to - from + 1)
}

// ---------------------------------------------------------------- the week's steps and the top 3

/** This week's step for a goal: its action that did worst last week (the first one when even). */
export function weekStep(g: LadderGoal, facts: LadderFacts, monday: string, today: string): { metric: Metric; text: string } | null {
  const last = goalWeek(g, facts, addDays(monday, -7), today)
  const scored = last.actions.filter((a) => a.target != null && a.target > 0)
  if (!scored.length) return null
  const pick = [...scored].sort((a, b) => (a.ratio ?? 1) - (b.ratio ?? 1))[0]
  return { metric: pick.metric, text: METRICS[pick.metric].step(pick.target!) }
}

/** The Sunday top 3, pre-filled: one step per critical goal (you can change them). */
export function ladderTop3(l: Ladder, facts: LadderFacts, monday: string, today: string): string[] {
  return activeGoals(l)
    .map((g) => weekStep(g, facts, monday, today)?.text ?? null)
    .filter((x): x is string => !!x)
    .slice(0, MAX_ACTIVE)
}

// ---------------------------------------------------------------- views for screens, Ben and Telegram

export interface LadderCard {
  goal: LadderGoal
  emoji: string
  week: GoalWeek
  fix: string | null
  result: ResultView
  milestone: LadderMilestone | null
  /** The milestones are only a suggestion so far. */
  suggested: boolean
  timeline: TimelineWeek[]
}

export function ladderCards(l: Ladder, facts: LadderFacts, q: Quarter, today: string): LadderCard[] {
  const monday = mondayOf(today)
  return activeGoals(l).map((g) => {
    const week = goalWeek(g, facts, monday, today)
    const ms = milestonesOf(g, facts, q)
    return { goal: g, emoji: templateOf(g.id).emoji, week, fix: fixLine(week, today), result: resultOf(g, facts, q, today), milestone: ms.find((m) => m.month === Math.max(1, q.month)) ?? ms[ms.length - 1] ?? null, suggested: !g.milestones, timeline: timeline(g, facts, q, today) }
  })
}

/** The one line on Today: the goal that needs it most (else the first), with its first two actions. */
export function quarterLine(cards: LadderCard[]): string {
  if (!cards.length) return ''
  const rank: Record<Light, number> = { red: 0, yellow: 1, green: 2, none: 3 }
  const c = [...cards].sort((a, b) => rank[a.week.light] - rank[b.week.light])[0]
  const pick = c.week.light === 'red' || c.week.light === 'yellow' ? c : cards[0]
  const acts = pick.week.actions.filter((a) => a.target != null).slice(0, 2).map((a) => a.text)
  return `Quarter goal: ${pick.goal.title}${acts.length ? ` · this week ${acts.join(', ')}` : ''}`
}

/** The week a review looks back on: last week on a Monday (Sunday's review was missed), else this week (on Sunday, the whole of it). */
export const reviewWeek = (today: string) => (new Date(`${today}T12:00:00Z`).getUTCDay() === 1 ? addDays(today, -7) : mondayOf(today))

/** Sunday, or Monday when Sunday's was missed, and that week isn't reviewed yet. */
export function weeklyReviewDue(l: Ladder, today: string): boolean {
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay()
  if (wd !== 0 && wd !== 1) return false
  return activeGoals(l).length > 0 && !l.reviews.includes(reviewWeek(today))
}

export interface WeeklyReview {
  /** The Monday of the week looked back on. */
  week: string
  /** The Monday of the week being planned. */
  next: string
  goals: { id: TemplateId; title: string; emoji: string; light: Light; score: number | null; actions: string[]; fix: string | null }[]
  /** Next week's top 3, pre-filled from the ladder. */
  top3: string[]
  done: boolean
}

/** The Sunday review (3 minutes): what you did per goal, then next week's top 3. Pure, so Telegram can reuse it. */
export function weeklyReviewData(l: Ladder, facts: LadderFacts, today: string): WeeklyReview {
  const week = reviewWeek(today)
  const next = addDays(week, 7)
  const asOf = new Date(`${today}T12:00:00Z`).getUTCDay() === 0 || today > addDays(week, 6) ? next : today
  return {
    week,
    next,
    goals: activeGoals(l).map((g) => {
      // Sunday or later: the whole week counts (its last day is still going); mid-week: the days so far.
      const gw = goalWeek(g, facts, week, asOf)
      const worst = gw.actions.filter((a) => a.ratio != null && a.ratio < GREEN_AT).sort((a, b) => a.ratio! - b.ratio!)[0]
      // For next week: plan the step in from the start (no today/tomorrow wording here).
      const fix = gw.light !== 'green' && worst?.target ? `Plan it in from Monday: ${METRICS[worst.metric].step(worst.target)}.` : null
      return { id: g.id, title: g.title, emoji: templateOf(g.id).emoji, light: gw.light, score: gw.score, actions: gw.actions.map((a) => a.text), fix }
    }),
    top3: ladderTop3(l, facts, next, next),
    done: l.reviews.includes(week)
  }
}

export const markReviewed = (l: Ladder, week: string): Ladder => ({ ...l, reviews: [...new Set([...l.reviews, week])].sort().slice(-30) })

/** The month that just ended (to review), or null mid-month. Due in the first week of the next month. */
export function monthToReview(q: Quarter): number | null {
  if (q.week < 1) return null
  const ended = q.week > q.weeks ? q.months : Math.floor((q.week - 1) / 4)
  return ended >= 1 && (q.week - 1) % 4 === 0 ? ended : null
}

export const monthKey = (q: Pick<Quarter, 'start'>, month: number) => `${q.start}:${month}`

export interface MonthlyReview {
  month: number
  goals: { id: TemplateId; title: string; emoji: string; milestone: string; hit: boolean | null; next: LadderMilestone | null }[]
  done: boolean
}

/** The monthly review (5 minutes): was each milestone hit, and next month's (to adjust). */
export function monthlyReviewData(l: Ladder, facts: LadderFacts, q: Quarter, month: number, today: string): MonthlyReview {
  return {
    month,
    goals: activeGoals(l).map((g) => {
      const ms = milestonesOf(g, facts, q)
      return { id: g.id, title: g.title, emoji: templateOf(g.id).emoji, milestone: ms.find((m) => m.month === month)?.text ?? '', hit: milestoneHit(g, facts, q, month, today), next: ms.find((m) => m.month === month + 1) ?? null }
    }),
    done: l.monthReviews.includes(monthKey(q, month))
  }
}

export const markMonthReviewed = (l: Ladder, key: string): Ladder => ({ ...l, monthReviews: [...new Set([...l.monthReviews, key])].sort().slice(-12) })

/** One line for Ben's prompt (empty without critical goals). Never invents progress. */
export function ladderBenLine(cards: LadderCard[], q: Quarter): string {
  if (!cards.length) return ''
  const parts = cards.map((c) => `${c.goal.title} (${c.week.light === 'none' ? 'new week' : c.week.light}: ${c.week.actions.filter((a) => a.target != null).map((a) => a.text).join(', ')}${c.milestone ? `; month ${c.milestone.month}: ${c.milestone.text.replace(/^Month \d+: /, '')}` : ''})`)
  return `Quarter (week ${q.week} of ${q.weeks}${q.season ? `, season "${q.season}"` : ''}), up to 3 critical goals, scored on actions this week: ${parts.join('; ')}. Everything else is "Not now": don't push it. Praise actions, not results; no guilt when a light is red, one small next step.`
}
