// Starter stations: a few public SoundCloud label and curator pages, so the
// Music page plays something on the first tap instead of asking for a link.
// They are ordinary stations (core/soundcloud.ts) with an icon and two
// colours for their generated cover. You can hide any of them (synced in
// island_kit.music.hiddenStarters); one that SoundCloud won't play on this
// device is marked unavailable and hidden by itself (music/stationHealth.ts),
// and tried again a week later. "Play something for now" picks one by the time
// of day and what you're doing. Pure; tested in starterStations.test.ts.
import type { Station } from './soundcloud'

export type Vibe = 'lofi' | 'focus' | 'chill' | 'jazz' | 'ambient' | 'workout' | 'classical' | 'soul'
export interface StarterStation extends Station {
  vibe: Vibe
  icon: string
  /** One short line under the name. */
  blurb: string
  /** The generated cover: two colours (hex) for a gradient. */
  colors: [string, string]
}

/**
 * Public profiles of well-known labels and curators (profiles change less
 * often than playlists). The sandbox this was built in could not reach
 * SoundCloud, so each one is checked on your device the first time it plays.
 */
export const STARTER_STATIONS: StarterStation[] = [
  { id: 'svlofi', vibe: 'lofi', name: 'Lofi beats', blurb: 'Chillhop Music', url: 'https://soundcloud.com/chillhopdotcom', kind: 'profile', icon: '🎧', colors: ['#8b5cf6', '#f472b6'] },
  { id: 'svfocus', vibe: 'focus', name: 'Deep focus', blurb: 'Erased Tapes: piano and strings', url: 'https://soundcloud.com/erasedtapes', kind: 'profile', icon: '🎯', colors: ['#0ea5e9', '#1e3a8a'] },
  { id: 'svchill', vibe: 'chill', name: 'Chill electronic', blurb: 'MrSuicideSheep', url: 'https://soundcloud.com/mrsuicidesheep', kind: 'profile', icon: '🌊', colors: ['#14b8a6', '#6366f1'] },
  { id: 'svjazz', vibe: 'jazz', name: 'Jazz cafe', blurb: 'Jazz hop and soft keys', url: 'https://soundcloud.com/jazzhopcafe', kind: 'profile', icon: '☕', colors: ['#f59e0b', '#7c2d12'] },
  { id: 'svambient', vibe: 'ambient', name: 'Ambient drift', blurb: 'Ultimae Records', url: 'https://soundcloud.com/ultimae', kind: 'profile', icon: '🌧', colors: ['#64748b', '#0f766e'] },
  { id: 'svworkout', vibe: 'workout', name: 'Upbeat workout', blurb: 'Monstercat', url: 'https://soundcloud.com/monstercat', kind: 'profile', icon: '⚡', colors: ['#ef4444', '#f97316'] },
  { id: 'svclassic', vibe: 'classical', name: 'Classical study', blurb: 'Deutsche Grammophon', url: 'https://soundcloud.com/deutschegrammophon', kind: 'profile', icon: '🎻', colors: ['#a16207', '#fde68a'] },
  { id: 'svsoul', vibe: 'soul', name: 'Evening soul', blurb: 'Majestic Casual', url: 'https://soundcloud.com/majesticcasual', kind: 'profile', icon: '🌙', colors: ['#be185d', '#312e81'] }
]
export const isStarterUrl = (url: string | null | undefined) => !!url && STARTER_STATIONS.some((s) => s.url === url)
export const starterByUrl = (url: string | null | undefined) => (url ? STARTER_STATIONS.find((s) => s.url === url) ?? null : null)

/** Only ids of real starters, once each. */
export function cleanHiddenStarters(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const ids = new Set(STARTER_STATIONS.map((s) => s.id))
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && ids.has(x)))]
}
export const toggleHidden = (hidden: string[], id: string) => (hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id])

// ---- unavailable on this device ----

/** Station address → when it failed (ms). */
export type Unavailable = Record<string, number>
/** A failed station is tried again after a week (it may be back). */
export const RETRY_AFTER_MS = 7 * 24 * 3600_000
export function cleanUnavailable(v: unknown, now: number): Unavailable {
  const out: Unavailable = {}
  if (!v || typeof v !== 'object') return out
  for (const [k, t] of Object.entries(v as Record<string, unknown>)) {
    const n = Number(t)
    if (isStarterUrl(k) && Number.isFinite(n) && now - n < RETRY_AFTER_MS && n - now < 60_000) out[k] = n
  }
  return out
}

/** The starters to show: not hidden by you, not unavailable here. Your own stations' addresses aren't repeated. */
export function visibleStarters(o: { hidden: string[]; unavailable: Unavailable; mine?: Station[] }): StarterStation[] {
  const mine = new Set((o.mine ?? []).map((s) => s.url))
  return STARTER_STATIONS.filter((s) => !o.hidden.includes(s.id) && !(s.url in o.unavailable) && !mine.has(s.url))
}

/**
 * Did SoundCloud play the station? 'bad' when the player reported an error,
 * or when it never showed a track: not ready 25 s after you pressed play, or
 * ready but with no track 15 s later (a page that doesn't exist plays
 * nothing). 'ok' once a track shows; 'wait' until then.
 */
export function stationVerdict(o: { since: number; now: number; ready: boolean; readyAt: number | null; title: string; error: string }): 'ok' | 'bad' | 'wait' {
  if (o.title) return 'ok'
  if (o.error) return 'bad'
  if (!o.ready) return o.now - o.since > 25_000 ? 'bad' : 'wait'
  return o.now - (o.readyAt ?? o.since) > 15_000 ? 'bad' : 'wait'
}

// ---- "Play something for now" ----

export interface NowCtx {
  hour: number
  /** A focus timer runs. */
  focus?: boolean
  /** A workout or sport block is on (from the timer's or the block's name). */
  workout?: boolean
}
const SPORT = /\b(work ?out|gym|sport|run|running|training|train|lift|cardio|reps|push-?ups|yoga|hiit)\b/i
/** Does this timer or calendar block sound like exercise? */
export const looksLikeWorkout = (...names: (string | null | undefined)[]) => names.some((n) => !!n && SPORT.test(n))

/** Which vibes fit now, best first. */
export function vibesFor(c: NowCtx): Vibe[] {
  if (c.workout) return ['workout', 'chill', 'lofi']
  if (c.focus) return ['focus', 'lofi', 'classical', 'ambient']
  const h = ((Math.floor(c.hour) % 24) + 24) % 24
  if (h >= 5 && h < 10) return ['jazz', 'lofi', 'classical']
  if (h >= 10 && h < 17) return ['lofi', 'focus', 'classical', 'chill']
  if (h >= 17 && h < 22) return ['chill', 'soul', 'jazz', 'lofi']
  return ['ambient', 'soul', 'lofi']
}
/** Why it picked that (a few words for the button's hint). */
export function whyPick(c: NowCtx): string {
  if (c.workout) return 'for your workout'
  if (c.focus) return 'for focus'
  const h = ((Math.floor(c.hour) % 24) + 24) % 24
  return h >= 5 && h < 12 ? 'for the morning' : h < 17 ? 'for the afternoon' : h < 22 ? 'for the evening' : 'for late night'
}

/** The station to play now from the ones you can see: the best vibe, else the first one shown, else null. */
export function pickForNow(c: NowCtx, list: StarterStation[]): StarterStation | null {
  for (const v of vibesFor(c)) {
    const s = list.find((x) => x.vibe === v)
    if (s) return s
  }
  return list[0] ?? null
}
