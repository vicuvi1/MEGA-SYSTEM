// Ben's water and workout cards on Telegram (what Sporty used to do), on the
// one shared log (settings.sport_tracker_json): progress bars, buttons, the
// day's record, and real progression (2 full days → harder, 2 weeks off → lighter). Pure.
import { sportForDay } from './sportShared'
import { WATER_GLASS_ML, WATER_TARGET_ML } from './defaults'

export const DEFAULT_EXERCISES = [
  { id: 'ex_pushups', name: 'Push-ups', target: 100, unit: 'reps', active: true, doneToday: 0 },
  { id: 'ex_situps', name: 'Sit-ups', target: 60, unit: 'reps', active: true, doneToday: 0 },
  { id: 'ex_squats', name: 'Squats', target: 60, unit: 'reps', active: true, doneToday: 0 },
  { id: 'ex_press', name: 'Press', target: 50, unit: 'reps', active: true, doneToday: 0 }
]

/** A fresh Sport Track state when there is none yet (so Ben works from day one). */
export function defaultSport(today: string): any {
  return { lastDate: today, exercises: DEFAULT_EXERCISES.map((e) => ({ ...e })), water: { currentMl: 0, targetMl: WATER_TARGET_ML, glassSizeMl: WATER_GLASS_ML }, history: [], sportySettings: { autoProgression: true, coachMode: false } }
}

export function bar(done: number, target: number, len = 8): string {
  if (target <= 0) return '█'.repeat(len)
  const r = Math.min(1, Math.max(0, done / target))
  const f = Math.round(r * len)
  return '█'.repeat(f) + '░'.repeat(len - f)
}

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
type Kb = { inline_keyboard: { text: string; callback_data: string }[][] }

/** target: the one goal every screen shows (coachStatus waterToday), else Sport Track's. */
export function waterCard(st: any, today: string, goal?: number): { text: string; keyboard: Kb } {
  const s = sportForDay(st, today)
  const ml = Math.round(Number(s.water.currentMl) || 0)
  const target = goal || Number(s.water.targetMl) || WATER_TARGET_ML
  const glass = Number(s.water.glassSizeMl) || 250
  const left = Math.max(0, target - ml)
  const text = [
    '💧 <b>Water today</b>',
    `<code>${bar(ml, target, 11)}</code> ${(ml / 1000).toFixed(2).replace(/0$/, '')} of ${(target / 1000).toFixed(1)} L`,
    `${Math.floor(ml / glass)} of ${Math.ceil(target / glass)} glasses (${glass} ml)`,
    left ? `<b>${left} ml</b> to go.` : '🎯 <b>Target reached.</b> Nice.',
    '<i>Or just type: water 250</i>'
  ].join('\n')
  return {
    text,
    keyboard: {
      inline_keyboard: [
        [
          { text: `💧 +${glass} (glass)`, callback_data: `wa|${glass}` },
          { text: '💧 +500 (bottle)', callback_data: 'wa|500' }
        ],
        [
          { text: '💧 +1000', callback_data: 'wa|1000' },
          { text: `➖ −${glass}`, callback_data: `wa|-${glass}` }
        ],
        [{ text: '🏋️ Workout', callback_data: 'wk|show' }]
      ]
    }
  }
}

export const activeExercises = (s: any) => (s.exercises ?? []).filter((e: any) => e.active !== false)
export const allDone = (s: any) => {
  const a = activeExercises(s)
  return a.length > 0 && a.every((e: any) => (Number(e.doneToday) || 0) >= (Number(e.target) || 0))
}

export function workoutCard(st: any, today: string, extra = ''): { text: string; keyboard: Kb } {
  const s = sportForDay(st, today)
  const list = activeExercises(s)
  const done = allDone(s)
  const lines = list.map((e: any) => {
    const d = Number(e.doneToday) || 0
    const t = Number(e.target) || 0
    return `${d >= t ? '✅' : '▫️'} <b>${esc(e.name)}</b> ${d}/${t} ${esc(e.unit || 'reps')}\n<code>${bar(d, t)}</code> ${t ? Math.round(Math.min(1, d / t) * 100) : 100}%`
  })
  const total = list.reduce((a: number, e: any) => a + Math.min(Number(e.doneToday) || 0, Number(e.target) || 0), 0)
  const goal = list.reduce((a: number, e: any) => a + (Number(e.target) || 0), 0)
  const head = done ? '🔥 <b>Workout done for today!</b>' : `🏋️ <b>Today's workout</b> · ${goal ? Math.round((total / goal) * 100) : 0}%`
  const rows = list
    .map((e: any, i: number) => ({ e, i }))
    .filter(({ e }: any) => (Number(e.doneToday) || 0) < (Number(e.target) || 0))
    .slice(0, 6)
    .map(({ e, i }: any) => [
      { text: `${String(e.name).slice(0, 12)} +10`, callback_data: `wk|${i}|10` },
      { text: '+25', callback_data: `wk|${i}|25` },
      { text: '✓ All', callback_data: `wk|${i}|all` }
    ])
  const tail = done ? [[{ text: '💧 Water', callback_data: 'wa|show' }]] : [[{ text: '✅ Complete all', callback_data: 'wk|all' }, { text: '💧 Water', callback_data: 'wa|show' }]]
  return { text: [head, '', ...lines, ...(extra ? ['', extra] : []), ...(done ? [] : ['', '<i>Or type: 30 pushups</i>'])].join('\n'), keyboard: { inline_keyboard: [...rows, ...tail] } }
}

/** Applies a button: "3|10", "3|all", "all". Returns the new state. */
export function applyWorkoutTap(st: any, today: string, data: string): any {
  const s = sportForDay(st, today)
  const list = activeExercises(s)
  if (data === 'all') {
    for (const e of list) e.doneToday = Math.max(Number(e.doneToday) || 0, Number(e.target) || 0)
    return s
  }
  const [i, amt] = data.split('|')
  const e = list[Number(i)]
  if (!e) return s
  e.doneToday = amt === 'all' ? Math.max(Number(e.doneToday) || 0, Number(e.target) || 0) : Math.max(0, (Number(e.doneToday) || 0) + (Number(amt) || 0))
  return s
}

/** Ben's record of finished days (settings.ben_workouts): per day, each exercise's target and reps. */
export interface WorkoutLog {
  days: Record<string, { name: string; target: number; done: number }[]>
}

export function recordWorkoutDay(log: WorkoutLog, st: any, today: string): WorkoutLog {
  const s = sportForDay(st, today)
  const days = { ...(log?.days ?? {}) }
  days[today] = activeExercises(s).map((e: any) => ({ name: String(e.name), target: Number(e.target) || 0, done: Number(e.doneToday) || 0 }))
  const keep = Object.keys(days).sort().slice(-60)
  return { days: Object.fromEntries(keep.map((d) => [d, days[d]])) }
}

export interface Progression { name: string; from: number; to: number; why: string }

/**
 * Real progression, per exercise:
 * - harder: the full target done on the last 2 days it was trained at this
 *   target → +5% (at least +1); the next step needs 2 more full days at the
 *   new target, so it only climbs while you keep up;
 * - lighter: not trained for real (half the target) in the last 14 days,
 *   though you trained before → −10%, so coming back is doable.
 */
export function progression(log: WorkoutLog, st: any, today?: string, needed = 2, pct = 5): Progression[] {
  const days = Object.keys(log.days ?? {}).sort()
  const out: Progression[] = []
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  for (const e of activeExercises(st)) {
    const cur = Number(e.target) || 0
    if (!cur) continue
    const name = String(e.name)
    const rows = days.map((d) => ({ d, r: log.days[d].find((x) => same(x.name, name)) })).filter((x) => x.r)
    // Lighter after two weeks away.
    if (today) {
      const from = isoAdd(today, -14)
      const real = rows.some((x) => x.d >= from && x.d < today && x.r!.done >= x.r!.target * 0.5)
      const before = rows.some((x) => x.d < from && x.r!.done > 0)
      if (!real && before) {
        const to = Math.max(1, Math.round(cur * 0.9))
        if (to < cur) out.push({ name, from: cur, to, why: '2 weeks without it: a bit lighter to come back' })
        continue
      }
    }
    const atTarget = rows.filter((x) => x.r!.target >= cur && x.r!.done > 0).slice(-needed)
    if (atTarget.length >= needed && atTarget.every((x) => x.r!.done >= x.r!.target)) out.push({ name, from: cur, to: cur + Math.max(1, Math.ceil((cur * pct) / 100)), why: `full target ${needed} times` })
  }
  return out
}

const isoAdd = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Exercise plan changes from Ben: set a target, add an exercise, remove one. */
export function setExercise(st: any, today: string, name: string, target?: number, unit = 'reps'): { st: any; line: string } {
  const s = sportForDay(st, today)
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  const e = s.exercises.find((x: any) => String(x.name).toLowerCase().replace(/[^a-z0-9]/g, '') === key || String(x.id).toLowerCase().replace(/[^a-z0-9]/g, '').includes(key))
  if (e) {
    const from = Number(e.target) || 0
    if (target && target > 0) e.target = Math.round(target)
    e.active = true
    return { st: s, line: `🏋️ ${e.name}: target ${from} → ${e.target} ${e.unit || unit}` }
  }
  if (!(target && target > 0)) return { st: s, line: '' }
  s.exercises.push({ id: `ex_${key || Date.now()}`, name: name.slice(0, 30), target: Math.round(target), unit, active: true, doneToday: 0 })
  return { st: s, line: `🏋️ New exercise: ${name} · ${Math.round(target)} ${unit} a day` }
}

export function removeExercise(st: any, today: string, name: string): { st: any; line: string } {
  const s = sportForDay(st, today)
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  const e = s.exercises.find((x: any) => String(x.name).toLowerCase().replace(/[^a-z0-9]/g, '') === key)
  if (!e) return { st: s, line: '' }
  e.active = false
  return { st: s, line: `🏋️ ${e.name} off the daily list` }
}
