// Level curve adapted from the Workout Crew bot (leveling_service.py).
export const MAX_LEVEL = 150

export function xpToNext(level: number): number {
  return Math.round(80 * Math.pow(level, 1.3))
}

export interface LevelInfo {
  level: number
  xpIntoLevel: number
  xpForNext: number
  progress: number // 0..1
  rank: string
}

export const RANKS: { minLevel: number; name: string }[] = [
  { minLevel: 1, name: 'Recruit' },
  { minLevel: 5, name: 'Apprentice' },
  { minLevel: 10, name: 'Hunter' },
  { minLevel: 20, name: 'Elite' },
  { minLevel: 35, name: 'Veteran' },
  { minLevel: 50, name: 'Master' },
  { minLevel: 75, name: 'Champion' },
  { minLevel: 100, name: 'Legend' }
]

export function rankFor(level: number): string {
  let name = RANKS[0].name
  for (const r of RANKS) if (level >= r.minLevel) name = r.name
  return name
}

export function levelInfo(totalXp: number): LevelInfo {
  let level = 1
  let left = Math.max(0, Math.floor(totalXp))
  while (level < MAX_LEVEL && left >= xpToNext(level)) {
    left -= xpToNext(level)
    level++
  }
  const xpForNext = level >= MAX_LEVEL ? 0 : xpToNext(level)
  return {
    level,
    xpIntoLevel: left,
    xpForNext,
    progress: xpForNext ? left / xpForNext : 1,
    rank: rankFor(level)
  }
}
