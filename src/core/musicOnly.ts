// DX12: workout-only music (a temptation bundle). A station or a starred
// track can be marked "only during workout" or "only during boring tasks".
// The island's player then plays it only while such a timer runs: started
// another time, it pauses at once and says why; when a matching timer starts
// and nothing plays, it starts by itself. Pairing what you want with what you
// should do is Rewards' "Pair it" rule, felt every day. Pure and tested.
import { kindOf } from './benLearn'
import type { Station } from './soundcloud'

export type OnlyDuring = 'workout' | 'boring'
export const ONLY_LABEL: Record<OnlyDuring, string> = { workout: 'Only during workout', boring: 'Only during boring tasks' }
export const ONLY_SHORT: Record<OnlyDuring, string> = { workout: '🏋 workout only', boring: '🥱 boring only' }

/** Saved marks (station or track address → when), checked. */
export function cleanOnly(raw: unknown): Record<string, OnlyDuring> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Record<string, OnlyDuring> = {}
  for (const [k, v] of Object.entries(o).slice(0, 80)) if (/^https:\/\/(www\.|m\.)?soundcloud\.com\//i.test(k) && (v === 'workout' || v === 'boring')) out[k.slice(0, 300)] = v
  return out
}
/** The next choice for a chip: none → workout → boring → none. */
export const nextOnly = (cur: OnlyDuring | undefined): OnlyDuring | undefined => (cur === undefined ? 'workout' : cur === 'workout' ? 'boring' : undefined)

/** Words that make a task "boring" (besides chores and admin). */
const BORING = /\b(boring|laundry|dishes|clean|tidy|email|inbox|invoice|taxes|forms?|admin|paperwork|filing|errands?|groceries)\b/i

/** What kind of timer runs: a workout, a boring task, something else, or none. */
export function timerMode(subject: string | null | undefined, workout = false): OnlyDuring | 'other' | null {
  if (workout) return 'workout'
  if (!subject) return null
  const k = kindOf(subject)
  if (k === 'sport') return 'workout'
  if (k === 'chores' || k === 'admin' || BORING.test(subject)) return 'boring'
  return 'other'
}

/** May this address play now? Unmarked music always may. */
export function mayPlay(url: string | null | undefined, only: Record<string, OnlyDuring>, mode: OnlyDuring | 'other' | null): boolean {
  const need = url ? only[url] : undefined
  return !need || need === mode
}

/** The station to start when a matching timer begins (the first marked one), or null. */
export function stationFor(stations: Station[], only: Record<string, OnlyDuring>, mode: OnlyDuring | 'other' | null): Station | null {
  if (mode !== 'workout' && mode !== 'boring') return null
  return stations.find((s) => only[s.url] === mode) ?? null
}

/** The words when it pauses. */
export const pausedWhy = (need: OnlyDuring) => (need === 'workout' ? 'That one is your workout music: start a workout to play it.' : 'That one is for boring tasks: start one to play it.')
