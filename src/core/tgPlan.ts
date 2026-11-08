// TV1: today's plan on Telegram with buttons (pure, tested). Under the plan:
// one row per block (−30 · +30 · ✓ Done · Skip), then Approve · Shift to now ·
// Change. A tap edits through the same paths as the app (a move is Ben's own
// "move: B1 | …" action, done/skip are the Today timeline's marks), shows a
// receipt line on the plan and an ↩ Undo button.

import { fromMin, toMin, type DayProposal, type PlanBlock } from './rhythm'
import { applyEdit, ensureIds, planItems, snapshotOf } from './planEdit'

/**
 * Callback data: "pb|m|<i>|<±minutes>", "pb|d|<i>", "pb|s|<i>", "pb|n" (shift to now), "pb|a" (approve),
 * "pb|u|<i>" (undo a mark), "pb|r" (re-plan from now), "pb|t" (too much today), "pb|w|<i>" (move the
 * block to tomorrow), "pb|z|<at>" (undo the last of those), "pb|c" (the end-of-day check).
 */
export type PlanTap =
  | { op: 'move'; i: number; delta: number }
  | { op: 'done'; i: number }
  | { op: 'skip'; i: number }
  | { op: 'now' }
  | { op: 'approve' }
  | { op: 'undo'; i: number }
  | { op: 'replan' }
  | { op: 'toomuch' }
  | { op: 'tomorrow'; i: number }
  | { op: 'back'; at: number }
  | { op: 'check' }

export const PLAN_TAP = /^pb\|/

export function readPlanTap(data: string): PlanTap | null {
  const p = String(data ?? '').split('|')
  if (p[0] !== 'pb') return null
  const i = Number(p[2])
  const okI = Number.isInteger(i) && i >= 0 && i < 12
  if (p[1] === 'm' && okI && /^-?\d{1,3}$/.test(p[3] ?? '')) {
    const delta = Number(p[3])
    return Math.abs(delta) <= 240 && delta % 5 === 0 && delta !== 0 ? { op: 'move', i, delta } : null
  }
  if (p[1] === 'd' && okI) return { op: 'done', i }
  if (p[1] === 's' && okI) return { op: 'skip', i }
  if (p[1] === 'u' && okI) return { op: 'undo', i }
  if (p[1] === 'w' && okI) return { op: 'tomorrow', i }
  if (p[1] === 'z' && /^[0-9a-z]{1,12}$/.test(p[2] ?? '')) return { op: 'back', at: parseInt(p[2], 36) }
  if (p[1] === 'r' && p.length === 2) return { op: 'replan' }
  if (p[1] === 't' && p.length === 2) return { op: 'toomuch' }
  if (p[1] === 'c' && p.length === 2) return { op: 'check' }
  if (p[1] === 'n' && p.length === 2) return { op: 'now' }
  if (p[1] === 'a' && p.length === 2) return { op: 'approve' }
  return null
}

export type Mark = 'done' | 'skip'

/** The id a block's done/skip mark is kept under (the calendar event's id when it has one). */
export const blockMarkId = (b: { start: string; title: string }, eventId?: string | null) => eventId || `plan:${b.start} ${b.title}`.slice(0, 120)

/** The new start for a ±minutes move, kept inside the day (05:00–23:30), or null when it can't move. */
export function movedStart(b: { start: string; minutes: number }, delta: number): string | null {
  const s = toMin(b.start) + delta
  if (s < 5 * 60 || s + b.minutes > 23 * 60 + 59) return null
  return fromMin(s)
}

/** What a pinned block answers on Telegram (the app's own rule: a pin never moves). */
export const PINNED_WORDS = '📌 pinned, unpin it in the app'

/**
 * A ±minutes tap checked against the plan-edit rules (core/planEdit.ts): a
 * pinned block refuses, a move off the day refuses, and the block's id (the
 * one the app, Google and Todoist sync by) comes back with the new start.
 */
export function planMoveCheck(plan: DayProposal, i: number, delta: number): { ok: true; id: string; to: string } | { ok: false; why: string } {
  const p = ensureIds(plan)
  const b = p.blocks[i]
  if (!b?.id) return { ok: false, why: 'That block is gone' }
  if (b.locked) return { ok: false, why: PINNED_WORDS }
  const to = movedStart(b, delta)
  if (!to) return { ok: false, why: "Can't move it there" }
  const after = applyEdit(p, { op: 'move', id: b.id, start: to })
  if (after === p) return { ok: false, why: PINNED_WORDS }
  return { ok: true, id: b.id, to }
}

/**
 * The plan after a move the calendar already took (an approved block moved
 * through the chat's path): the block's new start, and its sync memory set to
 * the same time, so the app's sync sees nothing left to send (no second move,
 * no "not synced" mark).
 */
export function planAfterMove(plan: DayProposal, id: string, to: string, calendarMoved: boolean): DayProposal {
  const p = applyEdit(ensureIds(plan), { op: 'move', id, start: to })
  if (!calendarMoved) return p
  const b = planItems(p).find((x) => x.id === id)
  if (!b?.sync) return p
  return { ...p, blocks: p.blocks.map((x) => (x.id === id ? { ...x, sync: snapshotOf(x, x.sync) } : x)) }
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** A draft block (not pinned, not approved, not in the calendar): it can move to tomorrow. */
export const draftBlock = (b: Pick<PlanBlock, 'locked' | 'ok' | 'sync'>, approved?: boolean) => !approved && !b.locked && !b.ok && !b.sync?.eventId

/**
 * The keyboard under the plan, the same actions as the app's plan card: up to 5 blocks get a row
 * (−30 · +30 · ✓ Done · Skip, and ➡️ Tomorrow on a draft); a marked block shows its mark and an
 * Undo. Then Approve · Change, Re-plan from now · Too much today, and "Check the day" once the last
 * work block is over. `shown`: the block indexes to list (the deduped plan's), in order.
 */
export function planKeyboard(p: Pick<DayProposal, 'blocks'>, opts: { approved?: boolean; marks?: Record<number, Mark>; late?: boolean; shown?: number[]; check?: boolean } = {}): { inline_keyboard: { text: string; callback_data: string }[][] } {
  const rows: { text: string; callback_data: string }[][] = []
  const idx = (opts.shown ?? p.blocks.map((_b, i) => i)).filter((i) => i >= 0 && i < Math.min(12, p.blocks.length)).slice(0, 5)
  for (const i of idx) {
    const b = p.blocks[i]
    const mark = opts.marks?.[i]
    if (mark) {
      rows.push([{ text: `${mark === 'done' ? '✅' : '⏭'} ${b.start} ${short(b.title, 18)}`, callback_data: `pb|u|${i}` }, { text: '↩ Undo', callback_data: `pb|u|${i}` }])
      continue
    }
    // A pinned block can't move (the app's rule): its row says so instead of −30 / +30.
    if (b.locked) {
      rows.push([{ text: `📌 ${b.start} ${short(b.title, 16)}`, callback_data: `pb|m|${i}|30` }, { text: '✓ Done', callback_data: `pb|d|${i}` }, { text: 'Skip', callback_data: `pb|s|${i}` }])
      continue
    }
    rows.push([
      { text: `${b.start} −30`, callback_data: `pb|m|${i}|-30` },
      { text: '+30', callback_data: `pb|m|${i}|30` },
      { text: '✓ Done', callback_data: `pb|d|${i}` },
      { text: 'Skip', callback_data: `pb|s|${i}` },
      ...(draftBlock(b, opts.approved) ? [{ text: '➡️ Tmrw', callback_data: `pb|w|${i}` }] : [])
    ])
  }
  rows.push([...(opts.approved ? [] : [{ text: '✅ Approve', callback_data: 'rb|a' }]), ...(opts.late ? [{ text: '⏩ Shift to now', callback_data: 'pb|n' }] : []), { text: '✏️ Change', callback_data: 'rb|e' }])
  rows.push([{ text: '🔄 Re-plan from now', callback_data: 'pb|r' }, { text: '📦 Too much today', callback_data: 'pb|t' }])
  if (opts.check) rows.push([{ text: '✓ Check the day', callback_data: 'pb|c' }])
  return { inline_keyboard: rows }
}

/** The receipt line added under the plan after a tap. */
export function receiptLine(t: PlanTap, b?: { start: string; title: string } | null, extra?: string): string {
  const name = b ? `${b.title} (${b.start})` : 'the block'
  if (t.op === 'move') return `↪️ Moved ${name} by ${t.delta > 0 ? '+' : ''}${t.delta} min${extra ? `: ${extra}` : ''}`
  if (t.op === 'done') return `✅ Done: ${name}`
  if (t.op === 'skip') return `⏭ Skipped: ${name}`
  if (t.op === 'undo') return `↩ Undone: ${name}`
  if (t.op === 'now') return extra ? `⏩ ${extra}` : '⏩ The plan now starts from now'
  if (t.op === 'tomorrow') return `➡️ ${extra ?? `Moved ${name} to tomorrow`}`
  if (t.op === 'replan' || t.op === 'toomuch' || t.op === 'back' || t.op === 'check') return extra ?? ''
  return extra ?? '✅ Approved'
}

/** Keeps only the last 3 receipt lines on the message (it stays short). */
export function withReceipt(text: string, line: string): string {
  const parts = String(text ?? '').split('\n')
  const marker = parts.findIndex((l) => l === '— — —')
  const body = marker >= 0 ? parts.slice(0, marker) : parts
  const old = marker >= 0 ? parts.slice(marker + 1) : []
  return [...body, '— — —', ...[...old, line].slice(-3)].join('\n')
}

/** Telegram's limit is 64 bytes of callback data: all of ours fit. */
export const fitsCallback = (s: string) => new TextEncoder().encode(s).length <= 64
