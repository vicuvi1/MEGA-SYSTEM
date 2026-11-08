// Coach chat fix (2026-11-08): simple data questions answered from the data in code,
// at once, with no model call (pure, tested). "How much do I sleep on average?",
// "how much have I earned this month?", "how are my habits?", "what are my tasks
// today?". Every number comes from the data handed in (benGround rule); when the
// data is not there the answer says so, never guesses. Also: which part of his day a
// short question needs (the prompt diet for questions the model still answers).
import { addDays } from './dates'
import { dur } from './benPlain'
import { rangeOf } from './benQuick'
import { asksFood } from './foodBen'

export type Ask =
  | { kind: 'sleep'; from: string; to: string; label: string }
  | { kind: 'earned'; from: string; to: string; label: string }
  | { kind: 'habits' }
  | { kind: 'tasks' }
  /** "What should I eat now?", "how much protein left", "ce sa mananc": the food log (core/foodBen.ts). */
  | { kind: 'food' }

const ADVICE = /\b(why|should|could|would|better|improve|tips?|help|fix|plan|how (do|can) i (get|sleep|earn|make)|more|less)\b/

/** A simple data question Ben can answer in code; null for anything else. */
export function askKind(text: string, today: string): Ask | null {
  const t = String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!t || t.length > 90 || t.split(' ').length > 12) return null
  const q = t.replace(/[?!.…]+$/g, '').trim()
  // Food: also in Romanian or Russian, so before the English question check.
  if (asksFood(t)) return { kind: 'food' }
  // Logs and edits are not questions ("slept 7h", "earned 500 today").
  const asks = /^(how|what|whats|what's|show|tell|did|do|am|have|list|my|average)\b/.test(q) || t.endsWith('?')
  if (!asks) return null
  if (/\b(sleep|slept|sleeping)\b/.test(q) && /\b(average|avg|usually|normally|typically|per night|a night|each night|how (much|long|many hours)|hours)\b/.test(q) && !ADVICE.test(q.replace(/^how (much|long)\b/, ''))) {
    if (/\blast night\b|\btonight\b/.test(q)) return { kind: 'sleep', from: today, to: today, label: 'last night' }
    const r = rangeOf(q, today)
    return r ? { kind: 'sleep', ...r } : { kind: 'sleep', from: addDays(today, -6), to: today, label: 'the last 7 nights' }
  }
  if ((/\b(earn(ed|t|ing)?|income|salary|got paid)\b/.test(q) || /\bhow much (money )?(did|have) i (make|made)\b/.test(q)) && /\b(how much|what|total|my)\b/.test(q) && !/\b(why|should|could|would|tips?|help|more|plan)\b/.test(q)) {
    const r = rangeOf(q, today)
    const first = `${today.slice(0, 8)}01`
    return r ? { kind: 'earned', ...r } : { kind: 'earned', from: first, to: today, label: 'this month' }
  }
  if (/^((what|how) (are|is|about) |show( me)? |list )?(my )?habits( today| so far| doing| this week)?$|^how('s| is| are) my habits( today| doing| going)?$|^(which|what) habits (did i do|are left|have i done)( today)?$/.test(q)) return { kind: 'habits' }
  if (/^((what|which) (are|is) |show( me)? |list |what('s| is) on )?(my |the )?(tasks|to-?dos?|todo list|list|must-?dos?|todoist)( for| on)?( today)?$|^what (do i have|have i got|is there) (to do )?today$|^what do i (have to|need to) do today$/.test(q) && !/^(my |the )?list$/.test(q)) return { kind: 'tasks' }
  return null
}

export interface SleepLogLite {
  day: string
  bedTime: string | null
  wakeTime: string | null
}

const toM = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const okTime = (t: string | null | undefined): t is string => !!t && /^\d{1,2}:\d{2}$/.test(t.trim())

/**
 * Nights from the sleep log: the night that ends on day D runs from the bed time logged
 * on D-1 (the app day turns at 04:00, so 00:30 still counts as D-1) to the wake time
 * logged on D. A night without both ends, or outside 2–16 h, is left out.
 */
export function nightsFrom(logs: SleepLogLite[]): { day: string; minutes: number; bed: string; wake: string }[] {
  const by = new Map(logs.map((l) => [l.day, l]))
  const out: { day: string; minutes: number; bed: string; wake: string }[] = []
  for (const l of logs) {
    const prev = by.get(addDays(l.day, -1))
    if (!okTime(l.wakeTime) || !okTime(prev?.bedTime)) continue
    let m = toM(l.wakeTime.trim().padStart(5, '0')) - toM(prev!.bedTime!.trim().padStart(5, '0'))
    if (m <= 0) m += 1440
    if (m >= 120 && m <= 16 * 60) out.push({ day: l.day, minutes: m, bed: prev!.bedTime!, wake: l.wakeTime })
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : 1))
}

export interface AskAnswer {
  reply: string
  chips: string[]
  /** What was read, in plain words (shown under "steps"). */
  read: string
}

const avgHm = (list: string[]) => {
  // Times around midnight: 23:30 and 00:30 average to 00:00, not 12:00.
  const m = list.map((t) => { const v = toM(t.padStart(5, '0')); return v < 12 * 60 ? v + 1440 : v })
  const a = Math.round(m.reduce((x, y) => x + y, 0) / m.length) % 1440
  return `${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

/** "On average you sleep 7 h 20 min a night (the last 7 nights, 6 logged)." */
export function sleepAnswer(ask: Extract<Ask, { kind: 'sleep' }>, logs: SleepLogLite[]): AskAnswer {
  const nights = nightsFrom(logs).filter((n) => n.day >= ask.from && n.day <= ask.to)
  if (!nights.length) return { reply: `I have no full nights logged for ${ask.label}, so I can't give an average.\nLog your bed time tonight and your wake-up tomorrow, and I'll start counting.`, chips: ['How did I sleep this week?'], read: 'Read your sleep log (no full nights)' }
  const avg = nights.reduce((t, n) => t + n.minutes, 0) / nights.length
  const shortest = nights.reduce((a, b) => (b.minutes < a.minutes ? b : a))
  const longest = nights.reduce((a, b) => (b.minutes > a.minutes ? b : a))
  const one = nights.length === 1
  const lines = [
    one ? `You slept ${dur(nights[0].minutes)} (${ask.label}: bed ${nights[0].bed}, up ${nights[0].wake}).` : `On average you sleep ${dur(avg)} a night (${ask.label}, ${nights.length} nights logged).`,
    ...(one ? [] : [`Usual bed time ${avgHm(nights.map((n) => n.bed))}, usual wake-up ${avgHm(nights.map((n) => n.wake))}.`, `Shortest night ${dur(shortest.minutes)}, longest ${dur(longest.minutes)}.`]),
    avg < 7 * 60 ? 'That is under 7 hours. Going to bed 30 minutes earlier tonight is the easiest fix.' : 'That is a healthy amount. Keep the same bed time tonight.'
  ]
  return { reply: lines.join('\n'), chips: ['How did I sleep this week?', 'What now?'], read: `Read your sleep log (${nights.length} night${nights.length === 1 ? '' : 's'})` }
}

const lei = (bani: number) => `${Math.round(bani / 100).toLocaleString('en-US')} lei`

/** Money in (Finance Helper income) and points earned, for the range. Amounts in bani. */
export function earnedAnswer(ask: Extract<Ask, { kind: 'earned' }>, d: { income: { date: string; amount: number; category: string }[] | null; points: { day: string; coins: number }[] }): AskAnswer {
  const inRange = (day: string) => day >= ask.from && day <= ask.to
  const lines: string[] = []
  let read = ''
  if (d.income) {
    const list = d.income.filter((t) => inRange(t.date))
    const total = list.reduce((t, x) => t + Math.abs(x.amount), 0)
    const by = new Map<string, number>()
    for (const t of list) by.set(t.category || 'Other', (by.get(t.category || 'Other') ?? 0) + Math.abs(t.amount))
    const top = [...by].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, v]) => `${c} ${lei(v)}`)
    lines.push(list.length ? `You earned ${lei(total)} ${ask.label} (${list.length} income record${list.length === 1 ? '' : 's'}).` : `No income is recorded ${ask.label} in Finance Helper.`)
    if (top.length > 1) lines.push(`From: ${top.join(', ')}.`)
    read = `Read Finance Helper (${list.length} income record${list.length === 1 ? '' : 's'})`
  } else {
    lines.push("I can't see your Finance Helper data on this device, so I don't know your income.")
    read = 'Finance Helper data not available'
  }
  const pts = d.points.filter((e) => inRange(e.day) && e.coins > 0).reduce((t, e) => t + e.coins, 0)
  lines.push(pts ? `In points you earned +${pts.toLocaleString('en-US')} ${ask.label}.` : `No points earned ${ask.label} yet.`)
  lines.push('Want to see what you spent too? Tap below.')
  return { reply: lines.join('\n'), chips: [`How much did I spend ${ask.label === 'this month' ? 'this month' : ask.label}?`], read: `${read} · read your points` }
}

export interface HabitLite {
  name: string
  done: boolean
  due: boolean
  streak: number
  week: number
  streakUnit?: 'day' | 'week'
}

/** Today's habits: done, still to do, the best streak. */
export function habitsAnswer(rows: HabitLite[]): AskAnswer {
  if (!rows.length) return { reply: "You have no habits on your list yet.\nAdd one on Today → Habits and I'll keep count.", chips: ['What now?'], read: 'Read your habits (none yet)' }
  const due = rows.filter((h) => h.due || h.done)
  const done = due.filter((h) => h.done)
  const left = due.filter((h) => !h.done)
  const best = [...rows].sort((a, b) => b.streak - a.streak)[0]
  const lines = [
    `You have done ${done.length} of ${due.length} habits today.`,
    ...(done.length ? [`Done: ${done.map((h) => h.name).join(', ')}.`] : []),
    ...(left.length ? [`Still to do: ${left.map((h) => h.name).join(', ')}.`] : []),
    ...(best && best.streak > 0 ? [`Best streak: ${best.name}, ${best.streak} ${best.streakUnit === 'week' ? 'week' : 'day'}${best.streak === 1 ? '' : 's'}.`] : []),
    left.length ? `Next step: do ${left[0].name} now, it takes a few minutes.` : 'All done for today. Nice work.'
  ]
  return { reply: lines.join('\n'), chips: left.length ? [`I did ${left[0].name}`, 'What now?'] : ['What now?'], read: `Read your habits (${rows.length})` }
}

/** Today's must-dos, plan blocks and Todoist tasks, in that order (`card`: the task card shows the list). */
export function tasksAnswer(d: { mustdos: { text: string; done: boolean }[]; todoist: { content: string }[] | null; blocks: { title: string; start: string }[]; card?: boolean }): AskAnswer {
  const open = d.mustdos.filter((m) => !m.done)
  const lines: string[] = []
  if (d.mustdos.length) lines.push(open.length ? `${open.length} of ${d.mustdos.length} must-dos are left: ${open.map((m) => m.text).join(', ')}.` : `All ${d.mustdos.length} must-dos are done.`)
  if (d.todoist) {
    const names = d.todoist.map((t) => t.content).filter((x) => !open.some((m) => m.text.toLowerCase() === x.toLowerCase()))
    if (names.length && d.card) lines.push(`Todoist has ${names.length} more task${names.length === 1 ? '' : 's'} for today (the list is below).`)
    else if (names.length) lines.push(`Todoist has ${names.length} task${names.length === 1 ? '' : 's'} for today: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ` and ${names.length - 8} more` : ''}.`)
    else if (!d.mustdos.length) lines.push('Todoist has nothing for today.')
  } else lines.push("I couldn't read Todoist just now, so this is only what the app knows.")
  if (d.blocks.length) lines.push(`Your plan has ${d.blocks.length} session${d.blocks.length === 1 ? '' : 's'}; the first is ${d.blocks[0].title} at ${d.blocks[0].start}.`)
  if (!lines.length) lines.push('Nothing is on your list for today.')
  const first = open[0]?.text ?? d.todoist?.[0]?.content
  lines.push(first ? `Next step: start ${first}.` : 'Next step: say "plan my day" and I will lay it out.')
  return { reply: lines.join('\n'), chips: first ? [`Start a 25 minute focus block on ${first}`, 'Plan my day'] : ['Plan my day'], read: `Read your must-dos${d.todoist ? ' and Todoist' : ''}` }
}

// ---- The prompt diet for a short question the model answers ----------------

/** Context lines a question about each topic needs (beside "Now:" and RIGHT NOW). */
const TOPIC_KEEP: { re: RegExp; keep: string }[] = [
  { re: /\b(sleep|slept|bed|wake|woke|tired|nap)\b/, keep: 'Sleep:|Readiness|Caffeine' },
  { re: /\b(money|spen[dt]|spending|budget|earn|income|lei|afford|cost|buy|save|saving)\b/, keep: 'Money|Budget|Spending' },
  { re: /\b(water|drink|drank|hydrat)/, keep: 'Water today' },
  { re: /\b(gym|workout|train|sport|run|exercise|muscle|protein|lift|rest day)\b/, keep: 'Training:|Body|Protein|Readiness' },
  { re: /\b(focus|study|studied|learn|exam|lab|homework|goal)\b/, keep: 'Focus timer|Focus today|Focus by subject|Goals planned|Goals now|Measurable goals|Deadlines soon' },
  { re: /\b(habit|streak)\b/, keep: 'Habits today|Discipline:|Week score' },
  { re: /\b(task|todo|to-do|must-?do|list|todoist)\b/, keep: "Today's must-dos|Todoist today|Deadlines soon" },
  { re: /\b(calendar|event|meeting|class|lecture|today|tonight|tomorrow|free|busy|when)\b/, keep: 'Calendar|Free time' },
  { re: /\b(points?|coins?|reward|shop)\b/, keep: 'Coins:|Rewards' }
]

const QUESTION = /^(how|what|whats|what's|when|where|which|who|did|do|does|am|is|are|have|has|can|will|was|were|should|any)\b/
/** Words that make a question a real "think it through" ask (the strong model keeps it). */
const BIG_ASK = /\b(why|plan|schedule|reschedule|review|analy[sz]e|strategy|prioriti[sz]e|advice|advise|help me|decide|what should i|organi[sz]e|figure out)\b/
const LIGHT = /^(Now:|Coins:|Focus timer|Focus today|Today's must-dos|Water today|Habits today|RIGHT NOW|HIS DAY SO FAR|Money \(MDL\))/

/**
 * A short question (not a log, not an edit, not a big ask): the quick model with only
 * the part of his day it needs. `lists`: it is about tasks or the calendar, so Todoist
 * and the calendar are read; otherwise they are skipped (that wait is most of the time).
 * `intent` is the router's (benRoute.intentOf): "advice" keeps the strong model unless
 * the question is a plain data question ("how much did I spend this month?").
 */
export function askTrim(text: string, intent: string): { keep: RegExp; lists: boolean } | null {
  const t = String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!t || t.length > 120 || t.split(' ').length > 16) return null
  if (!QUESTION.test(t) && !t.endsWith('?')) return null
  if (intent !== 'chat' && intent !== 'advice') return null
  if (intent === 'advice' && BIG_ASK.test(t)) return null
  const lists = /\b(task|tasks|todo|to-do|must-?dos?|list|todoist|calendar|events?|meetings?|class|lecture|today|tonight|tomorrow|free|busy|when|next|later|afternoon|evening|morning)\b/.test(t)
  return { keep: askKeep(t) ?? LIGHT, lists }
}

/** The context sections a short question needs; null = no topic seen (keep the light set). */
export function askKeep(text: string): RegExp | null {
  const t = String(text ?? '').toLowerCase()
  const parts = TOPIC_KEEP.filter((x) => x.re.test(t)).map((x) => x.keep)
  if (!parts.length) return null
  return new RegExp(`^(Now:|RIGHT NOW|HIS DAY SO FAR|Focus timer|Today's must-dos|${parts.join('|')})`)
}
