// What you actually did, in the numbers the Rewards page needs (pure, tested):
// where this week's points came from (by area), focus hours by kind (coding,
// security, study…), workouts, nights on time, water days, fun time taken and
// fun spent. Read only from logged rows (the ledger, focus sessions, workouts,
// sleep and the body log), so suggestions and "unlock by doing" never trust
// anything you didn't really log.
import { addDays } from './dates'
import { effective, type LedgerEntry } from './ledger'
import { dayStreak, mondayOf } from './rewardsKit'

// ---------- Where the points came from (by area) ----------

export type AreaId = 'focus' | 'mustdo' | 'tasks' | 'body' | 'sleep' | 'discipline' | 'money' | 'habits' | 'bonus'

export const AREAS: { id: AreaId; label: string; emoji: string; color: string }[] = [
  { id: 'focus', label: 'Focus', emoji: '🎯', color: '#a78bfa' },
  { id: 'mustdo', label: 'Must-dos', emoji: '✅', color: '#c8f135' },
  { id: 'tasks', label: 'Tasks', emoji: '📋', color: '#38bdf8' },
  { id: 'body', label: 'Body', emoji: '💪', color: '#f97316' },
  { id: 'sleep', label: 'Sleep', emoji: '🌙', color: '#818cf8' },
  { id: 'discipline', label: 'Discipline', emoji: '🛡️', color: '#34d399' },
  { id: 'money', label: 'Money', emoji: '💰', color: '#facc15' },
  { id: 'habits', label: 'Habits', emoji: '🌱', color: '#2dd4bf' },
  { id: 'bonus', label: 'Bonuses', emoji: '✨', color: '#f472b6' }
]

/** The area a point belongs to, by the module (and ref) that paid it. */
export function areaOf(e: Pick<LedgerEntry, 'module' | 'ref' | 'ruleId'>): AreaId {
  const ref = e.ref ?? ''
  if (/^(extra|quest|chest|challenge|saved):/.test(ref) || e.module === 'quests' || e.module === 'shop') return 'bonus'
  if (e.module === 'focus' || e.module === 'schedule') return 'focus'
  if (e.module === 'plan') return 'mustdo'
  if (e.module === 'tasks' || ref.startsWith('task:')) return 'tasks'
  if (e.module === 'body' || e.module === 'grand_slam') return 'body'
  if (e.module === 'sleep') return 'sleep'
  if (e.module === 'discipline') return 'discipline'
  if (e.module === 'money') return 'money'
  if (e.module === 'habits' || e.module === 'face' || e.ruleId?.startsWith('habit.')) return 'habits'
  return 'bonus'
}

const isJarMove = (e: LedgerEntry) => !!e.ref?.startsWith('goal:')

/** This week's earned points by area (live rows only), biggest first, with each one's share. */
export function weekAreas(entries: LedgerEntry[], today: string): { id: AreaId; label: string; emoji: string; color: string; points: number; share: number }[] {
  const mon = mondayOf(today)
  const by = new Map<AreaId, number>()
  for (const e of effective(entries)) {
    if (e.kind !== 'earn' || !(e.coins > 0) || isJarMove(e) || e.day < mon || e.day > today) continue
    const a = areaOf(e)
    by.set(a, (by.get(a) ?? 0) + e.coins)
  }
  const total = [...by.values()].reduce((s, n) => s + n, 0)
  return AREAS.filter((a) => (by.get(a.id) ?? 0) > 0)
    .map((a) => ({ ...a, points: by.get(a.id)!, share: total ? by.get(a.id)! / total : 0 }))
    .sort((a, b) => b.points - a.points)
}

// ---------- Focus by kind (from the subject you gave the timer or the PC coach) ----------

export type FocusKind = 'code' | 'security' | 'study' | 'work' | 'other'

const KIND_WORDS: [FocusKind, RegExp][] = [
  ['security', /\b(ctf|cyber|secur|hack|pwn|htb|hackthebox|tryhackme|thm|exploit|reverse|crypto|forensic|pentest|red team|blue team|osint)/i],
  ['code', /\b(cod(e|ing)|program|dev|rust|python|js|javascript|typescript|ts|react|go|golang|c\+\+|java|git|bug|build|app|website|api|leetcode|algorithm)/i],
  ['study', /\b(study|uni|universit|class|course|exam|lecture|homework|read|book|learn|math|physics|english|notes|revision)/i],
  ['work', /\b(work|job|shift|client|office|meeting)/i]
]

/** What kind of focus a subject is ("Rust" = code, "CTF practice" = security). */
export function focusKind(subject: string): FocusKind {
  const s = String(subject ?? '')
  for (const [k, re] of KIND_WORDS) if (re.test(s)) return k
  return 'other'
}

// ---------- The whole picture ----------

export interface ActivityInput {
  today: string
  /** Every ledger row (undo rows included; only live rows count). */
  ledger: LedgerEntry[]
  focus: { day: string; subject: string; minutes: number }[]
  /** Days with a logged workout. */
  workoutDays: string[]
  /** Nights you logged: on time for the wake-up (and bedtime when logged). */
  sleep: { day: string; onTime: boolean; bedOnTime?: boolean | null }[]
  /** Water drunk per day in ml (from the body log). */
  water?: Record<string, number>
  waterGoalMl?: number
  /** Starred tracks and stations you keep (music in your life). */
  musicSaved?: number
  /** Rewards in the Fun category: buying one counts as fun spending. */
  funRewardIds?: number[]
  /** Your current workout streak as the Body page counts it (rest days keep it), if known. */
  workoutStreak?: number
}

export interface Activity {
  today: string
  week: string
  /** Points earned this week (live), spent this week, and spent on fun this week. */
  earnedWeek: number
  spentWeek: number
  /** Fun time and rewards bought this week, in points. */
  funSpentWeek: number
  funTimesWeek: number
  areas: ReturnType<typeof weekAreas>
  focusMinWeek: number
  focusByKind: Record<FocusKind, number>
  focusToday: number
  workoutsWeek: number
  workoutStreak: number
  workoutToday: boolean
  /** Moved today: a workout, a move break, reps or any body points. */
  movedToday: boolean
  sleepNights7: number
  waterDays7: number
  musicSaved: number
  /** Days in the last 7 with any earned points. */
  activeDays7: number
}

export function activity(i: ActivityInput): Activity {
  const { today } = i
  const week = mondayOf(today)
  const live = effective(i.ledger)
  const inWeek = (d: string) => d >= week && d <= today
  const last7 = (d: string) => d > addDays(today, -7) && d <= today
  let earnedWeek = 0
  let spentWeek = 0
  let funSpentWeek = 0
  let funTimesWeek = 0
  let movedToday = false
  const active = new Set<string>()
  const funIds = new Set((i.funRewardIds ?? []).map((n) => `reward:${n}`))
  for (const e of live) {
    if (isJarMove(e) || e.kind === 'adjust') continue
    if (e.kind === 'earn' && e.coins > 0) {
      if (last7(e.day)) active.add(e.day)
      if (inWeek(e.day)) earnedWeek += e.coins
      if (e.day === today && e.module === 'body') movedToday = true
    }
    if (e.coins < 0 && inWeek(e.day)) {
      spentWeek += -e.coins
      if (e.module === 'fun' || (e.module === 'shop' && funIds.has(e.ref ?? ''))) {
        funSpentWeek += -e.coins
        funTimesWeek++
      }
    }
  }
  const focusByKind: Record<FocusKind, number> = { code: 0, security: 0, study: 0, work: 0, other: 0 }
  let focusMinWeek = 0
  let focusToday = 0
  for (const f of i.focus) {
    const m = Math.max(0, Math.round(Number(f.minutes) || 0))
    if (f.day === today) focusToday += m
    if (!inWeek(f.day)) continue
    focusMinWeek += m
    focusByKind[focusKind(f.subject)] += m
  }
  const wdays = [...new Set(i.workoutDays)]
  const workoutToday = wdays.includes(today)
  const goal = i.waterGoalMl && i.waterGoalMl > 0 ? i.waterGoalMl : 2000
  return {
    today,
    week,
    earnedWeek,
    spentWeek,
    funSpentWeek,
    funTimesWeek,
    areas: weekAreas(i.ledger, today),
    focusMinWeek,
    focusByKind,
    focusToday,
    workoutsWeek: wdays.filter(inWeek).length,
    workoutStreak: i.workoutStreak ?? dayStreak(wdays, today),
    workoutToday,
    movedToday: movedToday || workoutToday,
    sleepNights7: new Set(i.sleep.filter((s) => last7(s.day) && s.onTime && s.bedOnTime !== false).map((s) => s.day)).size,
    waterDays7: Object.entries(i.water ?? {}).filter(([d, ml]) => last7(d) && ml >= goal).length,
    musicSaved: Math.max(0, i.musicSaved ?? 0),
    activeDays7: active.size
  }
}

/** Hours with one decimal ("9.5"), whole from 10 up. */
export const hoursText = (min: number) => {
  const h = min / 60
  return h >= 10 ? String(Math.round(h)) : (Math.round(h * 10) / 10).toString()
}
