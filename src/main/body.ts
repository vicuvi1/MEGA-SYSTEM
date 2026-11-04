import {
  computeWeeklyAverages,
  computeWorkoutStats,
  DEFAULT_EXERCISES,
  validateWaist,
  validateWeight,
  validateWorkout,
  type BodyMetric,
  type BodyMetricInput,
  type BodySummary,
  type Exercise,
  type ExerciseCategory,
  type Workout,
  type WorkoutExerciseItem,
  type WorkoutInput
} from '@core/body'
import { LedgerError } from '@core/ledger'
import type { DB } from './db'
import { getSetting, setSetting } from './settings'
import type { Wallet } from './wallet'

interface DbWorkoutRow {
  id: number
  day: string
  ts: string
  title: string
  items_json: string
  note: string | null
  ledger_id: number | null
}

interface DbMetricRow {
  day: string
  weight: number | null
  waist: number | null
  note: string | null
  updated_at: string
}

interface DbExerciseRow {
  id: string
  name: string
  unit: string
  target: number
  category: ExerciseCategory
  sort: number
  archived: number
}

const REST_DAYS = 'sport_rest_days'

export class Body {
  constructor(private db: DB, private wallet: Wallet) {}

  /** Rest days you chose (synced setting, the last 120). */
  restDays(): string[] {
    try {
      const v = JSON.parse(getSetting(this.db, REST_DAYS) || '[]')
      return Array.isArray(v) ? v.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d))).map(String) : []
    } catch {
      return []
    }
  }

  /** Marks a day (default today) as a rest day, or takes it back. */
  setRest(day: string | null, on: boolean, now = new Date()): BodySummary {
    const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : this.wallet.today(now)
    const set = new Set(this.restDays())
    if (on) set.add(d)
    else set.delete(d)
    setSetting(this.db, REST_DAYS, JSON.stringify([...set].sort().slice(-120)))
    return this.state(now)
  }

  exercises(): Exercise[] {
    let rows = this.db.prepare('SELECT id, name, unit, target, category, sort, archived FROM exercises WHERE archived = 0 ORDER BY sort, name').all() as DbExerciseRow[]
    // The starter exercises only on a brand-new install (one you removed stays removed).
    const any = (this.db.prepare('SELECT COUNT(*) AS n FROM exercises').get() as { n: number }).n
    if (rows.length === 0 && !any) {
      for (const ex of DEFAULT_EXERCISES) {
        this.saveExercise(ex)
      }
      rows = this.db.prepare('SELECT id, name, unit, target, category, sort, archived FROM exercises WHERE archived = 0 ORDER BY sort, name').all() as DbExerciseRow[]
    }
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      unit: r.unit,
      target: r.target,
      category: r.category,
      sort: r.sort,
      archived: Boolean(r.archived)
    }))
  }

  saveExercise(ex: Omit<Exercise, 'id' | 'sort'> & { id?: string; sort?: number }): void {
    if (!ex.name || !ex.name.trim()) throw new LedgerError('Exercise name is required')
    const id = ex.id?.trim() || ex.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const sort = ex.sort ?? 99
    this.db.prepare(
      `INSERT INTO exercises (id, name, unit, target, category, sort, archived)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         unit = excluded.unit,
         target = excluded.target,
         category = excluded.category,
         sort = excluded.sort,
         archived = excluded.archived`
    ).run(id, ex.name.trim(), ex.unit || 'reps', Math.max(1, ex.target || 10), ex.category || 'calisthenics', sort, (ex as { archived?: boolean }).archived ? 1 : 0)
  }

  workouts(limit = 100): Workout[] {
    const rows = this.db.prepare('SELECT id, day, ts, title, items_json, note, ledger_id FROM workouts ORDER BY ts DESC LIMIT ?').all(limit) as DbWorkoutRow[]
    return rows.map((r) => ({
      id: r.id,
      day: r.day,
      ts: r.ts,
      title: r.title,
      items: JSON.parse(r.items_json) as WorkoutExerciseItem[],
      note: r.note ?? undefined,
      ledgerId: r.ledger_id
    }))
  }

  metrics(limit = 60): BodyMetric[] {
    // The newest `limit` days, oldest first (the latest weight keeps moving after 100 days).
    const rows = (this.db.prepare('SELECT day, weight, waist, note, updated_at FROM body_metrics ORDER BY day DESC LIMIT ?').all(limit) as DbMetricRow[]).reverse()
    return rows.map((r) => ({
      day: r.day,
      weight: r.weight,
      waist: r.waist,
      note: r.note,
      updatedAt: r.updated_at
    }))
  }

  state(now = new Date()): BodySummary {
    const today = this.wallet.today(now)
    const allWorkouts = this.workouts(200)
    const allMetrics = this.metrics(100)
    const exercises = this.exercises()

    const restDays = this.restDays()
    const stats = computeWorkoutStats(allWorkouts, today, restDays)
    const weeklyAverages = computeWeeklyAverages(allMetrics, 12)

    const withWeight = allMetrics.filter((m) => m.weight != null)
    const latestWeight = withWeight.length ? withWeight[withWeight.length - 1].weight! : null
    const previousWeight = withWeight.length > 1 ? withWeight[withWeight.length - 2].weight! : null

    const withWaist = allMetrics.filter((m) => m.waist != null)
    const latestWaist = withWaist.length ? withWaist[withWaist.length - 1].waist! : null
    const previousWaist = withWaist.length > 1 ? withWaist[withWaist.length - 2].waist! : null

    return {
      today,
      streak: stats.streak,
      bestStreak: stats.bestStreak,
      totalWorkouts: stats.totalWorkouts,
      workoutsThisWeek: stats.workoutsThisWeek,
      workoutDoneToday: stats.workoutDoneToday,
      restToday: stats.restToday,
      restDays,
      latestWeight,
      previousWeight,
      latestWaist,
      previousWaist,
      weeklyAverages,
      recentWorkouts: allWorkouts.slice(0, 25),
      metrics: allMetrics,
      exercises
    }
  }

  logWorkout(input: WorkoutInput, now = new Date()): { workout: Workout; state: BodySummary; awarded: boolean } {
    const err = validateWorkout(input)
    if (err) throw new LedgerError(err)

    const today = input.day ?? this.wallet.today(now)
    const ts = now.toISOString()

    return this.db.transaction(() => {
      let ledgerId: number | null = null
      let awarded = false
      try {
        ledgerId = this.wallet.awardRule('body.workout_done', {
          note: input.title,
          now,
          day: today,
          ref: `workout:${today}:${ts}`
        })
        awarded = true
      } catch (e) {
        if (!(e instanceof LedgerError)) throw e
      }

      const res = this.db.prepare(
        `INSERT INTO workouts (day, ts, title, items_json, note, ledger_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(today, ts, input.title.trim(), JSON.stringify(input.items), input.note?.trim() || null, ledgerId)

      const workout: Workout = {
        id: Number(res.lastInsertRowid),
        day: today,
        ts,
        title: input.title.trim(),
        items: input.items,
        note: input.note?.trim() || undefined,
        ledgerId
      }

      return {
        workout,
        state: this.state(now),
        awarded
      }
    })()
  }

  deleteWorkout(id: number, now = new Date()): BodySummary {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT ledger_id FROM workouts WHERE id = ?').get(id) as { ledger_id: number | null } | undefined
      if (!row) throw new LedgerError('Workout not found')

      if (row.ledger_id != null) {
        try {
          this.wallet.undo(row.ledger_id, 'Workout deleted', now)
        } catch {
          // ignore if already undone
        }
      }

      this.db.prepare('DELETE FROM workouts WHERE id = ?').run(id)
      return this.state(now)
    })()
  }

  logMetric(input: BodyMetricInput, now = new Date()): BodySummary {
    const wErr = validateWeight(input.weight)
    if (wErr) throw new LedgerError(wErr)
    const waistErr = validateWaist(input.waist)
    if (waistErr) throw new LedgerError(waistErr)

    if (input.weight == null && input.waist == null) {
      throw new LedgerError('Enter at least a weight or a waist measurement')
    }

    const today = input.day ?? this.wallet.today(now)
    const ts = now.toISOString()

    this.db.prepare(
      `INSERT INTO body_metrics (day, weight, waist, note, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET
         weight = COALESCE(excluded.weight, body_metrics.weight),
         waist = COALESCE(excluded.waist, body_metrics.waist),
         note = COALESCE(excluded.note, body_metrics.note),
         updated_at = excluded.updated_at`
    ).run(today, input.weight ?? null, input.waist ?? null, input.note?.trim() || null, ts)

    return this.state(now)
  }
}
