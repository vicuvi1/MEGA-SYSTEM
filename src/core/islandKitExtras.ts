// Island 2, the rest of the pure part: your own profiles (IN37), the
// clipboard tray (IN42), the file shelf (IN48) and the mini calendar (IN46).
// Tested in islandKitExtras.test.ts.
import { deniedBy, DEFAULT_DENY, looksSensitive } from './eyesGuard'
import type { IslandBlock } from './islandModel'

// ---- IN37: your own profiles ----

export type NudgeRule = 'peek' | 'dot' | 'never'
export const NUDGE_KINDS = ['water', 'move', 'eyes', 'ben', 'block', 'highlight'] as const
export type NudgeKind = (typeof NUDGE_KINDS)[number]

export interface KitProfile {
  id: string
  name: string
  icon: string
  /** Switched on by the app in front (program names, "code"), the Wi-Fi name, or the time. */
  apps: string[]
  wifi: string[]
  /** "09:00"–"17:00"; over midnight works ("22:00"–"06:00"). */
  from?: string
  to?: string
  /** 0 = Sunday … 6 = Saturday; empty = every day. */
  days: number[]
  /** Its own tiles and buttons (ids), or null for all of yours. */
  tiles: string[] | null
  buttons: string[] | null
  /** Its own nudges: drop down, a dot only, or never. */
  nudges: Partial<Record<NudgeKind, NudgeRule>>
}
export const PROFILES_MAX = 8
const HM = /^([01]\d|2[0-3]):[0-5]\d$/
const clip = (s: unknown, n: number) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n)
const names = (v: unknown, re: RegExp, max = 20) =>
  Array.isArray(v) ? [...new Set(v.map((x) => clip(x, 40).toLowerCase().replace(/\.exe$/, '')).filter((x) => re.test(x)))].slice(0, max) : []
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^[a-z0-9:_-]{1,40}$/i.test(x)).slice(0, 30) : null)

export function cleanKitProfile(p: any, i = 0): KitProfile | null {
  const name = clip(p?.name, 24)
  if (!name) return null
  const nudges: KitProfile['nudges'] = {}
  for (const k of NUDGE_KINDS) if (['peek', 'dot', 'never'].includes(p?.nudges?.[k])) nudges[k] = p.nudges[k]
  return {
    id: typeof p?.id === 'string' && /^p[a-z0-9]{1,20}$/i.test(p.id) ? p.id : `p${i}`,
    name,
    icon: clip(p?.icon, 4) || '⭐',
    apps: names(p?.apps, /^[a-z0-9 ._-]{1,40}$/),
    wifi: Array.isArray(p?.wifi) ? [...new Set(p.wifi.map((x: unknown) => clip(x, 32)).filter(Boolean) as string[])].slice(0, 10) : [],
    ...(HM.test(p?.from) && HM.test(p?.to) ? { from: p.from, to: p.to } : {}),
    days: Array.isArray(p?.days) ? [...new Set(p.days.filter((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6) as number[])].sort() : [],
    tiles: ids(p?.tiles),
    buttons: ids(p?.buttons),
    nudges
  }
}
export function cleanKitProfiles(v: unknown): KitProfile[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  return v.map(cleanKitProfile).filter((p): p is KitProfile => !!p && !seen.has(p.id) && (seen.add(p.id), true)).slice(0, PROFILES_MAX)
}

const mins = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
/** Is `now` inside from–to (over midnight too)? */
export function inWindow(from: string, to: string, now: Date): boolean {
  const m = now.getHours() * 60 + now.getMinutes()
  const a = mins(from)
  const b = mins(to)
  return a <= b ? m >= a && m < b : m >= a || m < b
}

/**
 * The profile of yours that fits now: the app in front first, then the
 * Wi-Fi you're on, then the time. A profile with days only counts on those days.
 * Null when none fits (the built-in profile stays).
 */
export function pickKitProfile(list: KitProfile[], o: { app: string | null; wifi: string | null; now: Date }): KitProfile | null {
  const day = o.now.getDay()
  const ok = list.filter((p) => !p.days.length || p.days.includes(day))
  const app = o.app ? o.app.toLowerCase().replace(/\.exe$/, '') : ''
  const wifi = (o.wifi ?? '').trim().toLowerCase()
  return (
    (app && ok.find((p) => p.apps.includes(app))) ||
    (wifi && ok.find((p) => p.wifi.some((w) => w.toLowerCase() === wifi))) ||
    ok.find((p) => p.from && p.to && inWindow(p.from, p.to, o.now)) ||
    null
  )
}

/** Only a profile's own tiles / buttons (all of them when it lists none). */
export const profileFilter = <T extends { id: string }>(all: T[], pick: string[] | null | undefined): T[] => (pick ? all.filter((x) => pick.includes(x.id)) : all)

/** "SSID : Home-Net" from `netsh wlan show interfaces`, or null (not on Wi-Fi). */
export function parseWifiName(out: string): string | null {
  for (const line of String(out ?? '').split(/\r?\n/)) {
    const m = /^\s*SSID\s*:\s*(.+?)\s*$/.exec(line)
    if (m && m[1]) return m[1].slice(0, 32)
  }
  return null
}

// ---- IN42: the clipboard tray ----

export interface ClipItem { text: string; at: number; pinned?: boolean }
export const CLIPS_MAX = 5
export const CLIP_MAX_CHARS = 500

/**
 * May this copy be kept? Never inside a password manager, a bank, a private
 * window or anything else on the eyes' private list, never something that
 * looks like a password, card number or code, never empty or huge.
 */
export function clipAllowed(text: string, win: { proc?: string | null; title?: string | null }, deny: string[] = DEFAULT_DENY): boolean {
  const t = String(text ?? '').trim()
  if (!t || t.length > 5000) return false
  if (deniedBy(win, deny)) return false
  if (looksSensitive(t)) return false
  // Card numbers and codes (long runs of digits), and one long token mixing letters and digits (a key or a password).
  if (/\b(?:\d[ -]?){7,}\d\b/.test(t)) return false
  if (!/\s/.test(t) && t.length >= 10 && /\d/.test(t) && /[a-z]/i.test(t) && !/^https?:\/\//i.test(t)) return false
  return true
}

/** The newest first; pinned ones stay; at most 5 that aren't pinned. */
export function addClip(list: ClipItem[], text: string, now: number): ClipItem[] {
  const t = String(text ?? '').trim().slice(0, CLIP_MAX_CHARS)
  if (!t) return list
  const had = list.find((c) => c.text === t)
  const rest = list.filter((c) => c.text !== t)
  const item: ClipItem = { text: t, at: now, ...(had?.pinned ? { pinned: true } : {}) }
  const pinned = [item, ...rest].filter((c) => c.pinned)
  const loose = [item, ...rest].filter((c) => !c.pinned).slice(0, CLIPS_MAX)
  return [...pinned, ...loose].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.at - a.at)
}
export const pinClip = (list: ClipItem[], text: string, on: boolean): ClipItem[] => list.map((c) => (c.text === text ? { ...c, pinned: on || undefined } : c)).map((c) => (c.pinned ? c : { text: c.text, at: c.at }))

// ---- IN48: the file shelf ----

export interface ShelfItem { path: string; name: string; at: number }
export const SHELF_MAX = 12
/** A real file path (Windows or not): never a link, never a relative path. */
export function cleanPath(p: unknown): string | null {
  const s = String(p ?? '').trim()
  if (!s || s.length > 1000 || /[\0\r\n]/.test(s)) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return null
  return /^[a-z]:[\\/]/i.test(s) || s.startsWith('/') || s.startsWith('\\\\') ? s : null
}
export const fileName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
export function addShelf(list: ShelfItem[], path: string, now: number): ShelfItem[] {
  const p = cleanPath(path)
  if (!p) return list
  return [{ path: p, name: fileName(p).slice(0, 120), at: now }, ...list.filter((x) => x.path !== p)].slice(0, SHELF_MAX)
}
export function cleanShelf(v: unknown): ShelfItem[] {
  if (!Array.isArray(v)) return []
  return v.reduceRight<ShelfItem[]>((acc, x: any) => addShelf(acc, x?.path, Number(x?.at) || 0), []).slice(0, SHELF_MAX)
}

// ---- IN46: the mini calendar ----

export interface StripItem { block: IslandBlock; left: number; width: number; movable: boolean; now: boolean }
/** Today's blocks along a strip `from`–`to` (ms) as shares of its width (0–1). */
export function dayStrip(blocks: IslandBlock[], from: number, to: number, now: number): StripItem[] {
  const span = Math.max(1, to - from)
  return blocks
    .filter((b) => b.end > from && b.start < to)
    .sort((a, b) => a.start - b.start)
    .map((b) => {
      const s = Math.max(from, b.start)
      const e = Math.min(to, b.end)
      return { block: b, left: (s - from) / span, width: Math.max(0.01, (e - s) / span), movable: !!b.id && !!b.calendarId && !b.call && !b.maybe, now: b.start <= now && now < b.end }
    })
}
/** The strip's hours: from the hour before now (or the first block) to 6 hours on, within the day. */
export function stripRange(blocks: IslandBlock[], now: number): { from: number; to: number } {
  const d = new Date(now)
  d.setMinutes(0, 0, 0)
  const from = Math.min(d.getTime() - 3600_000, ...blocks.filter((b) => b.end > now).map((b) => b.start).slice(0, 1))
  return { from, to: from + 7 * 3600_000 }
}
/** A drag of `dx` px on a strip `width` px wide: minutes, in 5-minute steps, at most ±3 h. */
export function dragMinutes(dx: number, width: number, spanMs: number): number {
  const m = ((dx / Math.max(1, width)) * spanMs) / 60_000
  return Math.max(-180, Math.min(180, Math.round(m / 5) * 5))
}

/** A profile's own nudges on top of your island settings (only the kinds it names). */
export function withProfileNudges<P extends { kinds: Record<string, { show: string; on: boolean }> }>(prefs: P, p: KitProfile | null): P {
  if (!p || !Object.keys(p.nudges).length) return prefs
  const kinds = { ...prefs.kinds }
  for (const [k, rule] of Object.entries(p.nudges)) if (kinds[k] && rule) kinds[k] = { ...kinds[k], show: rule, on: rule !== 'never' }
  return { ...prefs, kinds }
}
