// Simple mode (the default): your own exercises with your own daily targets, and a small "Harder" control per
// exercise (+reps, +1 set, or a harder version from the ladder). Coach mode (levels, programs, auto-progression)
// is opt-in and nothing in it is deleted when it is off. Pure, so it is tested.
import { moveOf, nextStep, startTarget } from './sportLadders'

export type HarderStep =
  | { kind: 'reps'; by: number }
  | { kind: 'set'; by: number }
  | { kind: 'version'; from: string; fromTarget: number }

export interface SimpleEx {
  id: string
  name: string
  target: number
  unit?: string
  active?: boolean
  plan?: boolean
  move?: string
  endTarget?: number
  coach?: boolean
  setReps?: number
  harder?: HarderStep[]
  [k: string]: any
}

const to5 = (n: number) => Math.max(5, Math.round(n / 5) * 5)
/** How many reps "+1 set" adds: a third of the daily target, in fives (or the size you set). */
export const setSize = (ex: Pick<SimpleEx, 'target' | 'setReps'>): number => (Number(ex.setReps) > 0 ? Math.round(Number(ex.setReps)) : to5((Number(ex.target) || 0) / 3))
export const REPS_STEP = 5

export interface HarderChoices {
  reps: { by: number; to: number }
  set: { by: number; to: number }
  /** The next step on the ladder, with the target it would start at; null at the top or for your own moves. */
  version: { moveId: string; name: string; target: number; unit: string } | null
}

export function harderChoices(ex: SimpleEx): HarderChoices {
  const t = Number(ex.target) || 0
  const s = setSize(ex)
  const m = moveOf(ex)
  const nx = m ? nextStep(m) : null
  return {
    reps: { by: REPS_STEP, to: t + REPS_STEP },
    set: { by: s, to: t + s },
    version: nx && m ? { moveId: nx.id, name: nx.name, target: startTarget(m, nx, t), unit: nx.unit } : null
  }
}

export type HarderKind = 'reps' | 'set' | 'version'

/** Make one exercise harder. Returns a new list; only that exercise (or its swap) changes. A version swap turns the old one off, never deletes it. */
export function makeHarder(exercises: SimpleEx[], id: string, kind: HarderKind, newId = `ex_${Date.now()}`): { exercises: SimpleEx[]; id: string } | null {
  const ex = exercises.find((e) => e.id === id)
  if (!ex) return null
  const c = harderChoices(ex)
  const hist = [...(ex.harder ?? [])]
  if (kind === 'reps' || kind === 'set') {
    const step = kind === 'reps' ? c.reps : c.set
    const next = { ...ex, target: step.to, harder: [...hist, { kind, by: step.by } as HarderStep] }
    return { exercises: exercises.map((e) => (e.id === id ? next : e)), id }
  }
  if (!c.version) return null
  const fresh: SimpleEx = {
    id: newId,
    name: c.version.name,
    target: c.version.target,
    unit: c.version.unit,
    active: ex.active !== false,
    doneToday: 0,
    move: c.version.moveId,
    harder: [...hist, { kind: 'version', from: ex.id, fromTarget: Number(ex.target) || 0 }]
  }
  const out = exercises.map((e) => (e.id === id ? { ...e, active: false } : e))
  const at = out.findIndex((e) => e.id === id)
  out.splice(at + 1, 0, fresh)
  return { exercises: out, id: fresh.id }
}

/** Go back one step (the last "Harder" you picked on this exercise). */
export function makeEasier(exercises: SimpleEx[], id: string): { exercises: SimpleEx[]; id: string } | null {
  const ex = exercises.find((e) => e.id === id)
  const hist = [...(ex?.harder ?? [])]
  const last = hist.pop()
  if (!ex || !last) return null
  if (last.kind === 'version') {
    if (!exercises.some((e) => e.id === last.from)) return null
    const out = exercises.map((e) => (e.id === last.from ? { ...e, active: true, target: last.fromTarget || e.target } : e.id === id ? { ...e, active: false, harder: hist } : e))
    return { exercises: out, id: last.from }
  }
  const next = { ...ex, target: Math.max(1, (Number(ex.target) || 0) - last.by), harder: hist }
  return { exercises: exercises.map((e) => (e.id === id ? next : e)), id }
}

// ------------------------------------------------------------------ restoring your own routine

/** The base moves of the best-set questions: a plain push-up, squat or sit-up is yours, not the coach's. */
const BASE = new Set(['pushup', 'squat', 'situp'])
const tsOf = (id: string) => {
  const m = /^ex_(\d{12,})/.exec(String(id))
  return m ? Number(m[1]) : 0
}

/** Moves the coach added: marked, auto-switched, or created on/after best-set onboarding (other than a plain push-up, squat or sit-up). */
export function coachAdded(state: { exercises?: SimpleEx[]; onboarded?: string; autoUp?: any }): Set<string> {
  const out = new Set<string>()
  const since = /^\d{4}-\d\d-\d\d$/.test(String(state.onboarded ?? '')) ? Date.parse(String(state.onboarded) + 'T00:00:00Z') - 36 * 3600000 : null
  const auto = new Set(((state.autoUp?.items as any[]) ?? []).map((i) => i.newId))
  for (const e of state.exercises ?? []) {
    if (e.plan) continue
    if (e.coach === true || auto.has(e.id)) out.add(e.id)
    else if (since != null && tsOf(e.id) >= since && !BASE.has(String(moveOf(e)?.id))) out.add(e.id)
  }
  return out
}

export interface CoachHidden {
  /** Coach moves that are hidden in Simple mode. */
  on: string[]
  /** Your own moves the coach had turned off (back on in Simple mode). */
  off: string[]
  /** Coach mode is showing the coach's moves now. */
  applied: boolean
}

/**
 * One time: your own routine is back. Coach-added moves are hidden (kept, with their history), your own moves the
 * coach turned off are on again, and your own daily targets (`endTarget`) are restored. Never empties the routine.
 */
export function restoreOwnRoutine<T extends { exercises?: any[]; onboarded?: string; autoUp?: any; coachHidden?: CoachHidden }>(state: T): T {
  const list: SimpleEx[] = (state.exercises ?? []).map((e) => ({ ...e }))
  const coach = coachAdded({ ...state, exercises: list })
  const fams = new Set<string>()
  for (const e of list) if (coach.has(e.id) && e.active) fams.add(String(moveOf(e)?.family ?? ''))
  fams.delete('')
  const on: string[] = []
  const off: string[] = []
  for (const e of list) if (coach.has(e.id)) { e.coach = true; if (e.active) on.push(e.id); e.active = false }
  for (const f of fams) {
    const cands = list.filter((e) => !coach.has(e.id) && !e.plan && !e.active && moveOf(e)?.family === f)
    const best = cands.sort((a, b) => (moveOf(a)?.diff ?? 0) - (moveOf(b)?.diff ?? 0)).pop()
    if (best) { best.active = true; off.push(best.id) }
  }
  for (const e of list) if (!coach.has(e.id) && e.endTarget != null) { e.target = e.endTarget; delete e.endTarget }
  if (!list.some((e) => e.active) && list.length) {
    // Never an empty routine: give the coach's moves back rather than show nothing.
    for (const e of list) if (e.coach && on.includes(e.id)) e.active = true
    on.length = 0
  }
  return { ...state, exercises: list, coachHidden: { on, off, applied: false } }
}

/** Coach mode on: the coach's moves come back; off: your own routine again. Nothing is deleted either way. */
export function setCoachMode<T extends { exercises?: any[]; sportySettings?: any; coachHidden?: CoachHidden }>(state: T, on: boolean): T {
  const ch: CoachHidden = state.coachHidden ?? { on: [], off: [], applied: false }
  const ss = { ...(state.sportySettings ?? {}), coachMode: on }
  const ex = state.exercises ?? []
  if (on && !ch.applied && (ch.on.length || ch.off.length)) {
    const exercises = ex.map((e) => (ch.on.includes(e.id) ? { ...e, active: true } : ch.off.includes(e.id) ? { ...e, active: false } : e))
    return { ...state, exercises, sportySettings: ss, coachHidden: { ...ch, applied: true } }
  }
  if (!on && ch.applied) {
    const exercises = ex.map((e) => (ch.on.includes(e.id) ? { ...e, active: false } : ch.off.includes(e.id) ? { ...e, active: true } : e))
    return { ...state, exercises, sportySettings: ss, coachHidden: { ...ch, applied: false } }
  }
  return { ...state, sportySettings: ss }
}
