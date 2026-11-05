// Ben learns your timing (pure): 👎 on his messages at the same time of the
// week become quiet rules ("no nudges 14–16 on Tue, Thu"); a 👍 there wins
// the slot back. Slots are 2 hours, per weekday, over the last 60 days.
export interface TimingFeedback { at: string; kind: string }
export interface QuietRule { days: number[]; fromH: number; toH: number; text: string }

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function quietRules(feedback: TimingFeedback[], now = new Date()): QuietRule[] {
  const since = now.getTime() - 60 * 86400000
  const score = new Map<string, number>()
  for (const f of feedback) {
    const t = new Date(f.at)
    if (!Number.isFinite(t.getTime()) || t.getTime() < since) continue
    const k = `${t.getDay()}:${Math.floor(t.getHours() / 2) * 2}`
    const v = f.kind === 'up' ? -1 : f.kind === 'down' ? 1 : 0
    if (v) score.set(k, (score.get(k) ?? 0) + v)
  }
  const bySlot = new Map<number, number[]>()
  for (const [k, v] of score) {
    if (v < 2) continue
    const [d, h] = k.split(':').map(Number)
    bySlot.set(h, [...(bySlot.get(h) ?? []), d].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)))
  }
  return [...bySlot.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([h, days]) => ({ days, fromH: h, toH: h + 2, text: `No nudges ${h}–${h + 2} on ${days.map((d) => DOW[d]).join(', ')}` }))
}

/** The rule that keeps Ben quiet now, if any. */
export const quietNow = (rules: QuietRule[], now = new Date()) => rules.find((r) => r.days.includes(now.getDay()) && now.getHours() >= r.fromH && now.getHours() < r.toH) ?? null
