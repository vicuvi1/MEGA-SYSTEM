// LT11: the Calendar page's pure math (days, minutes, weeks, time zones, and
// where a dragged or resized block lands), moved out of CalendarPage.tsx so
// it can be tested. Days are local YYYY-MM-DD; minutes count from midnight.
import { calendarDay } from './dates'

/** Pointer positions snap to this many minutes. */
export const SNAP_MIN = 15

/** ISO week number (Monday weeks), for the title and the month view. */
export const isoWeek = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`)
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `day` plus n days, on the local calendar. */
export const addLocalDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + n)
  return calendarDay(d)
}
/** The first day of `day`'s week (F3: Monday 1, Sunday 0 or Saturday 6). */
export const weekStartOf = (day: string, ws: number = 1) => {
  const d = new Date(`${day}T12:00:00`)
  return addLocalDays(day, -((d.getDay() - ws + 7) % 7))
}
/** "07:30" → 450. */
export const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
/** 450 → "07:30" (wraps at 24 h). */
export const hmOf = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`
/** The instant of `min` minutes into a local day (24:00 is the next midnight). */
export const isoAt = (day: string, min: number) => (min >= 24 * 60 ? new Date(`${addLocalDays(day, 1)}T00:00:00`).toISOString() : new Date(`${day}T${hmOf(min)}:00`).toISOString())
/** Like isoAt, for minutes that may run past midnight (a block ending at 01:30 the next day). */
export const isoFrom = (day: string, min: number) => isoAt(addLocalDays(day, Math.floor(min / 1440)), min % 1440)
/** Whole days from a to b. */
export const dayDiff = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000)
/** 45 → "45 min", 90 → "1 h 30", 120 → "2 h". */
export const lenLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60}` : `${m / 60} h`)

/** Minutes a time zone is ahead of this device's clock right now (D7). */
export const tzAhead = (tz: string, at = new Date()) => {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at)
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value)
    const there = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'))
    const here = Date.UTC(at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes())
    return Math.round((there - here) / 60000)
  } catch {
    return 0
  }
}

/** The minute under a pointer `y` pixels below the top of a day column, snapped and kept inside the shown hours. */
export function snapMinute(y: number, hourPx: number, startH: number, endH: number): number {
  return Math.min(endH * 60, Math.max(startH * 60, startH * 60 + Math.round((y / hourPx) * (60 / SNAP_MIN)) * SNAP_MIN))
}

/** What is being dragged: a block moved (its length and where it was grabbed), its end pulled, or a new one drawn. */
export type DragShape = { kind: 'move'; len: number; offset: number } | { kind: 'resize'; day: string; start: number } | { kind: 'create'; day: string; from: number }

/**
 * Where the block lands with the pointer at minute `m` over `overDay`: a move
 * keeps its length and stays inside the shown hours; a resize or a new block
 * is at least one snap long.
 */
export function dragSpan(d: DragShape, overDay: string, m: number, startH: number, endH: number): { day: string; start: number; end: number } {
  if (d.kind === 'move') {
    const start = Math.max(startH * 60, Math.min(endH * 60 - d.len, m - d.offset))
    return { day: overDay, start, end: start + d.len }
  }
  if (d.kind === 'resize') return { day: d.day, start: d.start, end: Math.max(d.start + SNAP_MIN, m) }
  return { day: d.day, start: Math.min(d.from, m), end: Math.max(d.from + SNAP_MIN, m) }
}
