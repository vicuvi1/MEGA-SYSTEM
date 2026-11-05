// Smart island (SI3–SI6): the queue of suggestions. Each one is a small offer
// ("Back to Algorithms?") that becomes an island alert with Accept / Not now /
// Never. There's a daily budget (6 by default), a cooldown per kind, a
// "never" list, and the island's own rules on top (quiet, calls, full screen,
// the gap between pop-ups: alertGate). It also learns (SI6): what you keep
// ignoring becomes a dot, and what you almost never take stops, with one
// notice and a way back in Settings. Pure and tested.
//
// Honest points: a suggestion only ever starts a timer or opens something;
// any "log it" stays a tap on the app's own logging button.
import type { IslandAction, IslandAlert } from './islandModel'
import type { ContextKind } from './activityContext'

export type SuggestKind =
  | 'ctx' // SI1: "what am I doing?" fix
  | 'back' // SI3: back to your block
  | 'startBlock' // SI4: start a block from what you opened
  | 'break' // SI12: a break at a natural pause
  | 'bedGaming' // SI13: gaming near bedtime
  | 'spend' // SI14: log spending after the bank
  | 'nextMustdo' // SI15: next must-do when drifting
  | 'emailBox' // SI16: email timebox
  | 'resume' // SI18: come back after a long distraction
  | 'bedtime' // SI20: closed the laptop late
  | 'recipe' // SI7: a recipe's first run, or one Ben proposes (SI24)
  | 'note' // a meeting ended: a note?
  | 'closeDay' // SI27: close the day in one go

export const SUGGEST_LABEL: Record<SuggestKind, string> = {
  ctx: 'What am I doing?',
  back: 'Back to your block',
  startBlock: 'Start a block from what you opened',
  break: 'Breaks at natural pauses',
  bedGaming: 'Gaming near bedtime',
  spend: 'Log spending after the bank',
  nextMustdo: 'Next must-do when drifting',
  emailBox: 'Box email time',
  resume: 'Come back after a long distraction',
  bedtime: 'Bedtime from closing the laptop',
  recipe: 'Automations',
  note: 'A note after a meeting',
  closeDay: 'Close the day in one go'
}

export interface Suggestion {
  /** Unique per moment ("back:<block>"): offered once. */
  id: string
  sk: SuggestKind
  title: string
  text: string
  face?: string
  accept: { label: string; action: IslandAction }
  /** A second choice (Push 15), shown between Accept and Not now. */
  extra?: { label: string; action: IslandAction }
  /** "Not now" hides it for this long (min). */
  laterMin?: number
  /** Skips the budget and cooldown (a recipe you set up asking first). */
  own?: boolean
}

export interface SuggestStats {
  /** per kind: accepts, dismisses, ignores in a row, per hour and per context. */
  [sk: string]: { a: number; d: number; row: number; byHour?: Record<string, [number, number]>; byCtx?: Record<string, [number, number]>; stopped?: boolean; noticed?: boolean }
}

export interface SuggestState {
  day: string
  /** Shown today. */
  shown: number
  /** Last time each kind was shown (ms). */
  lastAt: Record<string, number>
  /** Ids already offered (once each). */
  offered: Record<string, number>
  /** Kinds you said Never to. */
  never: string[]
  /** id → hidden until (Not now). */
  later: Record<string, number>
}

export const SUGGEST_BUDGET = 6
export const SUGGEST_COOLDOWN_MIN = 30
export const EMPTY_SUGGEST: SuggestState = { day: '', shown: 0, lastAt: {}, offered: {}, never: [], later: {} }

/** Saved state → valid, and a new day starts the budget again. */
export function cleanSuggestState(x: any, day: string): SuggestState {
  const rec = (v: any): Record<string, number> => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, n]) => Number.isFinite(n)).slice(-200)) as Record<string, number> : {})
  const s: SuggestState = { day: typeof x?.day === 'string' ? x.day : day, shown: Number(x?.shown) || 0, lastAt: rec(x?.lastAt), offered: rec(x?.offered), never: Array.isArray(x?.never) ? x.never.filter((k: unknown) => typeof k === 'string').slice(0, 30) : [], later: rec(x?.later) }
  return s.day === day ? s : { ...s, day, shown: 0 }
}

/** SI6: what learning says for this kind: show it, only a dot, or stop. */
export function learned(stats: SuggestStats, sk: string): 'peek' | 'dot' | 'stop' {
  const s = stats[sk]
  if (!s) return 'peek'
  if (s.stopped) return 'stop'
  const n = s.a + s.d
  if (n >= 10 && s.a / n < 0.15) return 'stop'
  if (s.row >= 4) return 'dot'
  return 'peek'
}

/** This hour and context: 3+ no's and no yes → skip it here. */
export function badMoment(stats: SuggestStats, sk: string, hour: number, ctx?: ContextKind | null): boolean {
  const s = stats[sk]
  if (!s) return false
  const bad = (v?: [number, number]) => !!v && v[1] >= 3 && v[0] === 0
  return bad(s.byHour?.[String(hour)]) || (!!ctx && bad(s.byCtx?.[ctx]))
}

export interface PickInput {
  now: number
  hour: number
  ctx?: ContextKind | null
  budget?: number
  cooldownMin?: number
  stats: SuggestStats
}

/** The suggestion to show now (the first one that passes every rule), and whether it may drop down or is only a dot. */
export function pickSuggestion(cands: (Suggestion | null | undefined)[], st: SuggestState, o: PickInput): { s: Suggestion; dot: boolean } | null {
  const budget = o.budget ?? SUGGEST_BUDGET
  const cool = (o.cooldownMin ?? SUGGEST_COOLDOWN_MIN) * 60_000
  for (const s of cands) {
    if (!s) continue
    if (st.never.includes(s.sk)) continue
    if ((st.later[s.id] ?? 0) > o.now) continue
    const was = st.offered[s.id]
    // Offered once: it stays up while it's the current one (shown in the last 10 min), never again after.
    const showing = was != null && o.now - was < 10 * 60_000
    if (was != null && !showing) continue
    if (!showing && !s.own) {
      if (st.shown >= budget) continue
      if (o.now - (st.lastAt[s.sk] ?? 0) < cool) continue
    }
    const l = learned(o.stats, s.sk)
    if (l === 'stop' && !s.own) continue
    if (!s.own && !showing && badMoment(o.stats, s.sk, o.hour, o.ctx)) continue
    return { s, dot: l === 'dot' && !s.own }
  }
  return null
}

/** It was shown: counts against today's budget (once per id). */
export function markShown(st: SuggestState, s: Suggestion, now: number): SuggestState {
  if (st.offered[s.id] != null) return st
  const offered = Object.fromEntries([...Object.entries(st.offered), [s.id, now]].slice(-200))
  return { ...st, shown: st.shown + (s.own ? 0 : 1), lastAt: { ...st.lastAt, [s.sk]: now }, offered }
}

export type SuggestAnswer = 'accept' | 'later' | 'never' | 'ignored'

/**
 * Your answer: learning counts it (an accept resets the "ignored in a row";
 * Not now and ignoring count as a no). Never puts the kind on the never list.
 * The first time a kind stops by itself, `notice` says so once.
 */
export function answerSuggestion(st: SuggestState, stats: SuggestStats, s: { id: string; sk: string; laterMin?: number }, answer: SuggestAnswer, o: { now: number; hour: number; ctx?: ContextKind | null }): { state: SuggestState; stats: SuggestStats; notice: string | null } {
  const cur = stats[s.sk] ?? { a: 0, d: 0, row: 0 }
  const yes = answer === 'accept'
  const bump = (m: Record<string, [number, number]> | undefined, k: string | null | undefined) => {
    if (!k) return m
    const v = m?.[k] ?? [0, 0]
    return { ...(m ?? {}), [k]: (yes ? [v[0] + 1, v[1]] : [v[0], v[1] + 1]) as [number, number] }
  }
  const next = { ...cur, a: cur.a + (yes ? 1 : 0), d: cur.d + (yes ? 0 : 1), row: yes ? 0 : cur.row + 1, byHour: bump(cur.byHour, String(o.hour)), byCtx: bump(cur.byCtx, o.ctx ?? null) }
  const nextStats = { ...stats, [s.sk]: next }
  let notice: string | null = null
  if (!next.noticed && learned(nextStats, s.sk) === 'stop') {
    next.stopped = true
    next.noticed = true
    notice = `You rarely take “${SUGGEST_LABEL[s.sk as SuggestKind] ?? s.sk}”, so I'll stop offering it. Turn it back on in Settings → Ben on this PC → Smart island.`
  }
  const state: SuggestState = {
    ...st,
    later: answer === 'later' ? { ...st.later, [s.id]: o.now + (s.laterMin ?? 30) * 60_000 } : st.later,
    never: answer === 'never' && !st.never.includes(s.sk) ? [...st.never, s.sk] : st.never
  }
  return { state, stats: nextStats, notice }
}

/** Settings: start learning this kind over (and take it off the never list). */
export function resetSuggestKind(st: SuggestState, stats: SuggestStats, sk: string): { state: SuggestState; stats: SuggestStats } {
  const { [sk]: _gone, ...rest } = stats
  return { state: { ...st, never: st.never.filter((k) => k !== sk) }, stats: rest }
}

/** Kinds that are stopped or on the never list (for Settings). */
export function pausedKinds(st: SuggestState, stats: SuggestStats): string[] {
  return [...new Set([...st.never, ...Object.keys(stats).filter((k) => learned(stats, k) === 'stop')])]
}

/** The suggestion as an island alert: Accept / (extra) / Not now / Never. */
export function suggestAlert(s: Suggestion, dot = false): IslandAlert {
  const ans = (answer: 'accept' | 'later' | 'never', run?: IslandAction): IslandAction => ({ kind: 'suggest', sid: s.id, sk: s.sk, answer, ...(run ? { run } : {}), ...(s.laterMin ? { laterMin: s.laterMin } : {}) })
  const actions: IslandAlert['actions'] = [{ label: s.accept.label, action: ans('accept', s.accept.action), primary: true }]
  if (s.extra) actions.push({ label: s.extra.label, action: ans('accept', s.extra.action) })
  actions.push({ label: 'Not now', action: ans('later') })
  actions.push({ label: 'Never', action: ans('never') })
  return { id: `sg:${s.id}`, kind: 'suggest', title: s.title, text: s.text, face: s.face ?? '✨', actions, ...(dot ? { dot: true } : {}) }
}
