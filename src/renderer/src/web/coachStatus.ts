// The coach chat's header, pinned move and live cards, read from this
// device's copy of the data (instant, no server call).
import { MOOD_FACE, REMINDERS, coachMood, promiseStats, type Mood, type Reminder } from '@core/coachKit'
import { nextMove, type Move } from '@core/coachNext'
import { planGoal } from '@core/goalPlan'
import { RHYTHM, rhythmFor } from '@core/rhythm'
import { waterTargetFor, sharedView, sportToday } from '@core/sportShared'
import { getSetting } from '../../../main/settings'
import { helpLine, shownMood } from '@core/benActs'
import { loadStyle } from './botBrain'
import { addDays } from '@core/dates'
import type { Services } from './webServices'
import { neverMissTwice, type MissTwiceItem } from '@core/neverMissTwice'


/**
 * Today's water and its ONE goal (N2/N4), used by every screen, the bot's
 * water card and Ben: your weight's target (35 ml/kg, +500 ml on a training
 * day), else Sport Track's.
 */
export function waterToday(db: any, s: any, now = new Date()): { ml: number; target: number } {
  const sport = json(db, 'sport_tracker_json')?.data
  const w = sport ? sharedView(sport, sportToday(now)).water : { ml: 0, target: 2700 }
  try {
    const b = s.body.state(now)
    const t = waterTargetFor(b.latestWeight, !!b.workoutDoneToday)
    if (t) return { ml: w.ml, target: t }
  } catch {
    /* no body data yet */
  }
  return { ml: w.ml, target: w.target || 2700 }
}

export interface CoachStatus {
  mood: Mood
  face: string
  why: string
  move: Move
  plan: { status: 'none' | 'proposed' | 'approved'; blocks: number; mustdos: number; headline: string; score?: number }
  promises: { awaiting: string[]; kept: number; missed: number }
  goals: { id: number; title: string; subject: string; pct: number; perDayMin: number; todayLeftMin: number; status: string; daysLeft: number }[]
  today: { focusMin: number; mustDone: number; mustTotal: number; waterMl: number; waterTarget: number; workoutDone: boolean }
  /** Focus minutes per day, the last 7 days (oldest first). */
  week: { day: string; min: number }[]
  /** Focus minutes the 7 days before that (to compare weeks). */
  prevWeekMin: number
  mustdos: { i: number; text: string; done: boolean }[]
  /** Yesterday slipped: the smaller version for today (never miss twice, D4). */
  missTwice: MissTwiceItem[]
}

const json = (db: any, key: string) => {
  try {
    return JSON.parse(getSetting(db, key) || 'null')
  } catch {
    return null
  }
}

export function coachStatus(s: Services, now = new Date()): CoachStatus {
  const db = s.db
  const today = s.wallet.today(now)
  const f = s.focus.state(now)
  const reminders: Reminder[] = json(db, REMINDERS) ?? []
  const ps = promiseStats(reminders, now)
  const awaiting = reminders.filter((r) => r.kind === 'checkin' && r.sentAt && !r.done).map((r) => r.text)
  const rh = rhythmFor(json(db, RHYTHM), today)
  const plans = f.goals.map((g) => planGoal(g, today, f.todaySessions.filter((x) => x.subject.toLowerCase() === g.subject.toLowerCase()).reduce((t, x) => t + x.minutes, 0)))
  const water = waterToday(db, s, now)
  const lastLedger = s.wallet.entries().filter((e: any) => e.day === today).map((e: any) => Date.parse(e.ts)).filter(Number.isFinite)
  const lastFocus = f.todaySessions.map((x) => Date.parse(x.endedAt ?? '')).filter(Number.isFinite)
  const last = Math.max(0, ...lastLedger, ...lastFocus)
  const open = f.plan.items.filter((x) => !x.done)
  const feel = coachMood({
    hour: now.getHours(),
    focusMinToday: f.todayMin,
    idleMin: last ? (now.getTime() - last) / 60000 : Infinity,
    openMustDos: open.length,
    mustDosDone: f.plan.items.length - open.length,
    missedWeek: ps.broken + ps.ignored,
    keptWeek: ps.kept,
    goalsBehind: f.goals.filter((g) => g.aheadH <= -1).length
  })
  const planStatus = rh.briefing?.status ?? 'none'
  const move = nextMove(
    {
      hour: now.getHours(),
      awaiting,
      planStatus,
      running: f.running ? { subject: f.running.subject, endsAt: Date.parse(f.running.startedAt) + f.running.planned * 60000 } : null,
      goals: plans
        .filter((p) => p.status !== 'done' && p.status !== 'late')
        .sort((a, b) => a.daysLeft - b.daysLeft)
        .map((p) => ({ title: p.title, subject: p.subject, todayLeftMin: p.todayLeftMin, behind: p.status === 'behind' })),
      openMustDos: open.map((x) => x.text),
      evening: now.getHours() >= 19
    },
    now.getTime()
  )
  // Below tone 5 a slipping day shows as 🎯 with a helpful line, not "Ben is angry".
  const mood = shownMood(feel.mood, loadStyle(db).tone)
  return {
    mood,
    face: MOOD_FACE[mood],
    why: mood === 'focused' ? helpLine(feel.why) : feel.why,
    move,
    plan: { status: planStatus, blocks: rh.briefing?.plan.blocks.length ?? 0, mustdos: rh.briefing?.plan.mustdos.length ?? 0, headline: rh.briefing?.plan.headline ?? '', score: rh.evening?.score },
    promises: { awaiting, kept: ps.kept, missed: ps.broken + ps.ignored },
    goals: plans.map((p) => {
      const g = f.goals.find((x) => x.id === p.goalId)!
      return { id: p.goalId, title: p.title, subject: p.subject, pct: Math.min(100, Math.round((g.doneMin / 60 / Math.max(0.1, g.hours)) * 100)), perDayMin: p.perDayMin, todayLeftMin: p.todayLeftMin, status: p.status, daysLeft: p.daysLeft }
    }),
    today: { focusMin: f.todayMin, mustDone: f.plan.items.length - open.length, mustTotal: f.plan.items.length, waterMl: water.ml, waterTarget: water.target, workoutDone: (s.wallet.summary(now).todayRules ?? []).includes('body.workout_done') },
    prevWeekMin: (() => {
      const focus = s.progress.input(null, now, 8).focus
      const from = addDays(today, -13)
      const to = addDays(today, -7)
      return focus.filter((x) => x.day >= from && x.day <= to).reduce((t, x) => t + x.minutes, 0)
    })(),
    week: (() => {
      const focus = s.progress.input(null, now, 8).focus
      return Array.from({ length: 7 }, (_, k) => {
        const day = addDays(today, k - 6)
        return { day, min: focus.filter((x) => x.day === day).reduce((t, x) => t + x.minutes, 0) }
      })
    })(),
    mustdos: f.plan.items.map((x, i) => ({ i, text: x.text, done: x.done })),
    missTwice: (() => {
      try {
        const b = s.body.state(now)
        return neverMissTwice({ today, focus: s.progress.input(null, now, 8).focus, workoutDays: b.recentWorkouts.map((w) => w.day), restDays: [...(b.restDays ?? []), ...(b.modeRest ?? [])] })
      } catch {
        return []
      }
    })()
  }
}
