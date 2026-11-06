// MU: the Music tab and page, the pure part. SoundCloud plays through its
// own embed player (core/soundcloud.ts, the Widget API); this file holds the
// rules around it: favourites and recently played, the up-next list with
// shuffle and repeat, the waveform's bars, the sleep timer's fade, the colour
// picked from the artwork, station order, the focus mix, and the "now
// playing" line Ben may see. No DOM here; tested in music.test.ts.
import { cleanStations, parseSoundCloud, type Station } from './soundcloud'

// ---- the synced part (island_kit.music) ----

/** A track you starred. */
export interface Fav { url: string; title: string; artist: string; artwork: string }
export const FAVS_MAX = 60

export interface MusicKit {
  stations: Station[]
  /** Starred tracks, newest first. */
  favs: Fav[]
  /** The station that starts with a focus timer (null: none). */
  focusMix: string | null
  /** Ben may see what is playing (off by default). */
  benSees: boolean
  /** Synced lyrics from LRCLIB (sends the song's name there). */
  lyrics: boolean
  /** The current lyric line on the pill (off by default). */
  pillLyric: boolean
  /** The equalizer: 'beat' bars or a 'pitch' low-to-high shape (both drawn, not measured). */
  eqMode: EqMode
  /** The player the views follow: 'sc', a PC player's id, or null (whatever plays). */
  pin: string | null
}
export type EqMode = 'beat' | 'pitch'
export const DEFAULT_MUSIC: MusicKit = { stations: [], favs: [], focusMix: null, benSees: false, lyrics: true, pillLyric: false, eqMode: 'beat', pin: null }

const line = (s: unknown, n: number) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)

/** Only SoundCloud's own image host (the artwork the widget gives). */
export function safeArt(u: unknown): string {
  const s = String(u ?? '')
  return /^https:\/\/i\d?\.sndcdn\.com\/[\w./-]{1,200}$/.test(s) ? s : ''
}
/** The big version of a SoundCloud artwork ("-large" is 100 px; "-t500x500" is 500 px). */
export function bigArt(u: string): string {
  const s = safeArt(u)
  return s ? s.replace(/-(large|t300x300|crop|small|badge|tiny|mini)\.(jpg|png)$/, '-t500x500.$2') : ''
}

export function cleanFav(v: any): Fav | null {
  const p = parseSoundCloud(v?.url)
  if (!p || p.kind !== 'track') return null
  return { url: p.url, title: line(v?.title, 120) || p.slug || 'Track', artist: line(v?.artist, 60), artwork: safeArt(v?.artwork) }
}
export function cleanFavs(v: unknown): Fav[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: Fav[] = []
  for (const x of v) {
    const f = cleanFav(x)
    if (!f || seen.has(f.url)) continue
    seen.add(f.url)
    out.push(f)
  }
  return out.slice(0, FAVS_MAX)
}
export function cleanMusicKit(v: any): MusicKit {
  const stations = cleanStations(v?.stations)
  const mix = typeof v?.focusMix === 'string' && stations.some((s) => s.id === v.focusMix) ? v.focusMix : null
  const pin = typeof v?.pin === 'string' && /^(sc|sys:[A-Za-z0-9._!\- ]{1,200})$/.test(v.pin) ? v.pin : null
  return { stations, favs: cleanFavs(v?.favs), focusMix: mix, benSees: v?.benSees === true, lyrics: v?.lyrics !== false, pillLyric: v?.pillLyric === true, eqMode: v?.eqMode === 'pitch' ? 'pitch' : 'beat', pin }
}

/** Star or unstar a track (newest first). */
export function toggleFav(list: Fav[], f: Partial<Fav>): Fav[] {
  const c = cleanFav(f)
  if (!c) return list
  return list.some((x) => x.url === c.url) ? list.filter((x) => x.url !== c.url) : [c, ...list].slice(0, FAVS_MAX)
}
export const isFav = (list: Fav[], url: string | null | undefined) => !!url && list.some((x) => x.url === url)

/** A starred track as something to play. */
export const favStation = (f: Fav): Station => ({ id: 'sfav', name: f.title, url: f.url, kind: 'track' })

/** Move a station up (-1) or down (+1). */
export function moveStation(list: Station[], id: string, dir: -1 | 1): Station[] {
  const i = list.findIndex((s) => s.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return list
  const out = list.slice()
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/** Made-up stations for the empty state and the screenshots (they don't exist on SoundCloud). */
export const EXAMPLE_STATIONS: Station[] = [
  { id: 's0', name: 'Late night study', url: 'https://soundcloud.com/example-lofi/sets/late-night-study', kind: 'playlist' },
  { id: 's1', name: 'Deep focus', url: 'https://soundcloud.com/example-ambient/sets/deep-focus', kind: 'playlist' },
  { id: 's2', name: 'Morning run', url: 'https://soundcloud.com/example-beats/sets/morning-run', kind: 'playlist' },
  { id: 's3', name: 'Rainy jazz', url: 'https://soundcloud.com/example-jazz/sets/rainy-jazz', kind: 'playlist' }
]

// ---- recently played (this device) ----

export interface Recent { url: string; title: string; artist: string; artwork: string; at: number }
export const RECENT_MAX = 20
/** Adds a track to the front (once), newest first. */
export function addRecent(list: Recent[], r: Omit<Recent, 'at'>, at: number): Recent[] {
  const f = cleanFav(r)
  if (!f) return list
  return [{ ...f, at }, ...list.filter((x) => x.url !== f.url)].slice(0, RECENT_MAX)
}
export function cleanRecents(v: unknown): Recent[] {
  if (!Array.isArray(v)) return []
  const out: Recent[] = []
  for (const x of v) {
    const f = cleanFav(x)
    if (f && !out.some((y) => y.url === f.url)) out.push({ ...f, at: Number(x?.at) || 0 })
  }
  return out.slice(0, RECENT_MAX)
}

// ---- the queue (the widget's getSounds()) ----

export interface QItem { i: number; title: string; artist: string; artwork: string; dur: number; url: string }
/** The widget's sounds → the list we show. Sounds not loaded yet have no title. */
export function queueFrom(sounds: unknown): QItem[] {
  if (!Array.isArray(sounds)) return []
  return sounds.slice(0, 500).map((s: any, i: number) => ({
    i,
    title: line(s?.title, 120) || `Track ${i + 1}`,
    artist: line(s?.user?.username, 60),
    artwork: safeArt(s?.artwork_url) || safeArt(s?.user?.avatar_url),
    dur: Math.max(0, Number(s?.duration) || 0),
    url: parseSoundCloud(s?.permalink_url)?.url ?? ''
  }))
}

export type Repeat = 'off' | 'all' | 'one'
export const REPEAT_NEXT: Record<Repeat, Repeat> = { off: 'all', all: 'one', one: 'off' }

/** A shuffled play order of n tracks that starts with the one playing. */
export function shuffleOrder(n: number, cur: number, rand: () => number = Math.random): number[] {
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => i !== cur)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return cur >= 0 && cur < n ? [cur, ...rest] : rest
}

/**
 * The track after `cur`, or null to stop. `auto` is a track that ended by
 * itself (repeat one plays it again); a press of Next always moves on.
 */
export function nextIndex(o: { n: number; cur: number; shuffle: boolean; order: number[]; repeat: Repeat; auto: boolean }): number | null {
  const { n, cur } = o
  if (n <= 0) return null
  if (o.auto && o.repeat === 'one') return cur
  const order = o.shuffle && o.order.length === n ? o.order : Array.from({ length: n }, (_, i) => i)
  const at = order.indexOf(cur)
  if (at >= 0 && at + 1 < order.length) return order[at + 1]
  return o.repeat === 'off' && o.auto ? null : order[0]
}
export function prevIndex(o: { n: number; cur: number; shuffle: boolean; order: number[] }): number {
  if (o.n <= 0) return 0
  const order = o.shuffle && o.order.length === o.n ? o.order : Array.from({ length: o.n }, (_, i) => i)
  const at = order.indexOf(o.cur)
  return at > 0 ? order[at - 1] : order[order.length - 1]
}
/** The next few after the one playing, in play order. */
export function upNext(q: QItem[], o: { cur: number; shuffle: boolean; order: number[]; repeat: Repeat }, max = 8): QItem[] {
  const out: QItem[] = []
  let cur = o.cur
  const seen = new Set<number>([cur])
  for (let k = 0; k < max; k++) {
    const nx = nextIndex({ n: q.length, cur, shuffle: o.shuffle, order: o.order, repeat: o.repeat === 'one' ? 'all' : o.repeat, auto: true })
    if (nx == null || seen.has(nx)) break
    seen.add(nx)
    out.push(q[nx])
    cur = nx
  }
  return out
}

// ---- the waveform ----

/** SoundCloud's waveform address (a picture) → its numbers (the same name, .json). Only its own host. */
export function waveJsonUrl(u: unknown): string | null {
  const m = /^https:\/\/wave\.sndcdn\.com\/([\w-]{4,80})_m\.(png|json)$/.exec(String(u ?? ''))
  return m ? `https://wave.sndcdn.com/${m[1]}_m.json` : null
}
/**
 * The waveform's samples → `bars` heights from 0.08 to 1: each bar is the
 * loudest sample in its slice, scaled to the loudest of all, with a gentle
 * curve so quiet parts still show.
 */
export function waveBars(samples: unknown, bars: number): number[] {
  const n = Math.max(1, Math.min(400, Math.round(bars)))
  const xs = Array.isArray(samples) ? samples.map((x) => Math.max(0, Number(x) || 0)) : []
  if (!xs.length) return Array(n).fill(0.08)
  const out: number[] = []
  for (let b = 0; b < n; b++) {
    const a = Math.floor((b * xs.length) / n)
    const z = Math.max(a + 1, Math.floor(((b + 1) * xs.length) / n))
    let m = 0
    for (let i = a; i < z && i < xs.length; i++) m = Math.max(m, xs[i])
    out.push(m)
  }
  const top = Math.max(...out) || 1
  return out.map((m) => Math.round(Math.max(0.08, Math.pow(m / top, 0.8)) * 1000) / 1000)
}
/**
 * A stand-in when the real waveform can't be fetched: a calm made-up shape
 * from the track's name (the same every time). It is NOT the song's sound;
 * the UI marks it as such.
 */
export function fakeWave(seed: string, bars: number): number[] {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296
  const n = Math.max(1, Math.min(400, Math.round(bars)))
  return Array.from({ length: n }, (_, i) => {
    const env = 0.55 + 0.35 * Math.sin((i / n) * Math.PI)
    return Math.round(Math.max(0.12, Math.min(1, env * (0.6 + 0.4 * rnd()))) * 1000) / 1000
  })
}
/** Where a click on the waveform lands, 0–1. */
export const seekFraction = (x: number, left: number, width: number) => Math.max(0, Math.min(1, (x - left) / Math.max(1, width)))

// ---- the sleep timer ----

export const SLEEP_CHOICES = [15, 30, 60] as const
export const SLEEP_FADE_MS = 45_000
/** The volume while the sleep timer runs: yours until the last 45 s, then down to 0 at the end. */
export function sleepVolume(now: number, endsAt: number, base: number, fadeMs = SLEEP_FADE_MS): number {
  const left = endsAt - now
  if (left <= 0) return 0
  if (left >= fadeMs) return base
  return Math.round(base * (left / fadeMs))
}
/** "12 min" / "45 s" left on the sleep timer. */
export function sleepLeft(now: number, endsAt: number): string {
  const s = Math.max(0, Math.ceil((endsAt - now) / 1000))
  return s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`
}

// ---- the colour from the artwork ----

export interface Rgb { r: number; g: number; b: number }
/**
 * The artwork's main colour from its pixels (RGBA, a small sample): pixels
 * are grouped into coarse buckets, and the bucket with the most colourful,
 * not-too-dark, not-too-bright pixels wins. Grey artwork gives its grey.
 */
export function pickColor(data: ArrayLike<number>, fallback: Rgb): Rgb {
  const buckets = new Map<number, { n: number; w: number; r: number; g: number; b: number }>()
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
    if (a < 128) continue
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const sat = max ? (max - min) / max : 0
    // Near-black and near-white say little about a cover's colour.
    const edge = lum < 22 || lum > 240 ? 0.08 : 1
    const w = edge * (0.15 + sat * sat * 2.5)
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
    const k = buckets.get(key) ?? { n: 0, w: 0, r: 0, g: 0, b: 0 }
    k.n++
    k.w += w
    k.r += r
    k.g += g
    k.b += b
    buckets.set(key, k)
  }
  let best: { n: number; w: number; r: number; g: number; b: number } | null = null
  for (const k of buckets.values()) if (!best || k.w > best.w) best = k
  if (!best || !best.n) return fallback
  return { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n) }
}
/** A colour made bright enough to glow on dark glass and soft enough for light (same hue). */
export function glowColor(c: Rgb): Rgb {
  const max = Math.max(c.r, c.g, c.b)
  if (max < 1) return { r: 120, g: 120, b: 130 }
  const lift = max < 150 ? 150 / max : 1
  const cap = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return { r: cap(c.r * lift), g: cap(c.g * lift), b: cap(c.b * lift) }
}
export const rgbText = (c: Rgb) => `${c.r} ${c.g} ${c.b}`
/** "#d4ff3f" → rgb (the accent fallback); anything else → the app's lime. */
export function hexRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 200, g: 241, b: 53 }
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/**
 * A made-up beat for the breathing artwork. The music plays inside
 * SoundCloud's cross-origin frame, so its sound can't be analysed: this is a
 * calm tempo (70–118 per minute) picked from the track's name, not the real one.
 */
export function pseudoBeat(seed: string): number {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return 70 + (h % 49)
}

// ---- the focus mix and the pauses ----

/** When a focus timer starts: play the focus mix (if you picked one), or pause (with that switch on). */
export function onFocusStart(o: { mix: Station | null; pauseInFocus: boolean; playing: boolean; playingUrl: string | null }): 'mix' | 'pause' | null {
  if (o.mix) return o.playing && o.playingUrl === o.mix.url ? null : 'mix'
  return o.playing && o.pauseInFocus ? 'pause' : null
}

// ---- what Ben may see (off by default) ----

export interface MusicNow { line: string; at: number }
/** The short line saved for Ben while something plays. */
export function nowPlayingLine(o: { title: string; artist: string; station?: string }): string {
  const t = line(o.title, 80)
  if (!t) return ''
  const a = line(o.artist, 40)
  const st = line(o.station, 40)
  return `${t}${a ? ` by ${a}` : ''}${st && st !== t ? ` (station ${st})` : ''}`
}
export function cleanMusicNow(v: any): MusicNow | null {
  const l = line(v?.line, 160)
  const at = Number(v?.at)
  return l && Number.isFinite(at) ? { line: l, at } : null
}
/** Ben's context line: only while fresh (20 min), so an old song is never "now". */
export function musicNowContext(v: unknown, now: number): string | null {
  const m = cleanMusicNow(v)
  if (!m || now - m.at > 20 * 60_000 || m.at - now > 60_000) return null
  return `Music playing on SoundCloud now: ${m.line}.`
}

// ---- several players: SoundCloud here, and the players on the PC ----

export interface PlayerInfo {
  /** 'sc' or 'sys:<Windows id>'. */
  id: string
  name: string
  playing: boolean
  title: string
  artist: string
}
/**
 * Which player the views follow: the pinned one while it is there; else the
 * one playing (SoundCloud first); else SoundCloud if loaded; else the first.
 */
export function pickPlayer(list: PlayerInfo[], pin: string | null): PlayerInfo | null {
  if (!list.length) return null
  const pinned = pin ? list.find((p) => p.id === pin) : null
  if (pinned) return pinned
  return list.find((p) => p.id === 'sc' && p.playing) ?? list.find((p) => p.playing) ?? list.find((p) => p.id === 'sc') ?? list[0]
}
