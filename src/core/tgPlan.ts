// TV1: today's plan on Telegram with buttons (pure, tested). Under the plan:
// one row per block (−30 · +30 · ✓ Done · Skip), then Approve · Shift to now ·
// Change. A tap edits through the same paths as the app (a move is Ben's own
// "move: B1 | …" action, done/skip are the Today timeline's marks), shows a
// receipt line on the plan and an ↩ Undo button.

import { fromMin, toMin, type DayProposal } from './rhythm'
import { applyEdit, ensureIds, planItems, snapshotOf } from './planEdit'

/** Callback data: "pb|m|<i>|<±minutes>", "pb|d|<i>", "pb|s|<i>", "pb|n" (shift to now), "pb|a" (approve), "pb|u|<i>" (undo a mark). */
export type PlanTap = { op: 'move'; i: number; delta: number } | { op: 'done'; i: number } | { op: 'skip'; i: number } | { op: 'now' } | { op: 'approve' } | { op: 'undo'; i: number }

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

/**
 * The keyboard under the plan. Up to 5 blocks get a row; a marked block shows
 * its mark and an Undo. Approved plans don't show Approve again.
 */
export function planKeyboard(p: Pick<DayProposal, 'blocks'>, opts: { approved?: boolean; marks?: Record<number, Mark>; late?: boolean } = {}): { inline_keyboard: { text: string; callback_data: string }[][] } {
  const rows: { text: string; callback_data: string }[][] = []
  p.blocks.slice(0, 5).forEach((b, i) => {
    const mark = opts.marks?.[i]
    if (mark) {
      rows.push([{ text: `${mark === 'done' ? '✅' : '⏭'} ${b.start} ${short(b.title, 18)}`, callback_data: `pb|u|${i}` }, { text: '↩ Undo', callback_data: `pb|u|${i}` }])
      return
    }
    // A pinned block can't move (the app's rule): its row says so instead of −30 / +30.
    if (b.locked) {
      rows.push([{ text: `📌 ${b.start} ${short(b.title, 16)}`, callback_data: `pb|m|${i}|30` }, { text: '✓ Done', callback_data: `pb|d|${i}` }, { text: 'Skip', callback_data: `pb|s|${i}` }])
      return
    }
    rows.push([
      { text: `${b.start} −30`, callback_data: `pb|m|${i}|-30` },
      { text: '+30', callback_data: `pb|m|${i}|30` },
      { text: '✓ Done', callback_data: `pb|d|${i}` },
      { text: 'Skip', callback_data: `pb|s|${i}` }
    ])
  })
  const last = [...(opts.approved ? [] : [{ text: '✅ Approve', callback_data: 'rb|a' }]), { text: opts.late ? '⏩ Shift to now' : '⏩ Start from now', callback_data: 'pb|n' }, { text: '✏️ Change', callback_data: 'rb|e' }]
  rows.push(last)
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
