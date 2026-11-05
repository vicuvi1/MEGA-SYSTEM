// The island's smarter moments (phase 1), pure and tested:
// - drift: a planned block is on, no timer runs and you've been away from
//   the PC for a while → "Algorithms · 25 min left · back to it?"
// - end-of-block check: a block just ended → "Did you finish it?"
// - call mode: a meeting in your calendar (by its data: a call link or other
//   people, and you said yes) keeps the island quiet
// - focus guard: how much of a focus session you were really at the PC.
import type { IslandAlert, IslandBlock } from './islandModel'

/**
 * A meeting: marked by its data (a call link or other people), never by its
 * name (IS11): "Call mom" in your own plan is a block you do, not a meeting.
 */
export const isMeetingBlock = (b: IslandBlock) => !!b.call && !b.maybe
const meeting = isMeetingBlock

/** Away this long (seconds of no mouse/keys) during a block counts as drifting. */
export const DRIFT_IDLE_SEC = 8 * 60
/** Idle this long during a focus timer counts against its quality. */
export const GUARD_IDLE_SEC = 120

const mins = (ms: number) => Math.max(1, Math.round(ms / 60000))

/** The call/meeting going on now, if any. */
export function callNow(blocks: IslandBlock[], now: number): IslandBlock | null {
  return blocks.find((b) => b.start <= now && now < b.end && meeting(b)) ?? null
}

/** The work block going on now (not a call). */
export function workNow(blocks: IslandBlock[], now: number): IslandBlock | null {
  return blocks.filter((b) => b.start <= now && now < b.end && !meeting(b) && !b.maybe).sort((a, b) => a.end - a.start - (b.end - b.start))[0] ?? null
}

export const blockKey = (b: IslandBlock) => b.id ?? `${b.start}:${b.title}`

export interface SmartInput {
  now: number
  blocks: IslandBlock[]
  running: boolean
  /** Seconds since the last mouse/keyboard input on the PC (null: unknown, e.g. the website). */
  idleSec: number | null
  dismissed: Record<string, number>
  /** Blocks you already answered "did you finish it?" for. */
  answered: Record<string, string>
  /** SI10: what you were really doing in a block ("You were coding 38 of 45 min."), when the Smart island knows. */
  reality?: (b: IslandBlock) => string
}

/** The smart alert to show now (end-of-block check first, then drift), or null. */
export function smartAlert(a: SmartInput): IslandAlert | null {
  const hidden = (id: string) => (a.dismissed[id] ?? 0) > a.now
  // A block ended in the last 20 minutes, and nothing else is on: did you finish it?
  if (!a.running && !callNow(a.blocks, a.now)) {
    const ended = a.blocks
      .filter((b) => !meeting(b) && !b.maybe && b.end <= a.now && a.now - b.end <= 20 * 60_000 && b.end - b.start >= 15 * 60_000 && !a.answered[blockKey(b)])
      .sort((x, y) => y.end - x.end)[0]
    const id = ended && `end:${blockKey(ended)}`
    if (ended && id && !hidden(id))
      return {
        id,
        kind: 'end',
        title: 'Block finished',
        text: `${a.reality?.(ended) ? `${a.reality(ended)} ` : ''}Did you finish “${ended.title}”?`,
        face: '🏁',
        actions: [
          { label: '✓ Done', action: { kind: 'blockResult', block: ended, result: 'done', alertId: id }, primary: true },
          { label: '½ Half', action: { kind: 'blockResult', block: ended, result: 'half', alertId: id } },
          { label: '✗ Not done', action: { kind: 'blockResult', block: ended, result: 'no', alertId: id } }
        ]
      }
  }
  // Drifting: a work block is on, no timer, and you've been away for a while.
  const b = workNow(a.blocks, a.now)
  if (b && !a.running && a.idleSec != null && a.idleSec >= DRIFT_IDLE_SEC) {
    const id = `drift:${blockKey(b)}`
    const left = mins(b.end - a.now)
    if (!hidden(id))
      return {
        id,
        kind: 'drift',
        title: `${b.title} · ${left} min left`,
        text: `You've been away ${mins(a.idleSec * 1000)} min. Back to it?`,
        face: '👀',
        actions: [
          { label: `▶ Resume · ${left} min`, action: { kind: 'start', subject: b.title, minutes: Math.min(180, left) }, primary: true },
          { label: 'Push 15 min', action: { kind: 'push', block: b, minutes: 15 } },
          { label: 'Skip it', action: { kind: 'blockResult', block: b, result: 'no', alertId: id } }
        ]
      }
  }
  return null
}

/** Focus quality 0–100: the share of the session you were at the PC. */
export function focusQuality(elapsedSec: number, idleSec: number): number {
  if (elapsedSec <= 0) return 100
  return Math.max(0, Math.min(100, Math.round((1 - Math.min(idleSec, elapsedSec) / elapsedSec) * 100)))
}

/** Should this block start a focus timer by itself (auto-start on)? */
export function autoStartBlock(blocks: IslandBlock[], now: number, running: boolean, started: Record<string, true>): IslandBlock | null {
  if (running) return null
  return blocks.find((b) => !meeting(b) && !b.maybe && b.start <= now && now - b.start <= 3 * 60_000 && now < b.end && !started[blockKey(b)]) ?? null
}

// ---- Smart island (SI3, SI10, SI11): what you were really doing ----

/** A stretch of doing (from activityStream's sessionize): kind and time only. */
export interface DoingSpan { context: string; start: number; end: number }
const DRIFT_KINDS = ['video', 'gaming']

/** Minutes in a row (from now backwards) in these kinds. */
const minutesBack = (spans: DoingSpan[], kinds: string[], now: number) => {
  let t = 0
  for (let i = spans.length - 1; i >= 0; i--) {
    if (!kinds.includes(spans[i].context)) break
    t += (Math.min(now, spans[i].end) - spans[i].start) / 60000
  }
  return t
}

/**
 * SI3: a planned block is on, no timer runs, and you've been on video or a
 * game for 3+ minutes: back to it? Once per block (the id). CTF/VM work
 * (SI11) never counts as drifting.
 */
export function blockDrift(o: { now: number; blocks: IslandBlock[]; running: boolean; spans: DoingSpan[]; minMin?: number }): { id: string; block: IslandBlock; left: number; minutes: number } | null {
  if (o.running) return null
  const b = workNow(o.blocks, o.now)
  if (!b || callNow(o.blocks, o.now)) return null
  const minutes = minutesBack(o.spans, DRIFT_KINDS, o.now)
  if (minutes < (o.minMin ?? 3)) return null
  const left = mins(b.end - o.now)
  if (left < 5) return null
  return { id: `back:${blockKey(b)}`, block: b, left, minutes: Math.round(minutes) }
}

const WORKISH = ['coding', 'study', 'writing', 'ctf']
/**
 * SI10: plan vs reality for a block that ended: "You were coding 38 of 45 min".
 * The kind you spent most of it on; null when nothing was seen.
 */
export function blockReality(spans: DoingSpan[], b: { start: number; end: number }): { kind: string; minutes: number; of: number; workMin: number } | null {
  const of = Math.round((b.end - b.start) / 60000)
  const by: Record<string, number> = {}
  for (const s of spans) {
    const a = Math.max(b.start, s.start)
    const z = Math.min(b.end, s.end)
    if (z > a) by[s.context] = (by[s.context] ?? 0) + (z - a) / 60000
  }
  const top = Object.entries(by).filter(([k]) => k !== 'idle').sort((x, y) => y[1] - x[1])[0]
  if (!top || of <= 0) return null
  const workMin = Math.round(Object.entries(by).filter(([k]) => WORKISH.includes(k)).reduce((t, [, v]) => t + v, 0))
  return { kind: top[0], minutes: Math.round(top[1]), of, workMin }
}

/** "You were coding 38 of 45 min." */
export function realityLine(r: ReturnType<typeof blockReality>): string {
  if (!r) return ''
  const verb: Record<string, string> = { coding: 'coding', study: 'studying', writing: 'writing', ctf: 'on CTF/lab work', video: 'on video', gaming: 'gaming', social: 'on chat & social', email: 'in email', browsing: 'browsing', meeting: 'in a meeting', money: 'banking', other: 'on other things' }
  return `You were ${verb[r.kind] ?? r.kind} ${Math.min(r.minutes, r.of)} of ${r.of} min.`
}
