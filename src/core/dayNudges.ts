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
import { WATER_GAP_BEHIND_MIN, WATER_SHARED_MIN, govern, lateAlert, waterBehindPace, queueAdd, queueRelease, reminderAlert, type GovernCtx, type Queued, type ReminderItem, type Shown } from './healthyDay'
import { afterShiftAlert, effectiveBed, windModeTonight, type AfterShiftPlan } from './afterShift'
import type { EyeTip } from './eyeCare'

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
  /** My life: the latest bedtime; the late nudges get firm from there. */
  latestBed?: string
  /** How hard Ben pushes (My life): interruptions an hour, and whether a long sitting ends in Ben's firmer line. */
  push?: { perHour: number; escalate: boolean }
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
  /** Sleep care (BD4, BD5, BD11, BD12), all optional. */
  care?: {
    /** The morning light card (sleepCare.ts lightCard), made by the app window. */
    light?: IslandAlert | null
    /** The caffeine curfew's soft warning (sleepCare.ts caffeineAlert). */
    caffeine?: IslandAlert | null
    /** A late shift tonight: the wind-down starts from its end (afterShift.ts). */
    afterShift?: { plan: AfterShiftPlan | null; done: string[]; ctf: boolean }
    /** Eye breaks as often as today's screen time asks, with a tip (eyeCare.ts). */
    eyes?: { everyMin: number; tip: EyeTip | null }
    /** The posture nudge offers the 60-second desk drill (deskMobility.ts). */
    drill?: boolean
  }
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
  // BD5: on a late-shift night the after-shift card is the wind-down, and the late nudges count from lights out.
  const shift = i.care?.afterShift?.plan ?? null
  const bedTarget = effectiveBed(shift, i.bedTarget)
  const wd = shift ? null : windDown(i.now, i.bedTarget, i.bedLogged)
  // From bedtime − 60 min until bed is logged: only bed things (healthyDay.ts govern); after a late shift, from its end.
  const night = windModeTonight(shift, i.now, i.bedTarget, i.bedLogged)
  const ctx: GovernCtx = { ...i.ctx, windDown: i.ctx.windDown ?? !!night, ...(i.push ? { perHour: i.push.perHour } : {}) }
  const morning = () => morningAlert({ now: i.now, firstActiveAt: i.firstActiveAt, wakeLogged: i.wakeLogged, wakeTime: i.wakeTime, firstBlock: i.firstBlock, blockStarted: i.blockStarted, dismissed: i.dismissed, bedAuto: i.bedAuto?.time ?? null })
  const morningId = `morning:${new Date(i.now).toDateString()}`
  const morningShown = i.shown.some((x) => x.key === morningId) || morning() != null
  const move = () => {
    const mv = learnAlert(moveNudge({ ...c, busy: false, lastMoveAt: i.lastMoveAt, exercises: i.exercises, coins: i.coins, doing: i.doing }), s, 'move', i.now)
    // IN31: at 90 min Ben's firmer line always drops down.
    return mv && i.push?.escalate !== false && mv.nudge?.type === 'move' && mv.nudge.level === 'ben' ? { ...mv, dot: false } : mv
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
    () => (i.running ? null : lateAlert({ now: i.now, bedTarget, latest: shift ? undefined : i.latestBed, idleSec: i.idleSec, bedLogged: i.bedLogged, dismissed: i.dismissed, day: i.day })),
    () => (busy || !i.care?.afterShift ? null : afterShiftAlert({ plan: shift, now: i.now, day: i.day, bedLogged: i.bedLogged, done: i.care.afterShift.done, ctf: i.care.afterShift.ctf, dismissed: i.dismissed })),
    () => (busy ? null : windDownAlert(wd, i.now, i.dismissed)),
    morning,
    () => i.care?.light ?? null,
    () => bedAutoAlert({ bed: i.bedAuto, now: i.now, running: !!i.running, wakeLogged: i.wakeLogged, morningShown, dismissed: i.dismissed }),
    move,
    () => i.care?.caffeine ?? null,
    () => learnAlert(personNudge(c), s, 'people', i.now),
    () => learnAlert(moodNudge({ ...c, moodSlotsDone: i.moodSlots }), s, 'mood', i.now),
    () => learnAlert(gratitudeNudge(c), s, 'gratitude', i.now),
    () => learnAlert(tidyNudge(c), s, 'tidy', i.now),
    () => learnAlert(postureNudge({ ...c, drill: i.care?.drill }), s, 'posture', i.now),
    () => learnAlert(breatheNudge({ ...c, lowMood: i.lowMood }), s, 'breathe', i.now),
    () => learnAlert(eyesNudge({ ...c, eyeBreaks: i.eyeBreaks, lastEyesAt: i.lastEyesAt, everyMin: i.care?.eyes?.everyMin, tip: i.care?.eyes?.tip }), s, 'eyes', i.now),
    () => waterNudge(waterAlert({ now: i.now, busy: false, idleSec: i.idleSec, activeSince: i.activeSince, water: i.water, lastWaterAt: waterBehindPace(i.now, i.water.ml, i.water.target) ? i.lastWaterAt - (WATER_SHARED_MIN - WATER_GAP_BEHIND_MIN) * 60_000 : i.lastWaterAt, lastMoveAt: i.lastMoveAt, lastEyesAt: i.lastEyesAt, eyeBreaks: i.eyeBreaks, dismissed: i.dismissed }), s, i.now, i.day),
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

// ---- "Why didn't I get a reminder?" (Settings → Island) ----

export type WhyKind = 'water' | 'move' | 'eyes'
export const WHY_LABEL: Record<WhyKind, string> = { water: 'Water', move: 'Screen-time break', eyes: 'Eye break' }

/**
 * The last reason each of these nudges was not on the island, in plain words
 * (for debugging; the first true reason wins). `r` is what dayNudge() just
 * returned: a card of that kind showing now says so, and the governor's own
 * "held back" reasons are used as they are.
 */
export function nudgeWhy(i: DayNudgeInput, r: DayNudge): Record<WhyKind, string> {
  const min = (t: number) => Math.round((i.now - t) / 60_000)
  const hour = new Date(i.now).getHours()
  const busyWhy = i.ctx.asleep ? 'bed is logged: only your own reminders' : i.ctx.call ? 'you are in a call' : i.ctx.focus ? 'a focus timer is running' : i.ctx.event ? 'you are in a class or event' : i.ctx.windDown ? 'wind-down: only bed things now' : null
  const governor = (topic: string) => r.held.find((h) => h.id.startsWith(`${topic}:`))?.why ?? null
  const showing = (kind: string) => r.alert?.kind === kind
  const away = i.idleSec == null ? 'no idle reading yet from this PC' : i.idleSec > 300 ? `away from the PC for ${Math.round(i.idleSec / 60)} min` : null
  const at = (t: number) => new Date(t).toTimeString().slice(0, 5)

  const water = (): string => {
    if (showing('water')) return r.alert?.dot ? 'showing now as a dot' : 'showing now'
    if (i.water.target > 0 && i.water.ml >= i.water.target) return "today's water goal is reached"
    if (!i.store.prefs.on.water) return 'water nudges are off in Settings → Island → Nudges'
    if ((i.store.snooze.water ?? 0) > i.now) return `snoozed until ${at(i.store.snooze.water!)}`
    if (busyWhy) return busyWhy
    if (away) return away
    if (hour < 9 || hour >= 21) return 'water reminders run 09:00 to 21:00'
    const gap = waterBehindPace(i.now, i.water.ml, i.water.target) ? WATER_GAP_BEHIND_MIN : WATER_SHARED_MIN
    if (i.lastWaterAt && min(i.lastWaterAt) < gap) return `last glass or reminder ${min(i.lastWaterAt)} min ago (next after ${gap} min)`
    return governor('water') ?? (r.alert ? `another card is showing: ${r.alert.kind}` : 'dismissed for this slot, or learning moved it')
  }
  const move = (): string => {
    if (showing('move')) return r.alert?.dot ? 'showing now as a dot' : 'showing now'
    if (!i.store.prefs.on.move) return 'move breaks are off in Settings → Island → Nudges'
    if ((i.store.snooze.move ?? 0) > i.now) return `snoozed until ${at(i.store.snooze.move!)}`
    if (busyWhy) return busyWhy
    if (away) return away
    const sitMin = i.store.prefs.sitMin
    if (!i.activeSince) return 'no active stretch yet (needs input without a 5-minute pause)'
    const sat = min(i.activeSince)
    if (sat < sitMin) return `at the PC ${sat} min (break after ${sitMin})`
    if (min(i.lastMoveAt) < sitMin) return `you moved ${min(i.lastMoveAt)} min ago`
    return governor('move') ?? (r.alert ? `another card is showing: ${r.alert.kind}` : 'dismissed for this stretch, or waiting for a pause in real work')
  }
  const eyes = (): string => {
    if (showing('eyes')) return r.alert?.dot ? 'showing now as a dot' : 'showing now'
    if (!i.eyeBreaks && !i.care?.eyes) return 'eye breaks are off (island Day page, 20-20-20)'
    if (!i.store.prefs.on.eyes) return 'eye breaks are off in Settings → Island → Nudges'
    if (busyWhy) return busyWhy
    if (away) return away
    return governor('eyes') ?? `last eye break ${i.lastEyesAt ? `${min(i.lastEyesAt)} min ago` : 'never today'}`
  }
  return { water: water(), move: move(), eyes: eyes() }
}
