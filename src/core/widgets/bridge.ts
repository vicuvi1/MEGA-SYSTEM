// PL1 / PL2: the typed bridge between a widget (in its sandboxed iframe) and
// the island, and the checks on every call. A widget never reaches the
// database, Node, Electron, the PIN or the session: all it gets is the small
// read-only data below (when you allowed "read") and the answers to the calls
// you allowed. Pure and tested (bridge.test.ts).
import { calendarDay } from '../dates'
import type { IslandSnapshot } from '../islandModel'
import { isPublicHost, type WidgetManifest, type WidgetPermission } from './manifest'
import { nextRain, sunItem } from './weatherPill'

/** What you allowed a widget (asked once at install, changeable in Settings → Widgets). */
export interface WidgetGrants {
  read: boolean
  /** The hosts it may reach (a subset of its manifest's hosts). */
  network: string[]
  add: boolean
  sound: boolean
}
export const NO_GRANTS: WidgetGrants = { read: false, network: [], add: false, sound: false }

/** Everything a widget asked for, granted (what Install gives after you say yes). */
export function fullGrants(m: WidgetManifest): WidgetGrants {
  return { read: m.permissions.includes('read'), network: m.permissions.includes('network') ? [...m.hosts] : [], add: m.permissions.includes('add'), sound: m.permissions.includes('sound') }
}

/** Saved grants → only what the manifest asks for. */
export function cleanGrants(m: WidgetManifest, g: any): WidgetGrants {
  const has = (p: WidgetPermission) => m.permissions.includes(p)
  return {
    read: has('read') && g?.read === true,
    network: has('network') && Array.isArray(g?.network) ? m.hosts.filter((h) => g.network.includes(h)) : [],
    add: has('add') && g?.add === true,
    sound: has('sound') && g?.sound === true
  }
}

// ---- The read-only data contract (from the same snapshot as islandModel) ----

export interface WidgetData {
  /** Always there: the time (ms), and the local date. */
  now: number
  day: string
  /** With "read" only. */
  today?: {
    plan: { now: { title: string; endsAt: number } | null; next: { title: string; startsAt: number } | null }
    nextEvent: { title: string; startsAt: number } | null
    focus: { running: { subject: string; endsAt: number; paused: boolean } | null; minutes: number; goal: number }
    mustdos: { done: number; total: number }
    points: { balance: number; goal: { title: string; price: number } | null } | null
    streak: { days: number; kind: string } | null
    weather: { rainAt: string | null; rainNow: boolean; sunset: string | null; lightLeft: string | null } | null
  }
}

const cut = (s: unknown, n = 80) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, n)
const dayOf = (ms: number) => calendarDay(new Date(ms))

/** The data a widget sees. Without "read": only the time. */
export function widgetData(s: IslandSnapshot, now: number, grants: Pick<WidgetGrants, 'read'>): WidgetData {
  const base: WidgetData = { now, day: dayOf(now) }
  if (!grants.read || s.locked) return base
  const firstEvent = (s.day ?? []).filter((b) => !b.maybe && b.start > now).sort((a, b) => a.start - b.start)[0] ?? s.next
  const rain = nextRain(s.weather, now)
  const sun = sunItem(s.weather, now)
  return {
    ...base,
    today: {
      plan: { now: s.now ? { title: cut(s.now.title), endsAt: s.now.end } : null, next: s.next ? { title: cut(s.next.title), startsAt: s.next.start } : null },
      nextEvent: firstEvent ? { title: cut(firstEvent.title), startsAt: firstEvent.start } : null,
      focus: {
        running: s.running && !s.running.brk ? { subject: cut(s.running.subject), endsAt: s.running.endsAt, paused: !!s.running.pausedAt } : null,
        minutes: Math.round(s.today?.focusMin ?? 0),
        goal: Math.round(s.today?.focusGoal ?? 0)
      },
      mustdos: { done: s.mustdos.filter((m) => m.done).length, total: s.mustdos.length },
      points: s.points ? { balance: s.points.balance, goal: s.points.goal ? { title: cut(s.points.goal.title, 40), price: s.points.goal.price } : null } : null,
      streak: s.streak ? { days: s.streak.days, kind: s.streak.kind } : null,
      weather: s.weather ? { rainAt: rain && rain.start > now ? rain.from : null, rainNow: !!rain && rain.start <= now, sunset: s.weather.sunset, lightLeft: sun ? sun.sub.replace(/ of light left$/, '') : null } : null
    }
  }
}

// ---- Calls from a widget ----

export type WidgetSound = 'done' | 'tick' | 'chime'
export const WIDGET_SOUNDS: WidgetSound[] = ['done', 'tick', 'chime']

/** A message from a widget, as it arrives (anything). */
export type WidgetCall =
  | { op: 'fetch'; url: string }
  | { op: 'addTask'; text: string }
  | { op: 'addNote'; text: string }
  | { op: 'sound'; name: WidgetSound }

/** Calls each op may make per minute (PL11's speed budget for calls). */
export const CALLS_PER_MIN: Record<WidgetCall['op'], number> = { fetch: 6, addTask: 3, addNote: 3, sound: 6 }

/** An https address a widget may fetch: its host on the granted list, no login in it, no port, GET only (checked twice: island and app). */
export function checkUrl(url: unknown, allowed: string[]): { ok: true; url: string; host: string } | { ok: false; error: string } {
  if (typeof url !== 'string' || url.length > 500) return { ok: false, error: 'Not a web address' }
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { ok: false, error: 'Not a web address' }
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'Only https addresses' }
  if (u.username || u.password) return { ok: false, error: 'No logins in addresses' }
  if (u.port) return { ok: false, error: 'No ports in addresses' }
  const host = u.hostname.toLowerCase()
  if (!isPublicHost(host)) return { ok: false, error: 'Not a public website' }
  if (!allowed.includes(host)) return { ok: false, error: `${host} is not on this widget's list` }
  u.hash = ''
  return { ok: true, url: u.toString(), host }
}

export type CallCheck = { ok: true; call: WidgetCall } | { ok: false; error: string }

/**
 * The check on each bridge call: the message's shape, the permission you
 * granted, the host list, and the rate limit (`recent`: when this widget made
 * each kind of call in the last minute).
 */
export function checkCall(msg: unknown, grants: WidgetGrants, recent: Partial<Record<WidgetCall['op'], number[]>>, now: number): CallCheck {
  const m = msg as Record<string, unknown> | null
  if (!m || typeof m !== 'object' || typeof m.op !== 'string') return { ok: false, error: 'Unknown call' }
  const op = m.op as WidgetCall['op']
  // Own keys only: "__proto__", "constructor"… are not calls.
  if (!Object.prototype.hasOwnProperty.call(CALLS_PER_MIN, op)) return { ok: false, error: 'Unknown call' }
  const list = recent[op]
  const used = Array.isArray(list) ? list.filter((t) => now - t < 60_000).length : 0
  if (used >= CALLS_PER_MIN[op]) return { ok: false, error: 'Too many calls: slow down' }
  switch (op) {
    case 'fetch': {
      if (!grants.network.length) return { ok: false, error: 'Network is off for this widget' }
      const u = checkUrl(m.url, grants.network)
      return u.ok ? { ok: true, call: { op, url: u.url } } : u
    }
    case 'addTask':
    case 'addNote': {
      if (!grants.add) return { ok: false, error: 'Adding tasks and notes is off for this widget' }
      const t = typeof m.text === 'string' ? m.text.replace(/[\u0000-\u001f]+/g, ' ').trim() : ''
      if (!t) return { ok: false, error: 'Nothing to add' }
      if (t.length > 200) return { ok: false, error: 'Too long (200 characters at most)' }
      return { ok: true, call: { op, text: t } }
    }
    case 'sound': {
      if (!grants.sound) return { ok: false, error: 'Sound is off for this widget' }
      return WIDGET_SOUNDS.includes(m.name as WidgetSound) ? { ok: true, call: { op, name: m.name as WidgetSound } } : { ok: false, error: 'Unknown sound' }
    }
  }
}

/** A fetched answer, made safe to hand to a widget: text only, at most 64 KB. */
export const FETCH_MAX = 64 * 1024
export function fetchAnswer(status: number, type: string, body: string): { status: number; type: string; body: string } {
  const t = String(type || '').split(';')[0].trim().toLowerCase()
  const textual = /^(text\/[a-z+.-]+|application\/([a-z.+-]*\+)?json|application\/xml)$/.test(t)
  return { status, type: t, body: textual ? body.slice(0, FETCH_MAX) : '' }
}

// ---- Messages over the port (the frame's runtime and the host speak these) ----

/** Host → widget. */
export type HostMsg =
  | { t: 'data'; data: WidgetData }
  | { t: 'reply'; id: number; ok: boolean; value?: unknown; error?: string }
  | { t: 'ping'; n: number }
  | { t: 'visible'; on: boolean }

/** Widget → host. */
export type FrameMsg =
  | { t: 'ready' }
  | { t: 'call'; id: number; call: unknown }
  | { t: 'pong'; n: number }
  | { t: 'busy'; ms: number }
  | { t: 'error'; text: string }

/** A message from the frame, shape-checked (anything else is dropped). */
export function readFrameMsg(v: unknown): FrameMsg | null {
  const m = v as Record<string, unknown> | null
  if (!m || typeof m !== 'object') return null
  switch (m.t) {
    case 'ready': return { t: 'ready' }
    case 'call': return Number.isInteger(m.id) && (m.id as number) >= 0 ? { t: 'call', id: m.id as number, call: m.call } : null
    case 'pong': return Number.isInteger(m.n) ? { t: 'pong', n: m.n as number } : null
    case 'busy': return Number.isFinite(m.ms) ? { t: 'busy', ms: Math.max(0, Math.min(60_000, Number(m.ms))) } : null
    case 'error': return { t: 'error', text: cut(m.text, 160) }
    default: return null
  }
}
