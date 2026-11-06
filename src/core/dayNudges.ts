// The island's healthy-day chain (HD), pure: which body or day nudge the
// island shows now, in one order, every one through the governor
// (healthyDay.ts govern). The app window (IslandFeed.tsx) runs exactly this,
// and the simulated day in dayNudges.test.ts runs it with a fake clock.
//
// Order: your reminder → right after a log (undo, "+250 ml too?") → a nudge
// held back by a call / focus / class → the late-night nudge → wind-down →
// the one morning card → move break and the small nudges → water → the
// evening story. The first one the governor lets through wins.
import type { IslandAlert, IslandRecap } from './islandModel'
import { bedAutoAlert, morningAlert, waterAlert, windDown, windDownAlert } from './islandBody'
import {
  awayNudge,
  breatheNudge,
  dayOf,
  eyesNudge,
  focusNudge,
  gratitudeNudge,
  learnAlert,
  moodNudge,
  moveDoneAlert,
  moveNudge,
  personNudge,
  postureNudge,
  tidyNudge,
  type ExerciseLine,
  type NudgeStore,
  type SnoozeCtx
} from './islandNudges'
import { recapAlert } from './islandMoments'
import { govern, lateAlert, windDownMode, queueAdd, queueRelease, reminderAlert, type GovernCtx, type Queued, type ReminderItem, type Shown } from './healthyDay'

export interface DayNudgeInput {
  now: number
  /** The app day (turns at 04:00). */
  day: string
  ctx: GovernCtx
  shown: Shown[]
  queue: Queued[]
  dismissed: Record<string, number>
  reminders: ReminderItem[]
  idleSec: number | null
  activeSince: number | null
  // Morning
  firstActiveAt: number | null
  wakeLogged: boolean
  wakeTime: string | null
  firstBlock: { title: string; start: number } | null
  blockStarted: boolean
  bedAuto: { time: string; at: string } | null
  // Bed
  bedTarget: string
  bedLogged: boolean
  // Body
  store: NudgeStore
  lastMoveAt: number
  lastEyesAt: number
  lastWaterAt: number
  exercises: ExerciseLine[]
  coins: number
  doing?: { ctx: string; pause: boolean } | null
  eyeBreaks: boolean
  running: { subject: string; startedAt: number; endsAt: number; pausedAt?: number | null; brk?: boolean } | null
  moodSlots: ('noon' | 'evening')[]
  lowMood: boolean
  snooze: SnoozeCtx
  water: { ml: number; target: number }
  // Evening
  eveningAt: string
  recap: IslandRecap
  /** Ben's evening review already went to Telegram today (the island's story would say it twice). */
  eveningSent: boolean
}

export interface DayNudge {
  alert: IslandAlert | null
  queue: Queued[]
  /** Why each candidate was held back (Island debug, the simulated day). */
  held: { id: string; why: string }[]
}

/** The water card learns (IN26) and its Later is a 15-minute snooze that counts (IN30). */
export function waterNudge(a: IslandAlert | null, s: NudgeStore, now: number, day: string): IslandAlert | null {
  if (!a) return null
  const g = learnAlert(a, s, 'water', now)
  if (!g) return null
  const postponed = dayOf(s, day).postponed.water ?? 0
  return {
    ...g,
    text: postponed ? `${g.text} · postponed ${postponed}×` : g.text,
    actions: g.actions.map((x) => (x.action.kind === 'dismiss' ? { ...x, action: { kind: 'nudge', op: { op: 'snooze', kind: 'water', alertId: a.id, choice: '15' } } } : x))
  }
}

/** The evening story waits 30 minutes after your review time, and only when Ben's review didn't go to Telegram. */
const RECAP_DELAY_MIN = 30

export function dayNudge(i: DayNudgeInput): DayNudge {
  const held: DayNudge['held'] = []
  let queue = i.queue
  const s = i.store
  const c = { now: i.now, day: i.day, busy: false, idleSec: i.idleSec, activeSince: i.activeSince, store: s, dismissed: i.dismissed, snooze: i.snooze }
  const busy = i.ctx.call || i.ctx.focus || i.ctx.event
  const wd = windDown(i.now, i.bedTarget, i.bedLogged)
  // From bedtime − 60 min until bed is logged: only bed things (healthyDay.ts govern).
  const night = windDownMode(i.now, i.bedTarget, i.bedLogged)
  const ctx: GovernCtx = { ...i.ctx, windDown: i.ctx.windDown ?? !!night }
  const morning = () => morningAlert({ now: i.now, firstActiveAt: i.firstActiveAt, wakeLogged: i.wakeLogged, wakeTime: i.wakeTime, firstBlock: i.firstBlock, blockStarted: i.blockStarted, dismissed: i.dismissed, bedAuto: i.bedAuto?.time ?? null })
  const morningId = `morning:${new Date(i.now).toDateString()}`
  const morningShown = i.shown.some((x) => x.key === morningId) || morning() != null
  const move = () => {
    const mv = learnAlert(moveNudge({ ...c, busy: false, lastMoveAt: i.lastMoveAt, exercises: i.exercises, coins: i.coins, doing: i.doing }), s, 'move', i.now)
    // IN31: at 90 min Ben's firmer line always drops down.
    return mv && mv.nudge?.type === 'move' && mv.nudge.level === 'ben' ? { ...mv, dot: false } : mv
  }
  const recap = () => {
    if (i.eveningSent) return null
    const [h, m] = i.eveningAt.split(':').map(Number)
    const at = `${String(Math.floor(((h * 60 + m + RECAP_DELAY_MIN) % 1440) / 60)).padStart(2, '0')}:${String((h * 60 + m + RECAP_DELAY_MIN) % 60).padStart(2, '0')}`
    return recapAlert({ now: i.now, eveningAt: at, dismissed: i.dismissed, recap: i.recap })
  }
  const candidates: (() => IslandAlert | null)[] = [
    () => reminderAlert(i.reminders, i.now, i.dismissed),
    () => moveDoneAlert(s, i.now, i.dismissed, i.day),
    () => learnAlert(awayNudge({ now: i.now, store: s, dismissed: i.dismissed, busy: false }), s, 'away', i.now),
    () => learnAlert(focusNudge({ now: i.now, running: i.running, store: s, day: i.day, dismissed: i.dismissed }), s, 'focus', i.now),
    () => {
      // Water already reached while it waited: nothing to say.
      // Only once you're back at the PC; water already reached while it waited: nothing to say.
      if (i.idleSec == null || i.idleSec > 120) return null
      const r = queueRelease(queue.filter((x) => x.topic !== 'water' || i.water.ml < i.water.target), ctx)
      queue = r.rest
      return r.alert
    },
    () => (i.running ? null : lateAlert({ now: i.now, bedTarget: i.bedTarget, idleSec: i.idleSec, bedLogged: i.bedLogged, dismissed: i.dismissed, day: i.day })),
    () => (busy ? null : windDownAlert(wd, i.now, i.dismissed)),
    morning,
    () => bedAutoAlert({ bed: i.bedAuto, now: i.now, running: !!i.running, wakeLogged: i.wakeLogged, morningShown, dismissed: i.dismissed }),
    move,
    () => learnAlert(personNudge(c), s, 'people', i.now),
    () => learnAlert(moodNudge({ ...c, moodSlotsDone: i.moodSlots }), s, 'mood', i.now),
    () => learnAlert(gratitudeNudge(c), s, 'gratitude', i.now),
    () => learnAlert(tidyNudge(c), s, 'tidy', i.now),
    () => learnAlert(postureNudge(c), s, 'posture', i.now),
    () => learnAlert(breatheNudge({ ...c, lowMood: i.lowMood }), s, 'breathe', i.now),
    () => learnAlert(eyesNudge({ ...c, eyeBreaks: i.eyeBreaks, lastEyesAt: i.lastEyesAt }), s, 'eyes', i.now),
    () => waterNudge(waterAlert({ now: i.now, busy: false, idleSec: i.idleSec, activeSince: i.activeSince, water: i.water, lastWaterAt: i.lastWaterAt, lastMoveAt: i.lastMoveAt, lastEyesAt: i.lastEyesAt, eyeBreaks: i.eyeBreaks, dismissed: i.dismissed }), s, i.now, i.day),
    () => (busy ? null : recap())
  ]
  for (const make of candidates) {
    const a = make()
    if (!a) continue
    const v = govern(a, ctx, i.shown)
    if (v.queue) queue = queueAdd(queue, v.queue, i.now)
    if (v.show) return { alert: v.show, queue, held }
    held.push({ id: a.id, why: v.why })
  }
  return { alert: null, queue, held }
}
