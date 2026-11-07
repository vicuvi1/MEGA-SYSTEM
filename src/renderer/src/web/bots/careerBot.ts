// Career on Telegram (CR1, CR3, CR4, CR5, CR12, CR20): /quiz (flashcards as
// a quiz: the question, Show answer, then Again / Hard / Good / Easy), /pack
// (a study pack for a quiet moment at work, started as a focus timer), /jobs
// (the week's applications and follow-ups), and the buttons under Ben's
// career messages ("cr|…"). Each tap counts once (bot_seen_updates).
import { GRADE_LABEL, GRADES, ivlText, nextIvl, type Card, type Grade } from '@core/career/srs'
import { followedUp, followUpsDue, jobsLine, snoozeFollowUp } from '@core/career/jobs'
import { PACK_SUBJECT, packText, type Pack } from '@core/career/studyPack'
import { letterText } from '@core/career/letter'
import { answerPay as answerPayIn } from '@core/career/money'
import { replan } from '@core/career/essays'
import type { Services } from '../webServices'
import { CAREER_MONEY, CAREER_STUDY, careerView, gradeCard, loadCards, loadJobs, loadLetters, loadMoney, loadStudy, nextCard, saveJobs } from '../career'
import { financeStateFrom } from '../botBrain'
import { setSetting } from '../../../../main/settings'
import { esc } from './telegram'
import type { BotContext, Tap } from './context'
import type { CallbackHandler } from './callbacks'

type Kb = { inline_keyboard: { text: string; callback_data: string }[][] }

/** The question side of a card, with Show answer. */
export function quizQuestion(c: Card, left: number): { text: string; keyboard: Kb } {
  return { text: `🃏 <b>${esc(c.front)}</b>\n<i>${esc(c.deck)} · ${left} to go today</i>`, keyboard: { inline_keyboard: [[{ text: '👀 Show answer', callback_data: `cr|a|${c.id}` }]] } }
}

/** The answer side, with the four grades and when each brings it back. */
export function quizAnswer(c: Card, today: string): { text: string; keyboard: Kb } {
  return {
    text: `🃏 <b>${esc(c.front)}</b>\n\n${esc(c.back)}\n\n<i>How well did you know it?</i>`,
    keyboard: { inline_keyboard: [GRADES.map((g) => ({ text: `${GRADE_LABEL[g]} · ${ivlText(nextIvl(c, g, today))}`, callback_data: `cr|g|${c.id}|${g[0]}` }))] }
  }
}

export function packKeyboard(p: Pack): Kb {
  return { inline_keyboard: [[{ text: `▶ Start ${p.minutes} min`, callback_data: `fo|${p.minutes}|${PACK_SUBJECT}` }, { text: '🃏 Quiz me', callback_data: 'cr|q' }]] }
}

const DONE = '🎉 No cards left for today. See you tomorrow.'

/** /quiz, /pack, /jobs (and "quiz me", "study pack"): null when the text is something else. */
export function runCareer(s: Services, text: string, finance: () => any): { reply: string; keyboard?: Kb } | null {
  const t = text.trim().toLowerCase().replace(/@\w+$/, '')
  const today = s.wallet.today()
  if (/^\/quiz$|^quiz me$|^flashcards?$/.test(t)) {
    const n = nextCard(s.db, today)
    if (!n) return { reply: DONE }
    const q = quizQuestion(n.card, n.left)
    return { reply: q.text, keyboard: q.keyboard }
  }
  if (/^\/pack$|^study pack$|^give me a (study )?pack$/.test(t)) {
    const v = careerView(s, finance())
    return { reply: esc(packText(v.study.pack)), keyboard: packKeyboard(v.study.pack) }
  }
  if (/^\/jobs$|^\/career$/.test(t)) {
    const b = loadJobs(s.db)
    const due = followUpsDue(b, today)
    const line = jobsLine(b, today) || 'No jobs on the board yet. Add them on the Career page.'
    return { reply: `💼 ${esc(line)}`, keyboard: due.length ? followKeyboard(due[0].id) : undefined }
  }
  return null
}

export const followKeyboard = (id: string): Kb => ({ inline_keyboard: [[{ text: '✅ Followed up', callback_data: `cr|f|${id}` }, { text: '⏰ In 3 days', callback_data: `cr|z|${id}` }]] })
export const payKeyboard = (txId: string, ask: number): Kb => ({ inline_keyboard: [[{ text: `✅ Moved ${ask} lei`, callback_data: `cr|p|${txId}|${ask}`.slice(0, 64) }, { text: 'Not this time', callback_data: `cr|p|${txId}|0`.slice(0, 64) }]] })

const gradeOf = (x: string): Grade | null => GRADES.find((g) => g[0] === x) ?? null

/** The buttons under career messages. */
export const CAREER_CALLBACK: CallbackHandler = {
  prefixes: ['cr'],
  match: (data) => data.startsWith('cr|'),
  run: async (c: BotContext, t: Tap) => {
    const { mirror, services, markSeen } = c
    const { data, key, answer, edit, cq } = t
    const [, op, a, b] = data.split('|')
    // Show answer / next question only read; grades and answers change data and count once.
    if (op !== 'a' && op !== 'q' && op !== 'l' && !(await markSeen(key))) return null
    const res = await mirror.write((db) => {
      const s = services.services(db)
      const today = s.wallet.today()
      if (op === 'q') {
        const n = nextCard(db, today)
        return n ? { ...quizQuestion(n.card, n.left), toast: '' } : { text: DONE, keyboard: undefined, toast: 'All done' }
      }
      if (op === 'a') {
        const card = loadCards(db).cards.find((x) => x.id === a)
        return card ? { ...quizAnswer(card, today), toast: '' } : { text: 'That card is gone.', keyboard: undefined, toast: 'Gone' }
      }
      if (op === 'g') {
        const g = gradeOf(b ?? '')
        const done = g ? gradeCard(db, a, g, today) : null
        if (!done) return { text: 'That card is gone.', keyboard: undefined, toast: 'Gone' }
        const n = nextCard(db, today, [a])
        const head = `✓ ${GRADE_LABEL[g!]} · back in ${ivlText(done.ivl)}`
        if (!n) return { text: `${esc(head)}\n\n${DONE}`, keyboard: undefined, toast: head }
        const q = quizQuestion(n.card, n.left)
        return { text: `<i>${esc(head)}</i>\n\n${q.text}`, keyboard: q.keyboard, toast: head }
      }
      if (op === 'f' || op === 'z') {
        const book = loadJobs(db)
        const job = book.jobs.find((j) => j.id === a)
        if (!job) return { text: `${esc(String(cq.message?.text ?? ''))}\n\nThat job is gone.`, keyboard: undefined, toast: 'Gone' }
        saveJobs(db, op === 'f' ? followedUp(book, a, today) : snoozeFollowUp(book, a, today, 3))
        const line = op === 'f' ? `✅ Followed up with ${job.company}. Good.` : `⏰ I'll ask again about ${job.company} in 3 days.`
        return { text: `${esc(String(cq.message?.text ?? ''))}\n\n${esc(line)}`, keyboard: undefined, toast: op === 'f' ? 'Noted' : 'Later' }
      }
      if (op === 'p') {
        const moved = Math.max(0, Math.round(Number(b) || 0))
        const fin = financeStateFrom(db, typeof localStorage !== 'undefined' ? localStorage : null)
        const tx = (Array.isArray(fin?.tx) ? fin.tx : []).find((x: any) => String(x.id) === a)
        const m = loadMoney(db)
        setSetting(db as any, CAREER_MONEY, JSON.stringify({ ...m, answers: answerPayIn(m.answers, { txId: a, day: String(tx?.date ?? today).slice(0, 10) }, moved, today) }))
        const line = moved ? `💪 ${moved} lei to savings first. That's how the safety net grows.` : 'OK, not this time. Next income, we try again.'
        return { text: `${esc(String(cq.message?.text ?? ''))}\n\n${esc(line)}`, keyboard: undefined, toast: moved ? 'Saved first' : 'Noted' }
      }
      if (op === 'e') {
        const st = loadStudy(db)
        const e = st.essays.find((x) => x.id === a)
        if (!e) return { text: 'That assignment is gone.', keyboard: undefined, toast: 'Gone' }
        setSetting(db as any, CAREER_STUDY, JSON.stringify({ ...st, essays: st.essays.map((x) => (x.id === a ? replan(x, today) : x)) }))
        return { text: `${esc(String(cq.message?.text ?? ''))}\n\n🗓 Replanned "${esc(e.title)}" from today. Check the Career page for the new days.`, keyboard: undefined, toast: 'Replanned' }
      }
      if (op === 'l') {
        const l = loadLetters(db)[0]
        return { text: l ? esc(letterText(l)) : 'No letter yet.', keyboard: undefined, toast: '' }
      }
      return null
    })
    if (!res) return null
    if (res.toast) await answer(res.toast.slice(0, 190))
    else await answer('')
    await edit(res.text, res.keyboard)
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('life-career-changed'))
    return res.text
  }
}

