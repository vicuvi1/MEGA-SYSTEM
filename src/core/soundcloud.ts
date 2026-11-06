// IN-SC: SoundCloud on the island, the pure part. You paste a SoundCloud
// track, playlist or profile likes address; it is kept as a "station" and
// played through SoundCloud's own free embed player (w.soundcloud.com, its
// Widget API): no key, no login. Tested in soundcloud.test.ts.

export type StationKind = 'track' | 'playlist' | 'likes' | 'profile'
export interface Station { id: string; name: string; url: string; kind: StationKind }
export const STATIONS_MAX = 12
export const STATION_KIND_LABEL: Record<StationKind, string> = { track: 'Track', playlist: 'Playlist', likes: 'Likes', profile: 'Profile' }

const HOSTS = ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com']
const SEG = /^[a-z0-9][a-z0-9_-]{0,99}$/i
/** Pages that are SoundCloud's own, not a profile. */
const RESERVED = new Set(['discover', 'search', 'upload', 'you', 'stream', 'settings', 'pages', 'charts', 'jobs', 'terms-of-use', 'mobile', 'signin', 'logout', 'messages', 'notifications'])

/**
 * A pasted address → its clean form and kind, or null when it isn't a
 * SoundCloud track, playlist ("/sets/"), profile or profile likes page.
 * Query strings and tracking bits are dropped.
 */
export function parseSoundCloud(input: unknown): { url: string; kind: StationKind; user: string; slug?: string } | null {
  let u: URL
  try {
    const raw = String(input ?? '').trim()
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (!HOSTS.includes(u.hostname.toLowerCase()) || u.username || u.password || u.port) return null
  const parts = u.pathname.split('/').filter(Boolean)
  if (!parts.length || parts.length > 3 || !parts.every((p) => SEG.test(p))) return null
  const [user, a, b] = parts.map((p) => p.toLowerCase())
  if (RESERVED.has(user)) return null
  const base = `https://soundcloud.com/${user}`
  if (parts.length === 1) return { url: base, kind: 'profile', user }
  if (parts.length === 2 && a === 'likes') return { url: `${base}/likes`, kind: 'likes', user }
  if (parts.length === 2 && !['sets', 'tracks', 'albums', 'reposts', 'followers', 'following', 'popular-tracks', 'comments'].includes(a)) return { url: `${base}/${a}`, kind: 'track', user, slug: a }
  if (parts.length === 3 && a === 'sets') return { url: `${base}/sets/${b}`, kind: 'playlist', user, slug: b }
  return null
}

/** The embed player's address for a station (the island controls it: no big artwork, no comments). */
export function widgetSrc(url: string): string {
  const q = new URLSearchParams({ url, auto_play: 'false', hide_related: 'true', show_comments: 'false', show_user: 'true', show_reposts: 'false', show_teaser: 'false', visual: 'false', buying: 'false', sharing: 'false', download: 'false' })
  return `https://w.soundcloud.com/player/?${q.toString()}`
}
export const WIDGET_API = 'https://w.soundcloud.com/player/api.js'

/** "lofi-beats" → "Lofi beats". */
const nice = (s: string) => {
  const t = s.replace(/[-_]+/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : s
}
/** A name for a new station from its address. */
export function stationName(p: { kind: StationKind; user: string; slug?: string }): string {
  return p.kind === 'likes' ? `${nice(p.user)} · likes` : p.kind === 'profile' ? nice(p.user) : nice(p.slug ?? p.user)
}

export function cleanStation(s: any, i = 0): Station | null {
  const p = parseSoundCloud(s?.url)
  if (!p) return null
  const name = String(s?.name ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40) || stationName(p)
  return { id: typeof s?.id === 'string' && /^s[a-z0-9]{1,20}$/i.test(s.id) ? s.id : `s${i}`, name, url: p.url, kind: p.kind }
}
export function cleanStations(v: unknown): Station[] {
  if (!Array.isArray(v)) return []
  const ids = new Set<string>()
  const urls = new Set<string>()
  const out: Station[] = []
  v.forEach((x, i) => {
    const s = cleanStation(x, i)
    if (!s || urls.has(s.url)) return
    while (ids.has(s.id)) s.id = `${s.id}x`.slice(0, 21)
    ids.add(s.id)
    urls.add(s.url)
    out.push(s)
  })
  return out.slice(0, STATIONS_MAX)
}

/** Add a pasted address as a station: the new list, or why not. */
export function addStation(list: Station[], input: string, name = ''): { list: Station[]; error?: string; station?: Station } {
  const p = parseSoundCloud(input)
  if (!p) return { list, error: 'That is not a SoundCloud track, playlist or likes page' }
  if (list.some((s) => s.url === p.url)) return { list, error: 'That station is already on your list' }
  if (list.length >= STATIONS_MAX) return { list, error: `At most ${STATIONS_MAX} stations` }
  let n = list.length
  const ids = list.map((s) => s.id)
  while (ids.includes(`s${n}`)) n++
  const station: Station = { id: `s${n}`, name: name.trim().slice(0, 40) || stationName(p), url: p.url, kind: p.kind }
  return { list: [...list, station], station }
}
export const removeStation = (list: Station[], id: string) => list.filter((s) => s.id !== id)
export const renameStation = (list: Station[], id: string, name: string) => list.map((s) => (s.id === id && name.trim() ? { ...s, name: name.trim().slice(0, 40) } : s))

/** "1:05 / 3:30" from milliseconds. */
export function timeText(ms: number): string {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
/** Should the music stop by itself? In a call, the PC locked, or a focus timer started (with that setting on). */
export function shouldPause(o: { playing: boolean; call: boolean; locked: boolean; focusStarted: boolean; pauseInFocus: boolean }): 'call' | 'locked' | 'focus' | null {
  if (!o.playing) return null
  if (o.call) return 'call'
  if (o.locked) return 'locked'
  if (o.focusStarted && o.pauseInFocus) return 'focus'
  return null
}

/**
 * "Your SoundCloud": a typed profile name or a pasted profile link → the
 * public profile name (lower case), or null. Accepts "name", "@name",
 * "soundcloud.com/name" and any link on that profile (likes, a playlist…).
 */
export function parseScUser(input: unknown): string | null {
  const raw = String(input ?? '').trim().replace(/^@/, '')
  if (!raw || raw.length > 300) return null
  if (SEG.test(raw)) return RESERVED.has(raw.toLowerCase()) ? null : raw.toLowerCase()
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !HOSTS.includes(u.hostname.toLowerCase()) || u.username || u.password || u.port) return null
  const first = u.pathname.split('/').filter(Boolean)[0] ?? ''
  if (!SEG.test(first) || RESERVED.has(first.toLowerCase())) return null
  return first.toLowerCase()
}
/** The synced setting's value: a clean profile name, or ''. */
export const cleanScUser = (v: unknown): string => (typeof v === 'string' && v ? parseScUser(v) ?? '' : '')
