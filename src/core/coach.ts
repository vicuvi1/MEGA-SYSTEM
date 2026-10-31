// The coach that writes first: what in your last days deserves a word
// (pure, from the same data as "Am I improving?"), and a short message with
// one concrete step. The server asks Gemini to say it in its own words when
// a key is set; this text is the fallback and the facts it gets.
import { addDays } from './dates'
import type { ProgressInput, ProgressReport } from './progress'

export interface CoachFact {
  id: 'no-focus' | 'late-wake' | 'no-sport' | 'reset' | 'focus-down' | 'no-plan' | 'good-streak' | 'improving' | 'week-focus' | 'deadline'
  /** Higher first. */
  weight: number
  text: string
  step: string
}

const daysSince = (rows: { day: string }[], today: string): number | null => {
  const last = rows.map((r) => r.day).filter((d) => d <= today).sort().pop()
  if (!last) return null
  let n = 0
  for (let d = last; d < today; d = addDays(d, 1)) n++
  return n
}

/** What's worth a word today, most important first (empty: say nothing). */
export function coachFacts(i: ProgressInput, r: ProgressReport): CoachFact[] {
  const out: CoachFact[] = []
  const t = i.today
  const focusDays = daysSince(i.focus.filter((x) => x.minutes > 0), t)
  if (focusDays !== null && focusDays >= 2) out.push({ id: 'no-focus', weight: 9, text: `No focus session for ${focusDays} days.`, step: 'Do one 25-minute focus block before lunch on your main subject.' })
  const last5 = i.wakes.filter((w) => w.day > addDays(t, -5) && w.day <= t)
  const late = last5.filter((w) => !w.onTime).length
  if (late >= 3) out.push({ id: 'late-wake', weight: 7, text: `Woke up late ${late} of the last ${last5.length} days.`, step: 'Tonight: phone away 30 minutes before bed, lights out at your bedtime.' })
  const sportDays = daysSince(i.workouts, t)
  if (sportDays !== null && sportDays >= 4) out.push({ id: 'no-sport', weight: 6, text: `No workout for ${sportDays} days.`, step: 'Just 15 minutes today: push-ups, squats, plank. Small counts.' })
  const lastReset = i.discipline.filter((e) => e.kind === 'reset').map((e) => e.day).sort().pop()
  if (lastReset && lastReset >= addDays(t, -2)) out.push({ id: 'reset', weight: 8, text: 'Your clean streak reset recently.', step: 'No guilt: check in today and plan the hour when urges usually come.' })
  const focus = r.metrics.find((m) => m.id === 'focus')
  if (focus && focus.trend === 'worse' && !out.some((f) => f.id === 'no-focus')) out.push({ id: 'focus-down', weight: 6, text: `Focus time is down: ${focus.text} this week, about ${Math.round(focus.usual / 60)}h usually.`, step: 'Book two 50-minute blocks in your calendar for tomorrow.' })
  const planned = new Set((i.mustdos ?? []).map((m) => m.day))
  const unplanned = [1, 2, 3].filter((k) => !planned.has(addDays(t, -k))).length
  if (i.mustdos && unplanned === 3) out.push({ id: 'no-plan', weight: 4, text: 'No must-dos planned for 3 days.', step: 'Write 1–3 must-dos now. Two minutes.' })
  // Something to be proud of, so it isn't only warnings.
  if (r.better.length >= 2) out.push({ id: 'improving', weight: 3, text: r.verdict, step: 'Keep the same rhythm tomorrow.' })
  const clean = r.metrics.find((m) => m.id === 'clean')
  if (clean && clean.now === 7) out.push({ id: 'good-streak', weight: 2, text: '7 clean days out of 7.', step: 'Protect it: same routine tonight.' })
  return out.sort((a, b) => b.weight - a.weight)
}

/** Only good news? Then the coach stays quiet unless it's Sunday. */
export const worthSaying = (facts: CoachFact[]) => facts.some((f) => f.weight >= 4)

/** The message without AI: the top facts and one step. */
export function coachText(facts: CoachFact[]): string {
  const top = facts.slice(0, 3)
  return `🧭 <b>Coach</b>\n\n${top.map((f) => `• ${f.text}`).join('\n')}\n\n👉 ${top[0]?.step ?? 'Keep going.'}`
}

/** What Gemini is asked (the reply is sent as is, so it must be short). */
export function coachPrompt(facts: CoachFact[], r: ProgressReport, extra: { mustdos: string[]; todoistToday: number | null; when: 'morning' | 'midday' | 'evening' | 'night' }): string {
  return [
    'You are a calm, direct personal coach for Victor, a university student in Moldova working on university, cyber security skills, his career, sport, health and discipline.',
    `It is ${extra.when}. Write him a Telegram message of at most 3 short sentences, in plain English, no greeting fluff, no hashtags, no markdown.`,
    'Name what you see (use the facts, with numbers), then give exactly ONE concrete step he can do today, with a time or a duration.',
    'Kind but honest; never preachy. If things go well, say so in one sentence and keep the step small.',
    '',
    'Facts:',
    ...facts.slice(0, 4).map((f) => `- ${f.text} (suggested step: ${f.step})`),
    `- Week overall: ${r.verdict}`,
    `- Today's must-dos: ${extra.mustdos.length ? extra.mustdos.join('; ') : 'none written yet'}`,
    extra.todoistToday !== null ? `- Todoist tasks due today or late: ${extra.todoistToday}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** Wake-ups are slipping: late on at least 2 of the last 5 logged mornings. */
export function wakeSlipping(wakes: { day: string; onTime: boolean }[], today: string): { late: number; of: number } | null {
  const last = wakes.filter((w) => w.day <= today).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 5)
  const late = last.filter((w) => !w.onTime).length
  return late >= 2 ? { late, of: last.length } : null
}

/** The bedtime message: when to put the phone away, when you get up, the first thing tomorrow. */
export function windDownText(o: { bedTarget: string; wakeTarget: string; late: number; of: number; first: string | null }): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return [
    `🌙 <b>Wind-down</b> · bedtime ${o.bedTarget}`,
    '',
    `You woke up late ${o.late} of the last ${o.of} mornings. Tomorrow starts tonight:`,
    '📵 Phone away now (charge it outside the bed).',
    `💡 Lights out at <b>${o.bedTarget}</b>, up at <b>${o.wakeTarget}</b>.`,
    o.first ? `🎯 First thing tomorrow: <b>${esc(o.first)}</b>` : '🎯 Decide your first thing for tomorrow, then sleep on it.'
  ].join('\n')
}

/** This week's chosen focus, when it's behind a good week: the coach's first point. */
export function weekFocusFact(plan: { focus: string; note: string; big3: { text: string; done: boolean }[] } | null, r: ProgressReport): CoachFact | null {
  if (!plan) return null
  const m = r.metrics.find((x) => x.id === plan.focus)
  if (!m || !m.target || m.now >= m.target) return null
  const open = plan.big3.filter((b) => !b.done).map((b) => b.text)
  return {
    id: 'week-focus',
    weight: 9.5,
    text: `Your focus this week is ${m.label.toLowerCase()}: ${m.text} in the last 7 days, a good week is ${m.targetText}.${plan.note ? ` Your plan: ${plan.note}.` : ''}`,
    step: plan.note || (open[0] ? `Put one block on “${open[0]}” in your calendar today.` : 'One small step on it today.')
  }
}

/** Deadlines in the next 3 days (from Todoist): warned about before the day, not on it. */
export function deadlineFacts(items: { task: { content: string }; date: string; daysLeft: number }[]): CoachFact[] {
  return items.slice(0, 2).map((x, k) => {
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${x.date}T12:00:00Z`).getUTCDay()]
    const when = x.daysLeft === 1 ? `tomorrow (${wd})` : `in ${x.daysLeft} days (${wd})`
    return {
      id: 'deadline' as const,
      weight: 9.8 - k * 0.1,
      text: `“${x.task.content}” is due ${when}.`,
      step: x.daysLeft === 1 ? `Finish “${x.task.content}” today: block 2 hours this afternoon.` : `Do the first 50 minutes of “${x.task.content}” today, so it isn't a last-night rush.`
    }
  })
}
