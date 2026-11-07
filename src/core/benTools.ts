// TL1: the tools Ben was missing (pure parts; tested in benTools.test.ts).
// Audit of what Ben can do in the app from a chat (web and Telegram):
// - water, reps and sets, money, sleep: "water:", "reps:", "sets:", "log:", "sleep:" (botBrain.ts)
// - start / stop / extend focus: "focus:", "stop", "extend:"
// - discipline check-in and oath (honest rules): "habit: clean" / "habit: oath"
// - goals: new goal drafts and check-ins ("newgoal", "goalcheck" in goalsBrain.ts), "aim:" notes
// - notebook: "note: <title> | <line>"
// - rewards: add one ("reward:")
// Missing until now, added here:
// - buying (claiming) a reward from the shop: "buy: <reward>": only when his
//   own message asks to buy / claim / redeem it, through the shop's own rules
//   (price, limits, fun budget), with Undo;
// - ticking one of his own habits (Today → habits): "myhabit: <name>": only
//   when his message says he did it; pays the habit rule once a day, with Undo.

import { similarity } from './benNormalize'

export type ToolAction = { kind: 'buy'; title: string } | { kind: 'myhabit'; name: string }

/** "buy: Movie night" / "myhabit: Read 10 pages" → the action, or null. */
export function readToolAction(line: string): ToolAction | null {
  const m = /^\s*(buy|claim|redeem|myhabit|habitdone)\s*:\s*(.{2,80}?)\s*$/i.exec(String(line ?? ''))
  if (!m) return null
  const v = m[2].replace(/^["']|["']$/g, '').trim()
  if (!v) return null
  return /^(myhabit|habitdone)$/i.test(m[1]) ? { kind: 'myhabit', name: v } : { kind: 'buy', title: v }
}

export const TOOL_HELP = `- "buy: <reward title>" buys a reward from his shop with points (the shop's own price, limits and fun budget apply). ONLY when he asks to buy, claim or redeem it.
- "myhabit: <habit name>" ticks one of HIS OWN habits (Today → habits) for today. ONLY when he says he did it.`

/** The best match by name (typos allowed), or null when nothing fits well. */
export function pickByName<T>(want: string, items: T[], name: (t: T) => string, min = 0.7): T | null {
  let top: { t: T; s: number } | null = null
  for (const t of items) {
    const s = similarity(want, name(t))
    if (s >= min && (!top || s > top.s)) top = { t, s }
  }
  return top?.t ?? null
}

/** Did his own words ask to buy / claim this? */
export function askedToBuy(text: string): boolean {
  return /\b(buy|claim|redeem|purchase|get me|treat myself|spend (?:my )?points)\b|cumpar|cumpăr|revendic|куп(и|лю)|возьму/i.test(String(text ?? ''))
}

/** Did his own words say he did this habit (a word of its name, and "did/done" or the like)? */
export function saidHabit(text: string, habit: string): boolean {
  const t = String(text ?? '').toLowerCase()
  const words = (habit.toLowerCase().match(/\p{L}{3,}/gu) ?? []).map((w) => w.slice(0, 4))
  return words.some((w) => t.includes(w)) && /\b(did|done|finished|completed|ticked|checked|read|went|made|i)\b|am făcut|am facut|gata|сделал/i.test(t)
}
