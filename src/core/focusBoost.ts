// Focus boost: the settings for the "Life boost" focus picks, in one synced
// setting (`focus_boost`), and the log of session goals, verdicts and
// stalling reasons (`focus_log`). Settings → Ben → Focus boost.
//   DX4 the push ladder (core/pushLadder.ts)       DX7 stalling fixes (core/stallFix.ts)
//   DX9 launch kits (core/launchKit.ts)            DX10 session goal + verdict (core/sessionGoal.ts)
//   DX19 morning countdown (core/morningLaunch.ts) LF14 Dojo mode (core/dojo.ts)
//   LF20 win music (core/winMoments.ts)            DX12 workout-only music lives with the
//   stations in island_kit.music (core/musicOnly.ts), so the island's player sees it.
// Pure: no database here.
import { cleanLadder, DEFAULT_LADDER, type LadderPrefs } from './pushLadder'
import { cleanKits, type LaunchKit } from './launchKit'
import { cleanMorning, DEFAULT_MORNING, type MorningPrefs } from './morningLaunch'
import { cleanDojo, DEFAULT_DOJO, type DojoPrefs } from './dojo'
import { cleanWins, DEFAULT_WINS, type WinPrefs } from './winMoments'
import { cleanSessions, type SessionRec } from './sessionGoal'
import { cleanStalls, type StallEntry } from './stallFix'

export const BOOST_KEY = 'focus_boost'
export const BOOST_LOG_KEY = 'focus_log'

export interface BoostPrefs {
  ladder: LadderPrefs
  /** DX7: offer the reasons on Snooze / Skip. */
  stall: boolean
  /** DX10: ask for a one-line goal when a timer starts, and Done / Half / Not at the end. */
  goals: boolean
  kits: LaunchKit[]
  morning: MorningPrefs
  dojo: DojoPrefs
  wins: WinPrefs
}
export const DEFAULT_BOOST: BoostPrefs = { ladder: DEFAULT_LADDER, stall: true, goals: true, kits: [], morning: DEFAULT_MORNING, dojo: DEFAULT_DOJO, wins: DEFAULT_WINS }

export function cleanBoost(raw: unknown): BoostPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof BoostPrefs, unknown>>
  return {
    ladder: cleanLadder(o.ladder),
    stall: typeof o.stall === 'boolean' ? o.stall : DEFAULT_BOOST.stall,
    goals: typeof o.goals === 'boolean' ? o.goals : DEFAULT_BOOST.goals,
    kits: cleanKits(o.kits),
    morning: cleanMorning(o.morning),
    dojo: cleanDojo(o.dojo),
    wins: cleanWins(o.wins)
  }
}

export interface BoostLog {
  sessions: SessionRec[]
  stalls: StallEntry[]
}
export function cleanBoostLog(raw: unknown): BoostLog {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof BoostLog, unknown>>
  return { sessions: cleanSessions(o.sessions), stalls: cleanStalls(o.stalls) }
}

/** The app's way in (life.boost, src/renderer/src/web/boostStore.ts). */
export interface BoostApi {
  get(): Promise<BoostPrefs>
  save(p: BoostPrefs): Promise<BoostPrefs>
  log(): Promise<BoostLog>
  /** DX10: the one-line goal of the session that started at `id` (its ISO start). */
  goal(o: { id: string; day: string; subject: string; goal: string }): Promise<void>
  /** DX10: Done / Half / Not; also a block result for Ben's learning. */
  verdict(o: { id: string; day: string; subject: string; verdict: import('./sessionGoal').Verdict; minutes: number }): Promise<void>
  /** DX7: why you stalled (saved; tired / boring also on Ben's desk). */
  stall(o: { reason: import('./stallFix').StallReason; subject: string }): Promise<void>
}
