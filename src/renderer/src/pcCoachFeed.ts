// Ben on your PC, the app window's side (desktop only): feeds the live coach
// (core/pcCoach.ts) from what the app window already has (the Smart island's
// activity stream, idle time, today's blocks, My life) on every island build,
// so there is no new timer or polling loop. Today's totals come from the
// desktop's own day file at most every 3 minutes. Its memory (what it said,
// "Less of this") stays in this PC's storage. It never logs anything itself:
// the water, push-ups, bedtime and timers are your taps (IslandFeed).
import { cleanCoachState, coachAlert, coachMuted, coachOffPatch, coachOnPatch, coachReady, coachResume, decideCoach, answerCoach, type CoachInput, type CoachKind, type CoachOp, type CoachState } from '@core/pcCoach'
import { DISTRACT_CONTEXTS, WORK_CONTEXTS, type ContextKind } from '@core/activityContext'
import type { IslandAlert } from '@core/islandModel'
import type { PcPrefs } from '@core/pcActivity'
import { calendarDay } from '@core/dates'
import { pcPrefsNow, refresh as refreshSmart, spans } from './smartIsland'

const STATE = 'ls.pcCoach'
const dayOf = (t: number) => calendarDay(new Date(t))
const read = (now = Date.now()): CoachState => {
  try {
    return cleanCoachState(JSON.parse(localStorage.getItem(STATE) || 'null'), dayOf(now))
  } catch {
    return cleanCoachState(null, dayOf(now))
  }
}
const write = (s: CoachState) => {
  try {
    localStorage.setItem(STATE, JSON.stringify(s))
  } catch {
    /* fine */
  }
}

/** Today's real work on this PC (the desktop's day file), at most every 3 minutes. */
let totals: { at: number; day: string; min: number; by: Partial<Record<ContextKind, number>>; distractMin: number } = { at: 0, day: '', min: 0, by: {}, distractMin: 0 }
async function dayWork(now: number): Promise<CoachInput['dayWork']> {
  const day = dayOf(now)
  if (now - totals.at > 3 * 60_000 || totals.day !== day) {
    totals.at = now
    const d = await window.desktop?.pcDoing?.().catch(() => null)
    if (d) {
      const by: Partial<Record<ContextKind, number>> = {}
      for (const [k, sec] of Object.entries(d.ctx ?? {})) by[k as ContextKind] = Math.round(Number(sec) / 60)
      const sum = (ks: ContextKind[]) => ks.reduce((t, k) => t + (by[k] ?? 0), 0)
      totals = { at: now, day, min: sum(WORK_CONTEXTS), by, distractMin: sum(DISTRACT_CONTEXTS) }
    } else if (totals.day !== day) totals = { at: now, day, min: 0, by: {}, distractMin: 0 }
  }
  return { min: totals.min, by: totals.by, distractMin: totals.distractMin }
}

export const coachOn = () => coachReady(pcPrefsNow())

/** The coach's card now, or null. `o` is what the island build already knows. */
export async function coachTick(o: Omit<CoachInput, 'day' | 'on' | 'desktop' | 'sessions' | 'dayWork'>): Promise<IslandAlert | null> {
  const desktop = !!window.desktop?.pcGetPrefs
  if (!desktop) return null
  const on = coachOn()
  const r = decideCoach({ ...o, day: dayOf(o.now), on, desktop, sessions: on ? spans(o.now) : [], dayWork: on ? await dayWork(o.now) : { min: 0, by: {}, distractMin: 0 } }, read(o.now))
  write(r.state)
  return r.reaction ? coachAlert(r.reaction) : null
}

/** Your answer on a coach card (the island's own logging happens in IslandFeed). Returns a few words back. */
export async function coachAnswer(kind: CoachKind, op: CoachOp, minutes?: number): Promise<string | null> {
  const now = Date.now()
  const r = answerCoach(read(now), kind, op, now, minutes)
  write(r.state)
  if (op === 'enable') await setCoach(true)
  return r.said
}

/** Settings and the setup card: the one switch ("Let Ben see what I'm doing"). */
export async function setCoach(on: boolean): Promise<PcPrefs | null> {
  const p = (await window.desktop?.pcSetPrefs?.(on ? coachOnPatch() : coachOffPatch()).catch(() => null)) ?? null
  if (on) {
    const s = read()
    write({ ...s, setup: { ...s.setup, answered: true } })
  }
  await refreshSmart(true).catch(() => {})
  window.dispatchEvent(new Event('life-island-refresh'))
  return p
}

/** Settings: the kinds you turned down or off, and turning one back on. */
export const coachMutedKinds = () => coachMuted(read())
export function coachTurnBackOn(k: CoachKind) {
  write(coachResume(read(), k))
}

/** DX4: the drift Ben spoke about, still going (video, games or social in front now): when it began, or null. */
export function driftNow(now = Date.now()): { since: number } | null {
  const s = read(now)
  if (!s.drift) return null
  const cur = spans(now).slice(-1)[0]
  const ctx = cur && cur.end >= now - 60_000 ? cur.context : null
  return ctx && DISTRACT_CONTEXTS.includes(ctx) ? { since: s.drift.start } : null
}
