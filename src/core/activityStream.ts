// Smart island (SI1, SI9): one stream of small, title-free events about your
// PC: the app in front (its friendly name, work/distract kind and what you're
// doing), away / back, lock / unlock, focus, blocks, meetings, and your answers
// to suggestions. The desktop sends them on one channel only when something
// changes; the app keeps about two hours in memory. Per-day totals stay in the
// desktop's own pc-activity/<day>.json (never synced). Pure and tested.
import type { AppKind } from './pcActivity'
import type { ContextKind } from './activityContext'

export type ActivityEvent =
  | { t: 'app'; at: number; label: string; kind: AppKind; context: ContextKind; conf: number; detail?: string }
  | { t: 'idle' | 'active' | 'lock' | 'unlock' | 'sleep' | 'wake'; at: number }
  | { t: 'focus:start'; at: number; subject: string }
  | { t: 'focus:end'; at: number }
  | { t: 'block:start' | 'block:end'; at: number; title: string }
  | { t: 'meeting:start' | 'meeting:end'; at: number }
  | { t: 'accept' | 'dismiss'; at: number; sk: string }
  /** SI14: you just left one of your bank sites (titles on): nothing about what was there. */
  | { t: 'bank:left'; at: number }

export const STREAM_KEEP_MS = 2 * 3600_000
/** SI9: switches shorter than this don't break a session. */
export const SESSION_GAP_SEC = 90

/** The app event worth sending: only when the app or what you're doing changes. */
export function appChanged(prev: { label: string; context: ContextKind; kind: AppKind } | null, next: { label: string; context: ContextKind; kind: AppKind }): boolean {
  return !prev || prev.label !== next.label || prev.context !== next.context || prev.kind !== next.kind
}

/** Adds an event and keeps the last two hours (and at most 2000 events). */
export function pushEvent(list: ActivityEvent[], e: ActivityEvent, now = e.at, keepMs = STREAM_KEEP_MS): ActivityEvent[] {
  const from = now - keepMs
  const out = list.filter((x) => x.at >= from)
  out.push(e)
  return out.length > 2000 ? out.slice(-2000) : out
}

/** A stretch of one kind of doing. */
export interface ActivitySession { context: ContextKind; start: number; end: number; labels: string[]; detail?: string; conf: number }

const isAway = (t: ActivityEvent['t']) => t === 'idle' || t === 'lock' || t === 'sleep'
const isBack = (t: ActivityEvent['t']) => t === 'active' || t === 'unlock' || t === 'wake'

/**
 * SI9: the events → sessions of what you were doing. Away time (idle, locked,
 * asleep) is its own "idle" session. A look elsewhere shorter than 90 s
 * between two stretches of the same thing doesn't break it.
 */
export function sessionize(events: ActivityEvent[], now: number, gapSec = SESSION_GAP_SEC): ActivitySession[] {
  const list = [...events].sort((a, b) => a.at - b.at)
  // 1. Raw segments: each app event runs until the next app / away event.
  const raw: ActivitySession[] = []
  let lastApp: Extract<ActivityEvent, { t: 'app' }> | null = null
  let away = false
  const open = (s: ActivitySession) => {
    const prev = raw[raw.length - 1]
    if (prev && prev.end > s.start) prev.end = s.start
    raw.push(s)
  }
  for (const e of list) {
    if (e.t === 'app') {
      lastApp = e
      away = false
      open({ context: e.context, start: e.at, end: now, labels: [e.label], conf: e.conf, ...(e.detail ? { detail: e.detail } : {}) })
    } else if (isAway(e.t)) {
      if (away) continue
      away = true
      open({ context: 'idle', start: e.at, end: now, labels: [], conf: 1 })
    } else if (isBack(e.t) && away) {
      away = false
      if (lastApp) open({ context: lastApp.context, start: e.at, end: now, labels: [lastApp.label], conf: lastApp.conf, ...(lastApp.detail ? { detail: lastApp.detail } : {}) })
      else {
        const prev = raw[raw.length - 1]
        if (prev) prev.end = e.at
      }
    }
  }
  const segs = raw.filter((s) => s.end > s.start)
  // 2. Merge: same kind in a row; a short look elsewhere between two of the same is absorbed.
  const out: ActivitySession[] = []
  const join = (a: ActivitySession, b: ActivitySession) => {
    a.end = Math.max(a.end, b.end)
    for (const l of b.labels) if (!a.labels.includes(l)) a.labels.push(l)
    if (!a.detail && b.detail && b.context === a.context) a.detail = b.detail
    if (b.context === a.context) a.conf = Math.max(a.conf, b.conf)
  }
  for (let i = 0; i < segs.length; i++) {
    const s = { ...segs[i], labels: [...segs[i].labels] }
    const last = out[out.length - 1]
    if (last && last.context === s.context) {
      join(last, s)
      continue
    }
    const next = segs[i + 1]
    const short = (s.end - s.start) / 1000 < gapSec
    if (last && short && s.context !== 'idle' && next && next.context === last.context) {
      // The quick look counts as part of the session around it.
      last.end = s.end
      continue
    }
    out.push(s)
  }
  return out
}

/** Minutes of each kind between from and to (sessions clipped to the window). */
export function contextMinutes(sessions: ActivitySession[], from: number, to: number): Partial<Record<ContextKind, number>> {
  const out: Partial<Record<ContextKind, number>> = {}
  for (const s of sessions) {
    const a = Math.max(from, s.start)
    const b = Math.min(to, s.end)
    if (b > a) out[s.context] = (out[s.context] ?? 0) + (b - a) / 60000
  }
  for (const k of Object.keys(out) as ContextKind[]) out[k] = Math.round(out[k]! * 10) / 10
  return out
}

/** The session going on now (the last one), and for how long (min). */
export function currentSession(sessions: ActivitySession[], now: number): (ActivitySession & { minutes: number }) | null {
  const s = sessions[sessions.length - 1]
  return s && s.end >= now - 1000 ? { ...s, minutes: (now - s.start) / 60000 } : null
}

/** Minutes in a row (from now backwards) spent in these kinds, a short look elsewhere allowed. */
export function minutesIn(sessions: ActivitySession[], kinds: ContextKind[], now: number): number {
  let total = 0
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i]
    if (!kinds.includes(s.context)) break
    total += (Math.min(now, s.end) - s.start) / 60000
  }
  return Math.max(0, Math.round(total * 10) / 10)
}

// ---- per-day totals (desktop file pc-activity/<day>.json, field ctx) ----

export type DayContext = Partial<Record<ContextKind, number>>

export function addContextSec(d: DayContext | undefined, kind: ContextKind, sec: number): DayContext {
  const out = { ...(d ?? {}) }
  out[kind] = (out[kind] ?? 0) + Math.max(0, sec)
  return out
}

const hm = (sec: number) => {
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m}m`
}

/** SI8: "coding 3h10, study 1h05, video 55m" (5+ min each, away and "other" left out). */
export function contextLine(d: DayContext | null | undefined, max = 6): string {
  if (!d) return ''
  return (Object.entries(d) as [ContextKind, number][])
    .filter(([k, v]) => k !== 'idle' && k !== 'other' && v >= 300)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k, v]) => `${k === 'ctf' ? 'CTF/lab' : k} ${hm(v)}`)
    .join(', ')
}
