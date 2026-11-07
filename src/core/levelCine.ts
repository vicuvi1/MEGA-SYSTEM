// The level-up cinematic (LF7): a full-screen 5-second scene for the rare,
// real milestones only: a new Hunter rank (not every level) and the season
// moments (a season starts, halfway, the boss is weak, the boss is beaten).
// The screen darkens, a light blade sweeps across, the new title rises, a
// deep synth hit lands and the island flashes the rank colour. Each moment
// plays once across your devices (`saga_arc.played`). Pure: what to play,
// its timeline and its sound; the scene is drawn by LevelCinematic.tsx.
import { hunterDefFor } from './levels'
import type { SeasonMoment } from './season'
import type { Voice } from './sounds'

export interface Cinematic {
  id: string
  kind: 'rank' | SeasonMoment['kind']
  /** Small line above the title ("NEW RANK", "SEASON 3"). */
  over: string
  title: string
  sub: string
  color: string
  badge: string
}

/** A new rank between two levels (null for an ordinary level-up). */
export function rankUp(prevLevel: number, level: number): Cinematic | null {
  if (!(level > prevLevel) || prevLevel < 1) return null
  const a = hunterDefFor(prevLevel)
  const b = hunterDefFor(level)
  if (a.name === b.name) return null
  return { id: `rank:${b.minLevel}`, kind: 'rank', over: `New rank · Level ${level}`, title: b.title, sub: b.name, color: b.color, badge: b.badge }
}

const SEASON_LOOK: Record<SeasonMoment['kind'], { over: string; badge: string }> = {
  'season-start': { over: 'A new season begins', badge: '⛩️' },
  'season-half': { over: 'Season · halfway', badge: '🌗' },
  'boss-ready': { over: 'Boss weakened', badge: '⚔️' },
  'boss-won': { over: 'Victory', badge: '🏆' },
  'season-end': { over: 'Season complete', badge: '📜' }
}

export function seasonCinematic(m: SeasonMoment, color: string): Cinematic {
  const look = SEASON_LOOK[m.kind]
  return { id: m.id, kind: m.kind, over: look.over, title: m.title, sub: m.sub, color, badge: look.badge }
}

/** The next one to play: the first not played yet (a rank first, then season moments in order). */
export function nextCinematic(candidates: Cinematic[], played: string[]): Cinematic | null {
  const seen = new Set(played)
  const order = (c: Cinematic) => (c.kind === 'rank' ? 0 : 1)
  return [...candidates].sort((a, b) => order(a) - order(b)).find((c) => !seen.has(c.id)) ?? null
}

/** The scene's beats in ms from the start (5 s in all; reduced motion keeps only the still title). */
export const CINE = { darken: 0, sweep: 650, flash: 1150, title: 1300, sub: 1900, out: 4300, end: 5000 } as const
export const CINE_REDUCED_MS = 3200

/** The synth hit: a deep falling sub, a soft noise swoosh with the blade, and a bright chord on the title. */
export function synthHit(): Voice[] {
  const s = CINE.sweep / 1000
  const t = CINE.flash / 1000
  return [
    { f: 1800, f2: 400, at: s - 0.25, len: 0.55, gain: 0.05, noise: true, fixed: true, lp: [6000, 900] },
    { f: 110, f2: 41, at: t, len: 1.6, gain: 0.34, wave: 'sine', attack: 0.004, fixed: true },
    { f: 55, f2: 36, at: t, len: 2.2, gain: 0.22, wave: 'triangle', attack: 0.004, fixed: true },
    { f: 220, at: t + 0.02, len: 1.8, gain: 0.07, wave: 'sawtooth', attack: 0.01, lp: [2400, 300], fixed: true },
    { f: 523.25, at: t + 0.18, len: 1.6, gain: 0.05, wave: 'triangle', attack: 0.03 },
    { f: 659.25, at: t + 0.24, len: 1.5, gain: 0.045, wave: 'triangle', attack: 0.03 },
    { f: 783.99, at: t + 0.3, len: 1.5, gain: 0.04, wave: 'triangle', attack: 0.03 },
    { f: 1046.5, at: t + 0.36, len: 1.7, gain: 0.035, wave: 'sine', attack: 0.04 }
  ]
}
