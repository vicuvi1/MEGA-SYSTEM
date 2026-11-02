import { describe, expect, it } from 'vitest'
import { isSimpleLog, moneyContext, parseBrain, personaFor, readAction, updateMemory } from './botBrain'

describe('the coach brain (pure parts)', () => {
  it('short logs keep the fast path; questions and longer text go to the coach', () => {
    for (const t of ['taxi 45', 'coffee 35 maib', '30 pushups', '/today', '+500 salary']) expect(isSimpleLog(t)).toBe(true)
    for (const t of ['spent 120 on pizza with Leo and 30 taxi', 'what should I do tonight?', 'I am tired', 'exam on friday, I need 10 hours']) expect(isSimpleLog(t)).toBe(false)
  })

  it('reads the model answer, even with fences around it', () => {
    expect(parseBrain('```json\n{"reply":"Hi","actions":["log: pizza 120"],"remember":["exam 12 Nov"]}\n```')).toMatchObject({ reply: 'Hi', actions: ['log: pizza 120'], remember: ['exam 12 Nov'], steps: [], need: [], chips: [], buttons: [], show: [] })
    expect(parseBrain('just text')).toEqual({ reply: 'just text', actions: [], remember: [] })
  })

  it('reads steps, lookups and the new calendar, Todoist and reminder actions', () => {
    expect(parseBrain('{"reply":"","need":["spending 2026-10-01 2026-10-31 food"],"steps":["Checked October"]}')).toMatchObject({ need: ['spending 2026-10-01 2026-10-31 food'], steps: ['Checked October'] })
    expect(readAction('move: e3 | 2026-11-01 15:00')).toEqual({ kind: 'move', ref: 'E3', day: '2026-11-01', time: '15:00' })
    expect(readAction('resize: E3 | 30')).toEqual({ kind: 'resize', ref: 'E3', minutes: 30 })
    expect(readAction('delete: E2')).toEqual({ kind: 'delevent', ref: 'E2' })
    expect(readAction('shift: 60 | E3, E4 E5')).toEqual({ kind: 'shift', refs: ['E3', 'E4', 'E5'], minutes: 60 })
    expect(readAction('edit: T2 | title=Fix report tables; priority=P1; due=friday 18:00')).toEqual({ kind: 'edit', ref: 'T2', title: 'Fix report tables', priority: 4, due: 'friday 18:00' })
    expect(readAction('taskmove: T2 | University')).toEqual({ kind: 'taskmove', ref: 'T2', area: 'University' })
    expect(readAction('done: T1')).toEqual({ kind: 'done', ref: 'T1' })
    expect(readAction('unstar: T1')).toEqual({ kind: 'star', ref: 'T1', on: false })
    expect(readAction('remind: 2026-11-01 15:00 | Call mom')).toEqual({ kind: 'remind', day: '2026-11-01', time: '15:00', text: 'Call mom' })
    expect(readAction('checkin: 60 | Did you start the CV?')).toEqual({ kind: 'checkin', minutes: 60, text: 'Did you start the CV?' })
    expect(readAction('move: 3 | tomorrow')).toBeNull()
    expect(readAction('done: buy milk')).toBeNull()
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

describe('coach part 2 actions', () => {
  it('reads water, reps, sleep, habits, rewards and the week plan', () => {
    expect(readAction('water: 500')).toEqual({ kind: 'water', ml: 500 })
    expect(readAction('water: -250')).toEqual({ kind: 'water', ml: -250 })
    expect(readAction('water: 9000')).toBeNull()
    expect(readAction('reps: pushups | 30')).toEqual({ kind: 'reps', exercise: 'pushups', amount: 30 })
    expect(readAction('sleep: 2026-11-01 | wake=6:40; bed=23:50; quality=4')).toEqual({ kind: 'sleep', day: '2026-11-01', wake: '06:40', bed: '23:50', quality: 4 })
    expect(readAction('sleep: 2026-11-01 | quality=9')).toBeNull()
    expect(readAction('habit: skincare')).toEqual({ kind: 'habit', habit: 'skincare' })
    expect(readAction('habit: clean day')).toEqual({ kind: 'habit', habit: 'clean' })
    expect(readAction('habit: reset streak')).toBeNull()
    expect(readAction('reward: Cinema night | 300 | 120')).toEqual({ kind: 'reward', title: 'Cinema night', points: 300, cost: 120 })
    expect(readAction('week: focus=wake; note=up at 7; big3=Lab report / Rust ch. 4 / 3 runs')).toEqual({ kind: 'week', focus: 'wake', note: 'up at 7', big3: ['Lab report', 'Rust ch. 4', '3 runs'] })
    expect(readAction('week: focus=nonsense')).toBeNull()
    expect(readAction('bigdone: 2')).toEqual({ kind: 'bigdone', index: 1 })
  })
})

describe('money fixes', () => {
  it('reads delmoney and editmoney', () => {
    expect(readAction('delmoney: m2')).toEqual({ kind: 'delmoney', ref: 'M2' })
    expect(readAction('editmoney: M1 | amount=45,5; category=Food; account=Maib')).toEqual({ kind: 'editmoney', ref: 'M1', amount: 45.5, category: 'Food', account: 'Maib' })
    expect(readAction('editmoney: M1')).toBeNull()
    expect(readAction('delmoney: T2')).toBeNull()
  })
})

describe('how Ben talks and learns', () => {
  it('reads style requests and writes the style line', async () => {
    const { styleText, feedbackText } = await import('./botBrain')
    expect(readAction('style: short; tone=5')).toEqual({ kind: 'style', length: 'short', tone: 5 })
    expect(readAction('style: detailed')).toEqual({ kind: 'style', length: 'detailed' })
    expect(readAction('style: whatever')).toBeNull()
    expect(styleText({ length: 'short', tone: 5 })).toContain('drill sergeant')
    const now = new Date('2026-11-02T12:00:00Z')
    const fb = feedbackText([{ at: '2026-11-01T10:00:00Z', kind: 'long', text: 'A very long answer about planning' }, { at: '2026-11-02T09:00:00Z', kind: 'up', text: 'ok' }, { at: '2026-09-01T09:00:00Z', kind: 'down', text: 'old' }], now)
    expect(fb).toContain('👍 1, 👎 0, too long 1, wrong 0')
    expect(fb).toContain('too long": "A very long answer')
    expect(fb).not.toContain('old')
    expect(feedbackText([], now)).toBe('')
  })
})
