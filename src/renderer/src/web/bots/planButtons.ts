// TV1: the buttons under today's plan on Telegram (pb|…): move a block ±30 min,
// Done, Skip, Shift to now, Undo. Every edit goes through the app's own paths:
// - a waiting plan's block moves with Ben's own "move: B1 | …" action (undo,
//   the coach log, the receipt), an approved plan's calendar block with the
//   same "move <block> to HH:MM" the chat understands;
// - Done / Skip are the Today timeline's marks (block_marks), shown everywhere;
// - Shift to now is rhythm.shift() (the plan card's "Shift the plan?").
// The plan message is redrawn with a receipt line and fresh buttons.
// Telegram parity: the message is the app card's (core/tgPlanText.ts), and the
// card's own buttons work here too: Re-plan from now (rhythm.replanNow), Too
// much today and Move <block> to tomorrow (web/planShared.ts, with ↩ Undo),
// and "Check the day" (the end-of-day check as one message, pc|…).
import { calendarDay } from '@core/dates'
import { RHYTHM, rhythmFor, type DayProposal } from '@core/rhythm'
import { blockMarkId, planAfterMove, planKeyboard, planMoveCheck, readPlanTap, receiptLine, withReceipt, type Mark } from '@core/tgPlan'
import { readReviewData, reviewKeyboard, reviewText, shownBlocks, tgPlanText } from '@core/tgPlanText'
import { cleanReview, reviewOpen } from '@core/planReview'
import { cleanLimits, limitsFor, PLAN_LIMITS } from '@core/planLimits'
import { ensureIds } from '@core/planEdit'
import { applyMark } from '@core/blockKind'
import { lateBlocks } from '@core/planShift'
import type { AuditTask } from '@core/planAudit'
import type { CalEvent } from '@core/dayTime'
import { readSetting, writeSetting } from '../../../../main/settings'
import { blockTomorrowOn, markReviewOn, reviewNow, tooMuchOn, undoPlanChange, type PlanDeps } from '../planShared'
import { esc, tg } from './telegram'
import type { BotContext, Tap } from './context'

type Marks = Record<string, Record<string, Mark>>

/** The shared plan store's access, from the bot's own mirror, services and Todoist. */
export const planDeps = (c: Pick<BotContext, 'mirror' | 'services' | 'todoist'>): PlanDeps => ({
  read: (fn) => c.mirror.read((db) => fn(db, c.services.services(db))),
  write: (fn) => c.mirror.write((db) => fn(db, c.services.services(db))),
  todoist: c.todoist ? { update: c.todoist.update?.bind(c.todoist), close: (id: string) => c.todoist!.close(id) } : null
})

/** Today's calendar (empty without one, or when it doesn't answer). */
async function todayEvents(c: BotContext): Promise<CalEvent[]> {
  if (!c.calendar) return []
  const s = new Date()
  s.setHours(0, 0, 0, 0)
  return c.calendar.events(s.toISOString(), new Date(s.getTime() + 86400000).toISOString()).catch(() => [] as CalEvent[])
}
/** Today's open Todoist tasks (ids for moves, the why lines), or nothing. */
async function openTasks(c: BotContext): Promise<AuditTask[] | undefined> {
  const list = c.todoist ? await c.todoist.today().catch(() => null) : null
  return list?.map((t) => ({ id: t.id, content: t.content, priority: t.priority, due: t.due, dueTime: t.dueTime, project: t.project }))
}

/** The receipt with its own ↩ Undo under the plan message's chat. */
async function undoReceipt(t: Tap, line: string, at: number) {
  await tg(t.update.__token, 'sendMessage', { chat_id: t.chat, text: esc(line), parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '↩ Undo', callback_data: `pb|z|${at.toString(36)}` }]] } }).catch(() => null)
}

const hm = (iso: string) => new Date(iso).toTimeString().slice(0, 5)

/** The calendar event of an approved plan's block (same title and start), if the calendar has it. */
async function eventOf(c: BotContext, day: string, b: { title: string; start: string }): Promise<string | null> {
  if (!c.calendar) return null
  const s = new Date(`${day}T00:00:00`)
  const evs = await c.calendar.events(s.toISOString(), new Date(s.getTime() + 86400000).toISOString()).catch(() => [])
  return evs.find((e) => e.title === b.title && hm(e.start) === b.start)?.id ?? null
}

/** Marks of today's blocks, by block index, for the keyboard. */
export function blockMarks(all: Marks, p: DayProposal): Record<number, Mark> {
  const day = all[p.day] ?? {}
  const out: Record<number, Mark> = {}
  p.blocks.forEach((b, i) => {
    const m = day[blockMarkId(b)] ?? Object.entries(day).find(([k]) => k === `ev:${b.start} ${b.title}`)?.[1]
    if (m) out[i] = m
  })
  return out
}

/** The plan message (text + buttons) as it is now. */
export function planMessage(c: BotContext, receipt?: string): Promise<{ text: string; keyboard: ReturnType<typeof planKeyboard> } | null> {
  return planMessageOf(c, receipt)
}

/**
 * Today's plan message (the app card's text and buttons), read from the database: used for the
 * morning plan, "plan my day" on Telegram and after every tap, so all three look the same.
 */
export async function planMessageOf(c: Pick<BotContext, 'mirror' | 'services'>, receipt?: string): Promise<{ text: string; keyboard: ReturnType<typeof planKeyboard> } | null> {
  const facts = await c.mirror
    .read((db) => {
      const today = c.services.services(db).wallet.today() as string
      const b = rhythmFor(readSetting(db as any, RHYTHM), today).briefing
      return { b, marks: readSetting(db as any, 'block_marks') as Marks | null, review: readSetting(db as any, 'plan_review') as any, limits: b ? limitsFor(cleanLimits(readSetting(db as any, PLAN_LIMITS)), b.plan.day) : null, today }
    })
    .catch(() => null)
  const b = facts?.b
  if (!b) return null
  const plan = ensureIds(b.plan)
  const now = new Date().toTimeString().slice(0, 5)
  const late = lateBlocks(plan, now).length > 0
  const base = tgPlanText(plan, { version: b.version, approved: b.status === 'approved', review: facts?.review ? cleanReview(facts.review) : null, today: facts?.today, limits: facts?.limits })
  return { text: receipt ? withReceipt(base, esc(receipt)) : base, keyboard: planKeyboard(plan, { approved: b.status === 'approved', marks: blockMarks(facts?.marks ?? {}, plan), late, shown: shownBlocks(plan), check: reviewOpen(plan, now) }) }
}

/** The end-of-day check as one message (text and one row of buttons per block). */
export async function reviewMessage(c: BotContext): Promise<{ text: string; keyboard: ReturnType<typeof reviewKeyboard> }> {
  const r = await c.mirror.read((db) => reviewNow(db, c.services.services(db)))
  return { text: reviewText(r.rows, r.review, r.day), keyboard: reviewKeyboard(r.rows) }
}

/** A tap in the end-of-day check (pc|<outcome>|<block id>): saved like the app's check, the message redrawn. */
export async function runReviewTap(c: BotContext, t: Tap): Promise<string | null> {
  const r = readReviewData(t.data)
  if (!r) return null
  if (!(await c.markSeen(t.key))) return null
  const res = await markReviewOn(planDeps(c), r.id, r.outcome)
  await t.answer(res.line.slice(0, 190))
  const msg = await reviewMessage(c)
  await t.edit(msg.text, msg.keyboard)
  return res.line
}

export async function runPlanTap(c: BotContext, t: Tap): Promise<string | null> {
  const tap = readPlanTap(t.data)
  if (!tap) return null
  if (!(await c.markSeen(t.key))) return null
  const st = await c.rhythm.state().catch(() => null)
  const b = st?.state.briefing
  if (!b) {
    await t.answer('No plan for today yet')
    return null
  }
  const p = b.plan
  let receipt = ''
  if (tap.op === 'now') {
    await t.answer('Moving the plan…')
    const r = await c.rhythm.shift()
    receipt = receiptLine(tap, null, r.done[0]?.replace(/^⏩\s*/, '') ?? '')
  } else if (tap.op === 'approve') {
    await t.answer('Approving…')
    const r = await c.rhythm.approve()
    receipt = r.done.join(' · ') || 'Approved'
  } else if (tap.op === 'replan') {
    // The plan card's "Re-plan from now": done and pinned blocks stay, the rest packs from now.
    await t.answer('Re-planning from now…')
    const r = await c.rhythm.replanNow()
    receipt = r.done.join(' · ').replace(/^⏩\s*/, '') || 'Nothing to re-plan'
  } else if (tap.op === 'toomuch' || tap.op === 'tomorrow') {
    // "Too much today" / a draft block's "Move to tomorrow": the app's same rules, Todoist gets tomorrow, ↩ Undo.
    const blk = tap.op === 'tomorrow' ? ensureIds(p).blocks[tap.i] : null
    if (tap.op === 'tomorrow' && !blk?.id) {
      await t.answer('That block is gone: here is the plan as it is now')
    } else {
      await t.answer(tap.op === 'toomuch' ? 'Looking at what fits…' : 'Moving to tomorrow…')
      const tasks = await openTasks(c)
      const r = tap.op === 'toomuch' ? await tooMuchOn(planDeps(c), await todayEvents(c), tasks) : await blockTomorrowOn(planDeps(c), blk!.id!, tasks)
      receipt = r.line
      if (r.ok && r.at) await undoReceipt(t, `➡️ ${r.line}`, r.at)
    }
  } else if (tap.op === 'back') {
    await t.answer('Undoing…')
    const r = await undoPlanChange(planDeps(c), { at: tap.at })
    receipt = r.line
    if (!r.ok) {
      await t.answer(r.line)
      return null
    }
  } else if (tap.op === 'check') {
    await t.answer('The end-of-day check')
    const m = await reviewMessage(c)
    await tg(t.update.__token, 'sendMessage', { chat_id: t.chat, text: m.text, parse_mode: 'HTML', reply_markup: m.keyboard }).catch(() => null)
    return m.text
  } else {
    const blk = p.blocks[tap.i]
    if (!blk) {
      await t.answer('That block is gone: here is the plan as it is now')
    } else if (tap.op === 'move') {
      // Through the app's plan-edit rules: a pinned block refuses, the id is the one the app syncs by.
      const chk = planMoveCheck(p, tap.i, tap.delta)
      if (!chk.ok) {
        await t.answer(chk.why)
        return null
      }
      const to = chk.to
      await t.answer(`Moving to ${to}…`)
      // A waiting plan: Ben's own move action (with Undo). An approved one: its calendar block, the chat's way.
      const said = `move ${blk.title} to ${to}`
      const r =
        b.status === 'proposed'
          ? await c.act(said, [`move: B${tap.i + 1} | ${p.day} ${to}`], '↪️ Moved.')
          : await c.act(said, [], '', said)
      const ok = r.done.filter((d) => !d.startsWith('⚠️'))
      receipt = receiptLine(tap, blk, ok.length ? '' : r.done[0]?.replace(/^⚠️\s*/, '') || 'nothing changed')
      // The receipt with its own ↩ Undo (the same undo as Ben's replies).
      if (r.at && r.undo?.some(Boolean)) await tg(t.update.__token, 'sendMessage', { chat_id: t.chat, text: esc([receipt, ...r.done].join('\n')), parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '↩ Undo', callback_data: `cu|${Date.parse(r.at)}` }]] } }).catch(() => null)
      // An approved plan keeps its own copy in step: same id, pins kept, and the sync memory set to
      // what the calendar now holds, so the app's sync shows it as sent, not as a change waiting.
      if (b.status === 'approved' && ok.length)
        await c.mirror
          .write((db) => {
            const cur = rhythmFor(readSetting(db as any, RHYTHM), p.day)
            if (!cur.briefing) return
            const plan = ensureIds(cur.briefing.plan)
            const bb = plan.blocks.find((x) => x.id === chk.id) ?? plan.blocks.find((x) => x.title === blk.title)
            if (!bb?.id || bb.locked) return
            writeSetting(db as any, RHYTHM, { ...cur, briefing: { ...cur.briefing, plan: planAfterMove(plan, bb.id, to, true) } } as any)
          })
          .catch(() => null)
    } else {
      // Done / Skip / Undo: the Today timeline's own marks.
      const ev = b.status === 'approved' ? await eventOf(c, p.day, blk) : null
      const id = blockMarkId(blk, ev)
      const v: Mark | null = tap.op === 'done' ? 'done' : tap.op === 'skip' ? 'skip' : null
      await c.mirror.write((db) => {
        const all = (readSetting(db as any, 'block_marks') as Marks | null) ?? {}
        let next = applyMark(all, p.day, id, v)
        // The plan's own id too, so the buttons show it even when the event id was used.
        if (ev) next = applyMark(next, p.day, blockMarkId(blk), v)
        writeSetting(db as any, 'block_marks', next as any)
      })
      await t.answer(tap.op === 'done' ? '✅ Done' : tap.op === 'skip' ? 'Skipped' : 'Undone')
      receipt = receiptLine(tap, blk)
    }
  }
  const msg = await planMessage(c, receipt)
  if (msg) await t.edit(msg.text, msg.keyboard)
  return msg?.text ?? receipt
}

/** For tests: today's app day key. */
export const planDay = () => calendarDay()
