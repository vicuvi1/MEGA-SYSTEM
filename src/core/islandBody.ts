// The island and your body (phase 2), pure and tested:
// - water rhythm: a glass every 90 min while you're at the PC (09–21)
// - movement: after 75 min at the PC without a break, 2 minutes of moving
// - eyes (optional): 20-20-20 every 20 min at the screen
// - wind-down: the hour before your bedtime target
// - morning launch: the first time you're at the PC today.
import type { IslandAlert } from './islandModel'

const hour = (now: number) => new Date(now).getHours() + new Date(now).getMinutes() / 60
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
const hm = (t: number) => new Date(t).toTimeString().slice(0, 5)

export interface BodyInput {
  now: number
  /** You're in a call or a focus timer runs: no body nudges now. */
  busy: boolean
  /** Seconds since the last mouse/keys (null: unknown). */
  idleSec: number | null
  /** When you've been at the PC without a 5-min break since (ms), or null. */
  activeSince: number | null
  water: { ml: number; target: number }
  /** Last time water was logged or a water nudge was answered. */
  lastWaterAt: number
  lastMoveAt: number
  lastEyesAt: number
  eyeBreaks: boolean
  dismissed: Record<string, number>
  /**
   * SI12 (Smart island on): what you're doing, and whether this is a natural
   * pause (you just switched apps). A work stretch waits for a pause (up to
   * 75 min) and says what it was: "90 min of coding: walk + water?".
   */
  doing?: { ctx: string; pause: boolean } | null
}

export function waterAlert(a: BodyInput): IslandAlert | null {
  if (a.busy || a.idleSec == null || a.idleSec > 300 || a.water.target <= 0 || a.water.ml >= a.water.target) return null
  const h = hour(a.now)
  if (h < 9 || h >= 21 || a.now - a.lastWaterAt < 90 * 60_000) return null
  const id = `water:${new Date(a.now).toDateString()}:${Math.floor(h / 1.5)}`
  if ((a.dismissed[id] ?? 0) > a.now) return null
  const left = Math.max(0, a.water.target - a.water.ml)
  return {
    id,
    kind: 'water',
    title: 'A glass of water?',
    text: `${(a.water.ml / 1000).toFixed(1)} of ${(a.water.target / 1000).toFixed(1)} L so far · ${Math.ceil(left / 250)} glasses to go`,
    face: '💧',
    actions: [
      { label: '+250 ml', action: { kind: 'water', ml: 250 }, primary: true },
      { label: '+500', action: { kind: 'water', ml: 500 } },
      { label: 'Later', action: { kind: 'dismiss', id, snoozeMin: 30 } }
    ]
  }
}

export function moveAlert(a: BodyInput): IslandAlert | null {
  if (a.busy || !a.activeSince || a.idleSec == null || a.idleSec > 120) return null
  // P11: after 50 minutes of input with no 5-minute pause (away time resets it, so never right after a break).
  if (a.now - a.activeSince < 50 * 60_000 || a.now - a.lastMoveAt < 50 * 60_000) return null
  const id = `move:${Math.floor(a.activeSince / 60_000)}`
  if ((a.dismissed[id] ?? 0) > a.now) return null
  const sat = Math.round((a.now - a.activeSince) / 60_000)
  const work = !!a.doing && ['coding', 'study', 'writing', 'ctf'].includes(a.doing.ctx)
  // SI12: in the middle of real work, wait for a natural pause (not past 75 min).
  if (work && !a.doing!.pause && sat < 75) return null
  const what = a.doing?.ctx === 'ctf' ? 'CTF work' : a.doing?.ctx
  return {
    id,
    kind: 'move',
    title: work ? `${sat} min of ${what}: walk + water?` : `${sat} min at the PC`,
    text: work ? '2 minutes away from the screen, a glass of water, then back to it.' : '2-minute break: 20 squats? Your back will thank you.',
    face: '🏃',
    actions: [
      { label: '✓ 20 squats', action: { kind: 'moveBreak', name: 'Squats', n: 20, alertId: id }, primary: true },
      { label: '✓ 10 push-ups', action: { kind: 'moveBreak', name: 'Push-ups', n: 10, alertId: id } },
      // P14: a real break: the PC locks, Ben greets you when you're back.
      { label: '🔒 Lock PC 5 min', action: { kind: 'lockPc', alertId: id } },
      { label: 'In 15 min', action: { kind: 'dismiss', id, snoozeMin: 15 } }
    ]
  }
}

export function eyesAlert(a: BodyInput): IslandAlert | null {
  if (!a.eyeBreaks || a.busy || !a.activeSince || a.idleSec == null || a.idleSec > 60) return null
  if (a.now - a.activeSince < 20 * 60_000 || a.now - a.lastEyesAt < 20 * 60_000) return null
  const id = `eyes:${Math.floor(a.now / (20 * 60_000))}`
  if ((a.dismissed[id] ?? 0) > a.now) return null
  return { id, kind: 'eyes', title: '20-20-20', text: 'Look at something 6 m away for 20 seconds.', face: '👁️', actions: [{ label: '✓ Done', action: { kind: 'dismiss', id }, primary: true }] }
}

/** The hour before your bedtime target (also past midnight targets like 00:30). */
export function windDown(now: number, bedTarget: string, bedLogged: boolean): { bedAt: string; minutesLeft: number } | null {
  if (bedLogged || !/^\d{2}:\d{2}$/.test(bedTarget)) return null
  const d = new Date(now)
  const cur = d.getHours() * 60 + d.getMinutes()
  const left = (toMin(bedTarget) - cur + 1440) % 1440
  return left > 0 && left <= 60 ? { bedAt: bedTarget, minutesLeft: left } : null
}

export function windDownAlert(w: { bedAt: string; minutesLeft: number } | null, now: number, dismissed: Record<string, number>): IslandAlert | null {
  if (!w) return null
  const id = `winddown:${new Date(now).toDateString()}`
  if ((dismissed[id] ?? 0) > now) return null
  return {
    id,
    kind: 'winddown',
    title: `Wind down · bed at ${w.bedAt}`,
    text: "Tomorrow's top 3 → close the day → screens off. Then tap Going to bed.",
    face: '🌇',
    actions: [
      { label: 'Close my day', action: { kind: 'closeDay' }, primary: true },
      { label: '🌙 Going to bed', action: { kind: 'bed' } },
      { label: 'Later', action: { kind: 'dismiss', id, snoozeMin: 20 } }
    ]
  }
}

/**
 * The first time at the PC today (05:00–12:00): wake-up, today's first block,
 * Start my day. The one morning card: once a wake-up is logged for today
 * (from anywhere: Telegram, Waky, the island, Ben) it never asks "Up at…?"
 * again, it just says when you got up; and it goes once your first block has begun.
 */
export function morningAlert(o: { now: number; firstActiveAt: number | null; wakeLogged: boolean; wakeTime?: string | null; firstBlock: { title: string; start: number } | null; blockStarted?: boolean; dismissed: Record<string, number> }): IslandAlert | null {
  if (!o.firstActiveAt) return null
  if (o.wakeLogged && o.blockStarted) return null
  const h = hour(o.now)
  if (h < 5 || h >= 12 || o.now - o.firstActiveAt > 3 * 3600_000) return null
  const id = `morning:${new Date(o.now).toDateString()}`
  if ((o.dismissed[id] ?? 0) > o.now) return null
  const wake = hm(o.firstActiveAt)
  return {
    id,
    kind: 'morning',
    title: 'Good morning ☀️',
    text: o.wakeLogged
      ? `${o.wakeTime ? `Up at ${o.wakeTime}. ` : ''}${o.firstBlock ? `First up: ${o.firstBlock.title} at ${hm(o.firstBlock.start)}.` : 'Nothing planned yet.'}`
      : `${o.firstBlock ? `First up: ${o.firstBlock.title} at ${hm(o.firstBlock.start)}. ` : 'Nothing planned yet. '}Up since ${wake}?`,
    face: '🌅',
    actions: [
      ...(o.wakeLogged ? [] : [{ label: `☀️ Up at ${wake}`, action: { kind: 'wake' as const, time: wake }, primary: true }]),
      { label: '▶ Start my day', action: { kind: 'open' as const, page: 'today' }, primary: o.wakeLogged },
      { label: 'Later', action: { kind: 'dismiss' as const, id, snoozeMin: 60 } }
    ]
  }
}
