// The week plan (made on Sunday in about 15 minutes): one area to focus on
// and your 3 big tasks. Pure helpers; saved in settings by main/weekPlan.ts.
import { addDays } from './dates'
import type { Metric, MetricId, ProgressReport } from './progress'

export interface WeekPlan {
  /** Monday the plan is for (YYYY-MM-DD). */
  week: string
  /** The one area for the week (a Progress metric). */
  focus: MetricId
  /** Your words for it, e.g. "up at 7:00 every day". */
  note: string
  big3: { text: string; done: boolean; todoistId?: string | null }[]
  /** The goals and projects offered on Sunday but not picked: still visible, quiet all week. Set once you picked (may be empty). */
  parked?: string[]
  savedAt: string
}

const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay() // 0 = Sunday

/**
 * The week a plan made today is for: this week's Monday, but on Sunday the
 * coming week (Sunday is planning day).
 */
export function planWeek(today: string): string {
  const wd = weekday(today)
  return wd === 0 ? addDays(today, 1) : addDays(today, 1 - wd)
}

/** The Monday of the week today is in (Sunday counts with the week before). */
export function currentWeek(today: string): string {
  const wd = weekday(today)
  return addDays(today, wd === 0 ? -6 : 1 - wd)
}

/** Sunday, or no plan for this week yet: time to plan. */
export function shouldPlan(plan: WeekPlan | null, today: string): boolean {
  if (weekday(today) === 0) return !plan || plan.week !== planWeek(today)
  return !plan || plan.week !== currentWeek(today)
}

/** The plan in force today (made last Sunday or during this week). */
export function activePlan(plan: WeekPlan | null, today: string): WeekPlan | null {
  return plan && plan.week === currentWeek(today) ? plan : null
}

/** The area to suggest: the one that got worse, else the furthest from a good week. */
export function suggestFocus(r: ProgressReport): Metric | null {
  const worse = r.metrics.find((m) => m.trend === 'worse' && m.target)
  if (worse) return worse
  const withTarget = r.metrics.filter((m) => m.target)
  return withTarget.sort((a, b) => a.now / a.target! - b.now / b.target!)[0] ?? null
}

/** Checks and tidies a plan before it's saved. */
export function cleanPlan(p: Partial<WeekPlan>, today: string, now = new Date()): WeekPlan {
  const big3 = (p.big3 ?? [])
    .map((b) => ({ text: String(b?.text ?? '').trim().slice(0, 140), done: !!b?.done, todoistId: b?.todoistId ? String(b.todoistId) : null }))
    .filter((b) => b.text)
    .slice(0, 3)
  return {
    week: p.week && /^\d{4}-\d{2}-\d{2}$/.test(p.week) ? p.week : planWeek(today),
    focus: (p.focus ?? 'focus') as MetricId,
    note: String(p.note ?? '').trim().slice(0, 140),
    big3,
    ...(Array.isArray(p.parked) ? { parked: [...new Set(p.parked.map((x) => String(x ?? '').trim().slice(0, 80)).filter((x) => x && !big3.some((b) => b.text.toLowerCase() === x.toLowerCase())))].slice(0, 8) } : {}),
    savedAt: now.toISOString()
  }
}

// ---- Sunday's "pick your top 3" (the same big 3, chosen from chips) ----

/** The chips to pick from: your goals first, then your projects, then the suggested tasks (up to 8, no repeats). */
export function top3Chips(goals: string[], projects: string[], suggested: string[] = []): string[] {
  const out: string[] = []
  for (const raw of [...goals, ...projects.filter((p) => !/^inbox$/i.test(p.trim())), ...suggested]) {
    const x = String(raw ?? '').trim().slice(0, 60)
    if (x && !out.some((o) => o.toLowerCase() === x.toLowerCase())) out.push(x)
    if (out.length >= 8) break
  }
  return out
}

/** Tap a chip: in or out, at most 3 picked. */
export function toggleChip(picked: string[], chip: string): string[] {
  if (picked.includes(chip)) return picked.filter((p) => p !== chip)
  return picked.length >= 3 ? picked : [...picked, chip]
}

/** The plan to save from the picks: the 3 become the big 3 (done ones kept done), the rest are parked. */
export function planFromPicks(prev: WeekPlan | null, week: string, chips: string[], picked: string[]): Partial<WeekPlan> {
  const same = prev && prev.week === week ? prev : null
  return {
    week,
    focus: same?.focus ?? 'focus',
    note: same?.note ?? '',
    big3: picked.slice(0, 3).map((text) => ({ text, done: !!same?.big3.find((b) => b.text.toLowerCase() === text.toLowerCase())?.done })),
    parked: chips.filter((c) => !picked.includes(c))
  }
}

/** Sunday (planning day) or Monday, and the week's top 3 aren't picked from chips yet: time to ask. */
export function top3AskDue(saved: WeekPlan | null, today: string): boolean {
  const wd = weekday(today)
  if (wd !== 0 && wd !== 1) return false
  const week = planWeek(today)
  return !(saved && saved.week === week && Array.isArray(saved.parked))
}

/** What Today's Now tab and the island's Day page show: the week's top 3, and the parked ones (quiet). */
export function weekTop3View(plan: WeekPlan | null, today: string): { top: { i: number; text: string; done: boolean }[]; parked: string[] } | null {
  const p = activePlan(plan, today)
  if (!p || !p.big3.length) return null
  return { top: p.big3.map((b, i) => ({ i, text: b.text, done: b.done })), parked: p.parked ?? [] }
}

/** Telegram's chips: two a row (✓ on the picked ones), then Save. */
export function top3Keyboard(chips: string[], picked: string[]): { inline_keyboard: { text: string; callback_data: string }[][] } {
  const rows: { text: string; callback_data: string }[][] = []
  chips.forEach((c, i) => {
    const b = { text: `${picked.includes(c) ? '✓ ' : ''}${c}`.slice(0, 40), callback_data: `w3|${i}` }
    if (i % 2 === 0) rows.push([b])
    else rows[rows.length - 1].push(b)
  })
  rows.push([{ text: picked.length ? `✅ Save my top ${picked.length}` : '✅ Save', callback_data: 'w3|ok' }])
  return { inline_keyboard: rows }
}

export function top3Text(picked: string[]): string {
  return `🎯 <b>Pick your top 3 for this week</b>\nTap up to 3. The rest stay on the list, parked and quiet.${picked.length ? `\n\nPicked: ${picked.join(' · ')}` : ''}`
}
