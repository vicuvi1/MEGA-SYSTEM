// Smart island (SI22, SI25): your best hours, from what really happened:
// focus sessions with their quality, and (if you share totals) minutes of
// each kind of doing per hour. Feeds booking (the next free slot in a good
// hour) and Ben's morning plan ("you never study after 21:00"). Pure and tested.
import type { IslandBlock } from './islandModel'
import { nextFreeSlot } from './islandActions'

/** Minutes of each kind per hour of a day ("9" → {coding: 40}). */
export type HourCtx = Record<string, Record<string, number>>

/** One focus session (from the day log). */
export interface FocusDone { at: string; minutes: number; pct: number }

/** Hours of the day by how well you focus in them (minutes × quality), best first; only hours with 30+ good minutes. */
export function bestHours(focus: FocusDone[], n = 3): number[] {
  const by: Record<number, number> = {}
  for (const f of focus) {
    const t = Date.parse(f.at)
    if (!Number.isFinite(t) || !(f.minutes > 0)) continue
    // Spread a session over the hours it covered.
    let left = f.minutes
    let at = t
    while (left > 0) {
      const h = new Date(at).getHours()
      const inHour = Math.min(left, 60 - new Date(at).getMinutes())
      by[h] = (by[h] ?? 0) + (inHour * Math.max(0, Math.min(100, f.pct))) / 100
      left -= inHour
      at += inHour * 60_000
    }
  }
  return Object.entries(by)
    .filter(([, v]) => v >= 30)
    .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))
    .slice(0, n)
    .map(([h]) => Number(h))
}

/** Adds minutes of a kind to an hour. */
export function addHourCtx(h: HourCtx | undefined, hour: number, ctx: string, min: number): HourCtx {
  const out: HourCtx = { ...(h ?? {}) }
  const k = String(hour)
  out[k] = { ...(out[k] ?? {}), [ctx]: Math.round(((out[k]?.[ctx] ?? 0) + min) * 10) / 10 }
  return out
}

/** The latest hour (over these days) with 10+ minutes of this kind, or null. */
export function latestHour(days: HourCtx[], ctx: string): number | null {
  let last: number | null = null
  for (const d of days) for (const [h, v] of Object.entries(d)) if ((v[ctx] ?? 0) >= 10 && (last == null || Number(h) > last)) last = Number(h)
  return last
}

/** The hours this kind happens most (over these days), best first. */
export function ctxHours(days: HourCtx[], ctx: string, n = 3): number[] {
  const by: Record<string, number> = {}
  for (const d of days) for (const [h, v] of Object.entries(d)) by[h] = (by[h] ?? 0) + (v[ctx] ?? 0)
  return Object.entries(by).filter(([, v]) => v >= 20).sort((a, b) => b[1] - a[1]).slice(0, n).map(([h]) => Number(h))
}

/** SI22: your best hours for real work (coding, study, writing, CTF) from the days' minutes per hour. */
export function workHours(days: HourCtx[], n = 3): number[] {
  const merged = days.map((d) => Object.fromEntries(Object.entries(d).map(([h, v]) => [h, { work: (v.coding ?? 0) + (v.study ?? 0) + (v.writing ?? 0) + (v.ctf ?? 0) }])))
  return ctxHours(merged, 'work', n)
}

/** SI22: a free slot today in one of your best hours (earliest first), else the next free one. */
export function preferSlot(blocks: IslandBlock[], now: number, minutes: number, best: number[]): { start: number; end: number; best: boolean } | null {
  const tries = [...best].sort((a, b) => a - b)
  for (const h of tries) {
    const d = new Date(now)
    d.setHours(h, 0, 0, 0)
    if (d.getTime() + minutes * 60_000 < now) continue
    const s = nextFreeSlot(blocks, Math.max(now, d.getTime() - 5 * 60_000), minutes)
    if (s && new Date(s.start).getHours() === h && new Date(s.start).toDateString() === new Date(now).toDateString()) return { ...s, best: true }
  }
  const s = nextFreeSlot(blocks, now, minutes)
  return s ? { ...s, best: false } : null
}

const toM = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
const toHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/**
 * SI25: a study block planned later than you ever study (last week) moves to
 * your best free hour today: "You never study after 21:00; moved Algorithms to 10:00."
 * `busy`: other events, minutes of the day. Only blocks whose title has one of `words`.
 */
export function moveLateStudy<B extends { title: string; start: string; minutes: number }>(blocks: B[], o: { lastHour: number | null; best: number[]; now: string; busy: { start: number; end: number }[]; words: string[] }): { blocks: B[]; note: string } {
  if (o.lastHour == null || !o.best.length) return { blocks, note: '' }
  const cutoff = (o.lastHour + 1) * 60
  const out = blocks.map((b) => ({ ...b }))
  const notes: string[] = []
  for (const b of out) {
    const s = toM(b.start)
    if (s < cutoff || !o.words.some((w) => w.length >= 3 && b.title.toLowerCase().includes(w.toLowerCase()))) continue
    const taken = [...o.busy, ...out.filter((x) => x !== b).map((x) => ({ start: toM(x.start), end: toM(x.start) + x.minutes }))]
    const slot = [...o.best]
      .sort((a, c) => a - c)
      .map((h) => h * 60)
      .find((m) => m >= toM(o.now) && m + b.minutes <= cutoff && !taken.some((t) => t.start < m + b.minutes + 10 && t.end + 10 > m))
    if (slot == null) continue
    notes.push(`moved ${b.title} to ${toHm(slot)}`)
    b.start = toHm(slot)
  }
  return { blocks: out.sort((a, c) => toM(a.start) - toM(c.start)), note: notes.length ? `You never study after ${toHm(cutoff)}; ${notes.join(', ')}.` : '' }
}

const range = (hs: number[]) => hs.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ')

/**
 * SI25: facts for the morning plan from last week (only from what you share):
 * "Best focus hours: 09:00, 10:00. Study never after 21:00 last week. Last week: coding 12h, study 5h."
 */
export function historyFacts(o: { focus: FocusDone[]; hours: HourCtx[]; totals?: Record<string, number> }): string {
  const parts: string[] = []
  const best = bestHours(o.focus)
  if (best.length) parts.push(`Best focus hours (focus quality × minutes, last 7 days): ${range(best)}`)
  for (const k of ['study', 'coding']) {
    const last = latestHour(o.hours, k)
    if (last != null && last < 21 && o.hours.length >= 3) parts.push(`He never did ${k} after ${String(last + 1).padStart(2, '0')}:00 last week`)
    const top = ctxHours(o.hours, k, 2)
    if (top.length) parts.push(`${k} happens most at ${range(top)}`)
  }
  if (o.totals) {
    const t = Object.entries(o.totals).filter(([k, v]) => k !== 'idle' && k !== 'other' && v >= 30).sort((a, b) => b[1] - a[1]).slice(0, 5)
    if (t.length) parts.push(`Last week on the PC: ${t.map(([k, v]) => `${k} ${v >= 60 ? `${Math.round(v / 6) / 10}h` : `${Math.round(v)}m`}`).join(', ')}`)
  }
  return parts.join('. ')
}
