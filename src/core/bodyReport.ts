// BD18: Ben's weekly body report. On Sunday, one card puts the week's body
// numbers side by side: average protein against the goal, the weight trend,
// hard sets per muscle, sleep (and the sleep debt against 8 h), steps when
// the phone sends them, and ONE focus for next week with the likely cause
// ("low protein and short sleep are why push-ups stalled"). It rides along
// with the Sunday weekly check (no extra message). Pure and tested.
import { addDays } from './dates'
import { MUSCLES, WEEKLY_SETS, sessionsOf, type Muscle, type SetLog } from './sportSets'
import { moveOf, type SportEx } from './sportLadders'
import type { Nudge } from './weightTrend'

export interface Stall {
  name: string
  /** Best set before and this week. */
  before: number
  now: number
}

/**
 * Moves that stalled: trained this week and in the 2 weeks before, and this
 * week's best set is no better than the best of those 2 weeks.
 */
export function stalledMoves(log: SetLog | null | undefined, exercises: SportEx[], today: string): Stall[] {
  const wk = addDays(today, -6)
  const prev = addDays(today, -20)
  const out: Stall[] = []
  for (const ex of exercises) {
    if (ex.active === false) continue
    const s = sessionsOf(log, String(ex.id), today)
    const now = s.filter((x) => x.day >= wk).flatMap((x) => x.reps)
    const before = s.filter((x) => x.day >= prev && x.day < wk).flatMap((x) => x.reps)
    if (!now.length || before.length < 2) continue
    const a = Math.max(...before)
    const b = Math.max(...now)
    if (b <= a) out.push({ name: moveOf(ex)?.name ?? ex.name, before: a, now: b })
  }
  return out
}

export interface SleepWeek {
  /** Average minutes a night (nights known). */
  avgMin: number | null
  nights: number
  /** Minutes short of `needMin` summed over the known nights. */
  debtMin: number
}

/** The week's nights against an 8-hour need. */
export function sleepWeek(nights: { day: string; minutes: number | null }[], today: string, needMin = 480): SleepWeek {
  const from = addDays(today, -6)
  const known = nights.filter((n) => n.day >= from && n.day <= today && n.minutes != null && n.minutes >= 120 && n.minutes <= 960) as { day: string; minutes: number }[]
  if (!known.length) return { avgMin: null, nights: 0, debtMin: 0 }
  return { avgMin: Math.round(known.reduce((t, n) => t + n.minutes, 0) / known.length), nights: known.length, debtMin: known.reduce((t, n) => t + Math.max(0, needMin - n.minutes), 0) }
}

export interface BodyWeekInput {
  today: string
  protein: { avg: number; days: number; goal: number }
  weight: { nudge: Nudge; perMonthKg: number | null; now: number | null; line?: string }
  sets: Record<Muscle, number>
  sleep: SleepWeek
  /** Average steps a day (null: no phone numbers). */
  steps: number | null
  workouts: number
  stalls: Stall[]
}

export interface BodyWeekLine {
  icon: string
  label: string
  value: string
  /** good / warn / bad / none, for the card's colour. */
  tone: 'good' | 'warn' | 'bad' | 'none'
}

export interface BodyWeek {
  lines: BodyWeekLine[]
  focus: string
  cause: string | null
  /** Telegram HTML (rides along with the weekly check). */
  html: string
}

const hm = (m: number) => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, '0')}`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function bodyWeek(i: BodyWeekInput): BodyWeek {
  const lines: BodyWeekLine[] = []
  const p = i.protein
  const pRatio = p.goal > 0 && p.days ? p.avg / p.goal : null
  lines.push({ icon: '🍗', label: 'Protein', value: p.days ? `${p.avg} g a day on average (goal ${p.goal} g), logged ${p.days} of 7 days` : 'Not logged this week', tone: pRatio == null ? 'none' : pRatio >= 0.9 ? 'good' : pRatio >= 0.75 ? 'warn' : 'bad' })
  const w = i.weight
  lines.push({ icon: '⚖️', label: 'Weight trend', value: w.perMonthKg == null ? (w.now ? `${w.now} kg, the trend needs 2 weeks of weigh-ins` : 'No weigh-ins') : `${w.now} kg, ${w.perMonthKg >= 0 ? '+' : '−'}${Math.abs(Math.round(w.perMonthKg * 10) / 10)} kg a month · ${w.nudge === 'add' ? 'eat a bit more' : w.nudge === 'ease' ? 'a bit fast' : 'on pace'}`, tone: w.nudge === 'hold' ? 'good' : w.nudge === 'wait' ? 'none' : 'warn' })
  const low = MUSCLES.filter((m) => i.sets[m.id] < WEEKLY_SETS.lo)
  lines.push({ icon: '💪', label: 'Hard sets', value: `${MUSCLES.map((m) => `${m.short} ${i.sets[m.id]}`).join(' · ')} (aim 10–20 each) · ${i.workouts} workout${i.workouts === 1 ? '' : 's'}`, tone: !low.length ? 'good' : low.length <= 2 ? 'warn' : 'bad' })
  const s = i.sleep
  lines.push({ icon: '🌙', label: 'Sleep', value: s.avgMin == null ? 'No nights logged' : `${hm(s.avgMin)} a night on average${s.debtMin >= 30 ? ` · ${hm(s.debtMin)} short of your sleep need this week` : ''}`, tone: s.avgMin == null ? 'none' : s.avgMin >= 450 ? 'good' : s.avgMin >= 390 ? 'warn' : 'bad' })
  if (i.steps != null) lines.push({ icon: '🚶', label: 'Steps', value: `${i.steps.toLocaleString('en-US')} a day on average`, tone: i.steps >= 7000 ? 'good' : i.steps >= 5000 ? 'warn' : 'bad' })

  // One focus, with the likely cause.
  const lowProtein = pRatio != null && pRatio < 0.8
  const shortSleep = s.avgMin != null && s.avgMin < 420
  const stall = i.stalls[0]
  let focus: string
  let cause: string | null = null
  if (stall && lowProtein && shortSleep) {
    focus = `Protein at every meal (${p.goal} g a day) and lights out 30 min earlier.`
    cause = `Low protein (${p.avg} g) and short sleep (${hm(s.avgMin!)}) are the likely reason ${stall.name.toLowerCase()} stalled at ${stall.now}.`
  } else if (stall && shortSleep) {
    focus = 'Sleep first: lights out 30 min earlier on training nights.'
    cause = `Short sleep (${hm(s.avgMin!)} a night) is the likely reason ${stall.name.toLowerCase()} stalled at ${stall.now}.`
  } else if (stall && lowProtein) {
    focus = `Protein: ${p.goal} g a day, a portion at every meal.`
    cause = `Low protein (${p.avg} g a day) is the likely reason ${stall.name.toLowerCase()} stalled at ${stall.now}.`
  } else if (lowProtein) {
    focus = `Protein: get to ${p.goal} g a day (you averaged ${p.avg} g). An egg breakfast and a shake on shift days close most of the gap.`
    cause = 'Muscle needs the protein to grow from the training.'
  } else if (shortSleep) {
    focus = 'Sleep: aim for 7 h+ every night this week.'
    cause = `${hm(s.avgMin!)} a night on average; muscle grows while you sleep.`
  } else if (low.length) {
    focus = `More sets for ${low.map((m) => m.short.toLowerCase()).join(' and ')}: at least 10 hard sets a week each.`
    cause = `${low.map((m) => `${m.short} ${i.sets[m.id]}`).join(', ')} this week, under the 10 that grow muscle.`
  } else if (stall) {
    focus = `${stall.name}: slower reps (3 seconds down) or a pause at the bottom next week.`
    cause = `${stall.name} stayed at ${stall.now}; the same reps made harder get it moving again.`
  } else if (w.nudge === 'add') {
    focus = 'Eat about 200 kcal more a day: the scale says you are not growing yet.'
    cause = w.line ?? null
  } else {
    focus = 'Keep it going: same plan, one more rep where you can.'
  }
  const html = `🏋️ <b>Your body this week</b>\n${lines.map((l) => `${l.icon} ${esc(l.label)}: ${esc(l.value)}`).join('\n')}\n🎯 <b>Next week:</b> ${esc(focus)}${cause ? `\n<i>${esc(cause)}</i>` : ''}`
  return { lines, focus, cause, html }
}
