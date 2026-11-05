// IN36: a recipe can show the move-break card (the safe action "moveCard").
// The recipe never logs anything: it only asks. You still tap what you
// really did (that goes through the normal move-break path), or "Not now".
//
// The hand-off is one small window event in the app window, so the move
// card's own code (the nudges, owned by islandNudges.ts / IslandNudgeCard
// when it is there) can listen to the same event and show its card instead.
import type { IslandAlert } from './islandModel'

/** Fired in the app window: `detail` is { why: string, at: number }. */
export const MOVE_CARD_EVENT = 'life-island-move-card'

/** How long an ask from a recipe stays on the island. */
export const MOVE_ASK_MS = 10 * 60_000

/** The move-break card a recipe asked for, while it is fresh and not answered. */
export function moveCardAlert(ask: { at: number; why: string } | null, now: number, dismissed: Record<string, number>): IslandAlert | null {
  if (!ask || now - ask.at > MOVE_ASK_MS || now < ask.at) return null
  const id = `move:recipe:${ask.at}`
  if ((dismissed[id] ?? 0) > now) return null
  return {
    id,
    kind: 'move',
    title: 'Time to move',
    text: `${ask.why ? `${ask.why}: ` : ''}a 2-minute break. Tap what you really did.`,
    face: '🏃',
    actions: [
      { label: '✓ 20 squats', action: { kind: 'moveBreak', name: 'Squats', n: 20, alertId: id }, primary: true },
      { label: '✓ 10 push-ups', action: { kind: 'moveBreak', name: 'Push-ups', n: 10, alertId: id } },
      { label: 'Not now', action: { kind: 'dismiss', id, snoozeMin: 60 } }
    ]
  }
}
