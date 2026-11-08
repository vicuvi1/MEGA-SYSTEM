// Coach chat fix (2026-11-08): the chat in true time order, and one live plan card
// (pure, tested). The owner saw the morning's plan card drawn under the afternoon's
// questions, and a second plan card higher up. Rules:
// - messages are shown oldest first by their time; a reply never goes above the
//   question it answers (a server clock a little behind the page's), and the
//   answer being written stays last;
// - only ONE plan card is live: the newest message from today that carries one
//   (a reply with the plan card, or the morning plan message); every older one
//   shows as a one-line "Plan updated" instead.

export interface OrderEntry {
  role: 'me' | 'coach'
  at: string
  pending?: boolean
  proactive?: boolean
}

/** The log sorted oldest first (stable); a reply stays under its question; pending last. */
export function orderLog<T extends OrderEntry>(log: readonly T[]): T[] {
  let prevKey = -Infinity
  const keyed = log.map((e, i) => {
    const t = Date.parse(e.at)
    let key = Number.isFinite(t) ? t : prevKey
    // A reply written right after a question: never above it.
    const prev = log[i - 1]
    if (e.role === 'coach' && !e.proactive && prev?.role === 'me' && key < prevKey) key = prevKey
    prevKey = key
    return { e, i, key, pending: !!e.pending }
  })
  keyed.sort((a, b) => (a.pending !== b.pending ? (a.pending ? 1 : -1) : a.key !== b.key ? a.key - b.key : a.i - b.i))
  return keyed.map((x) => x.e)
}

/** True when the log is already in the order `orderLog` gives (nothing to do). */
export function inOrder<T extends OrderEntry>(log: readonly T[]): boolean {
  const o = orderLog(log)
  return o.every((e, i) => e === log[i])
}

/**
 * Which message carries the one live plan card: the newest from today (`dayStart`, ms)
 * for which `hasPlan` is true; -1 when none. Every other plan card settles.
 */
export function livePlanAt<T extends { at: string }>(log: readonly T[], dayStart: number, hasPlan: (e: T) => boolean): number {
  for (let k = log.length - 1; k >= 0; k--) {
    const e = log[k]
    if (Date.parse(e.at) < dayStart) break
    if (hasPlan(e)) return k
  }
  return -1
}
