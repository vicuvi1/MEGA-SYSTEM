// Your healthy day (HD), pure and tested: one set of rules so the body
// nudges built by different parts of the app (the island's water, move,
// eye and posture cards, the bedtime countdown, Ben's Telegram rhythm, your
// own reminders) work together instead of piling up.
//
// - The governor: no two nudges about the same thing within 30 minutes on
//   any surface, nothing during a call, a focus timer or a class (water and
//   move breaks wait for after), at most 3 interruptions an hour (the rest
//   wait as a dot), and nothing after you went to bed but your own reminders.
// - The Healthy day ring: water, move breaks, screen breaks and last night's
//   bedtime, a streak, and a small honest bonus once all four are really done.
// - Words: the evening "how did your body do" line and the Sunday card.
// - Wind-down mode: from bedtime − 60 min the island dims and counts down;
//   after bedtime two firmer nudges at most, then it leaves you alone.
// - Reminders you set ("remind me to call mom at 18:00"): parsed here, shown
//   on the island with Done / Snooze, sent to Telegram once.
import type { IslandAlert } from './islandModel'
import type { NudgeDay, NudgeStore } from './islandNudges'
import { addDays } from './dates'

export const HEALTHY_RULE = 'body.healthy_day'
/** The same thing is never nudged twice within this, on any surface. */
export const SAME_TOPIC_MIN = 30
/** Interruptions (pop-ups or messages) in any 60 minutes; more wait as a dot. */
export const MAX_PER_HOUR = 3
/** A water or move nudge held back by a call, focus or class is offered after it, within this. */
export const QUEUE_KEEP_MIN = 90
/** Wind-down mode starts this long before your bedtime target. */
export const WIND_DOWN_MIN = 60
/** The island's water card counts for Telegram too: Telegram waits this long after it. */
export const WATER_SHARED_MIN = 90

export type Surface = 'island' | 'telegram' | 'toast'
/** A nudge that reached you: when, about what, its family (the same card escalating), where. */
export interface Shown { at: number; topic: string; key: string; surface: Surface; dot?: boolean }

const hmOf = (t: number) => new Date(t).toTimeString().slice(0, 5)
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
const isHm = (v: unknown): v is string => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v)

/** What a message from Ben (Telegram) is about, from its first line (a plan or a review mentions water too). */
export function textTopic(text: string): string | null {
  const t = String(text ?? '').replace(/<[^>]+>/g, '').trim()
  if (/^(?:🔔|⏰)/u.test(t)) return 'reminder'
  const first = t.split('\n')[0].toLowerCase()
  if (/day review|evening review/.test(first)) return 'evening'
  if (/your day|half a day left|here's a plan/.test(first)) return 'plan'
  if (/wind[- ]?down|bedtime|in bed by|go to bed/.test(first)) return 'bed'
  if (/^💪|training|workout/u.test(first)) return 'training'
  if (/^💧|\bwater\b|\bglass(?:es)?\b|hydrat/u.test(first)) return 'water'
  if (/move break|\bstretch\b|stand up/.test(first)) return 'move'
  return null
}

/**
 * Which part of your healthy day an island alert is about, or null when it
 * is not a body or day nudge (timers, blocks starting, Ben's answers,
 * the card right after you logged something).
 */
export function alertTopic(a: IslandAlert | null): string | null {
  if (!a) return null
  if (a.id.startsWith('remind:')) return 'reminder'
  const n = a.nudge
  if (n) {
    if (n.type === 'moveDone' || n.type === 'focus') return null
    return n.kind
  }
  switch (a.kind) {
    case 'water':
      return 'water'
    case 'move':
      return 'move'
    case 'eyes':
      return 'eyes'
    case 'winddown':
      return 'bed'
    case 'late':
      return 'late'
    case 'morning':
    case 'sleep':
      return 'morning'
    case 'recap':
      return 'evening'
    case 'ben':
      return textTopic(a.text)
    default:
      return null
  }
}

/** The card's family: a move break that grows from a dot to a peek is one card. */
export const alertKey = (a: IslandAlert) => a.id.replace(/:(?:dot|peek|sound|ben)$/, '')

export interface GovernCtx {
  now: number
  /** A call or meeting is on. */
  call: boolean
  /** A focus timer runs (not a break). */
  focus: boolean
  /** A class or another event you go to is on right now (not a focus block). */
  event: boolean
  /** You logged going to bed (the moon is up). */
  asleep: boolean
  /** Wind-down or later (bedtime − 60 min until bed): no push-ups or water now, only bed. */
  windDown?: boolean
  /** Interruptions an hour (how hard Ben pushes); never above MAX_PER_HOUR. */
  perHour?: number
}

export interface Verdict {
  /** What to show now (null: nothing), maybe turned into a quiet dot. */
  show: IslandAlert | null
  /** Held back for after the call, focus or class. */
  queue?: IslandAlert
  why: string
}

/** Water and move breaks wait for after a call / focus / class; the rest is simply not shown. */
const QUEUES = new Set(['water', 'move'])
/** Firm on purpose (your bedtime): never turned into a dot by the hourly cap. */
const FIRM = new Set(['late'])
/** What still makes sense in the wind-down hour and after bedtime. */
const NIGHT = new Set(['bed', 'late', 'gratitude', 'evening'])

/** Interruptions in the last hour (distinct cards, dots don't count). */
export function interruptions(shown: Shown[], now: number, except?: string): number {
  const keys = new Set(shown.filter((s) => !s.dot && s.topic !== 'reminder' && now - s.at < 60 * 60_000 && s.key !== except).map((s) => `${s.surface}:${s.key}`))
  return keys.size
}

/**
 * One rule for every body and day nudge (island and Telegram): see the top
 * of this file. Alerts that aren't nudges (timers, blocks, your answers)
 * pass as they are.
 */
export function govern(a: IslandAlert | null, c: GovernCtx, shown: Shown[]): Verdict {
  if (!a) return { show: null, why: 'nothing' }
  const topic = alertTopic(a)
  if (!topic || topic === 'reminder') return { show: a, why: topic ? 'your reminder' : 'not a nudge' }
  if (c.asleep) return { show: null, why: 'after bed: only your own reminders' }
  if (c.call || c.focus || c.event) return { show: null, ...(QUEUES.has(topic) ? { queue: a } : {}), why: c.call ? 'in a call' : c.focus ? 'focus timer' : 'in a class or event' }
  if (c.windDown && !NIGHT.has(topic)) return { show: null, why: 'wind-down: only bed now' }
  // Ben's Telegram message already reached you: on the island it waits as a dot, never pops up again.
  if (a.kind === 'ben') return { show: { ...a, dot: true }, why: 'already on Telegram: a dot' }
  const key = alertKey(a)
  const dup = shown.find((s) => s.topic === topic && s.key !== key && c.now - s.at < SAME_TOPIC_MIN * 60_000)
  if (dup) return { show: null, why: `${topic} already nudged at ${hmOf(dup.at)} (${dup.surface})` }
  const cap = Math.min(MAX_PER_HOUR, Math.max(1, c.perHour ?? MAX_PER_HOUR))
  if (!a.dot && !FIRM.has(topic) && interruptions(shown, c.now, key) >= cap) return { show: { ...a, dot: true }, why: `${cap} interruptions this hour: a dot` }
  return { show: a, why: 'ok' }
}

/**
 * Notes what reached you (kept 4 hours). `appeared`: it just came up (a card
 * that comes back after a snooze counts again); otherwise a card that grew
 * from a dot to a peek is updated, not doubled.
 */
export function noteShown(shown: Shown[], a: IslandAlert | null, surface: Surface, now: number, appeared = false): Shown[] {
  const topic = alertTopic(a)
  // The morning card is remembered all day (no second good-morning card at noon).
  const keep = shown.filter((s) => now - s.at < (s.topic === 'morning' ? 14 : 4) * 3600_000)
  if (!a || !topic) return keep
  const key = alertKey(a)
  const dot = !!a.dot
  const same = [...keep].reverse().find((s) => s.key === key && s.surface === surface)
  if (same && !appeared) return same.dot && !dot ? keep.map((s) => (s === same ? { ...s, dot: false } : s)) : keep
  if (same && same.dot && !dot && now - same.at < 60_000 * 15) return keep.map((s) => (s === same ? { ...s, dot: false } : s))
  return [...keep, { at: now, topic, key, surface, ...(dot ? { dot: true } : {}) }].slice(-60)
}

/** A Telegram message from Ben (it shows in the island's log too) as something that reached you. */
export function noteMessage(shown: Shown[], text: string, at: number): Shown[] {
  const topic = textTopic(text)
  if (!topic || shown.some((s) => s.surface === 'telegram' && s.at === at)) return shown
  return [...shown, { at, topic, key: `tg:${at}`, surface: 'telegram' as const }].slice(-60)
}

export interface Queued { topic: string; alert: IslandAlert; at: number }

/** Keeps one held-back nudge per topic (the newest). */
export function queueAdd(q: Queued[], a: IslandAlert, now: number): Queued[] {
  const topic = alertTopic(a) ?? a.kind
  return [...q.filter((x) => x.topic !== topic && now - x.at < QUEUE_KEEP_MIN * 60_000), { topic, alert: a, at: now }]
}

/** The call, focus or class is over: the oldest held-back nudge, said as "now that it's done". */
export function queueRelease(q: Queued[], c: GovernCtx): { alert: IslandAlert | null; rest: Queued[] } {
  const fresh = q.filter((x) => c.now - x.at < QUEUE_KEEP_MIN * 60_000)
  if (c.call || c.focus || c.event || c.asleep || !fresh.length) return { alert: null, rest: fresh }
  const [first, ...rest] = fresh
  const a = first.alert
  if (first.topic === 'move') return { alert: { ...a, title: 'Done sitting through that: stand up and stretch?', text: '2 minutes on your feet, then back to it.', face: '🏃', dot: false }, rest }
  const title = first.topic === 'water' ? 'Now that it is done: a glass of water?' : a.title
  return { alert: { ...a, title, dot: false }, rest }
}

// ---- The Healthy day ring ---------------------------------------------------------

export interface HealthyInput {
  waterMl: number
  waterTarget: number
  /** Move breaks logged today (undone ones don't count). */
  moves: number
  /** Screen breaks: eye breaks, calm minutes, tidy minutes, walks after time away. */
  breaks: number
  /** Last night's bedtime against your target (null: not logged). */
  sleptOnTime: boolean | null
  /** Your goals (defaults: 3 move breaks, 3 screen breaks). */
  moveGoal?: number
  breakGoal?: number
}

export interface HealthyPart { id: 'water' | 'move' | 'breaks' | 'sleep'; icon: string; label: string; done: boolean; pct: number; text: string }
export interface HealthyDay { parts: HealthyPart[]; score: number; met: number; all: boolean }

export const MOVE_GOAL = 3
export const BREAK_GOAL = 3

/** Today's four parts, each 0..1, and a score out of 100 (the ring on the pill and the Day page). */
export function healthyDay(i: HealthyInput): HealthyDay {
  const mg = Math.max(1, i.moveGoal ?? MOVE_GOAL)
  const bg = Math.max(1, i.breakGoal ?? BREAK_GOAL)
  const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0)
  const water = i.waterTarget > 0 ? clamp(i.waterMl / i.waterTarget) : 0
  const parts: HealthyPart[] = [
    { id: 'water', icon: '💧', label: 'Water', done: i.waterTarget > 0 && i.waterMl >= i.waterTarget, pct: water, text: `${(i.waterMl / 1000).toFixed(1)} of ${(i.waterTarget / 1000).toFixed(1)} L` },
    { id: 'move', icon: '💪', label: 'Moves', done: i.moves >= mg, pct: clamp(i.moves / mg), text: `${i.moves} of ${mg} move breaks` },
    { id: 'breaks', icon: '👁️', label: 'Breaks', done: i.breaks >= bg, pct: clamp(i.breaks / bg), text: `${i.breaks} of ${bg} screen breaks` },
    { id: 'sleep', icon: '🌙', label: 'Sleep', done: i.sleptOnTime === true, pct: i.sleptOnTime ? 1 : 0, text: i.sleptOnTime == null ? 'No bedtime logged last night' : i.sleptOnTime ? 'In bed on time last night' : 'Late to bed last night' }
  ]
  const met = parts.filter((p) => p.done).length
  return { parts, score: Math.round((parts.reduce((t, p) => t + p.pct, 0) / 4) * 100), met, all: met === 4 }
}

/** Screen breaks in a nudge day (eyes, calm, tidy, walks). */
export const screenBreaks = (d: Pick<NudgeDay, 'eyes' | 'calm' | 'tidy' | 'walks'> | null | undefined) => (d ? d.eyes + d.calm + d.tidy + d.walks : 0)

/** Last night's bedtime on time? From the row of the morning the night ended in (15 min grace). */
export function sleptOnTime(log: { bedTime: string | null; bedTarget: string | null; bedOnTime: boolean | null } | null | undefined, fallbackTarget = '23:00'): boolean | null {
  if (!log || !isHm(log.bedTime)) return null
  if (typeof log.bedOnTime === 'boolean') return log.bedOnTime
  const target = isHm(log.bedTarget) ? log.bedTarget : fallbackTarget
  // Minutes after the target, wrapping past midnight (an hour early counts as on time).
  const late = (toMin(log.bedTime) - toMin(target) + 1440 + 720) % 1440 - 720
  return late <= 15
}

/** Days in a row with all four (today counts once it's done; else it starts from yesterday). */
export function healthyStreak(days: Record<string, { healthy?: boolean } | undefined>, today: string): number {
  const ok = (d: string) => !!days[d]?.healthy
  let d = ok(today) ? today : addDays(today, -1)
  let n = 0
  while (ok(d) && n < 3650) {
    n++
    d = addDays(d, -1)
  }
  return n
}

/** The daily bonus: pay it once when all four are met, take it back if one is undone the same day. */
export function healthyBonus(h: HealthyDay, paid: number | null | undefined): 'pay' | 'undo' | null {
  if (h.all && !paid) return 'pay'
  if (!h.all && paid) return 'undo'
  return null
}

/** The pill and Day page's view of today. */
export interface HealthyView { score: number; met: number; parts: HealthyPart[]; streak: number; bonus: boolean; line: string }

export function healthyView(h: HealthyDay, streak: number, bonusPaid: boolean): HealthyView {
  return { score: h.score, met: h.met, parts: h.parts, streak, bonus: bonusPaid, line: bodyLine(h) }
}

/**
 * The Healthy day card's headline. The count says how many of the four are
 * complete; the percent is overall progress (partial water counts there), so
 * "0 of 4" next to a partly filled ring no longer reads as a contradiction.
 */
export function healthyHeadline(v: Pick<HealthyView, 'met' | 'score' | 'bonus'>): string {
  if (v.met >= 4) return v.bonus ? 'All four complete · +5 points' : 'All four complete'
  return `${v.met} of 4 complete · ${v.score}% overall`
}

/** The ring's four segments (water, moves, breaks, sleep): each fills by its own progress, 0..1. */
export function healthySegments(parts: Pick<HealthyPart, 'id' | 'pct' | 'done'>[]): { id: string; fill: number; done: boolean }[] {
  return parts.slice(0, 4).map((p) => ({ id: p.id, fill: p.done ? 1 : Math.max(0, Math.min(1, Number.isFinite(p.pct) ? p.pct : 0)), done: p.done }))
}

/** The evening's "how did your body do today" line (plain words, real numbers). */
export function bodyLine(h: HealthyDay): string {
  const [w, m, b, s] = h.parts
  const tail = h.all ? 'All four: a healthy day. 💚' : h.met === 3 ? `3 of 4. Missing: ${h.parts.find((p) => !p.done)!.label.toLowerCase()}.` : `${h.met} of 4 healthy.`
  return `Body today: ${w.text} water, ${m.text}, ${b.text}, ${s.done ? 'bed on time last night' : s.text.charAt(0).toLowerCase() + s.text.slice(1)}. ${tail}`
}

// ---- The weekly health card (Sunday) ------------------------------------------------

export interface WeekDayHealth { day: string; waterMl?: number; waterTarget?: number; moves: number; breaks: number; healthy?: boolean }
export interface WeeklyHealth {
  days: number
  waterAvgMl: number
  waterDaysMet: number
  moves: number
  breaks: number
  bedOnTime: number
  bedNights: number
  /** The latest minus the earliest bedtime this week (minutes): small is steady. */
  bedSpreadMin: number | null
  healthyDays: number
  lines: string[]
}

/** The last 7 days (ending today) from the island's tallies and Waky's bedtimes. */
export function weeklyHealth(days: WeekDayHealth[], beds: { day: string; bedTime: string | null; bedOnTime: boolean | null; bedTarget?: string | null }[], today: string): WeeklyHealth {
  const from = addDays(today, -6)
  const week = days.filter((d) => d.day >= from && d.day <= today)
  const watered = week.filter((d) => (d.waterMl ?? 0) > 0)
  const nights = beds.filter((b) => b.day >= from && b.day <= today && isHm(b.bedTime))
  const onTime = nights.filter((b) => sleptOnTime({ bedTime: b.bedTime, bedTarget: b.bedTarget ?? null, bedOnTime: b.bedOnTime }) === true).length
  // Bedtimes as minutes after 18:00 (so 23:40 and 00:20 sit 40 minutes apart).
  const mins = nights.map((b) => (toMin(b.bedTime!) - 18 * 60 + 1440) % 1440)
  const spread = mins.length >= 2 ? Math.max(...mins) - Math.min(...mins) : null
  const r: Omit<WeeklyHealth, 'lines'> = {
    days: week.length,
    waterAvgMl: watered.length ? Math.round(watered.reduce((t, d) => t + (d.waterMl ?? 0), 0) / watered.length) : 0,
    waterDaysMet: week.filter((d) => (d.waterTarget ?? 0) > 0 && (d.waterMl ?? 0) >= (d.waterTarget ?? 0)).length,
    moves: week.reduce((t, d) => t + d.moves, 0),
    breaks: week.reduce((t, d) => t + d.breaks, 0),
    bedOnTime: onTime,
    bedNights: nights.length,
    bedSpreadMin: spread,
    healthyDays: week.filter((d) => d.healthy).length
  }
  const lines = [
    `💧 Water: ${(r.waterAvgMl / 1000).toFixed(1)} L a day on average, goal reached ${r.waterDaysMet} of 7 days`,
    `💪 Moves: ${r.moves} move break${r.moves === 1 ? '' : 's'} · 👁️ ${r.breaks} screen break${r.breaks === 1 ? '' : 's'}`,
    `🌙 Bedtime: on time ${r.bedOnTime} of ${r.bedNights} night${r.bedNights === 1 ? '' : 's'}${spread != null ? ` · ${spread <= 30 ? 'steady' : spread <= 75 ? 'a bit all over' : 'all over the place'} (${Math.floor(spread / 60)}h${String(spread % 60).padStart(2, '0')} between earliest and latest)` : ''}`,
    `💚 Healthy days: ${r.healthyDays} of 7`
  ]
  return { ...r, lines }
}

/** The Sunday card's text (Telegram and the island). */
export function weeklyHealthText(w: WeeklyHealth): string {
  return `🩺 <b>Your body this week</b>\n${w.lines.join('\n')}`
}

/** The week from the island's nudge store (water is saved there each day the island runs). */
export function weekDaysFromStore(s: Pick<NudgeStore, 'days'>, today: string): WeekDayHealth[] {
  const out: WeekDayHealth[] = []
  for (let i = 6; i >= 0; i--) {
    const day = addDays(today, -i)
    const d = s.days[day]
    if (!d) continue
    out.push({ day, waterMl: d.water ?? 0, waterTarget: d.waterTarget ?? 0, moves: d.moves, breaks: screenBreaks(d), healthy: !!d.healthy })
  }
  return out
}

// ---- Wind-down mode -------------------------------------------------------------

export interface WindDownMode {
  phase: 'wind' | 'late'
  /** Minutes left to bed (wind), or minutes past it (late). */
  minutes: number
  bedAt: string
  title: string
  line: string
  /** Offer a calm music station (the island's music). */
  music: boolean
}

/**
 * From bedtime − 60 min until bed: the island dims and says "close the
 * laptop" with the countdown. After bedtime (until 05:00, still on the PC)
 * it stays dim and firmer. Nothing once bed is logged.
 */
export function windDownMode(now: number, bedTarget: string, bedLogged: boolean): WindDownMode | null {
  if (bedLogged || !isHm(bedTarget)) return null
  const d = new Date(now)
  const cur = d.getHours() * 60 + d.getMinutes()
  const left = (toMin(bedTarget) - cur + 1440) % 1440
  if (left > 0 && left <= WIND_DOWN_MIN) {
    return {
      phase: 'wind',
      minutes: left,
      bedAt: bedTarget,
      title: `Wind down · bed at ${bedTarget}`,
      line: left <= 15 ? 'Close the laptop now. Teeth, phone on the charger, lights low.' : left <= 30 ? 'Finish what you are on, then close the laptop.' : "Tomorrow's top 3, close the day, then close the laptop.",
      music: true
    }
  }
  const past = (cur - toMin(bedTarget) + 1440) % 1440
  const until5 = (5 * 60 - toMin(bedTarget) + 1440) % 1440
  if (past < until5 && past < 6 * 60) {
    return { phase: 'late', minutes: past, bedAt: bedTarget, title: past < 1 ? 'Bedtime' : `${past} min past bedtime`, line: 'Close the laptop. Tomorrow starts tonight.', music: false }
  }
  return null
}

/**
 * The firmer late-night nudge: at bedtime + 30 ("Still up?") and + 60
 * (firmer), each once, only while you're really at the PC. Then it stops:
 * no nagging every 20 minutes until 05:00.
 */
export function lateAlert(o: { now: number; bedTarget: string; latest?: string; idleSec: number | null; bedLogged: boolean; dismissed: Record<string, number>; day: string }): IslandAlert | null {
  const w = windDownMode(o.now, o.bedTarget, o.bedLogged)
  if (!w || w.phase !== 'late' || o.idleSec == null || o.idleSec > 120) return null
  // My life: the first one at your latest bedtime (when it's within 2 h of the target), else at +30; the firmer one 30 min later.
  const gap = o.latest && isHm(o.latest) ? (toMin(o.latest) - toMin(o.bedTarget) + 1440) % 1440 : 30
  const first = gap >= 10 && gap <= 120 ? gap : 30
  const stage = w.minutes >= first + 30 && w.minutes < first + 90 ? 2 : w.minutes >= first && w.minutes < first + 30 ? 1 : 0
  if (!stage) return null
  const id = `late:${o.day}:${stage}`
  if ((o.dismissed[id] ?? 0) > o.now) return null
  const now = hmOf(o.now)
  return stage === 1
    ? {
        id,
        kind: 'late',
        title: 'Still up?',
        text: `It's ${now} and your bedtime was ${o.bedTarget}${o.latest && gap >= 10 && gap <= 120 ? ` (latest ${o.latest})` : ''}. Close the laptop: tomorrow starts tonight.`,
        face: '🌙',
        actions: [
          { label: '🌙 Going to bed', action: { kind: 'bed' }, primary: true },
          { label: 'Close the day', action: { kind: 'closeDay' } },
          { label: '10 min to finish', action: { kind: 'dismiss', id, snoozeMin: 600 } }
        ]
      }
    : {
        id,
        kind: 'late',
        title: `An hour past bedtime`,
        text: `${now}. Every hour now comes out of tomorrow. Save your work and close the laptop.`,
        face: '😤',
        actions: [
          { label: '🌙 Going to bed', action: { kind: 'bed' }, primary: true },
          { label: 'Saving, then bed', action: { kind: 'dismiss', id, snoozeMin: 600 } }
        ]
      }
}

/**
 * Telegram's wind-down message (25–50 min before bed): not when the bed is
 * already logged, and not when the island just showed its own wind-down
 * (you're at the PC and saw it).
 */
export function telegramWindDown(o: { minutesBefore: number; bedLogged: boolean; islandBedAt: number | null; now: number }): boolean {
  if (o.bedLogged || o.minutesBefore < 25 || o.minutesBefore > 50) return false
  return !(o.islandBedAt && o.now - o.islandBedAt < WIND_DOWN_MIN * 60_000)
}

/**
 * Quiet hours end once you're up: after you log the wake-up (Telegram, Waky,
 * the island) the morning part of the quiet hours is over, so the morning
 * plan comes at once instead of waiting in the bell.
 */
export function stillQuiet(quiet: boolean, now: Date, wakeAt: string | null | undefined): boolean {
  if (!quiet) return false
  if (!isHm(wakeAt) || now.getHours() >= 12) return true
  return now.getHours() * 60 + now.getMinutes() < toMin(wakeAt)
}

/** The last time your water went up, from any device (the island's water card waits 90 minutes after it). */
export function waterSeen(prev: { ml: number; at: number } | null, ml: number, now: number): { ml: number; at: number } {
  if (!prev) return { ml, at: 0 }
  return ml > prev.ml ? { ml, at: now } : { ml, at: prev.at }
}

/** Telegram's water nudge waits while the island has water covered (its card within 90 min). */
export function islandHasWater(islandWaterAt: number | null | undefined, now: number): boolean {
  return !!islandWaterAt && now - islandWaterAt < WATER_SHARED_MIN * 60_000
}

// ---- Reminders you set --------------------------------------------------------

export interface ReminderAsk { text: string; at: number }

/** "18:00", "6pm", "6:30 pm", "18" → minutes after midnight, or null. */
function clockOf(t: string): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(t.trim().toLowerCase())
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  const ap = m[3]?.replace(/\./g, '')
  if (!m[2] && !ap && h > 24) return null
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * "remind me to call mom at 18:00", "remind me at 6pm to stretch",
 * "remind me in 20 min to drink water", "remind me tomorrow at 9 to pay
 * rent" → the text and the time (the next time it comes, never the past).
 * Null when there is no time (that's a Todoist task).
 */
export function parseReminder(raw: string, now: number): ReminderAsk | null {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ')
  const m = /^(?:\/?remind|reminder|remind me)\b:?\s*(?:me\s+)?(.*)$/i.exec(s)
  if (!m) return null
  let rest = m[1].trim()
  let at: number | null = null
  let tomorrow = false
  const tm = /\btomorrow\b/i
  if (tm.test(rest)) {
    tomorrow = true
    rest = rest.replace(tm, ' ').replace(/\s+/g, ' ').trim()
  }
  const inM = /\bin (\d{1,3}) ?(min|mins|minutes|m|h|hr|hrs|hours?)\b/i.exec(rest)
  const atM = /\bat (\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)(?=\s|$)/i.exec(rest)
  if (inM) {
    const n = Number(inM[1])
    const mins = /^h/i.test(inM[2]) ? n * 60 : n
    if (mins < 1 || mins > 24 * 60) return null
    at = now + mins * 60_000
    rest = rest.replace(inM[0], ' ')
  } else if (atM) {
    const c = clockOf(atM[1])
    if (c == null) return null
    const d = new Date(now)
    d.setHours(Math.floor(c / 60), c % 60, 0, 0)
    if (tomorrow) d.setDate(d.getDate() + 1)
    else if (d.getTime() <= now) d.setDate(d.getDate() + 1)
    at = d.getTime()
    rest = rest.replace(atM[0], ' ')
  }
  if (at == null) return null
  const text = rest
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:to|that|about)\s+/i, '')
    .replace(/[.!]+$/, '')
    .trim()
  if (text.length < 2) return null
  return { text: text.slice(0, 120), at }
}

/** A reminder as the island and the app keep it (the same list Ben's ⏰ uses). */
export interface ReminderItem { id: string; at: string; text: string; kind: 'remind' | 'checkin'; done?: boolean; sentAt?: string | null; answeredAt?: string | null; handled?: boolean }

/**
 * The island's card for a reminder you set: when it's due (within 6 hours)
 * and not answered yet with Done or Snooze, on the island or Telegram.
 * Ben's own check-ins stay on Telegram (they come back by themselves).
 */
export function reminderAlert(list: ReminderItem[], now: number, dismissed: Record<string, number>): IslandAlert | null {
  const due = list
    .filter((r) => r.kind === 'remind' && !r.handled && Date.parse(r.at) <= now && Date.parse(r.at) > now - 6 * 3600_000)
    // Sent to Telegram and answered there (done before it was sent = Done on the island).
    .filter((r) => !(r.done && !r.sentAt) && !r.answeredAt)
    .filter((r) => (dismissed[`remind:${r.id}`] ?? 0) <= now)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0]
  if (!due) return null
  const id = `remind:${due.id}`
  return {
    id,
    kind: 'remind',
    title: due.text,
    text: `Your reminder for ${hmOf(Date.parse(due.at))}.`,
    face: '⏰',
    actions: [
      { label: '✓ Done', action: { kind: 'remind', op: 'done', id: due.id }, primary: true },
      { label: '10 min', action: { kind: 'remind', op: 'snooze', id: due.id, minutes: 10 } },
      { label: '1 hour', action: { kind: 'remind', op: 'snooze', id: due.id, minutes: 60 } }
    ]
  }
}

/** Done: it's answered everywhere (the island card goes, Telegram won't send it). */
export function reminderDone<T extends ReminderItem>(list: T[], id: string, now: number): T[] {
  return list.map((r) => (r.id === id ? { ...r, done: true, handled: true, answeredAt: new Date(now).toISOString() } : r))
}

/** Snooze: it comes back once on both, this many minutes from now. */
export function reminderSnooze<T extends ReminderItem>(list: T[], id: string, minutes: number, now: number): T[] {
  const m = Math.max(1, Math.min(24 * 60, Math.round(minutes)))
  return list.map((r) => (r.id === id ? { ...r, at: new Date(now + m * 60_000).toISOString(), done: false, handled: false, sentAt: null } : r))
}

/** Wind-down's calm music: your own calm station first, else a calm starter (ambient, evening soul, chill). */
export function calmStationOf<T extends { name: string; vibe?: string }>(list: T[]): T | null {
  const calm = /calm|sleep|ambient|soul|piano|rain|chill|lofi|evening/i
  return list.find((x) => calm.test(x.name) && !x.vibe) ?? (['ambient', 'soul', 'chill', 'lofi'].map((v) => list.find((x) => x.vibe === v)).find(Boolean) as T | undefined) ?? list.find((x) => calm.test(x.name)) ?? null
}
