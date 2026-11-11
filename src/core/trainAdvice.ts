// Sport Track's Workout mode advice, as pure data from your logged sets:
//  - moveChoices: Easier / Alternate / Harder for the move you are on, at any
//    time, each with the specific reason from your data ("you hit 3×12 at OK
//    twice, form confirmed", "pain flagged on set 2 (wrist)", "missed the
//    bottom of the range twice"). Alternates are branches at the same level:
//    same muscles, allowed by your gear (Bulgarian ↔ reverse lunge, decline ↔
//    wide push-ups). After a pain flag Harder is never offered.
//  - safetyNotes: a stability warning for every household object a move uses
//    (a chair against a wall, a door that closes toward you and locks…).
//  - workoutDone: actual vs target per move, records, pain flags and ONE
//    recommended adjustment with its reasons (Apply next time / Ask me later).
// Nothing is changed here, and nothing pays points: XP never sets difficulty.
// Pure and tested (trainAdvice.test.ts).
import { setsText, type SetEntry } from './sportSets'
import { allowed, gearKeysUsed, SIDE_LEVELS, stepFrom, type Gear, type GearKey } from './trainGear'
import { effortOf, formConfirmed, formOk, formUnknown, issueOf, moveSessions, painText, trainOf, type PainFlag, type PlanItem } from './trainLog'
import { moveName, rangeText, type LadderId, type Level } from './trainLadders'
import type { TrackerItem, TrackerView } from './sportTrain'

const L = (move: string, lo: number, hi: number, unit: 'reps' | 'sec' = 'reps'): Level => ({ move, lo, hi, unit })

/** Same-level branches per move: the same muscles another way (never harder than your step). */
export const BRANCHES: Record<string, { level: Level; note: string }[]> = {
  pushup: [{ level: L('wide_pushup', 8, 15), note: 'more chest, less triceps' }],
  diamond_pushup: [{ level: L('wide_pushup', 8, 15), note: 'less bend in the wrists and elbows' }],
  decline_pushup: [{ level: L('wide_pushup', 8, 15), note: 'flat on the floor, less load on the shoulders' }],
  wide_pushup: [{ level: L('decline_pushup', 6, 12), note: 'feet up: more upper chest and shoulders' }],
  split_squat: [{ level: L('reverse_lunge', 8, 12), note: 'a step back each rep, kinder on the knees' }],
  bulgarian_squat: [{ level: L('reverse_lunge', 8, 12), note: 'no chair needed, easier on balance' }],
  reverse_lunge: [{ level: L('bulgarian_squat', 8, 12), note: 'back foot on a chair: more work for the front leg' }],
  box_pistol: [{ level: L('shrimp_squat', 3, 8), note: 'the other one-leg squat: back knee bent behind you' }],
  pistol_squat: [{ level: L('shrimp_squat', 3, 8), note: 'the other one-leg squat: back knee bent behind you' }],
  table_row: [{ level: L('towel_row', 8, 15), note: 'the same pull on a locked door' }],
  feet_row: [{ level: L('towel_row', 8, 15), note: 'the same pull on a locked door' }],
  plank: [{ level: L('dead_bug', 8, 12), note: 'the same core, lying on your back' }],
  knee_raise: [{ level: L('dead_bug', 8, 12), note: 'one leg at a time, easy on the low back' }],
  leg_raise: [{ level: L('hollow_hold', 15, 30, 'sec'), note: 'a still hold, no swinging' }],
  hip_thrust_load: [{ level: L('single_leg_bridge', 8, 15), note: 'no load needed: one leg does the work' }]
}

export interface Choice {
  kind: 'easier' | 'alternate' | 'harder'
  move: string
  name: string
  level: Level
  /** A step of the chain (null: a branch, used for today only). */
  index: number | null
  /** "3 × 8–12" */
  target: string
  /** The specific reason, from your logged data. */
  reason: string
}

export interface Choices {
  easier: Choice | null
  alternates: Choice[]
  harder: Choice | null
  /** Why there is no Harder ("not while pain is flagged"). */
  noHarder: string | null
}

/** The newest session of a move on its current step (today's included). */
const latestOn = (it: Pick<PlanItem, 'latest' | 'since'>) => (it.latest && (!it.since || it.latest.day >= it.since) ? it.latest : null)

/** The first set with this feel or form problem, 1-based (0: none). */
const firstSet = (sets: SetEntry[], test: (s: SetEntry) => boolean) => sets.findIndex(test) + 1

const effortWords = (e: 'easy' | 'ok' | 'hard' | null) => (e === 'easy' ? 'easy' : e === 'hard' ? 'hard' : 'at OK')

/** Easier / Alternate / Harder for a move right now, each with its reason. Pain blocks Harder. */
export function moveChoices(it: Pick<PlanItem, 'ladder' | 'index' | 'level' | 'fullSets' | 'status' | 'latest' | 'since' | 'alt'>, gear: Gear | null): Choices {
  const sets = it.fullSets
  const lv = it.level
  const u = lv.unit === 'sec' ? ' s' : ''
  const last = latestOn(it)
  const pain: PainFlag | null = issueOf(last)
  const target = (l: Level) => `${sets} × ${rangeText(l)}`
  const mk = (kind: Choice['kind'], level: Level, index: number | null, reason: string): Choice => ({ kind, move: level.move, name: moveName(level.move), level, index, target: target(level), reason })

  // Easier: the step before (that your gear allows).
  const downAt = it.alt || it.index <= 0 ? null : stepFrom(it.ladder, it.index - 1, -1, gear)
  let easierWhy = 'same muscles, less load: for a tired day or to clean up your form'
  if (pain) easierWhy = `${painText(pain)}: go easier`
  else if (it.status.state === 'struggling') easierWhy = `missed the bottom of the range (${lv.lo}${u}) twice`
  else if (last && !formOk(last, sets)) easierWhy = `form broke on set ${firstSet(last.sets, (s) => s.form === 'off')}`
  else if (last && effortOf(last, sets) === 'hard') easierWhy = `set ${firstSet(last.sets, (s) => s.feel === 'hard')} was Hard (0–1 reps left)`
  const easier = downAt == null ? null : mk('easier', it.ladder.levels[downAt], downAt, easierWhy)

  // Alternates: same-level branches and the chain's side option, allowed by your gear.
  const seen = new Set<string>([lv.move])
  const alternates: Choice[] = []
  const side = SIDE_LEVELS[it.ladder.id]
  for (const b of [...(BRANCHES[lv.move] ?? []), ...(side ? [side] : [])]) {
    if (seen.has(b.level.move) || !allowed(b.level.move, gear) || alternates.length >= 2) continue
    seen.add(b.level.move)
    const at = it.ladder.levels.findIndex((x) => x.move === b.level.move)
    // A branch that is a harder step of the chain is not an alternate after pain.
    if (pain && at > it.index) continue
    alternates.push(mk('alternate', b.level, null, pain ? `${b.note}; ${painText(pain)}` : b.note))
  }

  // Harder: the next step, never after a pain flag.
  const upAt = it.alt ? null : stepFrom(it.ladder, it.index + 1, 1, gear)
  let harder: Choice | null = null
  let noHarder: string | null = null
  if (pain) noHarder = `Not while ${painText(pain)}`
  else if (it.alt) noHarder = 'Another move for today: Harder comes from your step on the chain'
  else if (upAt == null) noHarder = 'This is the top of the chain for your gear'
  else {
    const s = it.status
    const why =
      s.state === 'complete'
        ? `you hit ${sets}×${lv.hi}${u} ${effortWords(effortOf(last, sets))} twice, form confirmed`
        : last && formUnknown(last, sets) && s.hits === 0 && last.reps.slice(0, sets).every((r) => r >= lv.hi)
          ? `not earned yet: form was not confirmed on ${formUnknown(last, sets)} sets`
          : `not earned yet: ${s.hits} of ${s.need} sessions at the top (your history stays)`
    harder = mk('harder', it.ladder.levels[upAt], upAt, why)
  }
  return { easier, alternates, harder, noHarder }
}

// ---------- safety ----------

const SAFETY: Partial<Record<GearKey, string>> = {
  chair: 'Chair: put it against a wall so it can’t slide. No chairs on wheels or folding chairs.',
  bed: 'Bed or sofa edge: use the firm middle of the edge, not a corner, and check it doesn’t slide.',
  table: 'Table: it must hold your full weight. Test it first; never a desk on wheels or a folding table.',
  towel: 'Door: it must close toward you and be locked. Pull only on the closed side.',
  backpack: 'Backpack: start light (3–5 kg of books), straps tight, nothing hard against your back.',
  bar: 'Pull-up bar: check it is locked in place before every set; door-frame bars only on solid frames.',
  rings: 'Rings: check the straps and the anchor before every set.',
  bands: 'Band: check it for tears and that the anchor is closed and steady.',
  wall: 'Wall: clear the floor around you and keep a soft cushion under your head.'
}

/** The stability warnings for a move with your gear (empty: floor only). */
export function safetyNotes(move: string, gear: Gear | null): string[] {
  return gearKeysUsed(move, gear)
    .map((k) => SAFETY[k])
    .filter((x): x is string => !!x)
}

// ---------- after the workout ----------

export interface DoneRow {
  ladder: LadderId
  move: string
  name: string
  /** "3 × 6–12" */
  target: string
  /** "12 · 11 · 11" */
  reps: string
  /** "OK, last hard" */
  effort: string
  /** "form good" · "form unknown on 2" · "form broke on 1" */
  form: string
  /** "+3 reps" · "Record ✓" · "same" · "first time" */
  delta: string
  tone: 'up' | 'same' | 'down' | 'record' | 'new'
  record: boolean
  pain: PainFlag | null
  setsDone: number
  setsPlanned: number
}

export interface Adjustment {
  /** up: the next step · down: an easier step · alt: another move · hold: same step, a rep more. */
  kind: 'up' | 'down' | 'alt' | 'hold'
  ladder: LadderId
  from: string
  /** The move next time (hold: the same). */
  to: string
  toMove: string
  /** The step index to apply (null: nothing to apply). */
  toIndex: number | null
  /** Your step now, for Undo. */
  fromIndex: number
  reasons: string[]
}

export interface DoneView {
  rows: DoneRow[]
  setsDone: number
  setsPlanned: number
  records: number
  pains: number
  minutes: number | null
  /** One recommended change for next time (null: nothing logged). */
  adjust: Adjustment | null
  /** "Holding steady" lines for the other moves. */
  holding: string[]
}

const feelName = (f?: string) => (f === 'ok' ? 'OK' : f === 'easy' ? 'easy' : f === 'hard' ? 'hard' : 'not tapped')

/** "OK, last hard", "easy", "not tapped" */
function effortSummary(sets: SetEntry[]): string {
  if (!sets.length) return '—'
  const f = sets.map((s) => s.feel)
  const cap = (x: string) => x[0].toUpperCase() + x.slice(1)
  if (f.every((x) => x === f[0])) return cap(f[0] ? feelName(f[0]) : 'not tapped')
  const main = f.slice(0, -1).every((x) => x === f[0]) ? feelName(f[0]) : 'mixed'
  return `${cap(main)}, last ${feelName(f[f.length - 1])}`
}

/** The Workout done page: actual vs target, records, pain flags and one recommended adjustment. */
export function workoutDone(st: any, v: TrackerView, now: number): DoneView {
  const day = v.day
  const items = v.items.filter((it) => it.done.length)
  const logged: DoneRow[] = items.map((it) => {
    const before = moveSessions(st, it.level.move, day).filter((s) => s.day < day)
    const best = Math.max(0, ...before.flatMap((s) => s.reps))
    const top = Math.max(0, ...it.done.map((s) => s.reps))
    const total = it.done.reduce((n, s) => n + s.reps, 0)
    const lastTotal = it.last ? it.last.reps.reduce((n, r) => n + r, 0) : null
    const record = before.length > 0 && top > best
    const u = it.level.unit === 'sec' ? ' s' : ' reps'
    const diff = lastTotal == null ? null : total - lastTotal
    const unknown = it.done.filter((s) => s.form !== 'good' && s.form !== 'off').length
    const broke = it.done.filter((s) => s.form === 'off').length
    return {
      ladder: it.ladder.id,
      move: it.level.move,
      name: it.name,
      target: it.target,
      reps: setsText(it.done.map((s) => s.reps), it.level.unit),
      effort: effortSummary(it.done),
      form: broke ? `form broke on ${broke}` : unknown ? `form unknown on ${unknown}` : 'form good',
      delta: record ? 'Record ✓' : diff == null ? 'first time' : diff === 0 ? 'same' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)}${u}`,
      tone: record ? 'record' : diff == null ? 'new' : diff > 0 ? 'up' : diff < 0 ? 'down' : 'same',
      record,
      pain: issueOf({ day, sets: it.done }),
      setsDone: it.done.length,
      setsPlanned: it.sets
    }
  })
  // Planned moves with no set today: listed as not done (actual vs target for every move).
  const skipped: DoneRow[] = v.items
    .filter((it) => !it.done.length)
    .map((it) => ({ ladder: it.ladder.id, move: it.level.move, name: it.name, target: it.target, reps: '—', effort: 'Not done', form: '', delta: 'not done', tone: 'same' as const, record: false, pain: null, setsDone: 0, setsPlanned: it.sets }))
  const rows = [...logged, ...skipped]
  const data = trainOf(st)
  const sess = data.log.find((s) => s.id === v.sessionId) ?? data.log.find((s) => s.date === day)
  const minutes = sess ? Math.max(1, Math.round((sess.durationSec || (now - sess.startedAt) / 1000) / 60)) : null
  const adjust = pickAdjustment(items, data.gear)
  const holding = items
    .filter((it) => it.ladder.id !== adjust?.ladder && it.nextTime)
    .map((it) => it.nextTime!.line.replace(/^Next time: /, ''))
    .slice(0, 2)
  return {
    rows,
    setsDone: logged.reduce((n, r) => n + Math.min(r.setsDone, r.setsPlanned), 0),
    setsPlanned: v.setsPlanned,
    records: logged.filter((r) => r.record).length,
    pains: logged.filter((r) => r.pain?.kind === 'pain').length,
    minutes,
    adjust,
    holding
  }
}

/** The one change worth making: pain first (easier or another move), then an unlocked step, then struggling, else the move closest to its next step. */
function pickAdjustment(items: TrackerItem[], gear: Gear | null): Adjustment | null {
  if (!items.length) return null
  const base = (it: TrackerItem) => ({ ladder: it.ladder.id, from: it.name, fromIndex: it.index })
  const hurt = items.find((it) => it.status.state === 'hurt' && it.status.pain)
  if (hurt) {
    const ch = moveChoices(hurt, gear)
    const pain = hurt.status.pain!
    const to = ch.easier ?? null
    if (to) return { ...base(hurt), kind: 'down', to: to.name, toMove: to.move, toIndex: to.index, reasons: [`${painText(pain)[0].toUpperCase()}${painText(pain).slice(1)}`, 'Pain never moves you up: an easier step keeps the muscles working', 'Step back up once two sessions are clean'] }
    const alt = ch.alternates[0]
    if (alt) return { ...base(hurt), kind: 'alt', to: alt.name, toMove: alt.move, toIndex: null, reasons: [`${painText(pain)[0].toUpperCase()}${painText(pain).slice(1)}`, `${alt.name}: ${alt.reason.split(';')[0]}`] }
  }
  const up = items.find((it) => it.offer)
  if (up && up.offer) {
    const sets = up.fullSets
    const u = up.level.unit === 'sec' ? ' s' : ''
    const latest = latestOn(up)
    return {
      ...base(up),
      kind: 'up',
      to: up.offer.name,
      toMove: up.offer.move,
      toIndex: up.offer.to,
      reasons: [`${sets} × ${up.level.hi}${u} at the top of the range, 2 sessions running`, `Effort ${effortWords(effortOf(latest, sets)).replace('at ', '')}, form confirmed good, no pain`]
    }
  }
  const low = items.find((it) => it.status.state === 'struggling')
  if (low) {
    const ch = moveChoices(low, gear)
    if (ch.easier) return { ...base(low), kind: 'down', to: ch.easier.name, toMove: ch.easier.move, toIndex: ch.easier.index, reasons: [`Missed the bottom of the range (${low.level.lo}${low.level.unit === 'sec' ? ' s' : ''}) twice`, 'One step back now builds the strength to come back up'] }
  }
  // Hold: the move closest to its next step, a rep more on the lowest set.
  const close = [...items].sort((a, b) => b.status.pct - a.status.pct)[0]
  const latest = latestOn(close)
  const reasons = [close.nextTime?.line.replace(/^Next time: /, '') ?? close.status.line]
  if (latest && !formConfirmed(latest, close.fullSets) && formUnknown(latest, close.fullSets)) reasons.push(`Form was not confirmed on ${formUnknown(latest, close.fullSets)} sets: tap Form good when it was, or they don’t count toward a step up`)
  return { ...base(close), kind: 'hold', to: close.name, toMove: close.level.move, toIndex: null, reasons }
}
