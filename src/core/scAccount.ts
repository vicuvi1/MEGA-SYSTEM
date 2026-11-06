// "Your SoundCloud", the pure part. Two ways in:
//  1. Connect by username (website and desktop): your public Likes, your own
//     tracks and your public playlists, played through the embed player
//     (core/soundcloud.ts). Only the public profile name is kept (synced).
//  2. Sign in to SoundCloud (desktop only): SoundCloud's own site in an
//     isolated view (src/desktop/scWeb.ts). These helpers check every value
//     that comes back from that page (now playing, the "Mixed for you"
//     tiles) and which addresses it may open. No DOM here; tested in
//     scAccount.test.ts.
import { bigArt, safeArt } from './music'
import { cleanScUser, parseScUser, parseSoundCloud, type Station } from './soundcloud'

export { cleanScUser, parseScUser }

// ---- 1. connect by username ----

/** Your Likes and your own tracks as stations (they play in the embed player). */
export function userStations(user: string): Station[] {
  const u = parseScUser(user)
  if (!u) return []
  return [
    { id: 'sylikes', name: 'Your likes', url: `https://soundcloud.com/${u}/likes`, kind: 'likes' },
    { id: 'sytracks', name: 'Your tracks', url: `https://soundcloud.com/${u}`, kind: 'profile' }
  ]
}

/** The address the embed player is asked for to list your public playlists. */
export const userSetsUrl = (user: string): string | null => {
  const u = parseScUser(user)
  return u ? `https://soundcloud.com/${u}/sets` : null
}

export interface UserSet { url: string; name: string; art: string }
export const USER_SETS_MAX = 24
const line = (s: unknown, n: number) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)

/**
 * What the embed player returned (getSounds) → your playlists: only real
 * playlist addresses ("/sets/") on SoundCloud, once each. Anything else
 * (tracks, broken items) is dropped.
 */
export function cleanUserSets(list: unknown): UserSet[] {
  if (!Array.isArray(list)) return []
  const out: UserSet[] = []
  for (const x of list.slice(0, 500) as any[]) {
    const p = parseSoundCloud(x?.permalink_url ?? x?.url)
    if (!p || p.kind !== 'playlist' || out.some((y) => y.url === p.url)) continue
    out.push({ url: p.url, name: line(x?.title ?? x?.name, 40) || line(p.slug?.replace(/[-_]+/g, ' '), 40) || 'Playlist', art: safeArt(x?.artwork_url ?? x?.art) })
    if (out.length >= USER_SETS_MAX) break
  }
  return out
}

/** Cached on this device (localStorage), asked again once a day at most. */
export interface UserSetsCache { user: string; at: number; sets: UserSet[] }
export const SETS_REFRESH_MS = 24 * 3600_000
export function cleanSetsCache(v: any): UserSetsCache | null {
  const user = cleanScUser(v?.user)
  if (!user) return null
  return { user, at: Math.max(0, Number(v?.at) || 0), sets: cleanUserSets(v?.sets) }
}
export const setsStale = (c: UserSetsCache | null, user: string, now: number) => !c || c.user !== user || now - c.at > SETS_REFRESH_MS || now < c.at

/** A playlist as a station to play. */
export const setStation = (s: UserSet, i: number): Station => ({ id: `syset${i}`, name: s.name, url: s.url, kind: 'playlist' })

// ---- 2. signed in (desktop) ----

export const SCWEB_PARTITION = 'persist:soundcloud'
export const SCWEB_HOME = 'https://soundcloud.com/discover'
export const SCWEB_SIGNIN = 'https://soundcloud.com/signin'

const SC_HOSTS = /^(?:[a-z0-9-]+\.)*(?:soundcloud\.com|sndcdn\.com)$/
/** Sign-in pages SoundCloud may open in a small window ("Continue with Google / Apple / Facebook"). */
const SIGNIN_HOSTS = new Set(['accounts.google.com', 'appleid.apple.com', 'www.facebook.com', 'm.facebook.com'])

/**
 * Where an address may go from the signed-in view: 'in' (SoundCloud and its
 * image / audio hosts, https only), 'signin' (a sign-in window, https only),
 * 'out' (any other web page: the system browser) or 'block' (anything else).
 */
export function scWebRoute(url: unknown): 'in' | 'signin' | 'out' | 'block' {
  let u: URL
  try {
    u = new URL(String(url ?? ''))
  } catch {
    return 'block'
  }
  if (u.username || u.password) return 'block'
  const host = u.hostname.toLowerCase()
  if (u.protocol === 'https:' && !u.port && SC_HOSTS.test(host)) return 'in'
  if (u.protocol === 'https:' && !u.port && SIGNIN_HOSTS.has(host)) return 'signin'
  if (u.protocol === 'https:' || u.protocol === 'http:') return 'out'
  return 'block'
}

/** How often to read what's playing: every second while it plays or you look at it, else every 5 s. */
export const scWebPollMs = (o: { playing: boolean; visible: boolean }) => (o.playing || o.visible ? 1000 : 5000)

/** The view's zoom (compact by default). */
export const SCWEB_ZOOM = 0.8
export const cleanZoom = (z: unknown) => {
  const n = Number(z)
  return Number.isFinite(n) && n > 0 ? Math.round(Math.max(0.5, Math.min(1.25, n)) * 20) / 20 : SCWEB_ZOOM
}

/** The panel's place on the window (CSS pixels from the page) → the view's bounds, or null if too small. */
export function viewBounds(r: any): { x: number; y: number; width: number; height: number } | null {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN)
  const b = { x: n(r?.x), y: n(r?.y), width: n(r?.width), height: n(r?.height) }
  if (Object.values(b).some((v) => Number.isNaN(v))) return null
  if (b.width < 80 || b.height < 80 || b.width > 10000 || b.height > 10000 || b.x < 0 || b.y < 0 || b.x > 10000 || b.y > 10000) return null
  return b
}

/** "1:23" or "1:02:03" → milliseconds (0 if not a time). */
export function parseClock(t: unknown): number {
  const m = /^\s*(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\s*$/.exec(String(t ?? ''))
  if (!m) return 0
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000
}

/** An image address from `url("…")` (a CSS background) or a plain one, if it is SoundCloud's own. */
export function artFrom(v: unknown): string {
  const s = String(v ?? '')
  const m = /url\(["']?([^"')]+)["']?\)/.exec(s)
  return safeArt(m ? m[1] : s)
}

/** The 500 px version of a SoundCloud image ("-t50x50", "-large"… → "-t500x500"). */
export const bigScArt = (u: string): string => {
  const s = safeArt(u)
  return s ? bigArt(s.replace(/-t\d{2,3}x\d{2,3}\.(jpg|png)$/, '-large.$1')) : ''
}

/** What's playing in the signed-in view, checked. */
export interface ScWebNow {
  title: string
  artist: string
  artwork: string
  playing: boolean
  /** Position and length, ms (0 when not known). */
  pos: number
  dur: number
  /** The track's SoundCloud address ('' when not known). */
  url: string
  /** Liked by you (null: the button wasn't found). */
  liked: boolean | null
}
export const NO_NOW: ScWebNow = { title: '', artist: '', artwork: '', playing: false, pos: 0, dur: 0, url: '', liked: null }

/**
 * The page's raw answer (navigator.mediaSession and the player bar, read by
 * a small script) → what's playing. Every field is checked: text is cut to
 * size, images must be SoundCloud's, the address must be a SoundCloud track.
 */
export function mapNowPlaying(raw: any): ScWebNow {
  if (!raw || typeof raw !== 'object') return NO_NOW
  const md = raw.md && typeof raw.md === 'object' ? raw.md : null
  const title = line(md?.title, 120) || line(raw.titleDom, 120)
  const artist = line(md?.artist, 60) || line(raw.artistDom, 60)
  // The biggest SoundCloud image the media session offers, else the player bar's (made big).
  let artwork = ''
  let best = -1
  for (const a of Array.isArray(md?.artwork) ? md.artwork.slice(0, 10) : []) {
    const src = safeArt(a?.src)
    const size = Number(/^(\d+)x\d+/.exec(String(a?.sizes ?? ''))?.[1] ?? 0)
    if (src && size > best) (artwork = src), (best = size)
  }
  if (!artwork) artwork = bigScArt(artFrom(raw.artDom))
  const state = raw.state === 'playing' || raw.state === 'paused' ? raw.state : 'none'
  const playing = state === 'playing' ? true : state === 'paused' ? false : raw.playingDom === true
  const sec = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) < 86400 ? Number(v) * 1000 : 0)
  let dur = sec(raw.max) || parseClock(raw.duration)
  let pos = raw.now != null && raw.max ? sec(raw.now) : parseClock(raw.passed)
  if (dur && pos > dur) pos = dur
  if (!dur) pos = Math.min(pos, 86400_000)
  const p = parseSoundCloud(raw.href)
  return { title, artist, artwork, playing: playing && !!title, pos: Math.round(pos), dur: Math.round(dur), url: p?.kind === 'track' ? p.url : '', liked: typeof raw.liked === 'boolean' ? raw.liked : null }
}

/** A "Mixed for you" tile from your SoundCloud home. */
export interface MixTile { title: string; art: string; url: string }
export const MIXES_MAX = 12
const MIX_PATH = /^\/[A-Za-z0-9_\-:.%]{1,120}(?:\/[A-Za-z0-9_\-:.%]{1,160}){0,4}$/

/** A tile's link, if it is a page on soundcloud.com (no tricks), cleaned. */
export function mixUrl(v: unknown): string | null {
  let u: URL
  try {
    u = new URL(String(v ?? ''), 'https://soundcloud.com')
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.hostname !== 'soundcloud.com' || u.port || u.username || u.password) return null
  if (!MIX_PATH.test(u.pathname) || u.pathname.includes('..')) return null
  return `https://soundcloud.com${u.pathname}`
}

/**
 * The tiles read from the home page → checked and capped. A change on
 * SoundCloud's side gives an empty list, never junk: then the island just
 * links to the "Your SoundCloud" tab.
 */
export function cleanMixTiles(list: unknown): MixTile[] {
  if (!Array.isArray(list)) return []
  const out: MixTile[] = []
  for (const x of list.slice(0, 60) as any[]) {
    const url = mixUrl(x?.url)
    const title = line(x?.title, 80)
    if (!url || !title || out.some((y) => y.url === url)) continue
    out.push({ title, art: bigScArt(artFrom(x?.art)), url })
    if (out.length >= MIXES_MAX) break
  }
  return out
}

/** After pressing like: did it change? */
export function likeResult(before: boolean | null, after: boolean | null): 'liked' | 'unliked' | 'unchanged' | 'unknown' {
  if (after == null) return 'unknown'
  if (before === after) return 'unchanged'
  return after ? 'liked' : 'unliked'
}

/** The state the desktop sends the windows. */
export interface ScWebState {
  /** You pressed "Sign in" on this PC (off until then). */
  on: boolean
  /** SoundCloud's sign-in cookie is there. */
  signedIn: boolean
  /** The view exists (loaded). */
  live: boolean
  /** The view is shown in the app window. */
  visible: boolean
  zoom: number
  now: ScWebNow
  mixes: MixTile[]
  /** When `now` was read. */
  at: number
}
export const SCWEB_OFF: ScWebState = { on: false, signedIn: false, live: false, visible: false, zoom: SCWEB_ZOOM, now: NO_NOW, mixes: [], at: 0 }
export function cleanScWebState(v: any): ScWebState {
  if (!v || typeof v !== 'object') return SCWEB_OFF
  return {
    on: v.on === true,
    signedIn: v.signedIn === true,
    live: v.live === true,
    visible: v.visible === true,
    zoom: cleanZoom(v.zoom),
    now: v.now && typeof v.now === 'object' ? { ...NO_NOW, ...mapNowPlaying({ md: { title: v.now.title, artist: v.now.artist, artwork: [{ src: v.now.artwork, sizes: '500x500' }] }, state: v.now.playing ? 'playing' : 'paused', now: Number(v.now.pos) / 1000, max: Number(v.now.dur) / 1000, href: v.now.url, liked: v.now.liked }) } : NO_NOW,
    mixes: cleanMixTiles(v.mixes),
    at: Math.max(0, Number(v.at) || 0)
  }
}
