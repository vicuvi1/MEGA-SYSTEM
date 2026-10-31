import { describe, expect, it } from 'vitest'
import { isSimpleLog, moneyContext, parseBrain, personaFor, readAction, updateMemory } from './botBrain'

describe('the coach brain (pure parts)', () => {
  it('short logs keep the fast path; questions and longer text go to the coach', () => {
    for (const t of ['taxi 45', 'coffee 35 maib', '30 pushups', '/today', '+500 salary']) expect(isSimpleLog(t)).toBe(true)
    for (const t of ['spent 120 on pizza with Leo and 30 taxi', 'what should I do tonight?', 'I am tired', 'exam on friday, I need 10 hours']) expect(isSimpleLog(t)).toBe(false)
  })

  it('reads the model answer, even with fences around it', () => {
    expect(parseBrain('```json\n{"reply":"Hi","actions":["log: pizza 120"],"remember":["exam 12 Nov"]}\n```')).toEqual({ reply: 'Hi', actions: ['log: pizza 120'], remember: ['exam 12 Nov'] })
    expect(parseBrain('just text')).toEqual({ reply: 'just text', actions: [], remember: [] })
  })

  it('only safe actions run', () => {
    expect(readAction('log: pizza 120')).toEqual({ kind: 'log', text: 'pizza 120' })
    expect(readAction('log: /wake 06:40')).toEqual({ kind: 'log', text: '/wake 06:40' })
    expect(readAction('log: /reset')).toBeNull()
    expect(readAction('focus: 50 math')).toEqual({ kind: 'focus', minutes: 50, subject: 'math' })
    expect(readAction('fun: 30 youtube')).toEqual({ kind: 'fun', minutes: 30, what: 'youtube' })
    expect(readAction('goal: DS exam | Data structures | 2026-11-12 | 12')).toEqual({ kind: 'goal', title: 'DS exam', subject: 'Data structures', deadline: '2026-11-12', hours: 12 })
    expect(readAction('goal: no date | x | soon | 3')).toBeNull()
    expect(readAction('delete everything')).toBeNull()
  })

  it('remembers new facts once and keeps the last messages', () => {
    let m = updateMemory({ facts: [], chat: [] }, { facts: ['Exam on 12 Nov', 'Wants to wake at 7'] })
    m = updateMemory(m, { facts: ['exam on 12 nov'], turns: [{ role: 'me', bot: 'mega', text: 'hi', at: 'x' }] })
    expect(m.facts.map((f) => f.t)).toEqual(['Wants to wake at 7', 'exam on 12 nov'])
    expect(m.chat).toHaveLength(1)
  })

  it('each bot is its coach', () => {
    const cfg: any = { megaBotToken: '1:a', financeBotToken: '2:b', manBotToken: '3:c', botToken: '4:d' }
    expect(['1', '2', '3', '4', '9'].map((id) => personaFor(id, cfg))).toEqual(['mega', 'finance', 'waky', 'sport', 'mega'])
  })

  it('the money picture: month, week, today, categories, the limit', () => {
    const state = {
      settings: { categories: [{ id: 'f', name: 'Food' }, { id: 't', name: 'Taxi' }], limit: { on: true, amount: 600000 } },
      tx: [
        { type: 'expense', date: '2026-10-31', amount: 12000, category: 'f', note: 'pizza' },
        { type: 'expense', date: '2026-10-29', amount: 3000, category: 't' },
        { type: 'income', date: '2026-10-01', amount: 900000 }
      ]
    }
    const t = moneyContext(state, '2026-10-31')
    expect(t).toContain('today 120 lei, last 7 days 150 lei, this month 150 lei')
    expect(t).toContain('Monthly limit 6,000 lei: 3% used, 5,850 lei left for 1 days')
    expect(t).toContain('Food 120 lei, Taxi 30 lei')
  })
})

describe('specialist coaches', () => {
  it('money coach: how often this week, and the month against the limit', async () => {
    const { moneyInsight } = await import('./botBrain')
    const state = {
      settings: { categories: [{ id: 'c', name: 'Coffee' }], limit: { on: true, amount: 600000 } },
      tx: [
        { type: 'expense', date: '2026-10-28', amount: 3500, category: 'c' },
        { type: 'expense', date: '2026-10-30', amount: 3500, category: 'c' },
        { type: 'expense', date: '2026-10-31', amount: 3500, category: 'c' }
      ]
    }
    expect(moneyInsight(state, { category: 'c', amount: 3500 }, '2026-10-31')).toBe('📊 3rd Coffee this week (105 lei) · 2% of the monthly limit, 5,895 lei/day left for 1 days')
    expect(moneyInsight(state, { category: 'c', amount: 1, type: 'income' }, '2026-10-31')).toBeNull()
  })

  it('sleep coach: the weekdays that go wrong', async () => {
    const { wakePattern } = await import('./botBrain')
    const w = (day: string, onTime: boolean) => ({ day, onTime })
    expect(wakePattern([w('2026-10-26', false), w('2026-10-19', false), w('2026-10-12', true), w('2026-10-27', true), w('2026-10-20', true)])).toBe('Late most often on: Mon (2/3).')
    expect(wakePattern([w('2026-10-27', true)])).toBeNull()
  })
})
