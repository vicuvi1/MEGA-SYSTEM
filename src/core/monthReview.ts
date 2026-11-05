// The month review (pure, FT11): this month against last month, a small
// archive of past months, and one aim for next month that Ben keeps in mind.
import type { MonthStory } from './benStakes'

export const MONTH_AIMS = 'month_aims'

export interface MonthAim {
  /** The month it is for (YYYY-MM). */
  month: string
  text: string
  at: string
}

const MONTH = /^\d{4}-\d{2}$/

/** "2026-11" + k months ("2026-12" for +1, "2026-10" for −1). */
export function shiftMonth(month: string, k: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + k, 1))
  return d.toISOString().slice(0, 7)
}

export function cleanAims(v: any): MonthAim[] {
  return (Array.isArray(v) ? v : [])
    .filter((a: any) => a && MONTH.test(a.month) && String(a.text ?? '').trim())
    .map((a: any) => ({ month: a.month, text: String(a.text).replace(/\s+/g, ' ').trim().slice(0, 160), at: String(a.at ?? '') }))
    .slice(-24)
}

export function setAim(list: MonthAim[], month: string, text: string, now = new Date()): MonthAim[] {
  if (!MONTH.test(month)) throw new Error('Bad month')
  const t = text.replace(/\s+/g, ' ').trim().slice(0, 160)
  const rest = list.filter((a) => a.month !== month)
  return t ? [...rest, { month, text: t, at: now.toISOString() }].sort((a, b) => a.month.localeCompare(b.month)).slice(-24) : rest
}

export const aimFor = (list: MonthAim[], month: string) => list.find((a) => a.month === month) ?? null

/** Ben's line (or ''): the aim for this month, and the one already set for next month. */
export function aimLine(list: MonthAim[], today: string): string {
  const month = today.slice(0, 7)
  const now = aimFor(list, month)
  const next = aimFor(list, shiftMonth(month, 1))
  return [now ? `His ONE aim for this month (track it, bring it up): "${now.text}".` : '', next ? `Aim he set for next month: "${next.text}".` : ''].filter(Boolean).join(' ')
}

export interface CompareRow {
  label: string
  now: string
  prev: string
  /** true = better, false = worse, null = same or no data. */
  better: boolean | null
}

/** This month against last month (the same days of it while this month runs). */
export function compareMonths(now: MonthStory, prev: MonthStory | null): CompareRow[] {
  const c = now.compare
  const lei = (b: number) => `${Math.round(b / 100).toLocaleString('en-US')} lei`
  const cmp = (a: number, b: number | null | undefined, higherIsBetter = true): boolean | null => (b == null || a === b ? null : higherIsBetter ? a > b : a < b)
  return [
    { label: 'Focus', now: `${now.stats.focusH}h`, prev: c ? `${Math.round(c.focusH * 10) / 10}h` : '–', better: cmp(now.stats.focusH, c?.focusH) },
    { label: 'Training days', now: String(now.stats.trained), prev: c ? String(c.trained) : '–', better: cmp(now.stats.trained, c?.trained) },
    { label: 'Average sleep', now: now.stats.avgSleep ?? '–', prev: prev?.stats.avgSleep ?? '–', better: null },
    { label: 'Mood', now: now.stats.moodAvg != null ? `${now.stats.moodAvg}/5` : '–', prev: prev?.stats.moodAvg != null ? `${prev.stats.moodAvg}/5` : '–', better: now.stats.moodAvg != null && prev?.stats.moodAvg != null ? cmp(now.stats.moodAvg, prev.stats.moodAvg) : null },
    { label: 'Spent', now: now.stats.spent ? lei(now.stats.spent) : '–', prev: c?.spent ? lei(c.spent) : '–', better: now.stats.spent && c?.spent ? cmp(now.stats.spent, c.spent, false) : null }
  ]
}

export interface ArchiveRow {
  month: string
  label: string
  focusH: number
  trained: number
  avgSleep: string | null
  moodAvg: number | null
  aim: string | null
  letter: boolean
}

/** Past months, newest first, only the ones with something in them. */
export function monthArchive(stories: MonthStory[], aims: MonthAim[], letters: Record<string, string>): ArchiveRow[] {
  return stories
    .filter((s) => s.stats.focusH || s.stats.trained || s.stats.avgSleep || s.stats.moodAvg != null)
    .sort((a, b) => b.month.localeCompare(a.month))
    .map((s) => ({ month: s.month, label: s.label, focusH: s.stats.focusH, trained: s.stats.trained, avgSleep: s.stats.avgSleep, moodAvg: s.stats.moodAvg, aim: aimFor(aims, s.month)?.text ?? null, letter: !!letters[s.month] }))
}
