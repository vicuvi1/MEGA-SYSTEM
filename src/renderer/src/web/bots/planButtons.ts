// TV1: the buttons under today's plan on Telegram (pb|…): move a block ±30 min,
// Done, Skip, Shift to now, Undo. Every edit goes through the app's own paths:
// - a waiting plan's block moves with Ben's own "move: B1 | …" action (undo,
//   the coach log, the receipt), an approved plan's calendar block with the
//   same "move <block> to HH:MM" the chat understands;
// - Done / Skip are the Today timeline's marks (block_marks), shown everywhere;
// - Shift to now is rhythm.shift() (the plan card's "Shift the plan?").
// The plan message is redrawn with a receipt line and fresh buttons.
import { calendarDay } from '@core/dates'
import { proposalText, RHYTHM, rhythmFor, type DayProposal } from '@core/rhythm'
import { blockMarkId, movedStart, planKeyboard, readPlanTap, receiptLine, withReceipt, type Mark } from '@core/tgPlan'
import { applyMark } from '@core/blockKind'
import { lateBlocks } from '@core/planShift'
import { readSetting, writeSetting } from '../../../../main/settings'
import { esc, tg } from './telegram'
import type { BotContext, Tap } from './context'

type Marks = Record<string, Record<string, Mark>>

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
export async function planMessage(c: BotContext, receipt?: string): Promise<{ text: string; keyboard: ReturnType<typeof planKeyboard> } | null> {
  const st = await c.rhythm.state().catch(() => null)
  const b = st?.state.briefing
  if (!b) return null
  const marks = await c.mirror.read((db) => readSetting(db as any, 'block_marks') as Marks | null).catch(() => null)
  const late = lateBlocks(b.plan, new Date().toTimeString().slice(0, 5)).length > 0
  const base = proposalText(b.plan, { version: b.version, approved: b.status === 'approved' })
  return { text: receipt ? withReceipt(base, esc(receipt)) : base, keyboard: planKeyboard(b.plan, { approved: b.status === 'approved', marks: blockMarks(marks ?? {}, b.plan), late }) }
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
  } else {
    const blk = p.blocks[tap.i]
    if (!blk) {
      await t.answer('That block is gone: here is the plan as it is now')
    } else if (tap.op === 'move') {
      const to = movedStart(blk, tap.delta)
      if (!to) {
        await t.answer("Can't move it there")
        return null
      }
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
      // An approved plan keeps its own copy of the times in step with the calendar.
      if (b.status === 'approved' && ok.length)
        await c.mirror
          .write((db) => {
            const cur = rhythmFor(readSetting(db as any, RHYTHM), p.day)
            const bb = cur.briefing?.plan.blocks[tap.i]
            if (!cur.briefing || !bb || bb.title !== blk.title) return
            const blocks = cur.briefing.plan.blocks.map((x, k) => (k === tap.i ? { ...x, start: to } : x)).sort((a, z) => a.start.localeCompare(z.start))
            writeSetting(db as any, RHYTHM, { ...cur, briefing: { ...cur.briefing, plan: { ...cur.briefing.plan, blocks } } } as any)
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
