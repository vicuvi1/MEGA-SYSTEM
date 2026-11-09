// Body → Training: the muscle recovery map. For six muscle groups (chest,
// back, shoulders, arms, legs, core) the hours since the last hard set, read
// from Sport Track's set log and each move's muscles:
//   red    under 24 h   still recovering
//   yellow 24–48 h      nearly ready
//   green  48 h or more ready (or not trained lately)
// and one line on what is best to train today, which agrees with the weekly
// split (trainWeek.ts) and suggests a swap after a missed session. Pure and
// tested (recovery.test.ts). Nothing here pays points or writes anything.
import { moveOf, type SportEx } from './sportLadders'
import { setsOn, shiftDay, type SetEntry, type SetLog } from './sportSets'
import { moveInfo } from './trainLadders'
import { missedSession, rested, TYPE_NAME, WEEKDAYS, dowOf, type DayType, type DoneSession, type SessionType, type TodayPlan, type TrainWeek } from './trainWeek'

export type RecGroup = 'chest' | 'back' | 'shoulders' | 'arms' | 'legs' | 'core'
export type RecStatus = 'red' | 'yellow' | 'green'

export const REC_GROUPS: { id: RecGroup; name: string }[] = [
  { id: 'chest', name: 'Chest' },
  { id: 'back', name: 'Back' },
  { id: 'shoulders', name: 'Shoulders' },
  { id: 'arms', name: 'Arms' },
  { id: 'legs', name: 'Legs' },
  { id: 'core', name: 'Core' }
]

/** Hours: under `red` still recovering, under `yellow` nearly ready, then ready. */
export const RECOVERY_HOURS = { red: 24, yellow: 48 }

/** The groups each session trains (the first two name it in the line). */
export const SESSION_GROUPS: Record<SessionType, RecGroup[]> = {
  upper: ['back', 'chest', 'shoulders', 'arms'],
  legs: ['legs', 'core']
}
const UPPER = new Set<RecGroup>(SESSION_GROUPS.upper)

/** A muscle as the move library writes it ("Thighs (quads)") → its group (null: not one of the six). */
export function groupOfMuscle(name: string): RecGroup | null {
  const m = String(name).toLowerCase().trim()
  if (/chest/.test(m)) return 'chest'
  if (/lower back|upper back|^back|lats/.test(m)) return 'back'
  if (/shoulder/.test(m)) return 'shoulders'
  if (/tricep|bicep|grip|wrist|forearm/.test(m)) return 'arms'
  if (/glute|thigh|quad|hamstring|calf|calves|^hips?$/.test(m)) return 'legs'
  if (/core|abs|oblique|hip flexor|spine/.test(m)) return 'core'
  return null
}

const FALLBACK: Record<string, RecGroup> = {
  push: 'chest',
  pull: 'back',
  legs: 'legs',
  core: 'core'
}

/**
 * The groups a move works hard: its first two listed muscles, kept to its own half of the body (a plank's
 * shoulders or a push-up's core are helpers, not what it trains), else its library group.
 */
export function groupsOfMove(move: string | null | undefined): RecGroup[] {
  const info = move ? moveInfo(move) : null
  if (!info) return []
  const upper = info.group === 'push' || info.group === 'pull'
  if (!upper && info.group !== 'legs' && info.group !== 'core') return []
  const out: RecGroup[] = []
  for (const m of info.muscles.slice(0, 2)) {
    const g = groupOfMuscle(m)
    if (g && UPPER.has(g) === upper && !out.includes(g)) out.push(g)
  }
  return out.length ? out : [FALLBACK[info.group]]
}

/** The move an exercise is: Body Training's own `t:<id>`, else the library move (by move id or name). */
export function moveIdOf(ex: Pick<SportEx, 'name' | 'move'>): string | null {
  const tag = String(ex?.move ?? '')
  if (tag.startsWith('t:')) return tag.slice(2)
  return moveOf(ex)?.id ?? null
}

/** The start of an app day (04:00 local) in ms. */
const dayStart = (day: string) => new Date(`${day}T04:00:00`).getTime()

/**
 * The hard sets of one exercise on one day: at least 5 reps (15 s for a hold), at least 70% of the day's
 * best set (Sport Track's rule, sportSets.hardSets), and not tapped "Easy".
 */
export function hardOnes(sets: SetEntry[], unit: string): SetEntry[] {
  const top = Math.max(0, ...sets.map((s) => Number(s.reps) || 0))
  const min = unit === 'sec' ? 15 : 5
  return sets.filter((s) => (Number(s.reps) || 0) >= min && (Number(s.reps) || 0) >= top * 0.7 && s.feel !== 'easy')
}

/** When a set was done (ms): its time, kept inside its own day; 18:00 that day when it has none. */
export function setTime(s: SetEntry, day: string): number {
  const from = dayStart(day)
  const to = from + 24 * 3600_000 - 1
  const at = Number(s.at)
  if (!Number.isFinite(at) || at <= 0) return new Date(`${day}T18:00:00`).getTime()
  return Math.min(to, Math.max(from, at))
}

export interface GroupRecovery {
  id: RecGroup
  name: string
  /** Hours since the last hard set (null: none in the last 10 days). */
  hours: number | null
  status: RecStatus
  /** The day of that set. */
  lastDay: string | null
}

export const statusOf = (hours: number | null): RecStatus => (hours == null || hours >= RECOVERY_HOURS.yellow ? 'green' : hours >= RECOVERY_HOURS.red ? 'yellow' : 'red')

export const STATUS_LABEL: Record<RecStatus, string> = {
  red: 'Recovering',
  yellow: 'Nearly ready',
  green: 'Ready'
}

/** Each group's recovery from Sport Track's sets (the last 10 days), at `now` (ms). */
export function recoveryMap(st: { sets?: SetLog | null; exercises?: SportEx[] | null } | null | undefined, now: number, today: string): GroupRecovery[] {
  const last: Partial<Record<RecGroup, { t: number; day: string }>> = {}
  const log = st?.sets ?? {}
  const byId = new Map((Array.isArray(st?.exercises) ? st!.exercises! : []).map((e) => [String(e.id), e]))
  const fromDay = shiftDay(today, -10)
  for (const day of Object.keys(log)) {
    if (day < fromDay || day > today) continue
    for (const exId of Object.keys(log[day] ?? {})) {
      const ex = byId.get(exId)
      if (!ex) continue
      const move = moveIdOf(ex)
      const groups = groupsOfMove(move)
      if (!groups.length) continue
      const unit = (move && moveInfo(move)?.unit) || ex.unit || 'reps'
      for (const s of hardOnes(setsOn(log, day, exId), unit)) {
        const t = Math.min(now, setTime(s, day))
        for (const g of groups) if (!last[g] || t > last[g]!.t) last[g] = { t, day }
      }
    }
  }
  return REC_GROUPS.map(({ id, name }) => {
    const l = last[id]
    const hours = l ? Math.max(0, (now - l.t) / 3600_000) : null
    return {
      id,
      name,
      hours: hours == null ? null : Math.round(hours),
      status: statusOf(hours),
      lastDay: l?.day ?? null
    }
  })
}

/** "20 h ago", "2 days ago", "not lately". */
export function agoText(hours: number | null): string {
  if (hours == null) return 'not lately'
  if (hours < 36) return `${Math.max(1, Math.round(hours))} h ago`
  const d = Math.round(hours / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

const join = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const SHORT: Record<SessionType, string> = {
  upper: 'Upper',
  legs: 'Legs + core'
}

/** Which of a session's groups are still red, and the main two that are ready. */
function sessionState(rec: GroupRecovery[], t: SessionType): { red: GroupRecovery[]; ready: RecGroup[]; nearly: RecGroup[] } {
  const by = new Map(rec.map((r) => [r.id, r]))
  const groups = SESSION_GROUPS[t]
  const main = groups.slice(0, 2)
  return {
    red: groups.map((g) => by.get(g)!).filter((r) => r && r.status === 'red'),
    ready: main.filter((g) => (by.get(g)?.status ?? 'green') === 'green'),
    nearly: main.filter((g) => by.get(g)?.status === 'yellow')
  }
}

const readyText = (s: { ready: RecGroup[]; nearly: RecGroup[] }) =>
  s.ready.length === 2 ? `${join(s.ready)} are ready` : s.ready.length === 1 ? `${s.ready[0]} is ready${s.nearly.length ? `, ${s.nearly[0]} nearly` : ''}` : `${join(s.nearly)} nearly ready`

export interface Recommendation {
  /** What the line suggests today. */
  type: DayType
  line: string
  /** A different session than the plan: one tap starts it (null: follow the plan). */
  swap: SessionType | null
}

/**
 * What is best to train today, from the plan (todayPlan) and how recovered each group is. It agrees with
 * the split; it suggests a swap only when a planned session was missed in the last 2 days (the same rule
 * as the week) or today's muscles are still red while the other session's are ready.
 */
export function recommend(plan: TodayPlan, rec: GroupRecovery[], week: TrainWeek, done: DoneSession[], today: string): Recommendation {
  if (plan.why === 'done')
    return {
      type: 'rest',
      line: `Trained today: ${join(SESSION_GROUPS[plan.type as SessionType].slice(0, 2))} recover over the next 48 hours.`,
      swap: null
    }
  if (plan.type === 'rest') {
    const alt = plan.anyway
    if (alt) {
      const s = sessionState(rec, alt)
      if (!s.red.length)
        return {
          type: 'rest',
          line: `Best today: rest. If you want to train, ${SHORT[alt]} is ready (${readyText(s)}).`,
          swap: null
        }
    }
    return {
      type: 'rest',
      line: 'Best today: rest. Your muscles grow while they recover.',
      swap: null
    }
  }
  const t = plan.type
  const other: SessionType = t === 'upper' ? 'legs' : 'upper'
  const s = sessionState(rec, t)
  const o = sessionState(rec, other)
  const otherOk = !o.red.length && rested(done, other, today)
  // A missed session of the other kind, its muscles ready: do it first, today's waits.
  const missed = plan.why === 'planned' ? missedSession(week, done, today) : null
  if (missed && missed.type === other && otherOk)
    return {
      type: other,
      line: `${WEEKDAYS[dowOf(missed.day)]}'s ${TYPE_NAME[other]} was missed. Best to train today: ${SHORT[other]} (${readyText(o)}), then ${SHORT[t]} next time.`,
      swap: other
    }
  if (s.red.length) {
    const r = s.red[0]
    const what = `${r.name} is still recovering (trained ${agoText(r.hours)})`
    if (otherOk)
      return {
        type: other,
        line: `${what}. Best to train today: ${SHORT[other]} instead (${readyText(o)}).`,
        swap: other
      }
    return { type: t, line: `${what}. Go lighter today, or rest.`, swap: null }
  }
  return {
    type: t,
    line: `Best to train today: ${SHORT[t]} (${readyText(s)}).`,
    swap: null
  }
}

// ---------- the body map ----------

/** The body map's drawn regions → recovery groups. */
export const REGION_GROUP: Record<string, RecGroup> = {
  chest: 'chest',
  shoulders: 'shoulders',
  biceps: 'arms',
  triceps: 'arms',
  abs: 'core',
  obliques: 'core',
  'lower-back': 'back',
  'upper-back': 'back',
  lats: 'back',
  quads: 'legs',
  'calves-f': 'legs',
  'calves-b': 'legs',
  glutes: 'legs',
  hamstrings: 'legs'
}
