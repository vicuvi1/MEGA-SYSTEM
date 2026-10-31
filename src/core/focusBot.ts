// The bot's words for focus, plans and goals (pure): the morning question,
// the evening review with tap-buttons, the weekly report.
import { REASONS, hm, type DayPlan, type GoalProgress, type WeekReport } from './focus'

const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))

/** Marker the bot looks for when you reply to the morning question. */
export const PLAN_ASK = "What are your 1–3 must-dos today?"

export function morningText(o: { focusYesterdayMin: number; goalsBehind: GoalProgress[]; todoistToday: number | null; planAlready: boolean }): string {
  const lines = ['☀️ <b>Good morning!</b>', '']
  if (o.focusYesterdayMin) lines.push(`Yesterday: <b>${hm(o.focusYesterdayMin)}</b> of focus.`)
  for (const g of o.goalsBehind.slice(0, 2)) lines.push(`🎯 <b>${esc(g.title)}</b>: ${-g.aheadH}h behind, needs ~${g.perWeekH}h this week.`)
  if (o.todoistToday) lines.push(`📋 ${o.todoistToday} Todoist task${o.todoistToday === 1 ? '' : 's'} due today (/todo).`)
  if (lines.length > 2) lines.push('')
  lines.push(o.planAlready ? 'You already have a plan for today: /plan to see it.' : `<b>${PLAN_ASK}</b>\nReply to this message, one per line.`)
  return lines.join('\n')
}

export function planText(plan: DayPlan, title = '📝 <b>Today\'s must-dos</b>'): string {
  if (!plan.items.length) return `${title}\n\nNo plan yet. Send <code>/plan essay; gym; call Leo</code>.`
  const done = plan.items.filter((i) => i.done).length
  const lines = plan.items.map((it, i) => `${it.done ? '✅' : '⬜'} ${i + 1}. ${esc(it.text)}`)
  return `${title} (${done}/${plan.items.length})\n\n${lines.join('\n')}\n\n<i>Tap to tick · +10 coins each</i>`
}

/** Buttons under a plan: tick each must-do; in the evening, what got in the way. */
export function planKeyboard(plan: DayPlan, withReasons: boolean): any {
  const rows: any[][] = plan.items.map((it, i) => [{ text: `${it.done ? '✅' : '⬜'} ${i + 1}. ${it.text}`.slice(0, 60), callback_data: `pp|${plan.day}|${i}` }])
  if (withReasons && plan.items.some((i) => !i.done)) {
    const rs = REASONS.map((r, i) => ({ text: `${plan.reasons.includes(r) ? '● ' : ''}${r}`, callback_data: `pr|${plan.day}|${i}` }))
    rows.push(rs.slice(0, 3), rs.slice(3))
  }
  return { inline_keyboard: rows }
}

export function eveningText(plan: DayPlan, focusMin: number): string {
  const head = `🌙 <b>Evening review</b> · ${hm(focusMin)} of focus today`
  if (!plan.items.length) return `${head}\n\nNo must-dos today. Tomorrow morning I'll ask again.\nHow was today? Just reply here with one line.`
  const done = plan.items.filter((i) => i.done).length
  const verdict = done === plan.items.length ? 'All done 🎉 Great day.' : `${done}/${plan.items.length} done. Tick what you finished; for the rest, tap what got in the way.`
  return `${head}\n\n${plan.items.map((it, i) => `${it.done ? '✅' : '⬜'} ${i + 1}. ${esc(it.text)}`).join('\n')}\n\n${verdict}`
}

export function weekText(w: WeekReport, goals: GoalProgress[]): string {
  const lines = [`📊 <b>Your week</b> (${w.from.slice(5)} → ${w.to.slice(5)})`, '', `⏱ Focus: <b>${hm(w.totalMin)}</b>`]
  for (const s of w.bySubject.slice(0, 6)) lines.push(`   · ${esc(s.subject)}: ${hm(s.minutes)}`)
  lines.push(`📝 Must-dos: <b>${w.planDone}/${w.planTotal}</b>${w.planTotal ? ` (${Math.round((w.planDone / w.planTotal) * 100)}%)` : ''}`)
  if (w.topReasons.length) lines.push(`🧱 What got in the way: ${w.topReasons.map((r) => `${esc(r.reason)} ×${r.count}`).join(', ')}`)
  if (w.funMin) lines.push(`🎮 Fun: ${hm(w.funMin)}`)
  for (const g of goals.slice(0, 4)) lines.push(`🎯 ${esc(g.title)}: ${hm(g.doneMin)} of ${g.hours}h · ${g.aheadH >= 0 ? `${g.aheadH}h ahead` : `${-g.aheadH}h behind`} · ~${g.perWeekH}h/week`)
  lines.push('', '<b>One thing to change next week?</b> Reply here.')
  return lines.join('\n')
}

export function goalsText(goals: GoalProgress[]): string {
  if (!goals.length) return '🎯 <b>No goals with a deadline yet.</b>\nAdd one in Life System → Focus (e.g. "Math exam, 15 Jan, 40 h").'
  return `🎯 <b>Goals</b>\n\n${goals
    .map((g) => `<b>${esc(g.title)}</b> · ${g.daysLeft} days left\n   ${hm(g.doneMin)} of ${g.hours}h · ${g.aheadH >= 0 ? `${g.aheadH}h ahead` : `${-g.aheadH}h behind`} · needs ~${g.perWeekH}h/week`)
    .join('\n')}`
}
