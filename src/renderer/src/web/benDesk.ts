// Ben's desk: everything the coach keeps between chats (synced setting
// `ben_desk`) and one view that gathers what the Coach page shows: patterns,
// energy map, excuses, mood, study topics, habit stacks, stakes, the Sunday
// call, the month's story, the spending coach and the sleep link. The same
// code runs in the app (instant, read from the local mirror) and on the
// server (Ben's prompt, the tick that enforces stakes).
import { fullHouse, weekOf, type FullHouse } from '@core/fullHouse'
import { sleepRegularity } from '@core/sleepRegularity'
import { lifeReview, type LifeReview } from '@core/lifeReview'
import { urgeEvents } from './disciplinePatterns'
import { EXPERIMENTS, measureExperiment, pickExperiment, type ExpMetric, type ExpResult, type ExpState, type Experiment, type Series } from '@core/experiment'
import { nightMinutes } from '@core/readiness'
import { getSetting, setSetting, writeSetting, readSetting } from '../../../main/settings'
import { saveSport } from '../../../main/bodyLog'
import { addDays, calendarDay } from '@core/dates'
import { financeSpending } from '@core/progress'
import { addExcuse, addMood, energyMap, excuseCallout, excuseCounts, excuseLine, hoursText, moodDue, moodLine, profileCorrections, profileNote, PROFILE_NOTE, weeklyPatterns, classifyExcuse, type EnergyMap, type Excuse, type ExcuseCount, type MoodEntry, type MoodSlot, type Pattern } from '@core/benKnows'
import { addTopic, dueTopics, nextReview, parseStack, reviewTopic, stackRate, stackStreak, tickStack, type Stack, type StudyTopic } from '@core/benPlans'
import { addStake, callDue, callNote, keepStake, monthStory, readDue, stakeStats, type CoachCall, type MonthStory, type Stake } from '@core/benStakes'
import { recurringCharges, sleepLink, spendPace, type Recurring, type SleepLink, type SpendPace } from '@core/benMoney'
import { REMINDERS, promiseStats, type Reminder } from '@core/coachKit'
import { DAY_LOG, type DayLogDay } from './dayLog'
import { listNotes, saveNote } from './notes'
import { loadMind, loadProfile, sportState } from './botBrain'
import { addWater, sharedView, sportToday } from '@core/sportShared'
import { defaultSport } from '@core/sportCards'
import type { Services } from './webServices'
import { WATER_MAX_ML } from '@core/defaults'

export const DESK = 'ben_desk'

export interface Desk {
  excuses: Excuse[]
  moods: MoodEntry[]
  study: StudyTopic[]
  stacks: Stack[]
  stakes: Stake[]
  calls: CoachCall[]
  /** month → Ben's letter for it. */
  letters: Record<string, string>
  /** Last day the profile note was refreshed. */
  profileDay?: string
}
export const EMPTY_DESK: Desk = { excuses: [], moods: [], study: [], stacks: [], stakes: [], calls: [], letters: {} }

export function loadDesk(db: any): Desk {
  try {
    const v = readSetting(db, DESK)
    return v && typeof v === 'object' ? { ...EMPTY_DESK, ...v } : { ...EMPTY_DESK }
  } catch {
    return { ...EMPTY_DESK }
  }
}
export function saveDesk(db: any, d: Desk): Desk {
  writeSetting(db, DESK, d)
  return d
}
export function editDesk(db: any, f: (d: Desk) => Desk): Desk {
  return saveDesk(db, f(loadDesk(db)))
}

const json = (db: any, key: string) => {
  try {
    return JSON.parse(getSetting(db, key) || 'null')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- the view

const EXP_KEY = 'ben_experiment'

export interface DeskView {
  today: string
  energy: EnergyMap
  patterns: Pattern[]
  excuses: ExcuseCount[]
  moods: MoodEntry[]
  moodDue: MoodSlot | null
  moodAvg: number | null
  study: (StudyTopic & { next: string | null; due: boolean })[]
  stacks: (Stack & { streak: number; rate: number; today: number[] })[]
  stakes: Stake[]
  stakeStats: ReturnType<typeof stakeStats>
  callDue: boolean
  lastCall: CoachCall | null
  month: MonthStory
  letter: string | null
  spend: SpendPace | null
  recurring: Recurring[]
  sleep: SleepLink
  money: { hourly: number | null; safeToday: number | null; limitLeft: number | null; perDay: number; balance: number | null; goals: { title: string; left: number }[] }
  goals: { id: number; title: string; deadline: string; hoursLeft: number; daysLeft: number; behind: boolean }[]
  exams: { title: string; deadline: string }[]
  restDays: string[]
  /** The weekly experiment: the running one (measured) or the one Ben suggests (N8). */
  experiment: { current: ExpResult | null; suggest: Experiment }
  /** The week in one look: 3 findings across training, sleep, money, focus, urges + 1 experiment (N13). */
  review: LifeReview
  /** Steady sleep, 3+ workouts, clean, under budget this week (M5); claimed: paid this week. */
  fullHouse: FullHouse & { claimed: boolean }
}

function sessionsOf(db: any, from: string) {
  try {
    return (db.prepare('SELECT day, started_at, minutes FROM focus_sessions WHERE day >= ?').all(from) as any[]).map((r) => ({ day: String(r.day), startedAt: String(r.started_at), minutes: Number(r.minutes) }))
  } catch {
    return []
  }
}

export function moneyNumbers(finance: any, today: string): DeskView['money'] {
  const tx: any[] = Array.isArray(finance?.tx) ? finance.tx : []
  const B = (t: any) => Math.abs(Number(t.base ?? t.amount) || 0)
  const exp = tx.filter((t) => t && t.type === 'expense' && !t.deleted && typeof t.date === 'string')
  const from30 = addDays(today, -29)
  const perDay = Math.round(exp.filter((t) => t.date >= from30 && t.date <= today).reduce((s, t) => s + B(t), 0) / 30)
  // Your hour: what you set in Finance Helper, else 3 months of income over 160 h.
  const wh = finance?.settings?.workHour
  let hourly: number | null = wh?.mode === 'manual' && Number(wh.rate) > 0 ? Number(wh.rate) : null
  if (hourly == null) {
    const months = [1, 2, 3].map((k) => {
      const d = new Date(`${today.slice(0, 7)}-15T12:00:00Z`)
      d.setUTCMonth(d.getUTCMonth() - k)
      return d.toISOString().slice(0, 7)
    })
    const inc = tx.filter((t) => t && t.type === 'income' && !t.deleted && !t.loan && typeof t.date === 'string' && months.includes(t.date.slice(0, 7)))
    const active = new Set(inc.map((t) => t.date.slice(0, 7))).size
    const sum = inc.reduce((s, t) => s + B(t), 0)
    hourly = active && sum ? Math.round(sum / active / (Number(wh?.hoursPerMonth) || 160)) : null
  }
  const limit = finance?.settings?.limit
  let limitLeft: number | null = null
  let safeToday: number | null = null
  if (limit?.on && Number(limit.amount) > 0) {
    const month = today.slice(0, 7)
    const spent = exp.filter((t) => t.date.startsWith(month)).reduce((s, t) => s + B(t), 0)
    limitLeft = Number(limit.amount) - spent
    const dim = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
    safeToday = Math.max(0, Math.round(limitLeft / (dim - Number(today.slice(8)) + 1)))
  }
  const goals = (Array.isArray(finance?.goals) ? finance.goals : [])
    .filter((g: any) => g && !g.deleted && Number(g.target) > 0)
    .map((g: any) => ({ title: String(g.name ?? g.title ?? 'Goal'), left: Math.max(0, Number(g.target) - Number(g.saved ?? g.current ?? 0)) }))
  return { hourly, safeToday, limitLeft, perDay, balance: null, goals }
}

/** Everything the Coach page's desk shows (pure read). */
export function deskView(s: Services, finance: any, now = new Date()): DeskView {
  const db = s.db
  const today = s.wallet.today(now)
  const d = loadDesk(db)
  const sessions = sessionsOf(db, addDays(today, -62))
  const dayLog: Record<string, DayLogDay> = json(db, DAY_LOG) ?? {}
  const quality = Object.values(dayLog).flatMap((x) => x.focus ?? []).map((q) => ({ at: q.at, pct: q.pct }))
  const blocks = Object.entries(dayLog).flatMap(([day, x]) => (x.blocks ?? []).map((b) => ({ day, at: b.at, result: b.result })))
  const energy = energyMap(sessions, quality, blocks)
  let logs: any[] = []
  try {
    logs = s.sleep.logs()
  } catch {
    logs = []
  }
  const sleep = logs.map((l) => ({ day: l.day, wake: l.wakeTime, bed: l.bedTime, onTime: !!l.onTime }))
  const input = s.progress.input(null, now, 70)
  const workouts = [...new Set(input.workouts.map((w: any) => w.day))]
  const f = s.focus.state(now)
  const exams = f.goals.map((g) => ({ title: g.title, deadline: g.deadline }))
  const spending = financeSpending(finance)
  const patterns = weeklyPatterns({ today, sessions, sleep, workouts, moods: d.moods, blocks, exams: exams.map((e) => e.deadline), spending })
  const recentMoods = d.moods.filter((m) => m.day >= addDays(today, -6))
  const cats = new Map<string, string>((finance?.settings?.categories ?? []).map((c: any) => [String(c.id), String(c.name)]))
  const catName = (id: string) => cats.get(id) ?? id
  const reminders: Reminder[] = json(db, REMINDERS) ?? []
  const ps = promiseStats(reminders, now)
  let restDays: string[] = []
  try {
    restDays = s.body.restDays()
  } catch {
    restDays = []
  }
  const month = today.slice(0, 7)
  const story = monthStory({
    month,
    today,
    focus: sessions.map((x) => ({ day: x.day, minutes: x.minutes })),
    workouts,
    restDays,
    sleep,
    spent: spending ?? [],
    moods: d.moods,
    stakes: stakeStats(d.stakes, now),
    promises: { kept: ps.kept, missed: ps.broken + ps.ignored }
  })
  // The weekly experiment (N8): daily numbers per area, measured against the 14 days before.
  const series: Record<ExpMetric, Series> = { focus: {}, sleep: {}, workouts: {}, spend: {} }
  for (const x of sessions) series.focus[x.day] = (series.focus[x.day] ?? 0) + x.minutes
  for (const l of logs) {
    const m = nightMinutes(l)
    if (m != null) series.sleep[l.day] = m
  }
  for (const w of input.workouts as any[]) series.workouts[w.day] = (series.workouts[w.day] ?? 0) + 1
  for (const x of spending ?? []) series.spend[x.day] = (series.spend[x.day] ?? 0) + x.bani / 100
  const mean = (m: ExpMetric, from: number, to: number, counted = m !== 'sleep') => {
    const vals: number[] = []
    for (let k = from; k <= to; k++) {
      const v = series[m][addDays(today, -k)]
      if (v != null || counted) vals.push(v ?? 0)
    }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  }
  const gap = (m: ExpMetric) => {
    const last = mean(m, 0, 6)
    const usual = mean(m, 7, 34)
    if (!usual) return 0
    return m === 'spend' ? Math.max(0, (last - usual) / usual) : Math.max(0, (usual - last) / usual)
  }
  const expState = (json(db, EXP_KEY) as ExpState | null)
  const current = expState ? measureExperiment(expState, series[EXPERIMENTS.find((e) => e.id === expState.id)?.metric ?? 'focus'], today) : null
  const experiment = { current, suggest: pickExperiment({ focus: gap('focus'), sleep: gap('sleep'), workouts: gap('workouts'), spend: gap('spend') }, current ? [current.exp.id] : []) }
  // The weekly life review (N13): urges this week vs last from the discipline events.
  const ue = urgeEvents(db)
  const inWeek = (ts: string, from: number, to: number) => {
    const d = String(ts).slice(0, 10)
    return d >= addDays(today, -to) && d <= addDays(today, -from)
  }
  const review = lifeReview(series, { crushed: ue.filter((e) => e.kind === 'urge' && inWeek(e.ts, 0, 6)).length, slips: ue.filter((e) => e.kind === 'reset' && inWeek(e.ts, 0, 6)).length, prevCrushed: ue.filter((e) => e.kind === 'urge' && inWeek(e.ts, 7, 13)).length }, today)
  // The weekly full house (M5).
  const sevenDays = (m: ExpMetric) => Array.from({ length: 7 }, (_, k) => series[m][addDays(today, -k)] ?? 0).reduce((a, b) => a + b, 0)
  const usualWeekSpend = (Array.from({ length: 28 }, (_, k) => series.spend[addDays(today, -7 - k)] ?? 0).reduce((a, b) => a + b, 0) / 28) * 7
  const fh = fullHouse({ sleepScore: sleepRegularity(logs as any).score, workouts: sevenDays('workouts'), slips: ue.filter((e) => e.kind === 'reset' && inWeek(e.ts, 0, 6)).length, spent: sevenDays('spend'), usualSpent: usualWeekSpend })
  const fullHouseState = { ...fh, claimed: s.wallet.entries().some((e: any) => e.ref === `fullhouse:${weekOf(today)}`) }
  const lastNight = logs.find((l) => l.day === today) ?? null
  const tx = Array.isArray(finance?.tx) ? finance.tx : null
  return {
    today,
    energy,
    patterns,
    excuses: excuseCounts(d.excuses, today),
    moods: d.moods.filter((m) => m.day >= addDays(today, -13)),
    moodDue: moodDue(d.moods, now),
    moodAvg: recentMoods.length ? recentMoods.reduce((t, m) => t + m.mood, 0) / recentMoods.length : null,
    study: d.study
      .filter((t) => !t.examDay || t.examDay >= addDays(today, -1))
      .map((t) => ({ ...t, next: nextReview(t), due: dueTopics([t], today).length > 0 }))
      .sort((a, b) => Number(b.due) - Number(a.due) || String(a.next).localeCompare(String(b.next))),
    stacks: d.stacks.map((x) => ({ ...x, streak: stackStreak(x, today), rate: stackRate(x, today), today: x.log[today] ?? [] })),
    stakes: [...d.stakes].sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || b.at.localeCompare(a.at)).slice(0, 12),
    stakeStats: stakeStats(d.stakes, now),
    callDue: callDue(d.calls, now),
    lastCall: d.calls[d.calls.length - 1] ?? null,
    month: story,
    letter: d.letters[month] ?? null,
    spend: tx ? spendPace(tx, catName, today) : null,
    recurring: tx ? recurringCharges(tx, catName, today) : [],
    sleep: sleepLink(lastNight?.bedTime, lastNight?.wakeTime),
    money: moneyNumbers(finance, today),
    goals: f.goals.map((g) => ({ id: g.id, title: g.title, deadline: g.deadline, hoursLeft: Math.max(0, Math.round((g.hours - g.doneMin / 60) * 10) / 10), daysLeft: g.daysLeft, behind: g.aheadH <= -1 })),
    exams,
    restDays,
    experiment,
    review,
    fullHouse: fullHouseState
  }
}

// ------------------------------------------------------------ Ben's prompt

/** What the desk adds to Ben's prompt (short lines; only what's there). */
export function deskPrompt(s: Services, finance: any, now = new Date()): string {
  const v = deskView(s, finance, now)
  const d = loadDesk(s.db)
  const lines: string[] = []
  if (v.energy.ready) lines.push(`His energy map: best hours ${hoursText(v.energy.best)}${v.energy.worst.length ? `, weakest ${hoursText(v.energy.worst)}` : ''}. Put HARD tasks in the best hours when you plan or move blocks.`)
  if (v.patterns.length) lines.push(`Weekly patterns (his data):\n${v.patterns.map((p) => `- ${p.text} → try: ${p.change}`).join('\n')}`)
  const ex = excuseLine(d.excuses, v.today)
  if (ex) lines.push(ex)
  const ml = moodLine(d.moods, v.today)
  if (ml) lines.push(ml)
  if (v.sleep.slept != null && v.sleep.level !== 'ok') lines.push(`Sleep link: ${v.sleep.title} ${v.sleep.tips.join(' ')} Plan today lighter before ${v.sleep.lightUntil}.`)
  const due = v.study.filter((t) => t.due)
  if (due.length) lines.push(`Study reviews due today: ${due.map((t) => `${t.exam} · ${t.topic}`).join('; ')}.`)
  if (v.stacks.length) lines.push(`Habit stacks: ${v.stacks.map((x) => `after ${x.cue} → ${x.steps.join(' → ')} (today ${x.today.length}/${x.steps.length}, streak ${x.streak})`).join('; ')}.`)
  const open = v.stakes.filter((x) => x.status === 'open')
  if (open.length) lines.push(`Open stakes (he loses the points if not done in time): ${open.map((x) => `"${x.text}" by ${new Date(x.due).toTimeString().slice(0, 5)} −${x.points}`).join('; ')}.`)
  if (v.stakeStats.kept + v.stakeStats.lost) lines.push(`Stakes last 30 days: ${v.stakeStats.kept} won, ${v.stakeStats.lost} lost (−${v.stakeStats.pointsLost} points).`)
  if (v.spend?.line) lines.push(`Spending coach: ${v.spend.line}`)
  if (v.recurring.length) lines.push(`Monthly charges that repeat: ${v.recurring.slice(0, 4).map((r) => `${r.name} ${Math.round(r.amount / 100)} lei`).join(', ')}. Ask if he still uses them when money comes up.`)
  if (v.lastCall) lines.push(`Last Sunday call (${v.lastCall.week}): change "${v.lastCall.answers.change}", big 3: ${v.lastCall.answers.big3.replace(/\n/g, ' / ')}.`)
  try {
    const p = listNotes(s.db as any).find((n) => n.title === PROFILE_NOTE)
    const corr = p ? profileCorrections(p.body) : ''
    if (corr) lines.push(`His corrections to your profile of him (always true):\n${corr}`)
  } catch {
    /* no notes table yet */
  }
  return lines.join('\n')
}

// --------------------------------------------------------------- changes

/** A message from him: if it's an excuse, it's counted; returns Ben's kind call-out of a repeat. */
export function noteExcuse(db: any, text: string, today: string, now = new Date()): string | null {
  const kind = classifyExcuse(text)
  if (!kind) return null
  const d = editDesk(db, (x) => ({ ...x, excuses: addExcuse(x.excuses, text, now.toISOString()) }))
  return excuseCallout(d.excuses, kind, today)
}

export function logMood(db: any, mood: number, now = new Date()): Desk {
  const day = calendarDay(now)
  const slot: MoodSlot = now.getHours() < 17 ? 'noon' : 'evening'
  return editDesk(db, (x) => ({ ...x, moods: addMood(x.moods, { day, slot, mood, at: now.toISOString() }) }))
}

export function refreshProfile(s: Services, finance: any, now = new Date(), force = false): boolean {
  const db = s.db
  const d = loadDesk(db)
  const today = s.wallet.today(now)
  if (!force && d.profileDay === today) return false
  const v = deskView(s, finance, now)
  const mind = loadMind(db)
  const prof = loadProfile(db)
  let notes: { id: string; title: string; body: string }[] = []
  try {
    notes = listNotes(db as any)
  } catch {
    return false
  }
  const prev = notes.find((n) => n.title === PROFILE_NOTE)
  const body = profileNote(
    {
      today,
      aboutMe: prof.about,
      goals: [...mind.goals.map((g) => ({ title: g.title, deadline: g.deadline ?? null, weekly: g.weekly ?? null })), ...prof.goals.filter((t) => !mind.goals.some((g) => g.title === t)).map((t) => ({ title: t }))],
      exams: v.exams,
      people: mind.people.map((p) => ({ name: p.name, note: p.note })),
      works: mind.works.map((x) => x.t),
      fails: mind.fails.map((x) => x.t),
      patterns: v.patterns,
      energy: v.energy,
      excuses: v.excuses,
      moodAvg: v.moodAvg
    },
    prev?.body ?? ''
  )
  if (prev?.body !== body) saveNote(db as any, { id: prev?.id, title: PROFILE_NOTE, body, pinned: true }, now)
  saveDesk(db, { ...loadDesk(db), profileDay: today })
  return true
}

export type DeskOp =
  | { op: 'mood'; mood: number }
  /** CC2: water from the chat's water card (the same record as "water 250"). */
  | { op: 'water'; ml: number }
  | { op: 'stake'; text: string; due: string; points: number }
  | { op: 'keepStake'; id: string }
  | { op: 'dropStake'; id: string }
  | { op: 'study'; exam: string; topic: string; examDay?: string | null }
  | { op: 'reviewed'; id: string }
  | { op: 'dropStudy'; id: string }
  | { op: 'stack'; text: string }
  | { op: 'tickStack'; id: string; step: number }
  | { op: 'dropStack'; id: string }
  | { op: 'call'; answers: CoachCall['answers'] }
  | { op: 'letter'; month: string; text: string }
  | { op: 'experiment'; id: string }
  | { op: 'stopExperiment' }
  | { op: 'fullHouse' }

/** One change on the desk (from the Coach page or Ben's actions). Returns a short line for the screen. */
export function deskChange(s: Services, o: DeskOp, now = new Date()): string {
  const db = s.db
  const today = s.wallet.today(now)
  if (o.op === 'experiment') {
    const e = EXPERIMENTS.find((x) => x.id === o.id)
    if (!e) throw new Error('No such experiment')
    setSetting(db, EXP_KEY, JSON.stringify({ id: e.id, start: today }))
    return `Experiment on for 7 days: ${e.title}`
  }
  if (o.op === 'fullHouse') {
    const v = deskView(s, null, now)
    if (!v.fullHouse.hit) throw new Error(`Not yet: ${v.fullHouse.missing.join(', ')}`)
    const ref = `fullhouse:${weekOf(today)}`
    if (s.wallet.entries().some((e: any) => e.ref === ref)) return 'Already claimed this week'
    s.wallet.awardRule('general.full_house', { now, ref, note: 'Weekly full house' })
    return 'Full house! +40 points 🏆'
  }
  if (o.op === 'stopExperiment') {
    setSetting(db, EXP_KEY, '')
    return 'Experiment ended'
  }
  if (o.op === 'mood') {
    logMood(db, o.mood, now)
    return 'Mood noted'
  }
  if (o.op === 'water') {
    const ml = Math.round(o.ml)
    if (!(ml > 0 && ml <= WATER_MAX_ML)) throw new Error(`Water: between 1 and ${WATER_MAX_ML} ml`)
    const day = sportToday(now)
    const next = addWater(sportState(db) ?? defaultSport(day), ml, day)
    const v = sharedView(saveSport(db, next, 'ben', { now }), day)
    return `💧 +${ml} ml · ${(v.water.ml / 1000).toFixed(1)} of ${(v.water.target / 1000).toFixed(1)} L today`
  }
  if (o.op === 'stake') {
    const due = readDue(o.due, now) ?? (Number.isFinite(Date.parse(o.due)) ? new Date(o.due).toISOString() : null)
    if (!due) throw new Error('When? e.g. 18:00 or tomorrow 9')
    editDesk(db, (x) => ({ ...x, stakes: addStake(x.stakes, o.text, due, o.points, now) }))
    return `Stake set: "${o.text}" by ${new Date(due).toTimeString().slice(0, 5)} or −${Math.round(o.points)} points`
  }
  if (o.op === 'keepStake') {
    editDesk(db, (x) => ({ ...x, stakes: keepStake(x.stakes, o.id, now) }))
    return 'Won it 💎'
  }
  if (o.op === 'dropStake') {
    editDesk(db, (x) => ({ ...x, stakes: x.stakes.filter((k) => !(k.id === o.id && k.status === 'open' && Date.parse(k.at) > now.getTime() - 10 * 60000)) }))
    return 'Removed (only within 10 minutes of setting it)'
  }
  if (o.op === 'study') {
    editDesk(db, (x) => ({ ...x, study: addTopic(x.study, o.exam, o.topic, today, o.examDay ?? s.focus.state(now).goals.find((g) => g.title.toLowerCase().includes(o.exam.toLowerCase()))?.deadline ?? null) }))
    return `Study topic added: ${o.exam} · ${o.topic} (first review tomorrow)`
  }
  if (o.op === 'reviewed') {
    editDesk(db, (x) => ({ ...x, study: reviewTopic(x.study, o.id, today) }))
    return 'Reviewed ✓'
  }
  if (o.op === 'dropStudy') {
    editDesk(db, (x) => ({ ...x, study: x.study.filter((t) => t.id !== o.id) }))
    return 'Removed'
  }
  if (o.op === 'stack') {
    const st = parseStack(o.text, today)
    if (!st) throw new Error('Write it like: after coffee → 10 pushups → plan review')
    editDesk(db, (x) => ({ ...x, stacks: [...x.stacks, st].slice(-8) }))
    return `Habit stack: after ${st.cue} → ${st.steps.join(' → ')}`
  }
  if (o.op === 'tickStack') {
    editDesk(db, (x) => ({ ...x, stacks: x.stacks.map((k) => (k.id === o.id ? tickStack(k, today, o.step) : k)) }))
    return 'Ticked'
  }
  if (o.op === 'dropStack') {
    editDesk(db, (x) => ({ ...x, stacks: x.stacks.filter((k) => k.id !== o.id) }))
    return 'Removed'
  }
  if (o.op === 'call') {
    const dow = now.getDay()
    const week = addDays(today, -((dow + 6) % 7) - (dow === 1 && now.getHours() < 12 ? 7 : 0))
    const call: CoachCall = { week, at: now.toISOString(), answers: o.answers }
    editDesk(db, (x) => ({ ...x, calls: [...x.calls.filter((c) => c.week !== week), call].slice(-26) }))
    try {
      const notes = listNotes(db as any)
      const prev = notes.find((n) => n.title === 'Weekly reviews')
      saveNote(db as any, { id: prev?.id, title: 'Weekly reviews', body: `${prev?.body?.trim() || '# Weekly reviews\n\nYour Sunday calls with Ben.'}\n\n${callNote(call)}\n` }, now)
    } catch {
      /* notes table not ready */
    }
    return 'Coach call saved: next week is set'
  }
  editDesk(db, (x) => ({ ...x, letters: { ...x.letters, [o.month]: o.text.slice(0, 3000) } }))
  return 'Letter saved'
}

/**
 * Ben's desk actions (from his "actions"):
 *   "stake: <what> | <when: 18:00, tomorrow 9> | <points>"
 *   "study: <exam> | <topic>"   "reviewed: <topic>"
 *   "stack: after coffee → 10 pushups → plan review"
 *   "mood: 1-5"
 */
export function readDeskOp(line: string, desk?: Desk): DeskOp | null {
  const m = /^\s*(stake|study|reviewed|stack|mood)\s*:\s*([\s\S]+)$/i.exec(String(line ?? ''))
  if (!m) return null
  const kind = m[1].toLowerCase()
  const arg = m[2].trim().slice(0, 300)
  const parts = arg.split('|').map((x) => x.trim())
  if (kind === 'stake') {
    const points = Math.round(Number(parts[2] ?? 50))
    return parts[0] && parts[1] && points > 0 ? { op: 'stake', text: parts[0].slice(0, 120), due: parts[1], points: Math.min(500, points) } : null
  }
  if (kind === 'study') return parts[0] && parts[1] ? { op: 'study', exam: parts[0], topic: parts[1] } : null
  if (kind === 'reviewed') {
    const want = arg.toLowerCase()
    const t = desk?.study.find((x) => x.topic.toLowerCase().includes(want) || want.includes(x.topic.toLowerCase()))
    return t ? { op: 'reviewed', id: t.id } : null
  }
  if (kind === 'stack') return { op: 'stack', text: arg }
  const mood = Math.round(Number(arg.match(/[1-5]/)?.[0]))
  return mood >= 1 && mood <= 5 ? { op: 'mood', mood } : null
}
