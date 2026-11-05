// The island's smarter moments (phase 1), pure and tested:
// - drift: a planned block is on, no timer runs and you've been away from
//   the PC for a while → "Algorithms · 25 min left · back to it?"
// - end-of-block check: a block just ended → "Did you finish it?"
// - call mode: a meeting/call in your calendar keeps the island quiet
// - focus guard: how much of a focus session you were really at the PC.
import type { IslandAlert, IslandBlock } from './islandModel'

/** Calendar titles that are calls or meetings (EN / RO / RU). */
export const CALL = /(?<![\p{L}\p{N}])(call|calls|meet|meeting|zoom|teams|google meet|interview|standup|stand-up|1:1|sync|apel|ședință|sedinta|întâlnire|intalnire|interviu|звонок|созвон|встреча)(?![\p{L}\p{N}])/iu
export const isCall = (title: string) => CALL.test(title)
/** A meeting: marked by its data (link, people) or named like one. */
const meeting = (b: IslandBlock) => !!b.call || isCall(b.title)

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
  return blocks.filter((b) => b.start <= now && now < b.end && !meeting(b)).sort((a, b) => a.end - a.start - (b.end - b.start))[0] ?? null
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
}

/** The smart alert to show now (end-of-block check first, then drift), or null. */
export function smartAlert(a: SmartInput): IslandAlert | null {
  const hidden = (id: string) => (a.dismissed[id] ?? 0) > a.now
  // A block ended in the last 20 minutes, and nothing else is on: did you finish it?
  if (!a.running && !callNow(a.blocks, a.now)) {
    const ended = a.blocks
      .filter((b) => !isCall(b.title) && b.end <= a.now && a.now - b.end <= 20 * 60_000 && b.end - b.start >= 15 * 60_000 && !a.answered[blockKey(b)])
      .sort((x, y) => y.end - x.end)[0]
    const id = ended && `end:${blockKey(ended)}`
    if (ended && id && !hidden(id))
      return {
        id,
        kind: 'end',
        title: 'Block finished',
        text: `Did you finish “${ended.title}”?`,
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
  return blocks.find((b) => !isCall(b.title) && b.start <= now && now - b.start <= 3 * 60_000 && now < b.end && !started[blockKey(b)]) ?? null
}
