// Ben on your career (server tick): at most one career message a tick, each
// at most once a day (and inside his daily cap and quiet hours, which `send`
// keeps). In this order:
//  1. the monthly career letter, in the first week of a month (CR20);
//  2. "pay yourself first" for a new income (CR5);
//  3. a job follow-up that's due (CR1);
//  4. an essay you've fallen behind on, with Replan (CR12);
//  5. a study pack during tonight's shift, once it has started (CR3).
import type { Mirror } from '../renderer/src/web/mirror'
import { getSetting, setSetting } from '../main/settings'
import { CAREER_ASKS, careerView, writeLetter } from '../renderer/src/web/career'
import { financeStateFrom } from '../renderer/src/web/botBrain'
import { followKeyboard, packKeyboard, payKeyboard } from '../renderer/src/web/bots/careerBot'
import { letterText } from '@core/career/letter'
import { packText } from '@core/career/studyPack'
import { behindFlags } from '@core/career/essays'

type Send = (text: string, markup?: unknown) => Promise<unknown>

export interface CareerAsks {
  day: string
  sent: string[]
}

export function cleanAsks(raw: any, today: string): CareerAsks {
  return raw && raw.day === today && Array.isArray(raw.sent) ? { day: today, sent: raw.sent.filter((x: unknown) => typeof x === 'string').slice(-50) } : { day: today, sent: [] }
}

const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

/** What to send now, if anything (pure on the view; tested). */
export function pickCareerPing(v: ReturnType<typeof careerView>, asks: CareerAsks, nowMin: number): { key: string; kind: 'letter' | 'pay' | 'follow' | 'essay' | 'pack'; id?: string } | null {
  const hour = Math.floor(nowMin / 60)
  const sent = new Set(asks.sent)
  if (v.letterDue && hour >= 10 && hour < 20 && !sent.has(`letter:${v.letterDue}`)) return { key: `letter:${v.letterDue}`, kind: 'letter' }
  const pay = v.money.asks[0]
  if (pay && hour >= 10 && hour < 21 && !sent.has(`pay:${pay.txId}`)) return { key: `pay:${pay.txId}`, kind: 'pay', id: pay.txId }
  const job = v.followUps.find((j) => !sent.has(`fu:${j.id}`))
  if (job && hour >= 10 && hour < 20) return { key: `fu:${job.id}`, kind: 'follow', id: job.id }
  const behind = v.study.essays.find((e) => e.status.state === 'behind')
  if (behind && hour >= 11 && hour < 21 && !sent.has('essay')) return { key: 'essay', kind: 'essay', id: behind.essay.id }
  const sh = v.study.shift
  if (sh && sh.now && sh.mode !== 'off' && nowMin >= toMin(sh.from) + 30 && !sent.has('pack')) return { key: 'pack', kind: 'pack' }
  return null
}

export async function careerTick(mirror: Mirror, services: any, now: Date, nowMin: number, send: Send, esc: (s: string) => string): Promise<string | null> {
  const plan = await mirror.read((db) => {
    const s = services.services(db)
    const today = s.wallet.today(now)
    let raw: any = null
    try {
      raw = JSON.parse(getSetting(db as any, CAREER_ASKS) || 'null')
    } catch {
      raw = null
    }
    const asks = cleanAsks(raw, today)
    const v = careerView(s, financeStateFrom(db, null), now)
    const ping = pickCareerPing(v, asks, nowMin)
    return ping ? { asks, ping, v, today } : null
  })
  if (!plan) return null
  const { ping, v, today } = plan
  // Asked once a day, even when quiet hours or the day's budget put it in the bell instead.
  await mirror.write((db) => {
    const cur = cleanAsks((() => {
      try {
        return JSON.parse(getSetting(db as any, CAREER_ASKS) || 'null')
      } catch {
        return null
      }
    })(), today)
    setSetting(db as any, CAREER_ASKS, JSON.stringify({ day: today, sent: [...cur.sent, ping.key] }))
  })
  try {
    if (ping.kind === 'letter') {
      const l = await mirror.write((db) => writeLetter(db, financeStateFrom(db, null), v.letterDue!, today))
      await send(esc(letterText(l)))
    } else if (ping.kind === 'pay') {
      const a = v.money.asks.find((x) => x.txId === ping.id)!
      await send(esc(`💰 ${a.income.toLocaleString('en-US')} lei came in (${a.note}). Pay yourself first: move ${v.money.plan.payPct}% (${a.ask.toLocaleString('en-US')} lei) to savings before anything else?${v.money.streak.now ? ` You're on ${v.money.streak.now} in a row.` : ''}`), payKeyboard(a.txId, a.ask))
    } else if (ping.kind === 'follow') {
      const j = v.followUps.find((x) => x.id === ping.id)!
      const what = j.stage === 'interview' ? 'a thank-you and a short follow-up after the interview' : j.stage === 'offer' ? 'an answer to the offer' : 'a short follow-up on your application'
      await send(esc(`📨 ${j.company} · ${j.role}: time for ${what}. Two lines is enough.`), followKeyboard(j.id))
    } else if (ping.kind === 'essay') {
      const flag = behindFlags(v.study.essays.map((x) => x.essay), today)[0]
      await send(esc(`✍️ Heads up, you're behind: ${flag}. Do the next step today, or let me replan it from today.`), { inline_keyboard: [[{ text: '🗓 Replan from today', callback_data: `cr|e|${ping.id}` }]] })
    } else {
      const p = v.study.pack
      await send(esc(`${packText(p)}\n\nFor the quiet bits of the shift. It counts as focus time.`), packKeyboard(p))
    }
  } catch {
    /* Telegram hiccup: it waits on the Career page */
  }
  return ping.key
}
