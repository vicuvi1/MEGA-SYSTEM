// Ben and your measurable goals (shared by the app and the server): the
// short "Goals now" part of his prompt, his two goal actions, and running
// them. Kept in its own file so Ben's main brain only calls in.
//   goal: raise profit to 5000 lei by 31 Dec   → a draft you confirm with a tap
//   goalcheck: G1 | 3400                       → a check-in (the number must be yours)
import { calendarDay } from '@core/dates'
import { fmtPair, type GoalCard } from '@core/goals'
import { answerValue, findGoal, goalsNowText } from '@core/goalsBen'
import { draftLine, parseGoalText, suggestCadence, type GoalDraft } from '@core/goalsText'
import { LedgerError } from '@core/ledger'
import type { Services } from './webServices'

export type GoalAction = { kind: 'newgoal'; draft: GoalDraft; text: string } | { kind: 'goalcheck'; ref: string; value: number }

/** "goal: <plain words>" (no "|", so not an hour goal line) and "goalcheck: G1 | 3400". */
export function readGoalAction(line: string, today = calendarDay()): GoalAction | null {
  const check = /^\s*goalcheck\s*:\s*([^|]{1,80})\|\s*([+-]?\d+(?:[.,]\d+)?)\s*$/i.exec(line)
  if (check) return { kind: 'goalcheck', ref: check[1].trim(), value: Number(check[2].replace(',', '.')) }
  const m = /^\s*goal\s*:\s*([^|]{4,200})$/i.exec(line)
  if (!m) return null
  const draft = parseGoalText(m[1], today)
  return draft ? { kind: 'newgoal', draft, text: m[1].trim() } : null
}

/** The part of Ben's prompt about your measurable goals (top 3 with status). */
export function goalsNowSection(s: Services, finance: any, now = new Date()): string {
  try {
    return goalsNowText(s.goals.cards(now, finance))
  } catch {
    return ''
  }
}

/** The confirm button's label for a draft. */
export const draftButton = (d: GoalDraft) => `🎯 Save goal: ${d.title}`.slice(0, 40)

/** Did his own message carry this number (so a check-in is really his)? */
export function numberInText(text: string, value: number): boolean {
  const nums = (String(text ?? '').replace(/(\d),(\d{3})(?!\d)/g, '$1$2').match(/\d+(?:[.,]\d+)?\s*k?/gi) ?? []).map((n) => Number(n.replace(/k$/i, '').trim().replace(',', '.')) * (/k$/i.test(n.trim()) ? 1000 : 1))
  return nums.some((n) => Math.abs(n - Math.abs(value)) < 1e-9)
}

/** Runs a goal action on the database copy; one line for Ben's receipts. */
export function runGoalAction(s: Services, a: GoalAction, finance: any, now = new Date()): string {
  const today = s.wallet.today(now)
  if (a.kind === 'goalcheck') {
    const cards = s.goals.cards(now, finance)
    const open = cards.filter((c) => c.status !== 'done' && c.status !== 'missed')
    const c = findGoal(cards, a.ref, open)
    if (!c) return `⚠️ No goal called "${a.ref}"`
    if (c.auto) return `ℹ️ ${c.goal.title} counts itself from your data (now ${fmtPair(c.goal.unit, c.value, c.goal.target, c.goal.unitLabel)})`
    const r = s.goals.checkIn(c.goal.id, a.value, 'ben', null, now)
    const g = r.card.goal
    return `🎯 ${g.title}: ${fmtPair(g.unit, r.card.value, g.target, g.unitLabel)} (${r.card.pct}%)${r.done ? ' · GOAL REACHED 🏆' : r.milestones.length ? ` · milestone ${r.milestones.map((m) => m.label ?? m.value).join(', ')} 🎉` : ''}${r.paid ? ` · +${r.paid} points` : ''}`
  }
  const d = a.draft
  if (!d.deadline) throw new LedgerError(`${d.title}: by when? Say a date (e.g. "by 31 Dec")`)
  if (d.kind === 'hours') {
    s.focus.saveGoal({ title: d.title, subject: d.subject ?? d.title, deadline: d.deadline, hours: Number(d.target) })
    return `🎯 Goal: ${d.title} · ${d.target}h by ${d.deadline} (planned into focus blocks)`
  }
  let target = d.target
  let start: number | null = d.start ?? null
  if (target == null && d.delta != null) {
    const now0 = s.goals.autoValue({ source: d.source, startDay: today }, now, finance)
    if (now0 == null) throw new LedgerError(`${d.title}: log your weight on Body first, then I can set the target`)
    start = now0
    target = Math.round((now0 + d.delta) * 10) / 10
  }
  if (target == null) throw new LedgerError(`${d.title}: what number are you aiming for?`)
  const g = s.goals.save({ title: d.title, unit: d.unit, unitLabel: d.unitLabel, target, start, deadline: d.deadline, area: d.area, cadence: d.cadence ?? suggestCadence(today, d.deadline), source: d.source, curve: d.curve, why: d.why }, now, finance)
  return `🎯 New goal: ${draftLine({ ...d, title: g.title })} · starting at ${fmtPair(g.unit, g.start, g.target, g.unitLabel)}`
}

/** The card a goal action points at (for tests and the island). */
export const cardFor = (cards: GoalCard[], ref: string) => findGoal(cards, ref, cards.filter((c) => c.status !== 'done' && c.status !== 'missed'))

/**
 * A quick answer to a check-in (Telegram button, island, the Goals page):
 * "+50", "-0.5", "=3400", "s" (same as before), "k" (skip). One line back.
 */
export function goalTap(s: Services, id: number, op: string, now = new Date()): string {
  const card = s.goals.cards(now).find((c) => c.goal.id === id)
  if (!card) return 'That goal is gone.'
  if (op === 'k') {
    s.goals.skip(id, now)
    return `⏭ ${card.goal.title}: skipped this time.`
  }
  const value = answerValue(card, op)
  if (value == null) return 'Type the number instead.'
  const r = s.goals.checkIn(id, value, 'me', null, now)
  const g = r.card.goal
  return `✅ ${g.title}: ${fmtPair(g.unit, r.card.value, g.target, g.unitLabel)} (${r.card.pct}%)${r.done ? ' · GOAL REACHED 🏆' : r.milestones.length ? ` · milestone ${r.milestones.map((m) => m.label ?? m.value).join(', ')} 🎉` : ''}${r.paid ? ` · +${r.paid} points` : ''}`
}
