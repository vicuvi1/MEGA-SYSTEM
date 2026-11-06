// Sport Track's badges, worked out from what you really logged: the day log
// (reps per exercise per day), your sessions (when you logged them) and your
// records. Badges are only for show: they pay no points (the app's points
// rules pay for logged work, never for a badge).
import { FAMILIES, GROUPS, moveById, type Group } from './sportMoves'
import { moveOf, type DayLog, type SportEx } from './sportLadders'

export interface Session {
  day: string
  /** Local hour it was logged (0–23), if known. */
  hour?: number | null
  /** A "Daily routine": every exercise of the day reached its target. */
  full?: boolean
}

export interface BadgeInput {
  days: DayLog
  exercises: SportEx[]
  sessions: Session[]
  restDays?: string[]
  /** Personal records you set (beaten bests). */
  records?: number
  today: string
}

export type Tier = 'bronze' | 'silver' | 'gold' | 'special'
export interface Badge {
  id: string
  name: string
  desc: string
  icon: string
  tier: Tier
  cur: number
  goal: number
  done: boolean
  /** The day it was earned, when it can be told from the log. */
  day: string | null
  /** For per-exercise badges: which one. */
  what?: string
}

const shift = (day: string, n: number) => {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const weekday = (day: string) => (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7 // Monday 0
const monday = (day: string) => shift(day, -weekday(day))

/** Days with any logged work, oldest first (the day log and your sessions). */
export function activeDays(input: Pick<BadgeInput, 'days' | 'sessions' | 'today'>): string[] {
  const s = new Set<string>()
  for (const [d, m] of Object.entries(input.days)) if (d <= input.today && Object.values(m ?? {}).some((v) => Number(v) > 0)) s.add(d)
  for (const x of input.sessions) if (x.day && x.day <= input.today) s.add(x.day)
  return [...s].sort()
}

/**
 * Your best run of training days: rest days you planned keep a run going but
 * don't add to it. Returns the length and the day it first reached `n`, for each n asked.
 */
export function bestRun(active: string[], rest: string[], goals: number[]): { best: number; reached: Record<number, string | null> } {
  const on = new Set(active)
  const off = new Set(rest)
  const reached: Record<number, string | null> = Object.fromEntries(goals.map((g) => [g, null]))
  let best = 0
  let run = 0
  let prev: string | null = null
  for (const d of active) {
    // Walk back over planned rest days between the last training day and this one.
    let gapOk = false
    if (prev) {
      let c = shift(d, -1)
      while (c > prev && off.has(c)) c = shift(c, -1)
      gapOk = c === prev
    }
    run = gapOk ? run + 1 : 1
    prev = d
    best = Math.max(best, run)
    for (const g of goals) if (run >= g && !reached[g]) reached[g] = d
  }
  return { best, reached }
}

/** Every badge, unlocked or not, with how far along you are. */
export function computeBadges(input: BadgeInput): Badge[] {
  const out: Badge[] = []
  const add = (b: Omit<Badge, 'done'> & { done?: boolean }) => out.push({ ...b, cur: Math.min(b.cur, b.goal), done: b.done ?? b.cur >= b.goal })
  const days = Object.keys(input.days).filter((d) => d <= input.today).sort()
  const active = activeDays(input)
  const exById = new Map(input.exercises.map((e) => [e.id, e]))
  const moveIdOf = (exId: string) => {
    const e = exById.get(exId)
    return e ? moveOf(e)?.id ?? null : null
  }

  // ---- getting going ----
  add({ id: 'first', name: 'First workout', desc: 'Log your first workout.', icon: 'spark', tier: 'bronze', cur: active.length ? 1 : 0, goal: 1, day: active[0] ?? null })
  const run = bestRun(active, input.restDays ?? [], [3, 7, 30])
  add({ id: 'streak3', name: '3 days in a row', desc: 'Train three days in a row (planned rest days keep it going).', icon: 'flame', tier: 'bronze', cur: run.best, goal: 3, day: run.reached[3] })
  add({ id: 'streak7', name: 'A full week', desc: 'Train seven days in a row.', icon: 'flame', tier: 'silver', cur: run.best, goal: 7, day: run.reached[7] })
  add({ id: 'streak30', name: '30-day streak', desc: 'Thirty training days in a row.', icon: 'flame', tier: 'gold', cur: run.best, goal: 30, day: run.reached[30] })
  add({ id: 'sessions10', name: '10 workouts', desc: 'Train on ten different days.', icon: 'calendar', tier: 'bronze', cur: active.length, goal: 10, day: active[9] ?? null })
  add({ id: 'sessions50', name: '50 workouts', desc: 'Train on fifty different days.', icon: 'calendar', tier: 'silver', cur: active.length, goal: 50, day: active[49] ?? null })

  // ---- volume: all-time reps of one exercise (reps, not seconds) ----
  const totals = new Map<string, number>()
  const firstOver = new Map<string, Record<number, string>>()
  for (const d of days) {
    for (const [id, v] of Object.entries(input.days[d] ?? {})) {
      const ex = exById.get(id)
      if (!ex || String(ex.unit ?? 'reps') !== 'reps' || !(Number(v) > 0)) continue
      const t = (totals.get(id) ?? 0) + Number(v)
      totals.set(id, t)
      const f = firstOver.get(id) ?? {}
      for (const g of [100, 1000, 10000]) if (t >= g && !f[g]) f[g] = d
      firstOver.set(id, f)
    }
  }
  const topEx = [...totals.entries()].sort((a, b) => b[1] - a[1])[0]
  for (const [g, name, tier] of [[100, '100 club', 'bronze'], [1000, '1,000 club', 'silver'], [10000, '10k legend', 'gold']] as const) {
    const hit = [...firstOver.entries()].filter(([, f]) => f[g]).sort((a, b) => a[1][g].localeCompare(b[1][g]))[0]
    add({
      id: `reps${g}`, name, desc: `${g.toLocaleString('en')} reps of one exercise, all time.`, icon: 'bolt', tier,
      cur: topEx?.[1] ?? 0, goal: g, day: hit ? hit[1][g] : null, what: (hit ? exById.get(hit[0]) : topEx ? exById.get(topEx[0]) : undefined)?.name
    })
  }

  // ---- levels: a harder version of a move you were already doing ----
  const firstDay = new Map<string, string>() // move → first day logged
  for (const d of days) for (const [id, v] of Object.entries(input.days[d] ?? {})) {
    const m = Number(v) > 0 ? moveIdOf(id) : null
    if (m && !firstDay.has(m)) firstDay.set(m, d)
  }
  let levelDay: string | null = null
  for (const [id, d] of firstDay) {
    const m = moveById(id)!
    const steps = FAMILY_STEPS(m.family)
    const i = steps.indexOf(id)
    const lowerBefore = steps.slice(0, i).some((low) => firstDay.has(low) && firstDay.get(low)! < d)
    if (lowerBefore && (!levelDay || d < levelDay)) levelDay = d
  }
  add({ id: 'levelup', name: 'Level up', desc: 'Do a harder version of a move you were already doing.', icon: 'up', tier: 'silver', cur: levelDay ? 1 : 0, goal: 1, day: levelDay })
  const hardDay = [...firstDay.entries()].filter(([id]) => moveById(id)!.diff >= 4).map(([, d]) => d).sort()[0] ?? null
  add({ id: 'hardmode', name: 'Hard mode', desc: 'Log a move of difficulty 4 or 5.', icon: 'mountain', tier: 'gold', cur: hardDay ? 1 : 0, goal: 1, day: hardDay })
  const explored = [...firstDay.values()].sort()
  add({ id: 'explorer', name: 'Explorer', desc: 'Try 5 different moves from the library.', icon: 'compass', tier: 'bronze', cur: firstDay.size, goal: 5, day: explored[4] ?? null })

  // ---- weeks ----
  const fullByWeek = new Map<string, Set<string>>()
  for (const s of input.sessions) if (s.full && s.day <= input.today) {
    const w = monday(s.day)
    fullByWeek.set(w, (fullByWeek.get(w) ?? new Set()).add(s.day))
  }
  let perfect = 0
  let perfectDay: string | null = null
  for (const set of fullByWeek.values()) {
    perfect = Math.max(perfect, set.size)
    if (set.size >= 5) {
      const d = [...set].sort()[4]
      if (!perfectDay || d < perfectDay) perfectDay = d
    }
  }
  add({ id: 'perfectweek', name: 'Perfect week', desc: 'Finish every exercise on 5 days in one week.', icon: 'star', tier: 'gold', cur: perfect, goal: 5, day: perfectDay })
  const groupsByWeek = new Map<string, Map<Group, string>>()
  for (const d of days) for (const [id, v] of Object.entries(input.days[d] ?? {})) {
    const m = Number(v) > 0 ? moveById(moveIdOf(id)) : null
    if (!m) continue
    const w = monday(d)
    const g = groupsByWeek.get(w) ?? new Map<Group, string>()
    if (!g.has(m.group)) g.set(m.group, d)
    groupsByWeek.set(w, g)
  }
  const need: Group[] = ['push', 'pull', 'core', 'legs']
  let rounder = 0
  let rounderDay: string | null = null
  for (const g of groupsByWeek.values()) {
    const have = need.filter((x) => g.has(x))
    rounder = Math.max(rounder, have.length)
    if (have.length === 4) {
      const d = need.map((x) => g.get(x)!).sort()[3]
      if (!rounderDay || d < rounderDay) rounderDay = d
    }
  }
  add({ id: 'allrounder', name: 'All-rounder', desc: `Train ${need.map((x) => GROUPS.find((g) => g.id === x)!.name.split(' ')[0].toLowerCase()).join(', ').replace(/, (\w+)$/, ' and $1')} in one week.`, icon: 'grid', tier: 'silver', cur: rounder, goal: 4, day: rounderDay })
  let weekendDay: string | null = null
  for (const d of active) if (weekday(d) === 6 && active.includes(shift(d, -1))) { weekendDay = d; break }
  add({ id: 'weekend', name: 'Weekend warrior', desc: 'Train on both Saturday and Sunday of one weekend.', icon: 'sun', tier: 'bronze', cur: weekendDay ? 1 : 0, goal: 1, day: weekendDay })
  let comeback: string | null = null
  for (let i = 1; i < active.length; i++) if (active[i] >= shift(active[i - 1], 8)) { comeback = active[i]; break }
  add({ id: 'comeback', name: 'Comeback', desc: 'Get back to training after a week or more off.', icon: 'return', tier: 'special', cur: comeback ? 1 : 0, goal: 1, day: comeback })

  // ---- time of day (when you logged it) ----
  const early = input.sessions.filter((s) => s.hour != null && s.hour >= 4 && s.hour < 8).map((s) => s.day).sort()[0] ?? null
  add({ id: 'earlybird', name: 'Early bird', desc: 'Finish a workout before 08:00.', icon: 'sunrise', tier: 'special', cur: early ? 1 : 0, goal: 1, day: early })
  const late = input.sessions.filter((s) => s.hour != null && (s.hour >= 21 || s.hour < 4)).map((s) => s.day).sort()[0] ?? null
  add({ id: 'nightowl', name: 'Night owl', desc: 'Finish a workout after 21:00.', icon: 'moon', tier: 'special', cur: late ? 1 : 0, goal: 1, day: late })

  // ---- holds and records ----
  let holdBest = 0
  let holdDay: string | null = null
  for (const d of days) {
    let sec = 0
    for (const [id, v] of Object.entries(input.days[d] ?? {})) {
      const m = moveById(moveIdOf(id))
      const ex = exById.get(id)
      if (m && m.group === 'core' && (ex?.unit === 'sec' || m.unit === 'sec')) sec += Number(v) || 0
    }
    holdBest = Math.max(holdBest, sec)
    if (sec >= 120 && !holdDay) holdDay = d
  }
  add({ id: 'ironcore', name: 'Iron core', desc: '2 minutes of plank or hollow holds in one day.', icon: 'shield', tier: 'silver', cur: holdBest, goal: 120, day: holdDay })
  add({ id: 'record', name: 'New record', desc: 'Beat your best in one set (workout mode notices it).', icon: 'trophy', tier: 'silver', cur: input.records ?? 0, goal: 1, day: null })
  return out
}

const FAMILY_STEPS = (family: string): string[] => FAMILIES[family]?.steps ?? []

/** Badges earned that you haven't seen yet (`seen`: id → the day it was shown). */
export function newBadges(badges: Badge[], seen: Record<string, string> | null | undefined): Badge[] {
  return badges.filter((b) => b.done && !(seen && seen[b.id]))
}
