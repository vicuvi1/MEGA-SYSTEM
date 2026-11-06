// The app side of: your own habits (FT1), one goals list (FT3), life modes
// (FT4), the cyber security path (FT8), planned vs real time (FT10), the
// month review (FT11), your year (FT12), mood links (FT13) and rewards that
// unlock with a goal or streak (FT21). Each runs on the browser's copy of the
// database through the services, like every other section.
import { addDays, daysBetween } from '@core/dates'
import { blockSubject, isFocusBlock, localDay, type CalEvent } from '@core/dayTime'
import { LedgerError } from '@core/ledger'
import { cleanMind } from '@core/coachMind'
import { planGoal } from '@core/goalPlan'
import { goalsBoard, type BoardGoal, type WeekItem } from '@core/goalsBoard'
import { addHabit, HABIT_RULE, habitRef, habitRows, logHabit, missedYesterday, removeHabit, renameHabit, unlogHabit, isLogged, type HabitRow } from '@core/myHabits'
import { endMode, MODES, startMode, modeRules, type LifeMode, type ModeKind, type ModeRules } from '@core/lifeMode'
import { addLearn, learnLadders, nextSubject, removeLearn, type LearnTrack, type TrackView, type LearnEntry } from '@core/learnPath'
import { weekTime, type WeekTime } from '@core/plannedVsReal'
import { aimFor, compareMonths, monthArchive, setAim, shiftMonth, type ArchiveRow, type CompareRow } from '@core/monthReview'
import { yearRecap, type YearRecap } from '@core/yearRecap'
import { cleanUnlocks, setUnlock, unlockState, REWARD_UNLOCKS, type Unlock, type UnlockFacts, type UnlockState } from '@core/unlocks'
import { big3Of, monthStory, weekOf, type MonthStory } from '@core/benStakes'
import { moodLinks, type MoodLink } from '@core/benKnows'
import { cleanSet } from '@core/insights'
import { financeSpending } from '@core/progress'
import { getSetting, setSetting } from '../../../main/settings'
import { loadDesk } from './benDesk'
import { financeStateFrom } from './botBrain'
import { DAY_LOG } from './dayLog'
import { loadAims, loadHabits, loadLearn, loadModes, modeRest, saveAims, saveHabits, saveLearn, saveModes } from './extrasContext'
import type { Services, WebServices } from './webServices'
import type { CheckIn, GoalCard, GoalSource } from '@core/goals'
import { parseGoalText, type GoalDraft } from '@core/goalsText'
import { orderCards, starterGoals, type GoalMeta, type Starter } from '@core/goalKinds'
import { financeFromDb, type CheckInResult, type GoalInput } from '../../../main/goals'

const json = (db: any, key: string): any => {
  try {
    return JSON.parse(getSetting(db, key) || 'null')
  } catch {
    return null
  }
}
const all = <T>(db: any, sql: string, ...args: unknown[]): T[] => {
  try {
    return db.prepare(sql).all(...args) as T[]
  } catch {
    return []
  }
}

// ------------------------------------------------------------ habits (FT1)

export interface HabitsView {
  rows: HabitRow[]
  /** Never miss twice: names you missed yesterday. */
  missed: string[]
  /** What one tap pays (0 when the rule is off), and the daily cap. */
  pays: number
  cap: number
}

function restFor(s: Services, today: string): string[] {
  let stored: string[] = []
  try {
    stored = s.body.restDays()
  } catch {
    stored = []
  }
  return [...stored, ...modeRest(s.db, today)]
}

export function habitsView(s: Services, now = new Date()): HabitsView {
  const today = s.wallet.today(now)
  const b = loadHabits(s.db)
  const rest = restFor(s, today)
  const rule = (() => {
    try {
      return s.wallet.rule(HABIT_RULE)
    } catch {
      return null
    }
  })()
  return { rows: habitRows(b, today, rest), missed: missedYesterday(b, today, rest).map((h) => h.name), pays: rule?.enabled ? rule.coins : 0, cap: rule?.dailyCap ?? 0 }
}

/** One tap: logs it for today and pays the habit rule once (the daily cap still holds). */
export function tapHabit(s: Services, id: string, now = new Date()): { paid: number; view: HabitsView } {
  const today = s.wallet.today(now)
  const b = loadHabits(s.db)
  const h = b.habits.find((x) => x.id === id)
  if (!h) throw new LedgerError('That habit is gone')
  if (isLogged(b, id, today)) return { paid: 0, view: habitsView(s, now) }
  saveHabits(s.db, logHabit(b, id, today))
  const ledgerId = s.wallet.payOnce(HABIT_RULE, { day: today, ref: habitRef(id, today), note: h.name, now })
  const paid = ledgerId ? Number((s.db.prepare('SELECT coins FROM ledger WHERE id = ?').get(ledgerId) as any)?.coins ?? 0) : 0
  return { paid, view: habitsView(s, now) }
}

/** Taken back (a wrong tap): unlogged, and its points undone. */
export function untapHabit(s: Services, id: string, now = new Date()): HabitsView {
  const today = s.wallet.today(now)
  saveHabits(s.db, unlogHabit(loadHabits(s.db), id, today))
  const row = s.db.prepare('SELECT id FROM ledger WHERE ref = ? AND id NOT IN (SELECT undo_of FROM ledger WHERE undo_of IS NOT NULL) ORDER BY id DESC LIMIT 1').get(habitRef(id, today)) as { id: number } | undefined
  if (row) s.wallet.undo(row.id, 'Habit taken back', now)
  return habitsView(s, now)
}

export type HabitEdit = { op: 'add'; name: string } | { op: 'rename'; id: string; name: string } | { op: 'remove'; id: string }
export function editHabits(s: Services, e: HabitEdit, now = new Date()): HabitsView {
  const b = loadHabits(s.db)
  try {
    saveHabits(s.db, e.op === 'add' ? addHabit(b, e.name, now) : e.op === 'rename' ? renameHabit(b, e.id, e.name) : removeHabit(b, e.id))
  } catch (err) {
    throw new LedgerError((err as Error).message)
  }
  return habitsView(s, now)
}

// --------------------------------------------------------- life modes (FT4)

export interface ModeView {
  today: string
  current: (LifeMode & ModeRules & { dayN: number; days: number }) | null
  past: LifeMode[]
  modes: { kind: ModeKind; label: string; emoji: string; blurb: string; defaultDays: number }[]
}

export function modeView(s: Services, now = new Date()): ModeView {
  const today = s.wallet.today(now)
  const book = loadModes(s.db, today)
  const r = modeRules(book, today)
  return {
    today,
    current: r && book.current ? { ...book.current, ...r } : null,
    past: [...book.past].reverse().slice(0, 5),
    modes: (Object.keys(MODES) as ModeKind[]).map((kind) => ({ kind, label: MODES[kind].label, emoji: MODES[kind].emoji, blurb: MODES[kind].blurb, defaultDays: MODES[kind].defaultDays }))
  }
}

export function setMode(s: Services, kind: ModeKind | null, days = 0, now = new Date()): ModeView {
  const today = s.wallet.today(now)
  const book = loadModes(s.db, today)
  saveModes(s.db, kind ? startMode(book, kind, days || MODES[kind].defaultDays, today, now) : endMode(book, today))
  return modeView(s, now)
}

// ------------------------------------------------- goals + learning (FT3, FT8)

export interface GoalsView {
  today: string
  /** Measurable goals ("profit 5,000 lei by 31 Dec"), the ones needing you first. */
  measures: GoalCard[]
  /** Their check-ins of the last 30 days, newest first. */
  checkins: CheckIn[]
  /** Hour goals: their total hours (focus_goals id → hours), for the progress ring. */
  hourTotals: Record<number, number>
  goals: BoardGoal[]
  week: WeekItem[]
  learn: TrackView[]
  learnNext: { track: LearnTrack; subject: string; why: string } | null
  /** Three starter goals that fit the data you already have (the empty page). */
  starters: Starter[]
}

/** What the starter goals look at: workouts, focus, money, sleep and water of the last 30 days. */
function starterFacts(s: Services, today: string, finance?: any) {
  const from = addDays(today, -30)
  const one = (sql: string, ...args: unknown[]) => {
    try {
      return s.db.prepare(sql).get(...args) as any
    } catch {
      return null
    }
  }
  const top = one('SELECT subject, SUM(minutes) AS m FROM focus_sessions WHERE day >= ? GROUP BY lower(subject) ORDER BY m DESC LIMIT 1', from)
  const fin = finance ?? financeFromDb(s.db)
  return {
    today,
    workouts30: Number(one('SELECT COUNT(*) AS n FROM workouts WHERE day >= ?', from)?.n ?? 0),
    focusTop: top?.subject ? { subject: String(top.subject), hours: Number(top.m) / 60 } : null,
    finance: !!(fin && Array.isArray(fin.tx) && fin.tx.length),
    sleepLogs30: Number(one('SELECT COUNT(*) AS n FROM sleep_logs WHERE day >= ?', from)?.n ?? 0),
    waterDays30: Number(one("SELECT COUNT(DISTINCT day) AS n FROM body_log WHERE kind = 'water' AND day >= ?", from)?.n ?? 0)
  }
}

export function goalsView(s: Services, events: CalEvent[] = [], now = new Date(), finance?: any): GoalsView {
  const today = s.wallet.today(now)
  const measures = orderCards(s.goals.cards(now, finance, { paused: true }))
  const checkins = s.goals.recent(30, now)
  const f = s.focus.state(now)
  const plans = f.goals.map((g) => planGoal(g, today, f.todaySessions.filter((x) => x.subject.toLowerCase() === g.subject.toLowerCase()).reduce((t, x) => t + x.minutes, 0)))
  const mind = cleanMind(json(s.db, 'coach_mind'))
  let weekPlan: { text: string; done: boolean }[] = []
  try {
    weekPlan = s.weekPlan.active()?.big3 ?? []
  } catch {
    weekPlan = []
  }
  const desk = loadDesk(s.db)
  const call = [...desk.calls].reverse().find((c) => c.week >= weekOf(addDays(today, -6)))
  const board = goalsBoard({ today, plans, aims: mind.goals, events, weekPlan, callBig3: call ? big3Of(call.answers?.big3 ?? '') : [] })
  const learn = loadLearn(s.db)
  const hourTotals = Object.fromEntries(f.goals.map((g) => [g.id, g.hours]))
  return { today, measures, checkins, hourTotals, ...board, learn: learnLadders(learn), learnNext: nextSubject(learn, today), starters: measures.length ? [] : starterGoals(starterFacts(s, today, finance)) }
}

export function addLearning(s: Services, e: { track: LearnTrack; title: string; tag?: string; link?: string | null }, now = new Date()): GoalsView {
  try {
    saveLearn(s.db, addLearn(loadLearn(s.db), e, s.wallet.today(now), now))
  } catch (err) {
    throw new LedgerError((err as Error).message)
  }
  return goalsView(s, [], now)
}

export function removeLearning(s: Services, id: string, now = new Date()): GoalsView {
  saveLearn(s.db, removeLearn(loadLearn(s.db), id))
  return goalsView(s, [], now)
}

export const learningLog = (s: Services): LearnEntry[] => loadLearn(s.db)

// ------------------------------------------------- planned vs real (FT10)

/** Calendar focus blocks (up to now) as planned time, with your done/skip marks. */
export function plannedBlocks(events: CalEvent[], marks: Record<string, Record<string, 'done' | 'skip'>>, now = new Date()) {
  return events
    .filter((e) => isFocusBlock(e) && Date.parse(e.start) <= now.getTime())
    .map((e) => {
      const day = localDay(e.start)
      return { day, subject: blockSubject(e.title), minutes: Math.max(0, (Date.parse(e.end) - Date.parse(e.start)) / 60000), mark: marks[day]?.[e.id] ?? null }
    })
    .filter((b) => b.minutes > 0 && b.minutes <= 600)
}

/** The week (Monday to Sunday) that holds `day`: planned blocks vs focus sessions vs PC work time. */
export function weekTimeFor(s: Services, events: CalEvent[], day?: string, now = new Date()): WeekTime {
  const today = s.wallet.today(now)
  const from = weekOf(day ?? today)
  const to = addDays(from, 6)
  const marks = json(s.db, 'block_marks') ?? {}
  const log = json(s.db, DAY_LOG) ?? {}
  const sessions = all<{ day: string; subject: string; minutes: number }>(s.db, 'SELECT day, subject, minutes FROM focus_sessions WHERE day >= ? AND day <= ?', from, to).map((r) => ({ day: String(r.day), subject: String(r.subject), minutes: Number(r.minutes) }))
  const pcLines = Object.entries<any>(log).filter(([d, v]) => d >= from && d <= to && typeof v?.pc === 'string').map(([d, v]) => ({ day: d, line: String(v.pc) }))
  return weekTime({ from, to, blocks: plannedBlocks(events, marks, now), sessions, pcLines })
}

// ------------------------------------------------------- mood links (FT13)

export interface MoodView {
  links: MoodLink[]
  /** Days with a mood check-in in the last 8 weeks, and how many it needs. */
  days: number
  need: number
}

function sleepRows(s: Services) {
  try {
    return s.sleep.logs().map((l) => ({ day: l.day, wake: l.wakeTime, bed: l.bedTime, onTime: !!l.onTime }))
  } catch {
    return []
  }
}

export function moodView(s: Services, finance: any, now = new Date()): MoodView {
  const today = s.wallet.today(now)
  const from = addDays(today, -56)
  const moods = loadDesk(s.db).moods.filter((m) => m.day >= from)
  const workouts = [...new Set(s.progress.input(null, now, 56).workouts.map((w) => w.day))]
  const spending = financeSpending(finance)?.filter((x) => x.day >= from) ?? null
  const links = moodLinks(moods, { sleep: sleepRows(s).filter((x) => x.day >= from), workouts, spending })
  return { links, days: new Set(moods.map((m) => m.day)).size, need: 6 }
}

/** The Sunday review's mood line (or ''). */
export function moodReviewLine(s: Services, finance: any, now = new Date()): string {
  const v = moodView(s, finance, now)
  const pick = v.links.filter((l) => l.id === 'sleep' || l.id === 'sport')
  return pick.length ? `🙂 ${pick.map((l) => l.text).join(' ')}` : ''
}

// -------------------------------------------------------- month review (FT11)

export interface MonthView {
  month: string
  now: MonthStory
  prev: MonthStory
  compare: CompareRow[]
  archive: ArchiveRow[]
  letter: string | null
  aim: string | null
  nextMonth: string
  nextLabel: string
  nextAim: string | null
}

function storyFor(s: Services, finance: any, month: string, today: string, data: ReturnType<typeof monthData>): MonthStory {
  return monthStory({ month, today, focus: data.focus, workouts: data.workouts, restDays: data.restDays, sleep: data.sleep, spent: data.spent, moods: data.moods, stakes: { kept: 0, lost: 0 }, promises: { kept: 0, missed: 0 } })
}

function monthData(s: Services, finance: any, from: string, now: Date) {
  const today = s.wallet.today(now)
  return {
    focus: all<{ day: string; minutes: number }>(s.db, 'SELECT day, minutes FROM focus_sessions WHERE day >= ?', from).map((r) => ({ day: String(r.day), minutes: Number(r.minutes) })),
    workouts: [...new Set(all<{ day: string }>(s.db, 'SELECT day FROM workouts WHERE day >= ?', from).map((r) => String(r.day)))],
    restDays: restFor(s, today),
    sleep: sleepRows(s).filter((x) => x.day >= from),
    spent: (financeSpending(finance) ?? []).filter((x) => x.day >= from),
    moods: loadDesk(s.db).moods.filter((m) => m.day >= from)
  }
}

export function monthView(s: Services, finance: any, now = new Date()): MonthView {
  const today = s.wallet.today(now)
  const month = today.slice(0, 7)
  const from = `${shiftMonth(month, -7)}-01`
  const data = monthData(s, finance, from, now)
  const stories = Array.from({ length: 7 }, (_, k) => storyFor(s, finance, shiftMonth(month, -k), today, data))
  const aims = loadAims(s.db)
  const letters = loadDesk(s.db).letters ?? {}
  const next = shiftMonth(month, 1)
  return {
    month,
    now: stories[0],
    prev: stories[1],
    compare: compareMonths(stories[0], stories[1]),
    archive: monthArchive(stories.slice(1), aims, letters),
    letter: letters[month] ?? null,
    aim: aimFor(aims, month)?.text ?? null,
    nextMonth: next,
    nextLabel: new Date(`${next}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' }),
    nextAim: aimFor(aims, next)?.text ?? null
  }
}

export function saveMonthAim(s: Services, month: string, text: string, finance: any, now = new Date()): MonthView {
  try {
    saveAims(s.db, setAim(loadAims(s.db), month, text, now))
  } catch (err) {
    throw new LedgerError((err as Error).message)
  }
  return monthView(s, finance, now)
}

// ---------------------------------------------------------- your year (FT12)

export function yearView(s: Services, finance: any, year?: number, now = new Date()): YearRecap & { years: number[] } {
  const today = s.wallet.today(now)
  const y = year ?? Number(today.slice(0, 4))
  const from = `${y}-01-01`
  const to = `${y}-12-31`
  const sessions = all<{ day: string; subject: string; minutes: number }>(s.db, 'SELECT day, subject, minutes FROM focus_sessions WHERE day >= ? AND day <= ?', from, to).map((r) => ({ day: String(r.day), subject: String(r.subject), minutes: Number(r.minutes) }))
  const input = s.progress.input(null, now, Math.max(366, daysBetween(from, today) + 1))
  const tx = Array.isArray(finance?.tx) ? finance.tx : null
  const money = tx
    ? tx.filter((t: any) => t && !t.deleted && typeof t.date === 'string' && (t.type === 'income' || t.type === 'expense')).map((t: any) => ({ day: t.date.slice(0, 10), bani: Math.abs(Number(t.base ?? t.amount) || 0), type: t.type }))
    : null
  const recap = yearRecap({
    year: y,
    today,
    sessions,
    workouts: input.workouts.map((w) => w.day),
    wakes: input.wakes,
    cleanDays: [...cleanSet(input.discipline, from, today < to ? today : to)],
    money,
    letters: loadDesk(s.db).letters ?? {}
  })
  const first = (all<{ d: string }>(s.db, 'SELECT MIN(day) AS d FROM focus_sessions')[0]?.d ?? today).slice(0, 4)
  const years: number[] = []
  for (let k = Number(today.slice(0, 4)); k >= Number(first) && years.length < 6; k--) years.push(k)
  return { ...recap, years }
}

// --------------------------------------------- rewards that unlock (FT21)

export function unlockFacts(s: Services, now = new Date()): UnlockFacts {
  const f = s.focus.state(now)
  let streaks: UnlockFacts['streaks'] = {}
  try {
    const ins = s.progress.insights(now)
    const cur = (id: string) => ins.streaks.find((x) => x.id === id)?.current ?? 0
    streaks = { focus: cur('focus'), clean: cur('clean'), wake: cur('wake') }
  } catch {
    streaks = {}
  }
  try {
    streaks.workout = s.body.state(now).streak
  } catch {
    /* no body data yet */
  }
  // Hour goals and measurable goals (a reward can unlock when either is reached).
  let measures: { id: number; title: string; done: boolean }[] = []
  try {
    measures = s.goals.goals().map((g) => ({ id: g.id, title: g.title, done: !!g.doneDay }))
  } catch {
    measures = []
  }
  return { goals: [...f.goals.map((g) => ({ id: g.id, title: g.title, done: g.hours * 60 - g.doneMin <= 0 })), ...measures], streaks }
}

export const loadUnlocks = (db: any): Record<string, Unlock> => cleanUnlocks(json(db, REWARD_UNLOCKS))

export interface UnlocksView {
  locks: Record<string, Unlock>
  states: Record<string, UnlockState>
  goals: { id: number; title: string; done: boolean }[]
}

export function unlocksView(s: Services, now = new Date()): UnlocksView {
  const locks = loadUnlocks(s.db)
  const facts = unlockFacts(s, now)
  return { locks, states: Object.fromEntries(Object.entries(locks).map(([id, u]) => [id, unlockState(u, facts)])), goals: facts.goals }
}

export function saveUnlock(s: Services, rewardId: number, u: Unlock | null, now = new Date()): UnlocksView {
  setSetting(s.db, REWARD_UNLOCKS, JSON.stringify(setUnlock(loadUnlocks(s.db), rewardId, u)))
  return unlocksView(s, now)
}

// ------------------------------------------------------------- the API

/** What the app calls (life.extras), on the services once they're ready. */
export function createExtras(svcP: Promise<WebServices>) {
  const fin = (s: Services) => financeStateFrom(s.db, typeof localStorage !== 'undefined' ? localStorage : null)
  const read = async <T>(fn: (s: Services) => T) => (await svcP).read(fn)
  const write = async <T>(fn: (s: Services) => T, ...events: string[]) => (await svcP).write(fn, ...events)
  const W = 'life-wallet-changed'
  const H = 'life-habits-changed'
  const M = 'life-mode-changed'
  const G = 'life-goals-changed'
  return {
    habits: () => read((s) => habitsView(s)),
    tapHabit: (id: string) => write((s) => tapHabit(s, id), W, H),
    untapHabit: (id: string) => write((s) => untapHabit(s, id), W, H),
    editHabits: (e: HabitEdit) => write((s) => editHabits(s, e), H),
    mode: () => read((s) => modeView(s)),
    setMode: (kind: ModeKind | null, days?: number) => write((s) => setMode(s, kind, days ?? 0), M, 'life-body-changed'),
    goals: (events: CalEvent[] = []) => read((s) => goalsView(s, events, new Date(), fin(s))),
    /** Measurable goals: save (a new one or an edit), check in, skip, archive, the auto number now, a draft from words. */
    saveMeasure: (g: GoalInput) => write((s) => s.goals.save(g, new Date(), fin(s)), G),
    goalCheckIn: (id: number, value: number, note?: string): Promise<CheckInResult> => write((s) => s.goals.checkIn(id, value, 'me', note ?? null), W, G),
    goalSkip: (id: number) => write((s) => s.goals.skip(id), G),
    archiveMeasure: (id: number) => write((s) => s.goals.archive(id), G),
    /** Kinds of goals: log a habit day or an amount, tick a step, change the extras, pause, pin, order, mark reached. */
    goalLog: (id: number, amount: number): Promise<CheckInResult> => write((s) => s.goals.logPeriod(id, amount), W, G),
    goalStep: (id: number, stepId: string): Promise<CheckInResult> => write((s) => s.goals.toggleStep(id, stepId), W, G),
    goalMeta: (id: number, patch: Partial<GoalMeta>) => write((s) => s.goals.setMeta(id, patch), G),
    goalPause: (id: number, paused: boolean) => write((s) => s.goals.setPaused(id, paused), G),
    goalPin: (id: number, pinned: boolean) => write((s) => s.goals.setPinned(id, pinned), G),
    goalReorder: (ids: number[]) => write((s) => s.goals.reorder(ids), G),
    goalDone: (id: number, done: boolean) => write((s) => s.goals.setDone(id, done), G),
    /** Rewards you can tie to a goal (read only: id, name, emoji, price). */
    goalRewards: () => read((s) => s.shop.state().rewards.filter((r) => !r.archived).map((r) => ({ id: r.id, title: r.title, emoji: r.emoji ?? null, price: r.price }))),
    syncGoals: () => write((s) => s.goals.syncAuto(new Date(), fin(s))),
    goalAutoValue: (source: GoalSource) => read((s) => s.goals.autoValue({ source, startDay: s.wallet.today() }, new Date(), fin(s))),
    parseGoal: (text: string): Promise<GoalDraft | null> => read((s) => parseGoalText(text, s.wallet.today())),
    addLearning: (e: { track: LearnTrack; title: string; tag?: string; link?: string | null }) => write((s) => addLearning(s, e)),
    removeLearning: (id: string) => write((s) => removeLearning(s, id)),
    weekTime: (events: CalEvent[], day?: string) => read((s) => weekTimeFor(s, events, day)),
    moods: () => read((s) => moodView(s, fin(s))),
    month: () => read((s) => monthView(s, fin(s))),
    setMonthAim: (month: string, text: string) => write((s) => saveMonthAim(s, month, text, fin(s))),
    year: (year?: number) => read((s) => yearView(s, fin(s), year)),
    unlocks: () => read((s) => unlocksView(s)),
    setUnlock: (rewardId: number, u: Unlock | null) => write((s) => saveUnlock(s, rewardId, u))
  }
}
export type ExtrasApi = ReturnType<typeof createExtras>
