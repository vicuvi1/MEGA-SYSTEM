// The resting island: what the closed pill (or notch) shows while you are not
// using it. One main thing and at most one small extra, picked by priority:
// a running timer, then music playing, then an event starting within 15
// minutes, then captions, then something waiting for you (Ben's new message, a
// reminder), then the hour before bed. With nothing going on it is calm: the
// next thing today, the time, the healthy-day ring, or nothing at all (your
// pick in Settings → Widgets → Island look). Pure: no DOM, tested.
import type { IslandSnapshot, PillItem } from './islandModel'
import { bedClock, windDownLeft } from './islandModel'

/** What the resting island shows when nothing is happening. */
export type RestIdle = 'next' | 'time' | 'health' | 'nothing'
export const REST_IDLE: RestIdle[] = ['next', 'time', 'health', 'nothing']
export const REST_IDLE_LABEL: Record<RestIdle, string> = { next: 'Next event', time: 'Time', health: 'Healthy day', nothing: 'Nothing' }

export type RestKind =
  // live (in priority order)
  | 'timer' | 'music' | 'soon' | 'captions' | 'alert' | 'winddown'
  // calm (nothing live)
  | 'now' | 'next' | 'time' | 'health' | 'nothing'
  // the small clock beside it (only when you switched the clock on)
  | 'clock'

export interface RestItem {
  kind: RestKind
  /** Stable while the item stays the same (the cross-fade runs only when it changes). */
  key: string
  /** The words (a title, a song), if any. */
  text: string
  /** A short time on the right ("11:30", "until 11:15", "in 8 min"), if any. */
  time: string
  /** When it starts (ms), for an event soon (a live countdown). */
  at?: number
  /** 0…1 for a ring (healthy day). */
  pct?: number
  /** The hover tooltip, in plain words. */
  tip: string
}

export interface RestInput {
  s: IslandSnapshot
  now: number
  /** What plays now (SoundCloud or a PC player), or null. Paused music is not "playing". */
  music: { playing: boolean; title: string } | null
  /** Live captions are running. */
  captions: boolean
  /** Your pick for the calm state. */
  idle: RestIdle
  /** Pill items you switched off (Edit the pill): never shown here either. */
  off?: ReadonlySet<PillItem>
  /** You switched the pill clock on: it may take the small spot when nothing live wants it. */
  clock?: boolean
}

export interface RestView {
  primary: RestItem
  secondary: RestItem | null
  /** A little more, shown only while the mouse is on it. */
  hint: string
}

/** An event starting within this many minutes is "soon" (live). */
export const SOON_MIN = 15

const hm = (t: number) => new Date(t).toTimeString().slice(0, 5)
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()
const inMin = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000))
  return m >= 60 ? `in ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `in ${m} min`
}
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** Something waiting for you: Ben's new message, or a reminder that is only a dot now. */
export function waitingDot(s: IslandSnapshot): { on: boolean; tip: string } {
  if (s.ben.unread > 0) return { on: true, tip: `${plural(s.ben.unread, 'new message')} from Ben` }
  if (s.alert) return { on: true, tip: `Waiting for you: ${s.alert.title}` }
  return { on: false, tip: '' }
}

/** The live things, most important first. */
function lives(i: RestInput): RestItem[] {
  const { s, now } = i
  const off = i.off ?? new Set<PillItem>()
  const out: RestItem[] = []
  const r = s.running
  if (r && !off.has('timer')) {
    const t = r.pausedAt ?? now
    const left = Math.round((r.endsAt - t) / 60_000)
    out.push({ kind: 'timer', key: `timer:${r.startedAt}`, text: r.subject, time: '', tip: `${r.pausedAt ? 'Paused' : r.brk ? 'Break' : 'Focus'}: ${r.subject} · ${left >= 0 ? `${left} min left` : `${-left} min over`}` })
  }
  if (i.music?.playing) out.push({ kind: 'music', key: 'music', text: i.music.title || 'Music', time: '', tip: `Playing: ${i.music.title || 'music'}` })
  const n = s.next
  if (n && !n.maybe && !off.has('next') && n.start > now && n.start - now <= SOON_MIN * 60_000)
    out.push({ kind: 'soon', key: `soon:${n.start}`, text: n.title, time: inMin(n.start - now), at: n.start, tip: `${n.title} at ${hm(n.start)}` })
  if (i.captions) out.push({ kind: 'captions', key: 'captions', text: 'Captions on', time: '', tip: 'Live captions are on for this call' })
  const w = waitingDot(s)
  if (w.on && !(s.ben.unread > 0 && !s.alert && off.has('ben')))
    out.push({ kind: 'alert', key: s.alert ? `alert:${s.alert.id}` : `ben:${s.ben.last?.at ?? ''}`, text: s.alert ? s.alert.title : 'New message from Ben', time: '', tip: w.tip })
  const bed = windDownLeft(s, now)
  if (bed != null && s.windDown && !r && !off.has('bed')) out.push({ kind: 'winddown', key: 'winddown', text: 'Bed in', time: bedClock(bed), pct: Math.min(1, Math.max(0, 1 - bed / 60)), tip: `Bed at ${s.windDown.bedAt}` })
  return out
}

/** The calm state, from your pick (with a sensible fallback: never an empty ring or a placeholder). */
function calm(i: RestInput): RestItem {
  const { s, now } = i
  const off = i.off ?? new Set<PillItem>()
  const time: RestItem = { kind: 'time', key: 'time', text: '', time: '', tip: 'Nothing on right now' }
  if (i.idle === 'nothing') return { kind: 'nothing', key: 'nothing', text: '', time: '', tip: 'Nothing on right now: hover to see more' }
  if (i.idle === 'health') {
    const h = s.health?.today
    if (!h || h.score <= 0) return time
    const left = h.parts.filter((p) => !p.done).map((p) => p.label.toLowerCase())
    return { kind: 'health', key: 'health', text: `${h.met}/4`, time: '', pct: Math.min(1, h.score / 100), tip: `Healthy day: ${h.met} of 4 done${left.length ? ` · left: ${left.join(', ')}` : ''}` }
  }
  if (i.idle === 'next') {
    const b = s.now
    if (b && !b.maybe && !off.has('now') && b.end > now) return { kind: 'now', key: `now:${b.start}`, text: b.title, time: `until ${hm(b.end)}`, tip: `${b.title}, ${hm(b.start)}–${hm(b.end)}` }
    const n = s.next
    if (n && !n.maybe && !off.has('next') && n.start > now && sameDay(n.start, now)) return { kind: 'next', key: `next:${n.start}`, text: n.title, time: hm(n.start), at: n.start, tip: `Next: ${n.title} at ${hm(n.start)} (${inMin(n.start - now)})` }
  }
  return time
}

/** A little more for the hover (the second thing you'd want to know). */
function hintFor(p: RestItem, i: RestInput): string {
  const { s, now } = i
  if (p.kind === 'timer') return p.text
  if (p.kind === 'next' && p.at) return inMin(p.at - now)
  if (p.kind === 'time' || p.kind === 'nothing' || p.kind === 'health') {
    const n = s.next
    if (n && !n.maybe && n.start > now && sameDay(n.start, now)) return `Next: ${n.title} ${hm(n.start)}`
    if (s.water.target > 0 && s.water.ml < s.water.target) return `Water ${(s.water.ml / 1000).toFixed(1)} / ${(s.water.target / 1000).toFixed(1)} L`
  }
  return ''
}

/** Which small extras fit beside the main thing (the clock you switched on, if nothing live wants the spot). */
const SECOND_ORDER: RestKind[] = ['timer', 'soon', 'captions', 'alert', 'music', 'winddown']

/** The resting island: one main item and at most one small extra. */
export function restingView(i: RestInput): RestView {
  const live = lives(i)
  const primary = live[0] ?? calm(i)
  const rest = live.slice(1)
  let secondary = SECOND_ORDER.map((k) => rest.find((x) => x.kind === k)).find(Boolean) ?? null
  if (!secondary && i.clock && ['music', 'captions', 'alert', 'health'].includes(primary.kind)) secondary = { kind: 'clock', key: 'clock', text: '', time: '', tip: 'The time' }
  return { primary, secondary, hint: hintFor(primary, i) }
}
