// The coach on Telegram (core/coachTalk.ts, coach/coachTalkStore.ts):
// - the evening check-in's taps: ck|e|<energy> → ck|s|<e><soreness> →
//   ck|h|<e><s>|<half hours or x>, then the coach's 1–2 sentence reply
//   (rules; the AI only rephrases it; the rule text when the AI fails);
// - a proposal's buttons: cp|a|<id> Apply · cp|n|<id> Not now · cp|u|<id> Undo.
// Only the owner's chats reach these (the usual check runs first).
import { ckAsk, ckKeyboard, checkinPrompt, cleanSleep, coachKey, parseCheckinAi, readCkTap, type CheckinReply } from '@core/coachTalk'
import { answerPushIn } from '../benPushStore'
import { answerProposal, checkinView, replyFor, saveCheckin } from '../../coach/coachTalkStore'
import { esc } from './telegram'
import type { CallbackHandler } from './callbacks'

const head = (lang: 'en' | 'ro') => `📝 <b>${lang === 'ro' ? 'Check-in de seară' : 'Evening check-in'}</b>`

export const COACH_CALLBACK: CallbackHandler = {
  prefixes: ['ck', 'cp'],
  match: (data) => data.startsWith('ck|') || data.startsWith('cp|'),
  run: async (c, t) => {
    const { mirror, services, markSeen } = c
    const { data, key, answer, edit } = t
    if (!(await markSeen(key))) return null
    const now = new Date()

    const prop = /^cp\|([anu])\|([\w-]{1,24})$/.exec(data)
    if (prop) {
      const op = prop[1] === 'a' ? 'apply' : prop[1] === 'n' ? 'skip' : 'undo'
      const r = await mirror.write((db) => answerProposal(db, prop[2], op, 'telegram', now.getTime()))
      await answer(r.line)
      const kb = r.ok && op === 'apply' ? { inline_keyboard: [[{ text: '↩ Undo', callback_data: `cp|u|${prop[2]}` }]] } : { inline_keyboard: [] }
      await edit(`${r.rec ? `💡 ${esc(r.rec.text)}\n` : ''}${esc(r.line)}`, kb)
      return r.line
    }

    const tap = readCkTap(data)
    if (!tap) return null
    const view = await mirror.read((db) => checkinView(db, services.services(db), now))
    const lang = view.facts.lang
    const lines = view.lines.map(esc).join('\n')
    if (view.done) {
      await answer(lang === 'ro' ? 'Ai făcut deja check-in azi' : 'Already checked in today')
      await edit(`${head(lang)}\n${lines}\n\n💬 ${esc(view.done.reply)}`, { inline_keyboard: [] })
      return 'already'
    }
    const ro = lang === 'ro'
    const so = (e: number, s?: number) => `${ro ? 'Energie' : 'Energy'} ${e}/5${s ? ` · ${ro ? 'Febră' : 'Soreness'} ${s}/5` : ''}`
    if (tap.step === 'e' || tap.step === 's') {
      await answer('👍')
      await edit(`${head(lang)}\n${lines}\n\n${so(tap.energy, tap.step === 's' ? tap.soreness : undefined)}\n${esc(ckAsk(tap, lang))}`, ckKeyboard(tap, view.facts.sleepH, lang))
      return tap.step
    }
    const taps = { energy: tap.energy, soreness: tap.soreness, sleep: tap.sleep ?? cleanSleep(view.facts.sleepH) }
    const ai = c.coachAi
    const phrase = ai ? async (r: CheckinReply) => parseCheckinAi(await ai(checkinPrompt(r, lang)), r) : null
    const reply = await replyFor(view.facts, taps, phrase)
    await mirror.write((db) => {
      saveCheckin(db, view.facts.date, taps, reply.text, now.getTime())
      answerPushIn(db, services.services(db).wallet.today(now), coachKey('checkin', services.services(db).wallet.today(now)), 'ok', now.getTime())
    })
    await answer(ro ? 'Salvat' : 'Saved')
    await edit(`${head(lang)}\n${lines}\n\n${so(taps.energy, taps.soreness)}${taps.sleep != null ? ` · ${ro ? 'Somn' : 'Sleep'} ${taps.sleep} h` : ''}\n\n💬 ${esc(reply.text)}`, { inline_keyboard: [] })
    return reply.text
  }
}
