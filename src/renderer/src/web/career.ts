// Career (CR1–CR5, CR12–CR14, CR19, CR20) on the browser's copy of the
// database: the job board, the portfolio, flashcards, essays, the shift
// study kit, the money plan and the monthly letters. Everything is kept in
// synced settings (career_*), so every device, the server's tick and Ben see
// the same thing. No points are paid here: focus time pays for study.
// No browser-only code at the top level: the server's bot bundle uses this too.
import { addDays } from '@core/dates'
import { addJob, cleanJobs, editJob, followedUp, followUpsDue, funnel, jobsLine, mondayOf, moveJob, removeJob, snoozeFollowUp, weekStats, type Job, type JobsBook, type Stage } from '@core/career/jobs'
import { cleanPortfolio, fromLearn, makeProof, skillCounts, type Proof, type ProofKind } from '@core/career/portfolio'
import { cardPrompt, cleanCards, cleanMarks, deckStats, dueCards, grade, newCard, newSeenToday, parseCards, type Card, type Grade, type ReviewMark } from '@core/career/srs'
import { behindFlags, cleanEssays, essaysLine, essayStatus, planEssay, replan, stepsToday, tickStep, type Essay } from '@core/career/essays'
import { buildPack, cleanQueue, inShift, packsDone, PACK_SUBJECT, type Pack, type QueueItem, type QueueKind } from '@core/career/studyPack'
import { answerPay, careerFund, cleanAnswers, cleanPlan, cleanSpends, emergencyFund, incomeView, moneyPlanLine, payAsks, payStreak, projection, type MoneyPlan, type PayAnswer, type CareerSpend } from '@core/career/money'
import { careerLetter, cleanLetters, letterDue, type CareerLetter, type CareerMonthFacts } from '@core/career/letter'
import { workToday } from '@core/lifeFit'
import { getSetting, setSetting } from '../../../main/settings'
import { loadLearn } from './extrasContext'
import { readLifeFit } from './lifeFitStore'
import type { Services, WebServices } from './webServices'

export const CAREER_JOBS = 'career_jobs'
export const CAREER_PROOFS = 'career_proofs'
export const CAREER_CARDS = 'career_cards'
export const CAREER_STUDY = 'career_study'
export const CAREER_MONEY = 'career_money'
export const CAREER_LETTERS = 'career_letters'
/** The server tick's once-a-day marks (follow-ups, packs, pay asks, essay flags). */
export const CAREER_ASKS = 'career_asks'

const json = (db: any, key: string): any => {
  try {
    return JSON.parse(getSetting(db, key) || 'null')
  } catch {
    return null
  }
}
const put = (db: any, key: string, v: unknown) => setSetting(db, key, JSON.stringify(v))
export const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export interface CardBook {
  cards: Card[]
  log: ReviewMark[]
}
export interface StudyBook {
  essays: Essay[]
  queue: QueueItem[]
  /** Which queue item the next pack starts from. */
  turn: number
}
export interface MoneyBook {
  plan: MoneyPlan
  answers: PayAnswer[]
  spends: CareerSpend[]
}

export const loadJobs = (db: any): JobsBook => cleanJobs(json(db, CAREER_JOBS))
export const loadProofs = (db: any): Proof[] => cleanPortfolio(json(db, CAREER_PROOFS))
export const loadCards = (db: any): CardBook => {
  const o = json(db, CAREER_CARDS) ?? {}
  return { cards: cleanCards(o.cards), log: cleanMarks(o.log) }
}
export const loadStudy = (db: any): StudyBook => {
  const o = json(db, CAREER_STUDY) ?? {}
  return { essays: cleanEssays(o.essays), queue: cleanQueue(o.queue), turn: Number.isFinite(o.turn) ? Math.max(0, Math.round(o.turn)) % 1000 : 0 }
}
export const loadMoney = (db: any): MoneyBook => {
  const o = json(db, CAREER_MONEY) ?? {}
  return { plan: cleanPlan(o.plan), answers: cleanAnswers(o.answers), spends: cleanSpends(o.spends) }
}
export const loadLetters = (db: any): CareerLetter[] => cleanLetters(json(db, CAREER_LETTERS))

/** Focus subjects that count as career work (school study is counted elsewhere). */
export const CAREER_SUBJECT = /ctf|rust|crypto|cyber|secur|pentest|hack|lab\b|portfolio|writeup|job|career|\bcv\b|interview|study pack|certif|linux|network/i

export function focusSessions(db: any, from: string, to: string): { day: string; subject: string; minutes: number }[] {
  try {
    return db.prepare('SELECT day, subject, minutes FROM focus_sessions WHERE day >= ? AND day <= ?').all(from, to) as { day: string; subject: string; minutes: number }[]
  } catch {
    return []
  }
}
export const careerMinutes = (sessions: { subject: string; minutes: number }[]) => sessions.filter((s) => CAREER_SUBJECT.test(s.subject)).reduce((t, s) => t + s.minutes, 0)

const monthEnd = (month: string) => addDays(`${month}-01`, new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate() - 1)

export interface MoneyView {
  plan: MoneyPlan
  ef: ReturnType<typeof emergencyFund>
  asks: ReturnType<typeof payAsks>
  streak: ReturnType<typeof payStreak>
  fund: ReturnType<typeof careerFund>
  spends: CareerSpend[]
  income: ReturnType<typeof incomeView>
  projection: ReturnType<typeof projection>
}

export function moneyView(db: any, finance: any, today: string): MoneyView {
  const m = loadMoney(db)
  const fund = careerFund(m.plan, m.answers, m.spends)
  const streak = payStreak(m.answers)
  return {
    plan: m.plan,
    ef: emergencyFund(m.plan, finance, today, fund, streak.total),
    asks: payAsks(finance, m.answers, today, m.plan.payPct),
    streak,
    fund,
    spends: m.spends,
    income: incomeView(finance, today, m.plan.incomeTarget),
    projection: projection(m.plan.investMonthly, m.plan.investRate, m.plan.investYears)
  }
}

export interface StudyView {
  essays: { essay: Essay; status: ReturnType<typeof essayStatus> }[]
  queue: QueueItem[]
  pack: Pack
  /** Tonight's work window, when there is one. */
  shift: { from: string; to: string; mode: string; now: boolean } | null
  packsWeek: { count: number; minutes: number }
}

export function studyView(db: any, today: string, now: Date, due: number): StudyView {
  const st = loadStudy(db)
  const w = workToday(readLifeFit(db), today)
  const nowMin = now.getHours() * 60 + now.getMinutes()
  return {
    essays: st.essays.map((essay) => ({ essay, status: essayStatus(essay, today) })).sort((a, b) => Number(a.status.state === 'done') - Number(b.status.state === 'done') || a.essay.due.localeCompare(b.essay.due)),
    queue: st.queue,
    pack: buildPack({ dueCards: due, queue: st.queue, essaySteps: stepsToday(st.essays, today).map((x) => ({ title: x.essay.title, kind: x.step.kind, ref: x.step.id })), minutes: 20, turn: st.turn }),
    shift: w ? { from: w.from, to: w.to, mode: w.mode, now: inShift(w, nowMin) } : null,
    packsWeek: packsDone(focusSessions(db, mondayOf(today), today), mondayOf(today), today)
  }
}

export interface CareerView {
  today: string
  jobs: JobsBook
  week: ReturnType<typeof weekStats>
  funnel: ReturnType<typeof funnel>
  followUps: Job[]
  proofs: Proof[]
  skills: { skill: string; n: number }[]
  drafts: ReturnType<typeof fromLearn>
  cards: { stats: ReturnType<typeof deckStats>; queue: Card[]; decks: string[] }
  study: StudyView
  money: MoneyView
  letters: CareerLetter[]
  letterDue: string | null
  hours: { week: number; month: number }
}

export function careerView(s: Services, finance: any, now = new Date()): CareerView {
  const db = s.db
  const today = s.wallet.today(now)
  const jobs = loadJobs(db)
  const proofs = loadProofs(db)
  const cb = loadCards(db)
  const seen = newSeenToday(cb.log, today)
  const queue = dueCards(cb.cards, today, { newSeen: seen })
  const stats = deckStats(cb.cards, cb.log, today, seen)
  const month = focusSessions(db, `${today.slice(0, 7)}-01`, today)
  const letters = loadLetters(db)
  return {
    today,
    jobs,
    week: weekStats(jobs, today),
    funnel: funnel(jobs),
    followUps: followUpsDue(jobs, today),
    proofs: [...proofs].sort((a, b) => b.day.localeCompare(a.day)),
    skills: skillCounts(proofs),
    drafts: fromLearn(loadLearn(db), proofs),
    cards: { stats, queue, decks: [...new Set(cb.cards.map((c) => c.deck))].sort() },
    study: studyView(db, today, now, queue.length),
    money: moneyView(db, finance, today),
    letters,
    letterDue: letterDue(letters, today),
    hours: { week: careerMinutes(focusSessions(db, mondayOf(today), today)), month: careerMinutes(month) }
  }
}

/** The numbers behind one month's letter. */
export function monthFacts(db: any, finance: any, month: string, today: string): CareerMonthFacts {
  const from = `${month}-01`
  const to = monthEnd(month)
  const jobs = loadJobs(db)
  const inMonth = (d: string | null | undefined) => !!d && d >= from && d <= to
  const proofs = loadProofs(db)
  const before = new Set(proofs.filter((p) => p.day < from).flatMap((p) => p.skills.map((x) => x.toLowerCase())))
  const mine = proofs.filter((p) => inMonth(p.day))
  const newSkills = [...new Set(mine.flatMap((p) => p.skills).filter((x) => !before.has(x.toLowerCase())))]
  const log = loadCards(db).log.filter((m) => inMonth(m.day))
  const sessions = focusSessions(db, from, to)
  const study = loadStudy(db)
  const m = moneyView(db, finance, to < today ? to : today)
  const inc = incomeView(finance, to < today ? to : today, m.plan.incomeTarget)
  return {
    month,
    applied: jobs.jobs.filter((j) => inMonth(j.applied)).length,
    quota: jobs.quota,
    interviews: jobs.jobs.filter((j) => j.moves.some((x) => x.stage === 'interview' && inMonth(x.day))).length,
    offers: jobs.jobs.filter((j) => j.moves.some((x) => x.stage === 'offer' && inMonth(x.day))).length,
    proofs: mine.map((p) => ({ title: p.title, kind: p.kind })),
    newSkills,
    cardsReviewed: log.length,
    retention: log.length >= 10 ? Math.round((log.filter((x) => x.grade !== 'again').length / log.length) * 100) / 100 : null,
    careerMinutes: careerMinutes(sessions),
    packs: packsDone(sessions, from, to).count,
    income: inc.total,
    incomeTarget: m.plan.incomeTarget,
    efPct: m.ef.pct,
    payStreak: m.streak.now,
    essaysDone: study.essays.filter((e) => inMonth(e.due) && e.steps.every((x) => x.done)).length,
    essaysLate: study.essays.filter((e) => inMonth(e.due) && e.due < today && !e.steps.every((x) => x.done)).length
  }
}

/** Writes (or rewrites) a month's letter and keeps it. */
export function writeLetter(db: any, finance: any, month: string, today: string): CareerLetter {
  const l = careerLetter(monthFacts(db, finance, month, today), today)
  put(db, CAREER_LETTERS, [l, ...loadLetters(db).filter((x) => x.month !== month)].slice(0, 24))
  return l
}

/** What Ben reads about your career (only lines that have something). */
export function careerContext(db: any, today: string, finance: any): string[] {
  try {
    const out: string[] = []
    out.push(jobsLine(loadJobs(db), today))
    const st = loadStudy(db)
    out.push(essaysLine(st.essays, today))
    const flags = behindFlags(st.essays, today)
    if (flags.length) out.push(`Behind on: ${flags.join('; ')}. Say it early and offer to replan.`)
    const cb = loadCards(db)
    const due = dueCards(cb.cards, today, { newSeen: newSeenToday(cb.log, today) }).length
    if (cb.cards.length) out.push(`Flashcards: ${due} due today of ${cb.cards.length}.`)
    const m = moneyView(db, finance, today)
    out.push(moneyPlanLine(m.plan, m.ef, m.streak, m.income, m.fund, m.asks.length))
    return out.filter(Boolean)
  } catch {
    return []
  }
}

/** One line for the Sunday review. */
export function careerWeekLine(db: any, today: string): string {
  try {
    const jobs = loadJobs(db)
    const w = weekStats(jobs, today)
    const proofs = loadProofs(db).filter((p) => p.day >= w.monday).length
    const packs = packsDone(focusSessions(db, w.monday, today), w.monday, today)
    if (!jobs.jobs.length && !proofs && !packs.count) return ''
    return `💼 Career this week: ${w.sent} of ${w.quota} applications${w.sent >= w.quota && w.quota ? ' ✓' : ''}, ${proofs} portfolio entr${proofs === 1 ? 'y' : 'ies'}, ${packs.count} shift pack${packs.count === 1 ? '' : 's'} (${packs.minutes} min)${followUpsDue(jobs, today).length ? `, ${followUpsDue(jobs, today).length} follow-up(s) waiting` : ''}`
  } catch {
    return ''
  }
}

/** Grades one card (the page, the island and Telegram all come here). */
export function gradeCard(db: any, id: string, g: Grade, today: string): Card | null {
  const cb = loadCards(db)
  const c = cb.cards.find((x) => x.id === id)
  if (!c) return null
  const next = grade(c, g, today)
  put(db, CAREER_CARDS, { cards: cb.cards.map((x) => (x.id === id ? next : x)), log: [...cb.log, { day: today, id, grade: g }].slice(-1500) })
  return next
}

/** The next card to review today (for the island and Telegram). */
export function nextCard(db: any, today: string, skip: string[] = []): { card: Card; left: number } | null {
  const cb = loadCards(db)
  const q = dueCards(cb.cards, today, { newSeen: newSeenToday(cb.log, today) }).filter((c) => !skip.includes(c.id))
  return q.length ? { card: q[0], left: q.length } : null
}

export function saveJobs(db: any, b: JobsBook) {
  put(db, CAREER_JOBS, b)
}

// ------------------------------------------------------------- the API

/** What the app calls (life.career), on the services once they're ready. */
export function createCareer(svcP: Promise<WebServices>, finance: (db: any) => any, ask?: (prompt: string) => Promise<{ text: string }>) {
  const fin = (s: Services) => finance(s.db)
  const read = async <T>(fn: (s: Services) => T) => (await svcP).read(fn)
  const C = 'life-career-changed'
  const write = async <T>(fn: (s: Services) => T, ...events: string[]) => (await svcP).write(fn, C, ...events)
  const view = (s: Services) => careerView(s, fin(s))
  const today = (s: Services) => s.wallet.today()
  const jobs = (fn: (b: JobsBook, day: string) => JobsBook) => write((s) => (saveJobs(s.db, fn(loadJobs(s.db), today(s))), view(s)))
  const proofs = (fn: (l: Proof[], day: string) => Proof[]) => write((s) => (put(s.db, CAREER_PROOFS, fn(loadProofs(s.db), today(s)).slice(0, 500)), view(s)))
  const cards = (fn: (b: CardBook, day: string) => CardBook) => write((s) => (put(s.db, CAREER_CARDS, fn(loadCards(s.db), today(s))), view(s)))
  const study = (fn: (b: StudyBook, day: string) => StudyBook) => write((s) => (put(s.db, CAREER_STUDY, fn(loadStudy(s.db), today(s))), view(s)))
  const money = (fn: (b: MoneyBook, day: string) => MoneyBook) => write((s) => (put(s.db, CAREER_MONEY, fn(loadMoney(s.db), today(s))), view(s)))
  return {
    view: () => read(view),
    // CR1: the job board
    setQuota: (n: number) => jobs((b) => ({ ...b, quota: Math.max(0, Math.min(30, Math.round(n))) })),
    addJob: (j: { company: string; role: string; link?: string | null; stage?: Stage; notes?: string }) => jobs((b, d) => addJob(b, j, d, newId('j'))),
    moveJob: (id: string, stage: Stage) => jobs((b, d) => moveJob(b, id, stage, d)),
    editJob: (id: string, patch: Partial<Pick<Job, 'company' | 'role' | 'link' | 'notes'>>) => jobs((b) => editJob(b, id, patch)),
    removeJob: (id: string) => jobs((b) => removeJob(b, id)),
    followedUp: (id: string) => jobs((b, d) => followedUp(b, id, d)),
    snooze: (id: string, days = 3) => jobs((b, d) => snoozeFollowUp(b, id, d, days)),
    // CR2: the portfolio
    addProof: (p: { kind: ProofKind; title: string; problem?: string; did?: string; skills?: string; link?: string | null; pub?: boolean; from?: string }) =>
      proofs((l, d) => {
        const x = makeProof(p, d, newId('p'))
        return x ? [x, ...l] : l
      }),
    editProof: (id: string, patch: Partial<Omit<Proof, 'id'>> & { skillsText?: string }) =>
      proofs((l) =>
        l.map((p) => {
          if (p.id !== id) return p
          const x = makeProof({ kind: patch.kind ?? p.kind, title: patch.title ?? p.title, problem: patch.problem ?? p.problem, did: patch.did ?? p.did, skills: patch.skillsText ?? patch.skills ?? p.skills, link: patch.link !== undefined ? patch.link : p.link, pub: patch.pub ?? p.pub, from: p.from }, p.day, p.id)
          return x ?? p
        })
      ),
    removeProof: (id: string) => proofs((l) => l.filter((p) => p.id !== id)),
    // CR4: flashcards
    addCards: (list: { front: string; back: string }[], deck: string, src?: string) =>
      cards((b, d) => {
        const have = new Set(b.cards.map((c) => `${c.deck}|${c.front.toLowerCase()}`))
        const fresh = list.filter((c) => !have.has(`${deck.trim() || 'General'}|${c.front.trim().toLowerCase()}`)).map((c, i) => newCard(c.front, c.back, deck, d, newId(`c${i}`), src))
        return { ...b, cards: [...b.cards, ...fresh].slice(-3000) }
      }),
    /** Ben drafts cards from a note or writeup (falls back to reading "front :: back" lines yourself). Nothing is saved until you add them. */
    draftCards: async (text: string, deck: string): Promise<{ cards: { front: string; back: string }[]; by: 'ben' | 'notes' }> => {
      const own = parseCards(text)
      if (ask) {
        try {
          const r = await ask(cardPrompt(text, deck))
          const got = parseCards(r.text, 15)
          if (got.length) return { cards: got, by: 'ben' }
        } catch {
          /* the notes' own lines */
        }
      }
      return { cards: own, by: 'notes' }
    },
    parseCards: async (text: string) => parseCards(text),
    grade: (id: string, g: Grade) => write((s) => (gradeCard(s.db, id, g, today(s)), view(s))),
    editCard: (id: string, patch: { front?: string; back?: string; deck?: string; off?: boolean }) =>
      cards((b) => ({ ...b, cards: b.cards.map((c) => (c.id === id ? { ...c, ...(patch.front ? { front: patch.front.slice(0, 300) } : {}), ...(patch.back ? { back: patch.back.slice(0, 600) } : {}), ...(patch.deck ? { deck: patch.deck.slice(0, 40) } : {}), ...(patch.off != null ? { off: patch.off } : {}) } : c)) })),
    removeCard: (id: string) => cards((b) => ({ ...b, cards: b.cards.filter((c) => c.id !== id) })),
    // CR12: essays and assignments
    addEssay: (e: { title: string; due: string; words: number }) => study((b, d) => ({ ...b, essays: [planEssay(e, d, newId('e')), ...b.essays].slice(0, 60) })),
    tickStep: (essayId: string, stepId: string, done: boolean) => study((b) => ({ ...b, essays: b.essays.map((e) => (e.id === essayId ? tickStep(e, stepId, done) : e)) })),
    replanEssay: (essayId: string) => study((b, d) => ({ ...b, essays: b.essays.map((e) => (e.id === essayId ? replan(e, d) : e)) })),
    removeEssay: (essayId: string) => study((b) => ({ ...b, essays: b.essays.filter((e) => e.id !== essayId) })),
    /** The Todoist tasks a plan's steps became ("send to my planner"). */
    setStepTasks: (essayId: string, tasks: Record<string, string>) => study((b) => ({ ...b, essays: b.essays.map((e) => (e.id === essayId ? { ...e, steps: e.steps.map((st) => (tasks[st.id] ? { ...st, taskId: tasks[st.id] } : st)) } : e)) })),
    // CR3: the study kit's queue and packs
    addQueue: (q: { kind: QueueKind; text: string; link?: string | null }) => study((b, d) => (q.text.trim() ? { ...b, queue: [...b.queue, { id: newId('q'), kind: q.kind, text: q.text.trim().slice(0, 160), link: q.link && /^https?:\/\//i.test(q.link) ? q.link.slice(0, 300) : null, done: false, added: d }].slice(-200) } : b)),
    doneQueue: (id: string, done = true) => study((b) => ({ ...b, queue: b.queue.map((q) => (q.id === id ? { ...q, done } : q)) })),
    removeQueue: (id: string) => study((b) => ({ ...b, queue: b.queue.filter((q) => q.id !== id) })),
    /** Another pack: the queue turns by one. */
    nextPack: () => study((b) => ({ ...b, turn: (b.turn + 1) % 1000 })),
    // CR5, CR13, CR14, CR19: the money plan
    savePlan: (patch: Partial<MoneyPlan>) => money((b) => ({ ...b, plan: cleanPlan({ ...b.plan, ...patch }) })),
    answerPay: (txId: string, day: string, moved: number) => money((b, d) => ({ ...b, answers: answerPay(b.answers, { txId, day }, moved, d) })),
    addSpend: (what: string, lei: number) => money((b, d) => (what.trim() && lei > 0 ? { ...b, spends: [...b.spends, { id: newId('s'), what: what.trim().slice(0, 80), lei: Math.round(lei), day: d }].slice(-100) } : b)),
    removeSpend: (id: string) => money((b) => ({ ...b, spends: b.spends.filter((x) => x.id !== id) })),
    // CR20: the monthly letter
    writeLetter: (month?: string) =>
      write((s) => {
        const d = today(s)
        writeLetter(s.db, fin(s), month ?? letterDue(loadLetters(s.db), d) ?? d.slice(0, 7), d)
        return view(s)
      })
  }
}
export type CareerApi = ReturnType<typeof createCareer>
export { PACK_SUBJECT }
