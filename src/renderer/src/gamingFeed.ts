// Game time, the app window's side (desktop only). core/gaming.ts does the
// counting (pure, tested); this reads the program in front from the Smart
// island's activity stream (names only: never a window title or a screenshot),
// keeps the minutes per day in this PC's storage, and gives the island its
// counter, the peek when a session ends, and the gentle limit notes.
// It needs the active-app sensor ("Let Ben see what I'm doing"): off by default.
import type { IslandAlert } from '@core/islandModel'
import type { PushLevel } from '@core/lifeFit'
import {
  cleanGaming, cleanGamingState, endedAlert, gameOf, gamingLine, gamingStep, gamingView, limitAlert, markWarned, todayMin,
  type GamingPrefs, type GamingState, type GamingView
} from '@core/gaming'
import { pcPrefsNow } from './smartIsland'
import { setCoach } from './pcCoachFeed'

const PREFS = 'ls.gaming'
const STATE = 'ls.gamingState'
export const GAMING_EVENT = 'life-gaming-changed'

const read = (k: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null')
  } catch {
    return null
  }
}
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* fine */
  }
}

export const gamingPrefs = (): GamingPrefs => cleanGaming(read(PREFS))
export function setGamingPrefs(patch: Partial<GamingPrefs>): GamingPrefs {
  const next = cleanGaming({ ...gamingPrefs(), ...patch })
  write(PREFS, next)
  window.dispatchEvent(new Event(GAMING_EVENT))
  window.dispatchEvent(new Event('life-island-refresh'))
  return next
}
/** The sensor the counter needs: the app in front (and the Smart island that sorts it). */
export const gamingSensorOn = (): boolean => {
  const p = pcPrefsNow()
  return !!p?.activeApp && !!p.smart
}
/** The one switch Settings offers when the counter is on but the sensor is off. */
export const turnOnSensor = () => setCoach(true)

let state: GamingState | null = null
let card: { alert: IslandAlert; until: number } | null = null
const load = () => (state ??= cleanGamingState(read(STATE)))
const save = (s: GamingState) => {
  state = s
  write(STATE, { days: s.days, warned: s.warned })
}

export interface GamingTick { view: GamingView | null; alert: IslandAlert | null; line: string | null; todayMin: number }

/** One look per island build. `doing`: what the Smart island sees now (program name and how it sorted it). */
export function gamingTick(o: { now: number; doing: { app: string; ctx: string } | null; push: PushLevel; quiet: boolean; busy: boolean }): GamingTick {
  const prefs = gamingPrefs()
  if (!prefs.on) return { view: null, alert: null, line: null, todayMin: 0 }
  const { now } = o
  const game = gamingSensorOn() ? gameOf(o.doing?.app, prefs.extra, o.doing?.ctx) : null
  const r = gamingStep(load(), { now, game })
  let s = r.state
  if (r.ended && r.ended.sessionMin >= 1 && !o.quiet) card = { alert: endedAlert(r.ended, now), until: now + 90_000 }
  // A gentle limit note, not while you are in a meeting, a focus timer or quiet hours; it waits for the next look.
  if (!card || card.until <= now) {
    card = null
    if (!o.quiet && !o.busy) {
      const l = limitAlert({ st: s, prefs, push: o.push, now })
      if (l) {
        s = markWarned(s, l.key, now)
        card = { alert: l.alert, until: now + 3 * 60_000 }
      }
    }
  }
  save(s)
  return { view: gamingView(s, prefs, now), alert: card && card.until > now ? card.alert : null, line: gamingLine(s, prefs, now), todayMin: todayMin(s, now) }
}

/** The totals line for Ben's day log (only with "Share totals" on): totals only, no app names. */
export const gamingLineNow = (now: number): string | null => gamingLine(load(), gamingPrefs(), now)
