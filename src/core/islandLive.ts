// Island v2: live activities. What is happening right now that deserves a
// place in the pill (a running timer, the eye-break countdown, a workout rest,
// a meeting about to start, music, water when you are behind), how much each
// matters, and which two share the pill when two things are live at once
// (the split pill: the main thing left, its companion right).
// Pure and tested with a pinned clock (islandLive.test.ts).
import type { LiveKind } from './islandLooks'

export interface LiveBlock { title: string; start: number; end: number; call?: boolean; meet?: string | null }

export interface WorkoutLive {
  /** The exercise of the current little session (sets logged from the island). */
  name: string
  sets: number
  reps: number
  lastAt: number
  /** The rest countdown after the last set ends here (null: no rest running). */
  restEndsAt: number | null
}

export interface LiveInput {
  now: number
  running?: { subject: string; startedAt: number; endsAt: number; pausedAt?: number | null; brk?: boolean } | null
  /** What is on now and what is next (a meeting when `call`). */
  current?: LiveBlock | null
  next?: LiveBlock | null
  music?: { playing: boolean; title: string; artist?: string } | null
  workout?: WorkoutLive | null
  /** The eye break's 20 s countdown on the pill. */
  eyes?: { endsAt: number } | null
  water?: { ml: number; target: number } | null
  /** You are a glass or more behind today's pace (core/healthyDay.ts waterBehindPace). */
  waterBehind?: boolean
  /** Which kinds may show (the look's widgets); missing = all. */
  allow?: Partial<Record<LiveKind, boolean>>
}

export interface LiveActivity {
  kind: LiveKind
  /** Stable while it is the same thing (React keys, flights between views). */
  key: string
  /** Higher wins. */
  prio: number
  icon: string
  /** What it is ("Write the essay", "Set 3 · Push-ups", "Standup"). */
  label: string
  /** The live number ("24:13", "Rest 1:12", "in 4:12", "750 / 2000 ml"). */
  value: string
  /** 0 … 1 for a ring or a fill, when it has one. */
  progress?: number
  /** Ends (or starts) at this time: the renderer ticks it each second. */
  at?: number
  urgent?: boolean
  paused?: boolean
}

const MIN = 60_000
/** A rest between sets. */
export const REST_SEC = 90
/** Sets more than this apart are a new little session. */
export const WORKOUT_GAP_MS = 20 * MIN
/** How long a meeting counts as "soon". */
export const MEETING_SOON_MIN = 15
/** The kinds that make the best companion on the right of a split pill. */
export const COMPANION: ReadonlySet<LiveKind> = new Set<LiveKind>(['music', 'water'])
/** The lowest priority that still earns half of a split pill. */
export const SPLIT_MIN_PRIO = 15

/** m:ss (or h:mm:ss) for a number of seconds; negative = over ("+1:05"). */
export function mmss(sec: number): string {
  const over = sec < 0
  const s = Math.abs(Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  const t = h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
  return over ? `+${t}` : t
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** Every live thing, the most important first. */
export function liveActivities(i: LiveInput): LiveActivity[] {
  const { now } = i
  const ok = (k: LiveKind) => i.allow?.[k] !== false
  const out: LiveActivity[] = []
  if (ok('eyes') && i.eyes && i.eyes.endsAt > now) {
    const left = (i.eyes.endsAt - now) / 1000
    out.push({ kind: 'eyes', key: 'eyes', prio: 100, icon: '👀', label: 'Look far away', value: mmss(left), progress: clamp01(1 - left / 20), at: i.eyes.endsAt, urgent: true })
  }
  const r = i.running
  if (ok('timer') && r) {
    const ref = r.pausedAt ?? now
    const left = (r.endsAt - ref) / 1000
    const over = !r.pausedAt && left < 0
    const total = Math.max(1, r.endsAt - r.startedAt)
    out.push({
      kind: 'timer',
      key: `timer:${r.startedAt}`,
      prio: over ? 95 : r.pausedAt ? 55 : 80,
      icon: r.brk ? '☕' : '⏱',
      label: r.brk ? 'Break' : r.subject,
      value: r.pausedAt ? `⏸ ${mmss(left)}` : mmss(left),
      progress: clamp01((ref - r.startedAt) / total),
      at: r.pausedAt ? undefined : r.endsAt,
      urgent: over,
      paused: !!r.pausedAt
    })
  }
  if (ok('meeting')) {
    const m = [i.current, i.next].find((b): b is LiveBlock => !!b && !!b.call && b.end > now)
    if (m) {
      const toStart = (m.start - now) / MIN
      if (toStart <= 0) out.push({ kind: 'meeting', key: `meet:${m.start}`, prio: 90, icon: '📅', label: m.title, value: 'now', at: m.end, urgent: true })
      else if (toStart <= 60)
        out.push({ kind: 'meeting', key: `meet:${m.start}`, prio: toStart <= 2 ? 90 : toStart <= MEETING_SOON_MIN ? 60 : 30, icon: '📅', label: m.title, value: `in ${mmss((m.start - now) / 1000)}`, at: m.start, urgent: toStart <= 2 })
    }
  }
  const w = i.workout && now - i.workout.lastAt < WORKOUT_GAP_MS ? i.workout : null
  if (ok('workout') && w) {
    const resting = w.restEndsAt != null && w.restEndsAt > now
    out.push({
      kind: 'workout',
      key: `workout:${w.name}`,
      prio: resting ? 75 : 45,
      icon: '💪',
      label: `Set ${w.sets} · ${w.name}`,
      value: resting ? `Rest ${mmss((w.restEndsAt! - now) / 1000)}` : `${w.reps} reps`,
      progress: resting ? clamp01(1 - (w.restEndsAt! - now) / (REST_SEC * 1000)) : undefined,
      at: resting ? w.restEndsAt! : undefined
    })
  }
  if (ok('music') && i.music && i.music.title) {
    out.push({ kind: 'music', key: 'music', prio: i.music.playing ? 50 : 15, icon: '♫', label: i.music.title, value: i.music.playing ? (i.music.artist || 'Playing') : 'Paused', paused: !i.music.playing })
  }
  if (ok('water') && i.water && i.water.target > 0 && i.waterBehind && i.water.ml < i.water.target) {
    out.push({ kind: 'water', key: 'water', prio: 25, icon: '💧', label: 'Water', value: `${i.water.ml} / ${i.water.target} ml`, progress: clamp01(i.water.ml / i.water.target) })
  }
  return out.sort((a, b) => b.prio - a.prio)
}

export interface SplitPill { left: LiveActivity | null; right: LiveActivity | null }

/**
 * Which two live things share the pill. The most important goes left; the
 * next one of another kind goes right, if it matters enough. A companion
 * (music, water) never takes the left side from a main thing.
 * `split` off: one thing only.
 */
export function splitPill(list: LiveActivity[], split = true): SplitPill {
  const left = list[0] ?? null
  if (!left) return { left: null, right: null }
  if (!split) return { left, right: null }
  const right = list.find((a) => a !== left && a.kind !== left.kind && a.prio >= SPLIT_MIN_PRIO) ?? null
  if (!right) return { left, right: null }
  if (COMPANION.has(left.kind) && !COMPANION.has(right.kind)) return { left: right, right: left }
  return { left, right }
}

// ---- the island's own little workout: sets logged from it, with a rest countdown ----

/** After a set logged from the island: the same exercise soon after is the next set, else a new session. */
export function workoutAfterLog(prev: WorkoutLive | null, name: string, n: number, now: number, restSec = REST_SEC): WorkoutLive {
  const same = prev && prev.name === name && now - prev.lastAt < WORKOUT_GAP_MS
  return { name, sets: same ? prev!.sets + 1 : 1, reps: (same ? prev!.reps : 0) + Math.max(0, Math.round(n)), lastAt: now, restEndsAt: restSec > 0 ? now + restSec * 1000 : null }
}

/** The last set was undone: one set less (no rest), or nothing left. */
export function workoutUndo(prev: WorkoutLive | null, n: number): WorkoutLive | null {
  if (!prev) return null
  const sets = prev.sets - 1
  if (sets <= 0) return null
  return { ...prev, sets, reps: Math.max(0, prev.reps - Math.max(0, Math.round(n))), restEndsAt: null }
}
