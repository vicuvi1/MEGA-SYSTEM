// The monthly career review letter (CR20). Pure and tested.
//
// Once a month Ben writes a career-only review: applications sent, skills
// gained, portfolio entries, career hours, income against the target, and
// the ONE thing to change next month. Written from the numbers in code, so
// it never invents anything; it sits next to the month review but looks only
// at the future you're building.
export interface CareerMonthFacts {
  /** YYYY-MM. */
  month: string
  applied: number
  /** Weekly quota at the time. */
  quota: number
  interviews: number
  offers: number
  proofs: { title: string; kind: string }[]
  /** Skills first seen in this month's portfolio entries. */
  newSkills: string[]
  cardsReviewed: number
  retention: number | null
  careerMinutes: number
  packs: number
  income: number
  incomeTarget: number | null
  /** Emergency fund %, or null without spending data. */
  efPct: number | null
  payStreak: number
  essaysDone: number
  essaysLate: number
}

export interface CareerLetter {
  month: string
  written: string
  title: string
  lines: string[]
  change: string
}

export const monthLabel = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const n = (x: number) => x.toLocaleString('en-US')
const hours = (min: number) => (min >= 60 ? `${Math.round((min / 60) * 10) / 10} h` : `${min} min`)
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`

/** The days in a month (for the quota: about 4.3 weeks). */
const weeksIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate() / 7

/** The one change for next month, by what held you back most. */
export function pickChange(f: CareerMonthFacts): string {
  const want = Math.round(f.quota * weeksIn(f.month))
  if (f.quota > 0 && f.applied < want * 0.6) return `Applications: ${f.applied} of about ${want}. Block 45 minutes every Tuesday and Thursday just for applying, and send ${f.quota} a week before anything else.`
  if (!f.proofs.length) return 'No portfolio entry this month. After your next CTF or lab, spend 15 minutes writing it up the same day: problem, what you did, the skills.'
  if (f.essaysLate > 0) return `${plural(f.essaysLate, 'essay')} went late. Put every assignment in the planner the day you get it, so the outline happens a week early.`
  if (f.retention != null && f.retention < 0.8) return `Your cards stuck ${Math.round(f.retention * 100)}% of the time. Make them smaller: one fact per card, and review every day, even 5 minutes.`
  if (f.careerMinutes < 8 * 60) return `Only ${hours(f.careerMinutes)} of career work. Use two shift packs a night and aim for 3 hours a week of portfolio, labs and applications.`
  if (f.incomeTarget && f.income < f.incomeTarget) return `Income was ${n(f.income)} of ${n(f.incomeTarget)} lei. Pick one move from your list and do its first step this week.`
  if (f.interviews === 0 && f.applied > 0) return `${plural(f.applied, 'application')} and no interview yet. Rewrite your CV's top third around your two best portfolio entries and ask one person to check it.`
  return `A strong month. Raise the weekly quota to ${f.quota + 1}, or aim one level higher in the roles you apply for.`
}

export function careerLetter(f: CareerMonthFacts, today: string): CareerLetter {
  const want = Math.round(f.quota * weeksIn(f.month))
  const lines: string[] = []
  lines.push(
    f.applied
      ? `📨 You sent ${plural(f.applied, 'application')}${f.quota ? ` (the quota asked for about ${want})` : ''}${f.interviews ? `, got ${plural(f.interviews, 'interview')}` : ''}${f.offers ? ` and ${plural(f.offers, 'offer')} 🎉` : ''}.`
      : '📨 No applications this month.'
  )
  lines.push(f.proofs.length ? `🧾 ${plural(f.proofs.length, 'portfolio entry', 'portfolio entries')}: ${f.proofs.slice(0, 4).map((p) => p.title).join(', ')}${f.proofs.length > 4 ? '…' : ''}.` : '🧾 Nothing new in the portfolio.')
  if (f.newSkills.length) lines.push(`🧠 New skills on record: ${f.newSkills.slice(0, 6).join(', ')}.`)
  lines.push(`⏱ ${hours(f.careerMinutes)} of career work${f.packs ? `, ${plural(f.packs, 'shift pack')} included` : ''}.`)
  if (f.cardsReviewed) lines.push(`🃏 ${n(f.cardsReviewed)} flashcard reviews${f.retention != null ? `, ${Math.round(f.retention * 100)}% remembered` : ''}.`)
  if (f.essaysDone || f.essaysLate) lines.push(`✍️ ${plural(f.essaysDone, 'assignment')} done${f.essaysLate ? `, ${f.essaysLate} late` : ' on time'}.`)
  lines.push(f.incomeTarget ? `💸 Income ${n(f.income)} of ${n(f.incomeTarget)} lei (${Math.round((f.income / f.incomeTarget) * 100)}%).` : `💸 Income ${n(f.income)} lei.`)
  if (f.efPct != null) lines.push(`🛟 Emergency fund ${f.efPct}%${f.payStreak ? `, paid yourself first ${f.payStreak}× in a row` : ''}.`)
  return { month: f.month, written: today, title: `Your career in ${monthLabel(f.month)}`, lines, change: pickChange(f) }
}

/** The month a letter is due for (last month, in the first week), or null. */
export function letterDue(letters: CareerLetter[], today: string): string | null {
  if (Number(today.slice(8, 10)) > 7) return null
  const d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - 1)
  const month = d.toISOString().slice(0, 7)
  return letters.some((l) => l.month === month) ? null : month
}

/** The letter as one Telegram message (plain text; the caller escapes it). */
export const letterText = (l: CareerLetter) => [`💼 ${l.title}`, '', ...l.lines, '', `👉 One change: ${l.change}`].join('\n')

export function cleanLetters(raw: unknown): CareerLetter[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((l: any) => l && /^\d{4}-\d{2}$/.test(l.month) && Array.isArray(l.lines) && typeof l.change === 'string')
    .map((l: any) => ({ month: l.month, written: /^\d{4}-\d{2}-\d{2}$/.test(l.written) ? l.written : `${l.month}-28`, title: String(l.title ?? `Your career in ${monthLabel(l.month)}`).slice(0, 80), lines: l.lines.map((x: unknown) => String(x).slice(0, 300)).slice(0, 12), change: l.change.slice(0, 400) }))
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, 24)
}
