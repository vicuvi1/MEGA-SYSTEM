// Telegram parity (pure, tested in tgPlanText.test.ts): today's plan as a
// Telegram message that says what the app's plan card says. The same blocks
// (the plan is cleaned by planDedupe first, so one thing is one block), the
// must-dos, a short "why" line under each block of 34 min or more (blockWhy:
// deadline sessions say which session), "Also today" with only the tasks that
// have no block, each with its reason (no slot yet / at the 17:00 event /
// project / overdue), what moved to tomorrow, the work against your limits,
// the audit's one line, and yesterday's plan score. Plus the end-of-day check
// as one message with Done / Partly / Tomorrow / Drop per block.
import { auditLine, blockWhy, leftTasks, type AuditTask } from './planAudit'
import { dedupePlan, sameThing } from './planDedupe'
import { ensureIds } from './planEdit'
import { fmtH, hasLimits, isWork, type DayLimits } from './planLimits'
import { markLabel, reviewLine, type ReviewRow, type ReviewStore } from './planReview'
import { dayScore, yesterdayLine } from './planScore'
import { fromMin, toMin, type AlsoItem, type DayProposal } from './rhythm'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`)
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** The indexes of the plan's blocks that stay once the plan is cleaned (one thing = one block), in time order. */
export function shownBlocks(plan: DayProposal): number[] {
  const p = ensureIds(plan)
  const kept = new Set(dedupePlan(p).blocks.map((b) => b.id))
  return p.blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => kept.has(b.id))
    .sort((x, y) => x.b.start.localeCompare(y.b.start))
    .map(({ i }) => i)
}

/** "Also today": tasks with no block (not a must-do, not in a block by id or by name), each once. */
export function alsoShown(plan: DayProposal): AlsoItem[] {
  const p = dedupePlan(ensureIds(plan))
  const inBlock = (t: string) => p.blocks.some((b) => sameThing(b.title, t) || (b.tasks ?? []).some((x) => sameThing(x, t)))
  const out: AlsoItem[] = []
  for (const a of p.also ?? []) {
    if (a.at || inBlock(a.title) || p.mustdos.some((m) => sameThing(m, a.title))) continue
    if (out.some((x) => (a.id && x.id === a.id) || sameThing(x.title, a.title))) continue
    out.push(a)
  }
  return out
}

/** One reason line for an "Also today" task, the app's words: "30 min · no slot yet · University · overdue". */
export const alsoWhy = (a: AlsoItem) => [fmt(a.minutes), a.event ? `at the ${a.event} event` : 'no slot yet', a.project, a.overdue ? 'overdue' : ''].filter(Boolean).join(' · ')

export interface TgPlanOpts {
  version?: number
  approved?: boolean
  /** The end-of-day records (for yesterday's plan score). */
  review?: ReviewStore | null
  /** Today's app day (for yesterday's score; default the plan's day). */
  today?: string
  /** Today's open tasks (why lines, the audit line). */
  tasks?: AuditTask[]
  limits?: DayLimits | null
}

/** The plan as a Telegram message (HTML), as the app's card shows it. */
export function tgPlanText(raw: DayProposal, o: TgPlanOpts = {}): string {
  const plan = ensureIds(raw)
  const p = dedupePlan(plan)
  const lines = [`☀️ <b>Your day${o.version && o.version > 1 ? ` (v${o.version})` : ''}</b> · ${esc(p.headline)}`]
  const score = o.review ? yesterdayLine(o.review, o.today ?? p.day) : null
  if (score) lines.push(`<i>${esc(score)}</i>`)
  if (p.mustdos.length) lines.push('', '<b>Must-dos</b>', ...p.mustdos.map((m, i) => `${i + 1}. ${esc(m)}`))
  const timed = [
    ...shownBlocks(plan).map((i) => {
      const b = plan.blocks[i]
      const why = b.minutes >= 34 ? blockWhy(b, plan, o.tasks) : null
      const tasks = (b.tasks ?? []).length > 1 ? (b.tasks ?? []).map((t) => `\n   · ${esc(t)}`).join('') : ''
      return { s: b.start, text: `${b.start}–${fromMin(toMin(b.start) + b.minutes)} ${esc(b.title)}${b.locked ? ' 📌' : ''}${tasks}${why ? `\n   <i>${esc(short(why, 70))}</i>` : ''}` }
    }),
    ...(p.training ? [{ s: p.training.time, text: `${p.training.time} 💪 ${esc(p.training.what)}` }] : [])
  ].sort((a, b) => a.s.localeCompare(b.s))
  if (timed.length) lines.push('', '<b>Blocks</b>', ...timed.map((x) => x.text))
  const also = alsoShown(plan)
  if (also.length) lines.push('', `<b>Also today (${also.length})</b>`, ...also.slice(0, 12).map((a) => `· ${esc(a.title)} · ${esc(alsoWhy(a))}`), ...(also.length > 12 ? [`…and ${also.length - 12} more`] : []))
  if (p.deferred?.length) lines.push('', '<b>Moved to tomorrow</b>', ...p.deferred.slice(0, 6).map((d) => `· ${esc(d.title)}: ${esc(d.why)}`))
  // Work against your limits (the plan keeps them; this says how much room is left).
  if (hasLimits(o.limits)) {
    const work = p.blocks.filter((b) => isWork(b)).reduce((t, b) => t + b.minutes, 0)
    const parts = [`${fmtH(work)} of work`, o.limits.maxFocusMin != null ? `your limit ${fmtH(o.limits.maxFocusMin)}` : '', o.limits.offAt ? `off at ${o.limits.offAt}` : ''].filter(Boolean)
    lines.push('', `⏱ ${esc(parts.join(' · '))}`)
  }
  // The audit's line, without naming the tasks again (they are listed just above).
  const noRoom = auditLine(leftTasks(p, o.tasks)) ? leftTasks(p, o.tasks).filter((l) => l.why === 'room').length : 0
  if (noRoom) lines.push('', `⚠️ ${noRoom} task${noRoom === 1 ? " doesn't" : "s don't"} fit today: 📦 Too much today moves ${noRoom === 1 ? 'it' : 'them'} to tomorrow.`)
  if (p.why) lines.push('', `<i>${esc(p.why)}</i>`)
  lines.push('', `💧 Water: ${(p.waterMl / 1000).toFixed(1)} L`)
  lines.push('', o.approved ? '✅ <b>Approved.</b> Blocks are in your calendar, must-dos are starred.' : 'Approve, change it, or ask for another one.')
  return lines.join('\n')
}

// ---- The end-of-day check on Telegram ------------------------------------------------

const MARK_ICON: Record<string, string> = { done: '✅', part: '◐', slip: '➡️', drop: '✗' }

/** The check as one message: each block with what you marked, the line, today's score so far. */
export function reviewText(rows: ReviewRow[], store: ReviewStore | null, day: string): string {
  if (!rows.length) return '✓ <b>Check the day</b>\nNo work blocks have started yet today.'
  const lines = ['✓ <b>Check the day</b> · one tap per block (nothing is paid for the check)', '']
  rows.slice(0, 8).forEach((r, k) => {
    const timer = r.timer > 0 ? ` · timer ${r.timer} min` : ''
    lines.push(`${k + 1}. ${r.start} ${esc(r.title)} (${r.minutes} min${timer})${r.mark ? ` — ${MARK_ICON[r.mark.outcome]} ${esc(markLabel(r.mark))}` : ''}`)
  })
  lines.push('', esc(reviewLine(rows)))
  const s = store ? dayScore(store, day) : null
  if (s) lines.push(`<i>Today's plan: ${s.score}% realistic so far</i>`)
  return lines.join('\n')
}

/** Callback data for a check tap: "pc|<d|p|t|x>|<block id>" (the block's own id, so a new row never shifts it). */
export const reviewData = (id: string, o: 'done' | 'part' | 'slip' | 'drop') => `pc|${({ done: 'd', part: 'p', slip: 't', drop: 'x' } as const)[o]}|${id}`
export function readReviewData(data: string): { id: string; outcome: 'done' | 'part' | 'slip' | 'drop' } | null {
  const m = /^pc\|([dptx])\|([\w-]{1,58})$/.exec(String(data ?? ''))
  if (!m) return null
  return { id: m[2], outcome: ({ d: 'done', p: 'part', t: 'slip', x: 'drop' } as const)[m[1] as 'd'] }
}

/** One row of buttons per block: Done · Partly · Tomorrow · Drop (the marked one shows a tick). */
export function reviewKeyboard(rows: ReviewRow[]): { inline_keyboard: { text: string; callback_data: string }[][] } {
  return {
    inline_keyboard: rows.slice(0, 8).map((r, k) => {
      const on = (o: string) => (r.mark?.outcome === o ? '• ' : '')
      return [
        { text: `${k + 1} ${on('done')}✓ Done`, callback_data: reviewData(r.id, 'done') },
        { text: `${on('part')}◐ Partly`, callback_data: reviewData(r.id, 'part') },
        { text: `${on('slip')}➡️ Tmrw`, callback_data: reviewData(r.id, 'slip') },
        { text: `${on('drop')}✗ Drop`, callback_data: reviewData(r.id, 'drop') }
      ]
    })
  }
}
