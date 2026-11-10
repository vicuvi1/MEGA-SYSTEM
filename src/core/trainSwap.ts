// Sport Track's swap sheet and Gear page, as pure data. Tap a move: the sheet
// lists its chain around your step (easier steps, your step, the next one, a
// side option; harder locked steps are only named). Only moves your gear allows
// are listed, never greyed out. "Use … today" changes today only (a one-day
// pick); "Make it my step" changes your level on the chain. History is never
// deleted. The Gear page's "Your plan with this" is the same engine on the gear
// you are ticking. Pure and tested (trainSwap.test.ts). Nothing here pays points.
import { restSecFor } from './sportTrain'
import { allowed, ALT_LEVELS, clearPick, effectiveLevel, gearUsed, needText, SIDE_LEVELS, stepFrom, type Gear } from './trainGear'
import { currentLevel, keepLevel, sessionItems, setLevel, trainOf, type Dose } from './trainLog'
import { moveInfo, moveName, rangeText, type Ladder, type LadderId, type Level } from './trainLadders'
import type { SessionType } from './trainWeek'

export interface SwapOption {
  /** easier · yours · next · side (same level) · alt (another way to train the chain with your gear). */
  kind: 'easier' | 'yours' | 'next' | 'side' | 'alt'
  move: string
  name: string
  level: Level
  /** The step on the chain (null: not a step, so it can only be used today). */
  index: number | null
  /** "Easier · step 1" */
  label: string
  /** "3 × 10–15 · chair or bed" */
  line: string
  /** "3 × 10–15" */
  target: string
  rest: number
  /** "floor", "chair or bed", "bar + bands" */
  needs: string
  /** How to start it, in one line. */
  why: string
}

export interface SwapView {
  ladder: Ladder
  type: SessionType
  /** The option the plan uses for the chain right now (your step, a stand-in for your gear, or today's pick). */
  now: SwapOption
  /** Today's move is a one-day pick, not your step. */
  picked: boolean
  /** The step your level is on (or the stand-in your gear allows for it). */
  yours: SwapOption
  /** Every option you can do, easiest first. */
  options: SwapOption[]
  /** Harder steps still locked (their names). */
  locked: string[]
}

const sessionOf = (id: LadderId): SessionType => (id === 'push' || id === 'pull' || id === 'shoulders' ? 'upper' : 'legs')

/** The swap sheet's options for one chain. Null: no such chain. */
export function swapView(st: any, ladderId: LadderId, day: string, dose: Dose = 'full'): SwapView | null {
  const data = trainOf(st)
  const ladder = data.ladders.find((l) => l.id === ladderId)
  if (!ladder) return null
  const type = sessionOf(ladderId)
  const item = sessionItems(st, data, type, day, dose).find((x) => x.ladder.id === ladderId)
  if (!item) return null
  const sets = item.fullSets
  const opt = (kind: SwapOption['kind'], level: Level, index: number | null, label: string, line?: string): SwapOption => {
    const target = `${sets} × ${rangeText(level)}`
    const needs = needText(level.move)
    return { kind, move: level.move, name: moveName(level.move), level, index, label, target, line: line ?? `${target} · ${needs}`, rest: restSecFor(level), needs, why: moveInfo(level.move)?.steps[0] ?? '' }
  }
  const indexOf = (move: string) => {
    const i = ladder.levels.findIndex((x) => x.move === move)
    return i < 0 ? null : i
  }
  const g = data.gear
  const eff = effectiveLevel(ladder, currentLevel(st, data, ladder, day).index, g)
  const options: SwapOption[] = []
  if (eff.alt) {
    // Your gear leaves no step of this chain: the other ways you can train it.
    for (const a of ALT_LEVELS[ladderId] ?? []) if (allowed(a.move, g) && a.move !== eff.level.move) options.push(opt('alt', a, indexOf(a.move), 'Another way'))
  } else {
    const easier: number[] = []
    for (let i = eff.index - 1; i >= 0 && easier.length < 2; i--) if (allowed(ladder.levels[i].move, g)) easier.unshift(i)
    for (const i of easier) options.push(opt('easier', ladder.levels[i], i, `Easier · step ${i + 1}`))
  }
  const yours = opt('yours', eff.level, eff.alt ? null : eff.index, eff.alt ? 'Your step' : `Your step · ${eff.index + 1}`)
  options.splice(eff.alt ? 0 : options.length, 0, yours)
  if (!eff.alt) {
    const at = stepFrom(ladder, eff.index + 1, 1, g)
    if (at != null) {
      // The next step's own progress is only shown while it is still your step's next one.
      const left = Math.max(0, item.status.need - item.status.hits)
      const unlocked = !!item.offer && !item.picked
      options.push(opt('next', ladder.levels[at], at, `Next · step ${at + 1}${unlocked ? ' · unlocked' : left ? ` · ${left} ${left === 1 ? 'session' : 'sessions'} to go` : ''}`))
    }
    const side = SIDE_LEVELS[ladderId]
    if (side && allowed(side.level.move, g) && side.level.move !== eff.level.move && !options.some((o) => o.move === side.level.move))
      options.push(opt('side', side.level, null, 'Side option · same level', `${sets} × ${rangeText(side.level)} · ${side.note}`))
  }
  const locked: string[] = []
  if (!eff.alt) {
    const next = stepFrom(ladder, eff.index + 1, 1, g)
    for (let i = (next ?? eff.index) + 1; i < ladder.levels.length && locked.length < 3; i++) if (allowed(ladder.levels[i].move, g)) locked.push(moveName(ladder.levels[i].move))
  }
  const now = options.find((o) => o.move === item.level.move) ?? opt('yours', item.level, item.alt ? null : item.index, 'Today')
  return { ladder, type, now, picked: item.picked, yours, options, locked }
}

/** "Make it my step": your level on the chain becomes this step. History stays; the step keeps the day you first reached it. */
export function makeStep(st: any, input: { day: string; ladder: LadderId; index: number; now: number }): boolean {
  const data = trainOf(st)
  const ladder = data.ladders.find((l) => l.id === input.ladder)
  if (!ladder || input.index < 0 || input.index >= ladder.levels.length || !allowed(ladder.levels[input.index].move, data.gear)) return false
  const from = effectiveLevel(ladder, currentLevel(st, data, ladder, input.day).index, data.gear).index
  keepLevel(st, ladder.id, from, input.now)
  setLevel(st, ladder.id, input.index, input.day, input.now, true)
  // Going down waits for a newer session before the harder step is offered again.
  if (input.index < from) st.trainLevels[ladder.id].declinedOn = input.day
  clearPick(st, { day: input.day, ladder: input.ladder, now: input.now })
  return true
}

export interface GearPlanRow {
  ladder: LadderId
  /** "Pull" */
  path: string
  move: string
  name: string
  /** "desk skipped" · "uses pull-up bar" · "floor" */
  tag: string
}

/** Each chain's move for these gear choices (your steps stay yours): the Gear page's live panel. */
export function gearPlan(st: any, gear: Gear | null, today: string): GearPlanRow[] {
  const probe = { ...(st ?? {}), trainGear: gear, trainPicks: null }
  const data = trainOf(probe)
  const rows: GearPlanRow[] = []
  for (const type of ['upper', 'legs'] as SessionType[])
    for (const it of sessionItems(probe, data, type, today)) {
      const yours = it.ladder.levels[currentLevel(probe, data, it.ladder, today).index]
      const desk = it.swapped && ['table_row', 'feet_row'].includes(yours?.move ?? '')
      const used = gearUsed(it.level.move, gear)
      rows.push({ ladder: it.ladder.id, path: it.ladder.name.replace(/ \(.*\)$/, ''), move: it.level.move, name: it.name, tag: desk ? 'desk skipped' : used ? `uses ${used}` : 'floor' })
    }
  return rows
}
