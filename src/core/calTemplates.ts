// Calendar helpers, pure and tested:
// - overlapping events side by side (columns), like a real calendar;
// - day templates ("Study day", "Weekend"): save a day's blocks, drop them
//   on another day (skipping times that are already taken);
// - repeat rules for blocks (daily, weekdays, weekly) with a sensible end.
import type { CalEvent } from './dayTime'

export interface TemplateBlock {
  title: string
  start: string // HH:MM
  end: string // HH:MM
}
export interface DayTemplate {
  name: string
  blocks: TemplateBlock[]
}
export const TEMPLATES = 'cal_templates'

const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
const hmOf = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const dayOf = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Places items with start/end minutes into columns so overlaps sit side by side. */
export function layoutColumns<T extends { start: number; end: number }>(items: T[]): (T & { col: number; cols: number })[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: (T & { col: number; cols: number })[] = []
  let group: (T & { col: number; cols: number })[] = []
  let groupEnd = -1
  const flush = () => {
    const cols = Math.max(1, ...group.map((g) => g.col + 1))
    for (const g of group) g.cols = cols
    out.push(...group)
    group = []
  }
  for (const it of sorted) {
    if (group.length && it.start >= groupEnd) flush()
    const used = new Set(group.filter((g) => g.end > it.start).map((g) => g.col))
    let col = 0
    while (used.has(col)) col++
    group.push({ ...it, col, cols: 1 })
    groupEnd = Math.max(groupEnd, it.end)
  }
  if (group.length) flush()
  return out
}

/** A day's timed events as a template (titles and times). */
export function templateFromDay(name: string, events: CalEvent[], day: string): DayTemplate {
  const blocks = events
    .filter((e) => !e.allDay && dayOf(e.start) === day)
    .map((e) => ({ title: e.title, start: hmOf(e.start), end: dayOf(e.end) > day ? '23:59' : hmOf(e.end) }))
    .sort((a, b) => a.start.localeCompare(b.start))
  return { name: name.trim().slice(0, 40) || 'My day', blocks: blocks.slice(0, 30) }
}

/** The template's blocks that fit on `day` (not over an existing event). */
export function blocksToApply(t: DayTemplate, day: string, existing: CalEvent[]): TemplateBlock[] {
  const taken = existing.filter((e) => !e.allDay && dayOf(e.start) === day).map((e) => [toMin(hmOf(e.start)), dayOf(e.end) > day ? 24 * 60 : toMin(hmOf(e.end))] as const)
  return t.blocks.filter((b) => {
    const s = toMin(b.start)
    const e = toMin(b.end)
    return e > s && !taken.some(([ts, te]) => s < te && e > ts)
  })
}

export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly'
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** A Google Calendar RRULE (with an end, so nothing repeats forever by accident). */
export function repeatRule(r: Repeat, day: string): string[] {
  if (r === 'none') return []
  if (r === 'daily') return ['RRULE:FREQ=DAILY;COUNT=28']
  if (r === 'weekdays') return ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=40']
  const [y, m, d] = day.split('-').map(Number)
  return [`RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]};COUNT=12`]
}

/** Saves (replacing by name) and keeps at most 12 templates. */
export function upsertTemplate(list: DayTemplate[], t: DayTemplate): DayTemplate[] {
  return [...list.filter((x) => x.name.toLowerCase() !== t.name.toLowerCase()), t].slice(-12)
}

/** A repeat you shape (D5): every N days or weeks, on chosen weekdays, until a date (or N times). */
export interface CustomRepeat { freq: 'daily' | 'weekly'; interval: number; days: number[]; until: string | null; count: number | null }
export function customRule(r: CustomRepeat, day: string): string[] {
  const parts = [`FREQ=${r.freq === 'weekly' ? 'WEEKLY' : 'DAILY'}`]
  const n = Math.max(1, Math.min(30, Math.round(r.interval || 1)))
  if (n > 1) parts.push(`INTERVAL=${n}`)
  if (r.freq === 'weekly') {
    const [y, m, d] = day.split('-').map(Number)
    const days = (r.days.length ? r.days : [new Date(Date.UTC(y, m - 1, d)).getUTCDay()]).filter((x) => x >= 0 && x <= 6)
    parts.push(`BYDAY=${[...new Set(days)].sort().map((x) => BYDAY[x]).join(',')}`)
  }
  // Always an end: a date (inclusive, end of that day) or a number of times (52 at most).
  if (r.until && /^\d{4}-\d{2}-\d{2}$/.test(r.until)) parts.push(`UNTIL=${r.until.replace(/-/g, '')}T235959Z`)
  else parts.push(`COUNT=${Math.max(1, Math.min(52, Math.round(r.count || 12)))}`)
  return [`RRULE:${parts.join(';')}`]
}
