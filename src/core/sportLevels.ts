// Sport Track's levels, placed from what you have logged (no test day).
// Every exercise family is a track of 10–15 levels: a name, a clear requirement
// ("3×20 push-ups") and what it means. Your level comes from your logged days:
// real sets when there are any, and for days with only a total (older days,
// the Telegram import) an estimate of the sets (total ÷ 3–6). It uses your best
// day, how steady you are and the recent trend, and updates after any log.
// After 10+ days off it shows a "Comeback level" and gives the old one back once
// you hit it twice. Overall strength rank: Recruit → Legend. Pure and tested;
// nothing here pays points.
import { FAMILIES, moveById, type Group, type Move } from './sportMoves'
import { moveOf, type DayLog, type SportEx } from './sportLadders'
import { muscleOf, setsOn, shiftDay, type Muscle, type SetLog } from './sportSets'

export interface Level {
  /** 1-based number on its track. */
  n: number
  name: string
  move: string
  sets: number
  /** Reps (or seconds for a hold) in each set. */
  reps: number
  /** "3×20 push-ups" */
  req: string
  /** What it means, in one motivating line. */
  meaning: string
}

export interface Track {
  family: string
  name: string
  group: Group
  levels: Level[]
}

type Row = [name: string, move: string, sets: number, reps: number]

const MEANING: string[][] = [
  ['Everyone starts here. Showing up is the hard part.', 'You have started: that already beats most people.'],
  ['You are building the base. Your body is learning fast.', 'Habits first, strength follows. You are on your way.'],
  ['Stronger than most beginners. This is real progress.', 'People notice this level. Keep the rhythm.'],
  ['A solid, honest level. You train with control.', 'You can trust your body here. Time to aim higher.'],
  ['Strong. Few people reach this without a gym.', 'This is advanced home training. Be proud of it.'],
  ['Elite strength. You earned every single rep.', 'The top of the ladder: legends are made of days like yours.']
]

const T = (family: string, rows: Row[]): [string, Row[]] => [family, rows]

const TABLES: [string, Row[]][] = [
  T('pushup', [
    ['Starting Line', 'incline_pushup', 3, 6], ['Incline Climber', 'incline_pushup', 3, 12], ['Kneeler', 'knee_pushup', 3, 10], ['Knee Master', 'knee_pushup', 3, 15],
    ['Floor Ready', 'pushup', 3, 5], ['Solid', 'pushup', 3, 10], ['Strong Chest', 'pushup', 3, 15], ['Machine', 'pushup', 3, 20], ['Wide Wings', 'wide_pushup', 3, 15],
    ['Diamond Cutter', 'diamond_pushup', 3, 10], ['Iron Chest', 'diamond_pushup', 3, 15], ['Decline Drive', 'decline_pushup', 3, 10], ['Archer', 'archer_pushup', 3, 6],
    ['Archer Elite', 'archer_pushup', 3, 10], ['Planche Path', 'planche_pushup', 3, 6]
  ]),
  T('squat', [
    ['Starting Line', 'squat', 3, 8], ['Steady Legs', 'squat', 3, 15], ['Squat Habit', 'squat', 3, 20], ['Hundred Club', 'squat', 3, 30], ['Springy', 'jump_squat', 3, 10],
    ['Jump Master', 'jump_squat', 3, 15], ['One Leg Forward', 'split_squat', 3, 10], ['Split Strong', 'split_squat', 3, 15], ['Bulgarian', 'bulgarian_squat', 3, 8],
    ['Bulgarian Pro', 'bulgarian_squat', 3, 12], ['Shrimp Starter', 'shrimp_squat', 3, 4], ['Shrimp Master', 'shrimp_squat', 3, 8], ['Pistol Path', 'pistol_squat', 3, 2],
    ['Pistol', 'pistol_squat', 3, 5]
  ]),
  T('core', [
    ['Starting Line', 'crunch', 3, 10], ['Crunch Rhythm', 'crunch', 3, 20], ['Sit-up Start', 'situp', 3, 10], ['Sit-up Strong', 'situp', 3, 20], ['Raise Your Legs', 'leg_raise', 3, 8],
    ['Leg Raise Pro', 'leg_raise', 3, 15], ['Hollow Start', 'hollow_hold', 3, 15], ['Hollow Strong', 'hollow_hold', 3, 30], ['V Shape', 'v_up', 3, 8], ['V-up Pro', 'v_up', 3, 15],
    ['Dragon Start', 'dragon_flag', 3, 2], ['Dragon Strong', 'dragon_flag', 3, 5]
  ]),
  T('plank', [
    ['Starting Line', 'plank', 3, 15], ['Half Minute', 'plank', 3, 30], ['Forty-five', 'plank', 3, 45], ['Full Minute', 'plank', 3, 60], ['Side Start', 'side_plank', 3, 20],
    ['Side Steady', 'side_plank', 3, 40], ['Tap Tap', 'shoulder_taps', 3, 20], ['Tap Master', 'shoulder_taps', 3, 40], ['Up and Down', 'plank_updown', 3, 10],
    ['Up-down Pro', 'plank_updown', 3, 20]
  ]),
  T('row', [
    ['Starting Line', 'door_row', 3, 6], ['Door Puller', 'door_row', 3, 12], ['Door Master', 'door_row', 3, 18], ['Table Start', 'table_row_bent', 3, 6], ['Bent Knee Rower', 'table_row_bent', 3, 12],
    ['Bent Knee Master', 'table_row_bent', 3, 18], ['Straight Legs', 'table_row', 3, 5], ['Rower', 'table_row', 3, 10], ['Strong Back', 'table_row', 3, 15], ['Back of Steel', 'table_row', 3, 20]
  ]),
  T('lunge', [
    ['Starting Line', 'reverse_lunge', 3, 6], ['Backstep', 'reverse_lunge', 3, 10], ['Backstep Strong', 'reverse_lunge', 3, 14], ['Forward Lunge', 'lunge', 3, 8], ['Lunge Steady', 'lunge', 3, 12],
    ['Lunge Strong', 'lunge', 3, 16], ['Lunge Master', 'lunge', 3, 20], ['Jump Start', 'jump_lunge', 3, 6], ['Jump Lunger', 'jump_lunge', 3, 10], ['Spring Legs', 'jump_lunge', 3, 15]
  ]),
  T('bridge', [
    ['Starting Line', 'glute_bridge', 3, 8], ['Bridge Builder', 'glute_bridge', 3, 15], ['Bridge Strong', 'glute_bridge', 3, 20], ['Bridge Master', 'glute_bridge', 3, 30],
    ['One Leg Start', 'single_leg_bridge', 3, 5], ['One Leg Steady', 'single_leg_bridge', 3, 8], ['One Leg Strong', 'single_leg_bridge', 3, 12], ['One Leg Pro', 'single_leg_bridge', 3, 15],
    ['Glute Machine', 'single_leg_bridge', 3, 20], ['Glute Legend', 'single_leg_bridge', 4, 20]
  ]),
  T('calf', [
    ['Starting Line', 'calf_raise', 3, 10], ['Calf Habit', 'calf_raise', 3, 20], ['Calf Strong', 'calf_raise', 3, 30], ['Calf Master', 'calf_raise', 3, 40], ['One Leg Start', 'single_calf_raise', 3, 6],
    ['One Leg Steady', 'single_calf_raise', 3, 10], ['One Leg Strong', 'single_calf_raise', 3, 15], ['One Leg Pro', 'single_calf_raise', 3, 20], ['Spring Steel', 'single_calf_raise', 3, 25],
    ['Calf Legend', 'single_calf_raise', 3, 30]
  ]),
  T('dips', [
    ['Starting Line', 'chair_dip', 3, 4], ['Dip Starter', 'chair_dip', 3, 8], ['Dip Steady', 'chair_dip', 3, 12], ['Dip Strong', 'chair_dip', 3, 16], ['Dip Machine', 'chair_dip', 3, 20],
    ['Dip Pro', 'chair_dip', 3, 25], ['Triceps Tank', 'chair_dip', 4, 20], ['Dip Elite', 'chair_dip', 4, 25], ['Dip Master', 'chair_dip', 5, 20], ['Dip Legend', 'chair_dip', 5, 25]
  ]),
  T('pike', [
    ['Starting Line', 'pike_pushup', 3, 4], ['Pike Starter', 'pike_pushup', 3, 8], ['Pike Steady', 'pike_pushup', 3, 12], ['Pike Strong', 'pike_pushup', 3, 15], ['Feet-up Start', 'elevated_pike', 3, 4],
    ['Feet-up Steady', 'elevated_pike', 3, 8], ['Feet-up Strong', 'elevated_pike', 3, 12], ['Shoulder Tank', 'elevated_pike', 3, 15], ['Shoulder Pro', 'elevated_pike', 4, 15],
    ['Shoulder Legend', 'elevated_pike', 5, 15]
  ]),
  T('back', [
    ['Starting Line', 'superman', 3, 6], ['Superman Steady', 'superman', 3, 12], ['Superman Strong', 'superman', 3, 18], ['Superman Master', 'superman', 3, 24], ['Swimmer Start', 'swimmer', 3, 10],
    ['Swimmer Steady', 'swimmer', 3, 16], ['Swimmer Strong', 'swimmer', 3, 24], ['Swimmer Pro', 'swimmer', 3, 32], ['Back Tank', 'swimmer', 4, 32], ['Back Legend', 'swimmer', 5, 32]
  ]),
  T('burpee', [
    ['Starting Line', 'half_burpee', 3, 5], ['Thruster', 'half_burpee', 3, 10], ['Thruster Strong', 'half_burpee', 3, 15], ['Burpee Start', 'burpee', 3, 5], ['Burpee Steady', 'burpee', 3, 10],
    ['Burpee Strong', 'burpee', 3, 15], ['Burpee Master', 'burpee', 3, 20], ['Push-up Burpee', 'pushup_burpee', 3, 6], ['Burpee Pro', 'pushup_burpee', 3, 10], ['Burpee Legend', 'pushup_burpee', 3, 15]
  ])
]

const REP_LADDER = [6, 10, 15, 20, 25, 30, 40, 50, 60, 80]

/** Words after the ×: "push-ups", "seconds of plank". */
const reqText = (m: Move, sets: number, reps: number) => (m.unit === 'sec' ? `${sets}×${reps} s ${m.name.toLowerCase()}` : `${sets}×${reps} ${m.name.toLowerCase()}`)

function build(family: string, group: Group, name: string, rows: Row[]): Track {
  const N = rows.length
  const levels: Level[] = rows.map(([lname, move, sets, reps], i) => {
    const m = moveById(move)
    if (!m) throw new Error(`sportLevels: unknown move ${move}`)
    const tier = Math.min(MEANING.length - 1, Math.floor((i / N) * MEANING.length))
    return { n: i + 1, name: lname, move, sets, reps, req: reqText(m, sets, reps), meaning: MEANING[tier][i % 2] }
  })
  return { family, name, group, levels }
}

/** A track for a family without a hand-made table: each step × a ladder of reps, 10 levels at least. */
function generic(family: string): Track | null {
  const f = FAMILIES[family]
  const steps = (f?.steps ?? []).map((id) => moveById(id)).filter(Boolean) as Move[]
  if (!steps.length) return null
  const rows: Row[] = []
  const perStep = Math.max(3, Math.ceil(10 / steps.length))
  steps.forEach((m, si) => {
    const sec = m.unit === 'sec'
    const base = sec ? [10, 20, 30, 45, 60, 75, 90] : REP_LADDER
    const from = si === 0 ? 0 : 1
    for (let k = 0; k < perStep; k++) {
      const r = base[Math.min(base.length - 1, from + k)]
      rows.push([`${m.name} ${k + 1}`, m.id, 3, si === 0 || !sec ? Math.max(3, Math.round(r * (1 - Math.min(0.5, si * 0.12)))) : r])
    }
  })
  // Names: the move and the level on it ("Squat thrusts · 3×10").
  return build(family, steps[0].group, f.name, rows.slice(0, 15).map((r) => [r[0], r[1], r[2], r[3]] as Row))
}

const CACHE = new Map<string, Track | null>()
export function trackOf(family: string): Track | null {
  if (CACHE.has(family)) return CACHE.get(family)!
  let t: Track | null = null
  const table = TABLES.find((x) => x[0] === family)
  if (table) {
    const first = moveById(table[1][0][1])
    t = build(family, first?.group ?? 'push', FAMILIES[family]?.name ?? family, table[1])
  } else t = generic(family)
  CACHE.set(family, t)
  return t
}

/** The families with a hand-made table of levels. */
export const MAIN_FAMILIES = TABLES.map((t) => t[0])

const stepIdx = (move: Move) => (FAMILIES[move.family]?.steps ?? []).indexOf(move.id)

// ---------------------------------------------------------------- sets of a day

export interface DayEntry {
  move: Move
  reps: number[]
  /** The sets were estimated from a day total (no set data). */
  est: boolean
  /** A declared best set: harder moves of the ladder count too, at 70% of the reps per step. */
  transfer?: boolean
}

/** One max set you told us about ("my best set: 50"), per exercise family. */
export interface BestSet {
  move: string
  reps: number
  day: string
}
/** Working sets are about 60% of a max set. */
export const WORKING_OF_MAX = 0.6
/** Reps on a move that match `reps` on a move `steps` harder on its ladder. */
export const transferReps = (reps: number, steps: number) => reps * Math.pow(0.7, Math.max(0, steps))

/** How many sets a day total was probably done in. */
export function estimateSets(total: number, unit: 'reps' | 'sec' = 'reps'): number[] {
  const t = Math.max(0, Math.round(total))
  if (t <= 0) return []
  const n = unit === 'sec' ? (t > 180 ? 4 : 3) : Math.max(3, Math.min(6, Math.ceil(t / 25)))
  const base = Math.floor(t / n)
  const extra = t - base * n
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0))
}

export interface HistoryInput {
  exercises: SportEx[]
  days?: DayLog | null
  sets?: SetLog | null
  today: string
  /** Your declared best set per family (placement counts it on its day and the day before). */
  best?: Record<string, BestSet> | null
}

/** Per day, the entries of one family: real sets, else an estimate from the day total. */
export function dayEntries(input: HistoryInput, family: string, until?: string): Map<string, DayEntry[]> {
  const out = new Map<string, DayEntry[]>()
  const exs = input.exercises.map((ex) => ({ ex, move: moveOf(ex) })).filter((x) => x.move && x.move.family === family) as { ex: SportEx; move: Move }[]
  const dayKeys = new Set([...Object.keys(input.days ?? {}), ...Object.keys(input.sets ?? {})])
  for (const day of dayKeys) {
    if (day > (until ?? input.today)) continue
    for (const { ex, move } of exs) {
      const real = setsOn(input.sets, day, String(ex.id)).map((s) => s.reps)
      let entry: DayEntry | null = null
      if (real.length) entry = { move, reps: real, est: false }
      else {
        const total = Number(input.days?.[day]?.[String(ex.id)]) || 0
        if (total > 0) entry = { move, reps: estimateSets(total, move.unit), est: true }
      }
      if (entry) (out.get(day) ?? out.set(day, []).get(day)!).push(entry)
    }
  }
  const b = input.best?.[family]
  const bm = b && moveById(b.move)
  if (b && bm && b.reps > 0 && b.day <= (until ?? input.today)) {
    const w = Math.max(1, Math.round(b.reps * WORKING_OF_MAX))
    const mk = (): DayEntry => ({ move: bm, reps: [w, w, w], est: true, transfer: true })
    for (const d of [b.day, shiftDay(b.day, -1)]) (out.get(d) ?? out.set(d, []).get(d)!).push(mk())
  }
  return out
}

/** How many sets of this entry count towards a level: the move at least as hard, 70% of the reps for a harder move. */
function setsMeeting(entries: DayEntry[], lv: Level): number {
  const lm = moveById(lv.move)
  if (!lm) return 0
  const li = stepIdx(lm)
  let n = 0
  for (const e of entries) {
    const hard = stepIdx(e.move)
    if (hard < li) {
      if (e.transfer) n += e.reps.filter((r) => transferReps(r, li - hard) >= lv.reps).length
      continue
    }
    const need = hard > li ? Math.ceil(lv.reps * 0.7) : lv.reps
    n += e.reps.filter((r) => r >= need).length
  }
  return n
}

/** The highest level a day's entries reach (0: none). */
export function levelOfDay(track: Track, entries: DayEntry[]): number {
  for (let i = track.levels.length - 1; i >= 0; i--) if (setsMeeting(entries, track.levels[i]) >= track.levels[i].sets) return i + 1
  return 0
}

/** The day's level with the part of the way to the next one ("6.4"). */
export function valueOfDay(track: Track, entries: DayEntry[]): number {
  const L = levelOfDay(track, entries)
  const top = Math.max(0, ...entries.flatMap((e) => e.reps))
  if (L >= track.levels.length) return L
  const cur = L ? track.levels[L - 1] : null
  const next = track.levels[L]
  const nm = moveById(next.move)!
  // Progress toward the next level: reps of the best set on its move (or an easier one) between 0 and its reps.
  const best = Math.max(0, ...entries.filter((e) => stepIdx(e.move) >= stepIdx(nm)).flatMap((e) => e.reps), ...entries.flatMap((e) => e.reps).map((r) => r * 0.7))
  const lo = cur && cur.move === next.move ? cur.reps : 0
  const frac = Math.max(0, Math.min(0.95, (Math.min(best, top) - lo) / Math.max(1, next.reps - lo)))
  return L + frac
}

// ---------------------------------------------------------------- placement

export type Trend = 'up' | 'steady' | 'down' | 'new'

export interface Placement {
  family: string
  track: Track
  /** 0: nothing logged yet. */
  level: number
  of: number
  lv: Level | null
  next: Level | null
  /** The best level any day reached in the last 60 days, and when. */
  best: { level: number; day: string; top: number; sets: number; est: boolean } | null
  /** The level you reached on at least 2 days of the last 45. */
  solid: number
  /** Days with a log in the last 30. */
  active30: number
  daysLogged: number
  trend: Trend
  /** Part of the way to the next level, 0–1 (from the best recent day). */
  frac: number
  estimated: boolean
  lastDay: string | null
  /** A comeback: the old level and how many days you hit it since you are back (of 2). */
  comeback: { from: number; hits: number; need: number; daysOff: number } | null
  /** One line: why this level. */
  why: string
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)
export const COMEBACK_DAYS = 10

function core(input: HistoryInput, track: Track, until: string): Omit<Placement, 'why' | 'comeback'> {
  const entries = dayEntries(input, track.family, until)
  const rows = [...entries.entries()].map(([day, es]) => ({ day, es, level: levelOfDay(track, es), value: valueOfDay(track, es) })).sort((a, b) => a.day.localeCompare(b.day))
  const lastDay = rows.length ? rows[rows.length - 1].day : null
  const of = track.levels.length
  const base = { family: track.family, track, of, active30: 0, daysLogged: rows.length, trend: 'new' as Trend, lastDay, frac: 0, estimated: false }
  if (!rows.length) return { ...base, level: 0, lv: null, next: track.levels[0], best: null, solid: 0 }
  const win = (n: number) => rows.filter((r) => dayDiff(r.day, until) <= n)
  const w60 = win(60)
  const w45 = win(45)
  const pool = w60.length ? w60 : rows.slice(-1)
  let bestRow = pool[0]
  for (const r of pool) if (r.level > bestRow.level || (r.level === bestRow.level && r.day > bestRow.day)) bestRow = r
  let solid = 0
  for (let L = of; L >= 1; L--) if (w45.filter((r) => r.level >= L).length >= 2) { solid = L; break }
  let level = pool.length <= 2 ? bestRow.level : Math.max(solid, Math.min(bestRow.level, solid + 1))
  // The recent trend: a clear slip in the last 3 weeks pulls the level down to where you are now.
  const w21 = win(21)
  if (w21.length >= 2) {
    const recentMax = Math.max(...w21.map((r) => r.level))
    if (recentMax < level - 1) level = recentMax + 1
  }
  level = Math.max(1, Math.min(of, level))
  const a = win(14)
  const b = rows.filter((r) => dayDiff(r.day, until) > 14 && dayDiff(r.day, until) <= 28)
  const avg = (l: typeof rows) => (l.length ? l.reduce((t, r) => t + r.value, 0) / l.length : null)
  const va = avg(a)
  const vb = avg(b)
  const trend: Trend = va == null ? 'down' : vb == null ? (rows.length < 3 ? 'new' : 'steady') : va - vb > 0.3 ? 'up' : va - vb < -0.3 ? 'down' : 'steady'
  const top = Math.max(0, ...bestRow.es.flatMap((e) => e.reps))
  const topEntry = bestRow.es.find((e) => e.reps.includes(top))!
  const recentBest = Math.max(0, ...win(10).map((r) => r.value))
  const frac = Math.max(0, Math.min(1, recentBest - Math.floor(recentBest))) * (recentBest >= level ? 1 : 0)
  return {
    ...base,
    level,
    lv: track.levels[level - 1],
    next: track.levels[level] ?? null,
    best: { level: bestRow.level, day: bestRow.day, top, sets: topEntry.reps.length, est: bestRow.es.some((e) => e.est) },
    solid,
    active30: win(30).length,
    trend,
    frac,
    estimated: bestRow.es.every((e) => e.est)
  }
}

/** Where you stand on one family's track. `until` re-places you as you were on that day. */
export function placeFamily(input: HistoryInput, family: string, until?: string): Placement | null {
  const track = trackOf(family)
  if (!track) return null
  const day = until ?? input.today
  const p = core(input, track, day)
  let comeback: Placement['comeback'] = null
  let level = p.level
  if (p.lastDay && p.level > 0) {
    const off = dayDiff(p.lastDay, day)
    if (off >= COMEBACK_DAYS) {
      comeback = { from: p.level, hits: 0, need: 2, daysOff: off }
      level = Math.max(1, p.level - (off >= 21 ? 2 : 1))
    } else {
      // Back after a break in the last 5 weeks: the old level returns after 2 days at it.
      const entries = [...dayEntries(input, family, day).keys()].sort()
      for (let i = entries.length - 1; i > 0; i--) {
        if (dayDiff(entries[i], day) > 35) break
        const gap = dayDiff(entries[i - 1], entries[i])
        if (gap >= COMEBACK_DAYS) {
          const old = core(input, track, entries[i - 1]).level
          const map = dayEntries(input, family, day)
          const hits = entries.slice(i).filter((d) => levelOfDay(track, map.get(d) ?? []) >= old).length
          if (hits < 2 && old > 1) {
            comeback = { from: old, hits, need: 2, daysOff: gap }
            level = Math.min(p.level, Math.max(1, old - (gap >= 21 ? 2 : 1)))
          }
          break
        }
      }
    }
  }
  const lv = level ? track.levels[level - 1] : null
  const next = track.levels[level] ?? null
  const bestTxt = p.best ? `best day ${p.best.sets}×${p.best.top}${p.estimated ? ' (from your totals)' : ''}` : 'nothing logged yet'
  const steady = p.active30 >= 12 ? 'steady' : p.active30 >= 6 ? 'regular' : p.active30 ? 'on and off' : 'quiet lately'
  const trendTxt = p.trend === 'up' ? 'trending up' : p.trend === 'down' ? 'a little down lately' : p.trend === 'new' ? 'just started' : 'holding steady'
  const why = !level
    ? `${track.name}: nothing logged yet. Log one day (like "15 14 12") and your level appears.`
    : comeback && comeback.hits < comeback.need
      ? `${track.name}: Comeback level ${level} ${lv!.name} after ${comeback.daysOff} days off. Hit Level ${comeback.from} (${track.levels[comeback.from - 1].req}) on ${comeback.need - comeback.hits} more ${comeback.need - comeback.hits === 1 ? 'day' : 'days'} to get it back.`
      : `${track.name}: ${bestTxt}, ${p.active30} ${p.active30 === 1 ? 'day' : 'days'} in 30 (${steady}), ${trendTxt} → Level ${level} ${lv!.name}.${next ? ` Next: Level ${next.n} at ${next.req}.` : ' You are at the top of this ladder.'}`
  return { ...p, level, lv, next, comeback, why }
}

/** The families you log (from your exercises), with where you stand on each; most advanced first. */
export function placeAll(input: HistoryInput, until?: string): Placement[] {
  const fams = new Set<string>()
  for (const ex of input.exercises) {
    const m = moveOf(ex)
    if (m) fams.add(m.family)
  }
  const out: Placement[] = []
  for (const f of fams) {
    const p = placeFamily(input, f, until)
    if (p && p.level > 0) out.push(p)
  }
  return out.sort((a, b) => b.level / b.of - a.level / a.of)
}

// ---------------------------------------------------------------- series (charts, forecast)

export interface SeriesPoint {
  day: string
  /** Best single set that day. */
  top: number
  level: number
  value: number
  est: boolean
  /** Reps (or seconds) in all sets that day. */
  total: number
}

/** One family, one point per logged day: best set, level, fractional level and the day's total. */
export function seriesOf(input: HistoryInput, family: string, until?: string): SeriesPoint[] {
  const track = trackOf(family)
  if (!track) return []
  return [...dayEntries(input, family, until).entries()]
    .map(([day, es]) => ({
      day,
      top: Math.max(0, ...es.flatMap((e) => e.reps)),
      level: levelOfDay(track, es),
      value: valueOfDay(track, es),
      est: es.every((e) => e.est),
      total: es.reduce((t, e) => t + e.reps.reduce((a, b) => a + b, 0), 0)
    }))
    .sort((a, b) => a.day.localeCompare(b.day))
}

/** The days a level went up (in the series: the first day each new top level was reached), for the chart marks. */
export function levelChanges(series: SeriesPoint[]): { day: string; level: number }[] {
  const out: { day: string; level: number }[] = []
  let top = 0
  for (const p of series) {
    if (p.level > top) {
      if (top > 0) out.push({ day: p.day, level: p.level })
      top = p.level
    }
  }
  return out
}

// ---------------------------------------------------------------- the overall rank

export const RANKS = [
  { name: 'Recruit', from: 0, line: 'You signed up. Now show up.' },
  { name: 'Trainee', from: 10, line: 'The habit is forming and the base is real.' },
  { name: 'Fighter', from: 25, line: 'You are strong in more than one area.' },
  { name: 'Warrior', from: 45, line: 'Strong all over: push, pull, core and legs.' },
  { name: 'Elite', from: 65, line: 'Advanced moves and the discipline to match.' },
  { name: 'Legend', from: 85, line: 'The top of the ladders. Few ever get here.' }
] as const

export interface Rank {
  /** 0–100 */
  score: number
  rank: (typeof RANKS)[number]
  index: number
  next: (typeof RANKS)[number] | null
  /** Points still needed for the next rank. */
  need: number
  by: Record<Muscle, number>
  /** What would raise it most. */
  hint: string
}

/** Your strength rank from every group: the average of your best track per muscle group (0 for a group you do not train). */
export function overallRank(places: Placement[]): Rank {
  const by: Record<Muscle, number> = { push: 0, pull: 0, core: 0, legs: 0 }
  const bestFam: Partial<Record<Muscle, Placement>> = {}
  for (const p of places) {
    const mu = muscleOf(p.track.group)
    if (!mu) continue
    const pct = (((p.level - 1) + p.frac) / p.of) * 100
    if (pct > by[mu]) {
      by[mu] = pct
      bestFam[mu] = p
    }
  }
  const score = Math.round((by.push + by.pull + by.core + by.legs) / 4)
  let index = 0
  RANKS.forEach((r, i) => { if (score >= r.from) index = i })
  const next = RANKS[index + 1] ?? null
  const weakest = (Object.keys(by) as Muscle[]).sort((a, b) => by[a] - by[b])[0]
  const names: Record<Muscle, string> = { push: 'pushing', pull: 'pulling', core: 'core', legs: 'legs' }
  const wp = bestFam[weakest]
  const hint = !next
    ? 'You are at the top. Keep it up.'
    : wp?.next
      ? `Fastest way up: ${names[weakest]}. Reach Level ${wp.next.n} (${wp.next.req}).`
      : by[weakest] === 0
        ? `Fastest way up: start training your ${names[weakest]}.`
        : `Fastest way up: raise your ${names[weakest]}.`
  return { score, rank: RANKS[index], index, next, need: next ? Math.max(0, next.from - score) : 0, by, hint }
}

// ---------------------------------------------------------------- you 30 days ago vs now

export interface Compare {
  family: string
  name: string
  then: { level: number; best: number; total: number } | null
  now: { level: number; best: number; total: number }
  /** "Level 3 → 5, best set 12 → 18" */
  line: string
}

export function compareThen(input: HistoryInput, days = 30): Compare[] {
  const out: Compare[] = []
  const before = shiftDay(input.today, -days)
  const stat = (family: string, from: string, to: string) => {
    const s = seriesOf(input, family, to).filter((p) => p.day >= from)
    return { best: Math.max(0, ...s.map((p) => p.top)), total: s.reduce((t, p) => t + p.total, 0) }
  }
  for (const p of placeAll(input)) {
    const old = placeFamily(input, p.family, before)
    const a = old && old.level > 0 ? { level: old.level, ...stat(p.family, shiftDay(before, -30), before) } : null
    const b = { level: p.level, ...stat(p.family, shiftDay(input.today, -30), input.today) }
    const line = a
      ? `Level ${a.level} → ${b.level}${b.level > a.level ? ' (up!)' : b.level === a.level ? ' (same)' : ' (down a bit)'} · best set ${a.best} → ${b.best}`
      : `New since then: Level ${b.level}, best set ${b.best}`
    out.push({ family: p.family, name: p.track.name, then: a, now: b, line })
  }
  return out
}

// ---------------------------------------------------------------- milestones

export interface Milestone {
  id: string
  title: string
  line: string
  /** The day you earned it, or null. */
  day: string | null
  /** "34 of 50" while not earned. */
  progress?: string
}

/** Fun titles for real feats: first 50 in one set, 100 squats club, Pistol unlocked… (no points). */
export function milestones(input: HistoryInput): Milestone[] {
  const out: Milestone[] = []
  const famsOf = (f: string) => seriesOf(input, f)
  const firstWhere = (s: SeriesPoint[], pred: (p: SeriesPoint) => boolean) => s.find(pred)?.day ?? null
  const add = (id: string, title: string, line: string, day: string | null, progress?: string) => out.push({ id, title, line, day, ...(day || !progress ? {} : { progress }) })
  const push = famsOf('pushup')
  const squat = famsOf('squat')
  const bestOf = (s: SeriesPoint[]) => Math.max(0, ...s.map((p) => p.top))
  for (const n of [10, 25, 50]) add(`pu${n}`, n === 50 ? 'First 50 in one set' : `First ${n} push-ups in one set`, 'Push-ups, all in a row, no stopping.', firstWhere(push.filter((p) => !p.est), (p) => p.top >= n), `best ${bestOf(push.filter((p) => !p.est))} of ${n}`)
  add('sq100', '100 squats club', 'A hundred squats in one day.', firstWhere(squat, (p) => p.total >= 100), `best day ${Math.max(0, ...squat.map((p) => p.total))} of 100`)
  add('pu100', '100 push-ups day', 'A hundred push-ups in one day.', firstWhere(push, (p) => p.total >= 100), `best day ${Math.max(0, ...push.map((p) => p.total))} of 100`)
  const plank = famsOf('plank').filter((p) => p.top > 0)
  add('plank60', 'The minute hold', 'Hold a plank for a full minute.', firstWhere(plank, (p) => p.top >= 60), `best ${bestOf(plank)} of 60 s`)
  // Unlocked: a hard move (difficulty 4–5) in any of your logs.
  const logged = new Map<string, string>()
  for (const ex of input.exercises) {
    const m = moveOf(ex)
    if (!m || m.diff < 4) continue
    const days = [...new Set([...Object.keys(input.days ?? {}).filter((d) => Number(input.days?.[d]?.[String(ex.id)]) > 0), ...Object.keys(input.sets ?? {}).filter((d) => setsOn(input.sets, d, String(ex.id)).length)])].sort()
    if (days.length && (!logged.has(m.id) || logged.get(m.id)! > days[0])) logged.set(m.id, days[0])
  }
  for (const [id, day] of logged) {
    const m = moveById(id)!
    add(`un_${id}`, m.id === 'pistol_squat' ? 'Pistol unlocked' : `${m.name.replace(/ \(.*\)/, '')} unlocked`, 'A hard move most people never try.', day)
  }
  if (!logged.has('pistol_squat')) add('un_pistol_squat', 'Pistol unlocked', 'Your first pistol squat.', null, 'on the squat ladder')
  // Total reps
  let total = 0
  let day1k: string | null = null
  let day10k: string | null = null
  for (const d of Object.keys(input.days ?? {}).sort()) {
    for (const [id, v] of Object.entries(input.days?.[d] ?? {})) {
      const ex = input.exercises.find((e) => String(e.id) === id)
      if (ex && (moveOf(ex)?.unit ?? ex.unit) === 'sec') continue
      total += Number(v) || 0
    }
    if (!day1k && total >= 1000) day1k = d
    if (!day10k && total >= 10000) day10k = d
  }
  add('reps1k', '1,000 reps club', 'A thousand reps, one by one.', day1k, `${total} of 1,000`)
  add('reps10k', '10,000 reps club', 'Ten thousand reps. Real dedication.', day10k, `${total} of 10,000`)
  return out
}