// DX7 on Telegram: after "10 min later" or "Skip" on a block check-in, Ben
// asks what's in the way (tired / unclear / too big / boring / scared) with
// one tap each ("sl|<r>|<block>"), and each reason gets its fix right away:
// a short timer button (the bot's own "fo|<min>|<subject>" start), or the
// break-down for "too big" (Ben's own "break down …" path, with Undo). The
// reason is saved in the focus log; tired / boring also on Ben's desk.
// Only your own chat reaches here (the bots obey only your chat ids).
import { readSetting, writeSetting } from '../../../../main/settings'
import { BOOST_KEY, BOOST_LOG_KEY, cleanBoost, cleanBoostLog } from '@core/focusBoost'
import { addStall, excuseWords, readStallCallback, stallFix, stallKeyboard, STALL_REASONS } from '@core/stallFix'
import { noteExcuse } from '../benDesk'
import { esc, tg } from './telegram'
import type { BotContext, Tap } from './context'
import type { CallbackHandler } from './callbacks'

/** Is the stalling question on (Settings → Ben → Focus boost)? */
export async function stallOn(c: BotContext): Promise<boolean> {
  return c.mirror.read((db) => cleanBoost(readSetting(db as any, BOOST_KEY)).stall).catch(() => false)
}

/** "What's in the way?" with the five reasons, under a snoozed or skipped block. */
export async function askStall(c: BotContext, t: Tap, subject: string): Promise<void> {
  if (!(await stallOn(c))) return
  await tg(t.update.__token, 'sendMessage', { chat_id: t.chat, text: `What's in the way of <b>${esc(subject)}</b>? One tap, one fix.`, parse_mode: 'HTML', reply_markup: stallKeyboard(subject) }).catch(() => null)
}

export const STALL_CALLBACK: CallbackHandler = {
  prefixes: ['sl'],
  match: (data) => data.startsWith('sl|'),
  run: async (c, t) => {
    const r = readStallCallback(t.data)
    if (!r) return null
    if (!(await c.markSeen(t.key))) return null
    const now = new Date()
    const reward = await c.mirror
      .write((db) => {
        const log = cleanBoostLog(readSetting(db as any, BOOST_LOG_KEY))
        writeSetting(db as any, BOOST_LOG_KEY, { ...log, stalls: addStall(log.stalls, { at: now.toISOString(), reason: r.reason, subject: r.subject }) } as any)
        const words = excuseWords(r.reason, r.subject)
        if (words) noteExcuse(db, words, now.toISOString().slice(0, 10), now)
        try {
          return (c.services.services(db).shop.state?.().rewards ?? []).find((x: { pinned?: boolean; archived?: boolean; title: string }) => x.pinned && !x.archived)?.title ?? null
        } catch {
          return null
        }
      })
      .catch(() => null)
    const fix = stallFix(r.reason, r.subject, { reward })
    const label = STALL_REASONS.find((x) => x.id === r.reason)!
    await t.answer(`${label.icon} ${label.fix}`)
    await tg(t.update.__token, 'editMessageReplyMarkup', { chat_id: t.chat, message_id: t.cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => null)
    if (fix.action.kind === 'split') {
      const said = `break down ${fix.action.subject}`
      const res = await c.act(said, [], '', said).catch(() => ({ done: [] as string[] }))
      const text = `${label.icon} <b>${esc(fix.title)}</b>\n${esc(fix.text)}${res.done.length ? `\n${esc(res.done.slice(0, 6).join('\n'))}` : ''}`
      await tg(t.update.__token, 'sendMessage', { chat_id: t.chat, text, parse_mode: 'HTML' }).catch(() => null)
      return text
    }
    const a = fix.action
    const start = `fo|${a.minutes}|${a.subject}`.slice(0, 64)
    const text = `${label.icon} <b>${esc(fix.title)}</b>\n${esc(fix.text)}${fix.action && r.reason === 'boring' ? '\n🎵 Your boring-task music starts on the PC when the timer does (Music → mark a station “boring only”).' : ''}`
    await tg(t.update.__token, 'sendMessage', { chat_id: t.chat, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: fix.button, callback_data: start }]] } }).catch(() => null)
    return text
  }
}
