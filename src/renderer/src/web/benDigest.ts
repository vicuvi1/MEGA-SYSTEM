// Coach fix + power: one day of his life in numbers (for "review yesterday"),
// and the lookups Ben can ask for with "need" beyond the history ones in
// botBrain.answerLocal: goals, money this week, sleep, water, workouts, a day.
// Reads the database copy only; never writes.
import { addDays } from '@core/dates'
import { COACH_HISTORY, cleanHistory } from '@core/coachImpact'
import { digestText, type DayDigest } from '@core/benRoute'
import { goalsNowText } from '@core/goalsBen'
import { nightMinutes } from '@core/readiness'
import { planGoal, planLine } from '@core/goalPlan'
import { getSetting } from '../../../main/settings'
import { financeDayTx, type Services } from './webServices'

const readJson = (db: any, key: string): any => {
  try {
    return JSON.parse(getSetting(db, key) || 'null')
  } catch {
    return null
  }
}

/** The goals with their status, one line each (measurable goals and the study goals with deadlines). */
export function goalLines(s: Services, finance: any, now = new Date()): string[] {
  const today = s.wallet.today(now)
  const out: string[] = []
  try {
    const text = goalsNowText(s.goals.cards(now, finance))
    for (const l of text.split('\n')) if (/^- G\d/.test(l)) out.push(l.replace(/^- /, ''))
  } catch {
    /* no measurable goals */
  }
  try {
    const f = s.focus.state(now)
    for (const g of f.goals) out.push(planLine(planGoal(g, today, f.todaySessions.filter((x) => x.subject.toLowerCase() === g.subject.toLowerCase()).reduce((t, x) => t + x.minutes, 0))))
  } catch {
    /* no study goals */
  }
  return out
}

/** One day in numbers: score, must-dos, focus, sleep, water, workouts, money, goals, promises, points. */
export function dayDigest(db: any, s: Services, finance: any, day: string, now = new Date()): DayDigest {
  const hist = cleanHistory(readJson(db, COACH_HISTORY)).days[day] ?? {}
  let mustdos: DayDigest['mustdos'] = null
  try {
    const p = s.focus.plan(day)
    if (p.items.length) mustdos = { done: p.items.filter((x) => x.done).length, total: p.items.length, open: p.items.filter((x) => !x.done).map((x) => x.text) }
  } catch {
    mustdos = null
  }
  if (!mustdos && hist.mustdos) mustdos = { done: hist.mustdos[0], total: hist.mustdos[1], open: [] }
  let focusBy: { subject: string; minutes: number }[] = []
  try {
    focusBy = (db.prepare('SELECT subject, SUM(minutes) AS m FROM focus_sessions WHERE day = ? GROUP BY subject ORDER BY m DESC').all(day) as any[]).map((r) => ({ subject: String(r.subject), minutes: Number(r.m) || 0 }))
  } catch {
    focusBy = []
  }
  let sleep: DayDigest['sleep'] = null
  try {
    const log = s.sleep.logs().find((l) => l.day === day)
    if (log) {
      const min = nightMinutes(log)
      sleep = { bed: log.bedTime, wake: log.wakeTime || null, onTime: log.onTime ?? null, hours: min != null ? min / 60 : null, quality: log.quality }
    }
  } catch {
    sleep = null
  }
  let rules: string[] = []
  let points: number | null = null
  try {
    const entries = s.wallet.entriesOn(day) as any[]
    rules = entries.map((e) => String(e.ruleId ?? ''))
    points = entries.filter((e) => e.coins > 0).reduce((t, e) => t + Number(e.coins), 0)
  } catch {
    rules = []
  }
  const waterMet = rules.some((r) => /water/i.test(r)) ? true : rules.length ? false : null
  let workouts: string[] = []
  try {
    workouts = s.body.workouts(30).filter((w) => w.day === day).map((w) => w.title)
  } catch {
    workouts = []
  }
  let money: DayDigest['money'] = null
  try {
    const tx = financeDayTx(s, finance, true).filter((t) => t.date === day && t.type === 'expense')
    if (finance && Array.isArray(finance.tx)) {
      const by = new Map<string, number>()
      for (const t of tx) by.set(t.category || 'Other', (by.get(t.category || 'Other') ?? 0) + Math.abs(t.amount) / 100)
      money = { spent: [...by.values()].reduce((a, b) => a + b, 0), top: [...by].sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${Math.round(v)}`) }
    }
  } catch {
    money = null
  }
  return {
    day,
    score: typeof hist.score === 'number' ? hist.score : null,
    mustdos,
    focusMin: focusBy.reduce((t, x) => t + x.minutes, 0),
    focusBy,
    plannedFocusMin: null,
    sleep,
    water: { met: waterMet, ml: null, target: null },
    workouts,
    money,
    goals: goalLines(s, finance, now),
    promises: hist.kept != null || hist.broken != null ? { kept: hist.kept ?? 0, broken: (hist.broken ?? 0) + (hist.ignored ?? 0) } : null,
    points
  }
}

/** Yesterday's digest (the app day turns at 04:00). */
export function yesterdayDigest(db: any, s: Services, finance: any, now = new Date()): DayDigest {
  return dayDigest(db, s, finance, addDays(s.wallet.today(now), -1), now)
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The extra lookups (null when the request isn't one of them):
 * "goals", "day <date>", "money week", "sleep7", "water <from> <to>".
 * The history ones (spending, focus, workouts, sleep, tasks, points) stay in botBrain.answerLocal.
 */
export function answerMore(need: string, db: any, s: Services, finance: any, now = new Date()): string | null {
  const [kind, a, b] = need.trim().split(/\s+/)
  const k = (kind ?? '').toLowerCase()
  const today = s.wallet.today(now)
  if (k === 'goals') {
    const lines = goalLines(s, finance, now)
    return lines.length ? `Goals with status:\n${lines.map((l) => `- ${l}`).join('\n')}` : 'Goals: none set yet.'
  }
  if (k === 'day') {
    const day = a === 'yesterday' ? addDays(today, -1) : a === 'today' ? today : DATE.test(a ?? '') ? a : null
    if (!day) return `${need}: give a date as YYYY-MM-DD (or "yesterday").`
    return digestText(dayDigest(db, s, finance, day, now)).replace(/^Yesterday \(/, 'Day (')
  }
  if (k === 'money' || k === 'spending-week') {
    const from = addDays(today, -6)
    try {
      const tx = financeDayTx(s, finance, true).filter((t) => t.type === 'expense' && t.date >= from && t.date <= today)
      const by = new Map<string, number>()
      for (const t of tx) by.set(t.category || 'Other', (by.get(t.category || 'Other') ?? 0) + Math.abs(t.amount) / 100)
      const total = [...by.values()].reduce((x, y) => x + y, 0)
      return `Money this week (${from} to ${today}): ${Math.round(total)} lei in ${tx.length} expenses (${Math.round(total / 7)} lei/day).${by.size ? ` By category: ${[...by].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([c, v]) => `${c} ${Math.round(v)}`).join(', ')}.` : ''}`
    } catch {
      return 'Money this week: Finance Helper data not available.'
    }
  }
  if (k === 'sleep7' || (k === 'sleep' && a === 'week')) {
    const from = addDays(today, -6)
    const logs = s.sleep.logs().filter((l) => l.day >= from && l.day <= today).sort((x, y) => (x.day < y.day ? -1 : 1))
    if (!logs.length) return 'Sleep, last 7 days: nothing logged.'
    const hrs = logs.map((l) => nightMinutes(l)).filter((m): m is number => m != null)
    return `Sleep, last 7 days: ${logs.map((l) => `${l.day.slice(5)} ${l.bedTime ? `bed ${l.bedTime}` : ''}${l.wakeTime ? ` up ${l.wakeTime}${l.onTime ? '' : ' (late)'}` : ''}${nightMinutes(l) != null ? ` ${(nightMinutes(l)! / 60).toFixed(1)}h` : ''}`.trim()).join('; ')}.${hrs.length ? ` Average ${(hrs.reduce((x, y) => x + y, 0) / hrs.length / 60).toFixed(1)} h.` : ''}`
  }
  if (k === 'water') {
    const from = DATE.test(a ?? '') ? a : addDays(today, -6)
    const to = DATE.test(b ?? '') ? b : today
    const days: string[] = []
    for (let d = from; d <= to && days.length < 31; d = addDays(d, 1)) days.push(d)
    const met = days.filter((d) => (s.wallet.entriesOn(d) as any[]).some((e) => /water/i.test(String(e.ruleId ?? ''))))
    return `Water goal ${from} to ${to}: met on ${met.length}/${days.length} days${met.length ? ` (${met.map((d) => d.slice(5)).join(', ')})` : ''}.`
  }
  return null
}

/** The lookup list Ben sees, for these new kinds (added to his prompt's LOOKUPS). */
export const MORE_LOOKUPS = `- "goals" every goal with its status. "day <YYYY-MM-DD|yesterday>" one day in numbers (score, must-dos, focus, sleep, water, workouts, money). "money week" spending of the last 7 days. "sleep7" bed and wake times of the last 7 days. "water <from> <to>" days the water goal was met.
- "todoist <project>" open tasks of one project (with T-numbers).`
