// LF20: soundtrack moments tied to wins. You pick a personal victory track
// and a focus theme from your SoundCloud stations or starred tracks; on a big
// win (a workout done, a level up, a goal milestone, a season's end, a boss
// beaten) a short clip of the victory track plays through the app's one
// SoundCloud player. The focus theme plays when Dojo mode opens.
// Rules: off until you switch it on; short (10–30 s, then it
// stops); never in a meeting or quiet hours; never over music you are
// already playing (it would cut it off); at most one clip every 10 minutes.
// Pure and tested.

export type WinKind = 'workout' | 'levelUp' | 'goal' | 'season' | 'boss'
export const WIN_KINDS: { id: WinKind; label: string; icon: string }[] = [
  { id: 'workout', label: 'A workout done', icon: '🏋' },
  { id: 'levelUp', label: 'A level up', icon: '⭐' },
  { id: 'goal', label: 'A goal milestone', icon: '🏆' },
  { id: 'season', label: 'A season ends', icon: '🍂' },
  { id: 'boss', label: 'A boss beaten', icon: '🐉' }
]
export const isWinKind = (x: unknown): x is WinKind => WIN_KINDS.some((k) => k.id === x)

export interface Track {
  url: string
  name: string
}
export interface WinPrefs {
  on: boolean
  victory: Track | null
  theme: Track | null
  /** Seconds of the clip. */
  clipSec: number
  kinds: Record<WinKind, boolean>
}
export const DEFAULT_WINS: WinPrefs = { on: false, victory: null, theme: null, clipSec: 15, kinds: { workout: true, levelUp: true, goal: true, season: true, boss: true } }

const okSc = (u: unknown) => typeof u === 'string' && /^https:\/\/(www\.|m\.)?soundcloud\.com\/[^\s]+$/i.test(u) && u.length <= 300
const track = (t: unknown): Track | null => {
  const o = t as Partial<Track> | null
  return o && okSc(o.url) ? { url: String(o.url), name: String(o.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Your track' } : null
}
export function cleanWins(raw: unknown): WinPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<WinPrefs>
  const clip = typeof o.clipSec === 'number' && Number.isFinite(o.clipSec) ? Math.max(10, Math.min(30, Math.round(o.clipSec))) : DEFAULT_WINS.clipSec
  const k = (o.kinds && typeof o.kinds === 'object' ? o.kinds : {}) as Record<string, unknown>
  return {
    on: o.on === true,
    victory: track(o.victory),
    theme: track(o.theme),
    clipSec: clip,
    kinds: Object.fromEntries(WIN_KINDS.map((w) => [w.id, typeof k[w.id] === 'boolean' ? (k[w.id] as boolean) : true])) as Record<WinKind, boolean>
  }
}

export const WIN_GAP_MS = 10 * 60_000

/** Should the victory clip play for this win now? */
export function winClip(o: { prefs: WinPrefs; kind: WinKind; now: number; meeting: boolean; quiet: boolean; musicPlaying: boolean; lastAt: number | null }): { play: true; track: Track; ms: number } | { play: false; why: string } {
  if (!o.prefs.on) return { play: false, why: 'off' }
  if (!o.prefs.victory) return { play: false, why: 'no victory track picked' }
  if (!o.prefs.kinds[o.kind]) return { play: false, why: 'off for this kind of win' }
  if (o.meeting) return { play: false, why: 'in a meeting' }
  if (o.quiet) return { play: false, why: 'quiet hours' }
  if (o.musicPlaying) return { play: false, why: 'your music is playing' }
  if (o.lastAt != null && o.now - o.lastAt < WIN_GAP_MS) return { play: false, why: 'one just played' }
  return { play: true, track: o.prefs.victory, ms: o.prefs.clipSec * 1000 }
}

export const winTitle = (k: WinKind) => ({ workout: 'Workout done', levelUp: 'Level up', goal: 'Goal milestone', season: 'Season complete', boss: 'Boss beaten' })[k]
