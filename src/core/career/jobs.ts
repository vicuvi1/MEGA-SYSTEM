// The job-hunt pipeline with a weekly quota (CR1). Pure and tested.
//
// A board for internships and junior jobs: found → applied → interview →
// offer, or no. Moving a card stamps the day and sets the next follow-up
// (a week after applying, 2 days after an interview, 3 after an offer). The
// week runs Monday to Sunday; the quota is applications sent this week.
import { addDays, daysBetween } from '../dates'

export type Stage = 'found' | 'applied' | 'interview' | 'offer' | 'no'
export const STAGES: Stage[] = ['found', 'applied', 'interview', 'offer', 'no']
export const STAGE_LABEL: Record<Stage, string> = { found: 'Found', applied: 'Applied', interview: 'Interview', offer: 'Offer', no: 'No' }

export interface Job {
  id: string
  company: string
  role: string
  link: string | null
  stage: Stage
  added: string
  applied: string | null
  /** The day to follow up (or null: nothing to chase). */
  followUp: string | null
  /** Follow-ups already sent for this stage. */
  chased: number
  notes: string
  moves: { stage: Stage; day: string }[]
}

export interface JobsBook {
  /** Applications to send each week. */
  quota: number
  jobs: Job[]
}

export const DEFAULT_QUOTA = 3
/** Days after a move until Ben asks you to follow up. */
export const FOLLOW_UP_DAYS: Partial<Record<Stage, number>> = { applied: 7, interview: 2, offer: 3 }

/** The Monday of a day's week. */
export function mondayOf(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay()
  return addDays(day, -((dow + 6) % 7))
}

const cleanLink = (x: unknown): string | null => (typeof x === 'string' && /^https?:\/\/\S{3,}$/i.test(x.trim()) ? x.trim().slice(0, 300) : null)

export function addJob(book: JobsBook, j: { company: string; role: string; link?: string | null; stage?: Stage; notes?: string }, today: string, id: string): JobsBook {
  const company = j.company.trim().slice(0, 80)
  const role = j.role.trim().slice(0, 80)
  if (!company && !role) return book
  const stage = j.stage && STAGES.includes(j.stage) ? j.stage : 'found'
  let job: Job = { id, company: company || 'Unknown company', role: role || 'Role', link: cleanLink(j.link), stage: 'found', added: today, applied: null, followUp: null, chased: 0, notes: (j.notes ?? '').slice(0, 500), moves: [{ stage: 'found', day: today }] }
  if (stage !== 'found') job = moved(job, stage, today)
  return { ...book, jobs: [job, ...book.jobs] }
}

function moved(j: Job, stage: Stage, today: string): Job {
  const wait = FOLLOW_UP_DAYS[stage]
  return {
    ...j,
    stage,
    applied: j.applied ?? (stage === 'applied' || stage === 'interview' || stage === 'offer' ? today : null),
    followUp: wait ? addDays(today, wait) : null,
    chased: 0,
    moves: [...j.moves, { stage, day: today }].slice(-12)
  }
}

export function moveJob(book: JobsBook, id: string, stage: Stage, today: string): JobsBook {
  if (!STAGES.includes(stage)) return book
  return { ...book, jobs: book.jobs.map((j) => (j.id === id && j.stage !== stage ? moved(j, stage, today) : j)) }
}

export function editJob(book: JobsBook, id: string, patch: Partial<Pick<Job, 'company' | 'role' | 'link' | 'notes'>>): JobsBook {
  return {
    ...book,
    jobs: book.jobs.map((j) =>
      j.id === id
        ? { ...j, ...(patch.company != null ? { company: patch.company.slice(0, 80) } : {}), ...(patch.role != null ? { role: patch.role.slice(0, 80) } : {}), ...(patch.link !== undefined ? { link: cleanLink(patch.link) } : {}), ...(patch.notes != null ? { notes: patch.notes.slice(0, 500) } : {}) }
        : j
    )
  }
}

export const removeJob = (book: JobsBook, id: string): JobsBook => ({ ...book, jobs: book.jobs.filter((j) => j.id !== id) })

/** You followed up: one more nudge a week later, then it stops (two chases is enough). */
export function followedUp(book: JobsBook, id: string, today: string): JobsBook {
  return { ...book, jobs: book.jobs.map((j) => (j.id === id ? { ...j, chased: j.chased + 1, followUp: j.chased + 1 >= 2 ? null : addDays(today, 7) } : j)) }
}

export function snoozeFollowUp(book: JobsBook, id: string, today: string, days = 3): JobsBook {
  return { ...book, jobs: book.jobs.map((j) => (j.id === id && j.followUp ? { ...j, followUp: addDays(today, days) } : j)) }
}

export const isOpen = (j: Job) => j.stage === 'applied' || j.stage === 'interview' || j.stage === 'offer'

export function followUpsDue(book: JobsBook, today: string): Job[] {
  return book.jobs.filter((j) => isOpen(j) && j.followUp && j.followUp <= today).sort((a, b) => (a.followUp ?? '').localeCompare(b.followUp ?? ''))
}

export interface WeekStats {
  monday: string
  sent: number
  quota: number
  left: number
  /** Days left in the week, today included. */
  daysLeft: number
  /** Where you should be by today at an even pace. */
  paceNow: number
  onPace: boolean
  /** Weeks in a row (before this one) that made the quota. */
  streak: number
  /** The last 8 weeks, oldest first (this week last). */
  history: { monday: string; sent: number }[]
}

export function appliedIn(book: JobsBook, from: string, to: string): number {
  return book.jobs.filter((j) => j.applied && j.applied >= from && j.applied <= to).length
}

export function weekStats(book: JobsBook, today: string): WeekStats {
  const monday = mondayOf(today)
  const quota = Math.max(0, book.quota)
  const sent = appliedIn(book, monday, addDays(monday, 6))
  const elapsed = daysBetween(monday, today) + 1
  const paceNow = Math.ceil((quota * elapsed) / 7)
  const history = Array.from({ length: 8 }, (_, i) => {
    const m = addDays(monday, -7 * (7 - i))
    return { monday: m, sent: appliedIn(book, m, addDays(m, 6)) }
  })
  let streak = 0
  for (let i = history.length - 2; i >= 0 && quota > 0 && history[i].sent >= quota; i--) streak++
  return { monday, sent, quota, left: Math.max(0, quota - sent), daysLeft: 8 - elapsed, paceNow, onPace: sent >= paceNow, streak, history }
}

export interface Funnel {
  applied: number
  interviews: number
  offers: number
  /** Interviews per application (0–1), null before any application. */
  responseRate: number | null
  counts: Record<Stage, number>
}

export function funnel(book: JobsBook): Funnel {
  const reached = (j: Job, s: Stage) => j.moves.some((m) => m.stage === s) || j.stage === s
  const applied = book.jobs.filter((j) => j.applied).length
  const interviews = book.jobs.filter((j) => reached(j, 'interview') || reached(j, 'offer')).length
  const counts = Object.fromEntries(STAGES.map((s) => [s, book.jobs.filter((j) => j.stage === s).length])) as Record<Stage, number>
  return { applied, interviews, offers: book.jobs.filter((j) => reached(j, 'offer')).length, responseRate: applied ? Math.round((interviews / applied) * 100) / 100 : null, counts }
}

/** One line for Ben's context and the Sunday check. */
export function jobsLine(book: JobsBook, today: string): string {
  if (!book.jobs.length && !book.quota) return ''
  const w = weekStats(book, today)
  const due = followUpsDue(book, today)
  const f = funnel(book)
  return [
    `Job hunt: ${w.sent} of ${w.quota} applications this week${w.left ? ` (${w.left} to go, ${w.daysLeft} day${w.daysLeft === 1 ? '' : 's'} left)` : ' ✓'}`,
    `${f.counts.interview} interview${f.counts.interview === 1 ? '' : 's'} open`,
    f.counts.offer ? `${f.counts.offer} offer${f.counts.offer === 1 ? '' : 's'}` : '',
    due.length ? `follow up: ${due.slice(0, 3).map((j) => j.company).join(', ')}` : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

export function cleanJobs(raw: unknown): JobsBook {
  const o = (raw && typeof raw === 'object' ? raw : {}) as any
  const day = /^\d{4}-\d{2}-\d{2}$/
  const jobs: Job[] = (Array.isArray(o.jobs) ? o.jobs : [])
    .filter((j: any) => j && typeof j.id === 'string' && STAGES.includes(j.stage) && day.test(j.added))
    .map((j: any) => ({
      id: j.id.slice(0, 40),
      company: String(j.company ?? '').slice(0, 80),
      role: String(j.role ?? '').slice(0, 80),
      link: cleanLink(j.link),
      stage: j.stage,
      added: j.added,
      applied: day.test(j.applied) ? j.applied : null,
      followUp: day.test(j.followUp) ? j.followUp : null,
      chased: Number.isFinite(j.chased) ? Math.max(0, Math.round(j.chased)) : 0,
      notes: String(j.notes ?? '').slice(0, 500),
      moves: (Array.isArray(j.moves) ? j.moves : []).filter((m: any) => m && STAGES.includes(m.stage) && day.test(m.day)).slice(-12)
    }))
    .slice(0, 400)
  const q = Number(o.quota)
  return { quota: Number.isFinite(q) ? Math.max(0, Math.min(30, Math.round(q))) : DEFAULT_QUOTA, jobs }
}
