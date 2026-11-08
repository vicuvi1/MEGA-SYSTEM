import { describe, expect, it } from 'vitest'
import { askKeep, askKind, askTrim, earnedAnswer, habitsAnswer, nightsFrom, sleepAnswer, tasksAnswer } from './benAsk'
import { keepLines } from './benRoute'
import { plainStep, plainSteps, reasoningSummary, timeText } from './benSteps'
import { costLine } from './answerCost'

const TODAY = '2026-11-18'

describe('askKind: simple data questions answered in code', () => {
  it('reads the owner’s questions', () => {
    expect(askKind('how much do I sleep on average', TODAY)).toEqual({ kind: 'sleep', from: '2026-11-12', to: TODAY, label: 'the last 7 nights' })
    expect(askKind('how much I have earned this month?', TODAY)).toEqual({ kind: 'earned', from: '2026-11-01', to: TODAY, label: 'this month' })
    expect(askKind('how much did I sleep last week?', TODAY)).toMatchObject({ kind: 'sleep', label: 'last week' })
    expect(askKind('what was my income last month', TODAY)).toMatchObject({ kind: 'earned', from: '2026-10-01', to: '2026-10-31' })
    expect(askKind('how are my habits?', TODAY)).toEqual({ kind: 'habits' })
    expect(askKind('my habits today', TODAY)).toEqual({ kind: 'habits' })
    expect(askKind('what are my tasks today?', TODAY)).toEqual({ kind: 'tasks' })
    expect(askKind('what do I have to do today', TODAY)).toEqual({ kind: 'tasks' })
  })

  it('leaves logs, advice and edits to the rest of Ben', () => {
    for (const t of ['slept 7h', 'earned 500 today', 'how can I sleep better?', 'should I sleep more?', 'why do I sleep so little?', 'how do I earn more money', 'add a habit: read', 'move my tasks to tomorrow', 'plan my day', 'the list'])
      expect(askKind(t, TODAY), t).toBeNull()
  })
})

describe('the answers use only the data', () => {
  // Bed time is logged on the evening of its day; the night ending on D is bed(D-1) → wake(D).
  const logs = [
    { day: '2026-11-15', bedTime: '23:30', wakeTime: '07:00' },
    { day: '2026-11-16', bedTime: '00:30', wakeTime: '07:30' },
    { day: '2026-11-17', bedTime: '23:00', wakeTime: '07:30' },
    { day: '2026-11-18', bedTime: null, wakeTime: '07:00' }
  ]
  it('nights pair the evening bed time with the next morning', () => {
    expect(nightsFrom(logs)).toEqual([
      { day: '2026-11-16', minutes: 480, bed: '23:30', wake: '07:30' },
      { day: '2026-11-17', minutes: 420, bed: '00:30', wake: '07:30' },
      { day: '2026-11-18', minutes: 480, bed: '23:00', wake: '07:00' }
    ])
  })
  it('sleep average', () => {
    const a = sleepAnswer({ kind: 'sleep', from: '2026-11-12', to: TODAY, label: 'the last 7 nights' }, logs)
    expect(a.reply.split('\n')[0]).toBe('On average you sleep 7 h 40 min a night (the last 7 nights, 3 nights logged).')
    expect(a.reply).toMatch(/Usual bed time 23:40/)
    expect(a.read).toBe('Read your sleep log (3 nights)')
    const none = sleepAnswer({ kind: 'sleep', from: '2026-11-01', to: '2026-11-05', label: 'last week' }, logs)
    expect(none.reply).toMatch(/no full nights logged for last week/)
    expect(none.reply).not.toMatch(/\d h/)
  })
  it('money earned and points', () => {
    const a = earnedAnswer({ kind: 'earned', from: '2026-11-01', to: TODAY, label: 'this month' }, {
      income: [
        { date: '2026-11-01', amount: 1_200_000, category: 'Salary' },
        { date: '2026-11-03', amount: 250_000, category: 'Freelance' },
        { date: '2026-10-30', amount: 999_900, category: 'Salary' }
      ],
      points: [{ day: '2026-11-02', coins: 40 }, { day: '2026-11-02', coins: -15 }, { day: '2026-10-01', coins: 99 }]
    })
    expect(a.reply).toMatch(/^You earned 14,500 lei this month \(2 income records\)\./)
    expect(a.reply).toMatch(/From: Salary 12,000 lei, Freelance 2,500 lei\./)
    expect(a.reply).toMatch(/\+40 this month/)
    const unknown = earnedAnswer({ kind: 'earned', from: '2026-11-01', to: TODAY, label: 'this month' }, { income: null, points: [] })
    expect(unknown.reply).toMatch(/can't see your Finance Helper data/)
  })
  it('habits and tasks', () => {
    const h = habitsAnswer([
      { name: 'Read 10 pages', done: true, due: true, streak: 6, week: 6 },
      { name: 'Stretch', done: false, due: true, streak: 0, week: 2 },
      { name: 'Run', done: false, due: false, streak: 2, week: 2, streakUnit: 'week' }
    ])
    expect(h.reply).toMatch(/^You have done 1 of 2 habits today\./)
    expect(h.reply).toMatch(/Still to do: Stretch\./)
    expect(h.reply).toMatch(/Best streak: Read 10 pages, 6 days\./)
    const t = tasksAnswer({ mustdos: [{ text: 'Lab report', done: false }, { text: 'Email tutor', done: true }], todoist: [{ content: 'Lab report' }, { content: 'Buy milk' }], blocks: [{ title: 'Deep block 1', start: '16:00' }] })
    expect(t.reply).toMatch(/^1 of 2 must-dos are left: Lab report\./)
    expect(t.reply).toMatch(/Todoist has 1 task for today: Buy milk\./)
    expect(t.reply).toMatch(/Next step: start Lab report\./)
    expect(tasksAnswer({ mustdos: [], todoist: null, blocks: [] }).reply).toMatch(/couldn't read Todoist/)
  })
})

describe('prompt diet for short questions', () => {
  const ctx = ['Now: 15:21', 'Sleep: bed 23:30', '- night 1', 'Money (MDL): 120 spent', 'Calendar today: 09:00 Deep block', 'His notebook: long', '- note', 'RIGHT NOW: at the PC'].join('\n')
  it('keeps only what the question is about', () => {
    const k = askTrim('should I go to bed early tonight?', 'chat')!
    expect(k.lists).toBe(true)
    const kept = keepLines(ctx, k.keep)
    expect(kept).toMatch(/Sleep: bed 23:30\n- night 1/)
    expect(kept).toMatch(/Calendar today/)
    expect(kept).not.toMatch(/notebook|Money/)
    expect(keepLines(ctx, askKeep('how much money did I spend?')!)).toMatch(/Money \(MDL\)/)
  })
  it('a data question routed as advice gets the quick model; a real big ask does not', () => {
    expect(askTrim('how much did I spend this month?', 'advice')).not.toBeNull()
    expect(askTrim('what should I focus on this week?', 'advice')).toBeNull()
    expect(askTrim('plan my week around the exam', 'advice')).toBeNull()
    expect(askTrim('log 500 ml water', 'log')).toBeNull()
    expect(askTrim('rename the deep block to Study', 'chat')).toBeNull()
  })
})

describe('time, steps and reasoning lines', () => {
  it('time text and the cost line lead with the time', () => {
    expect(timeText(3240)).toBe('3.2 s')
    expect(timeText(12_400)).toBe('12 s')
    expect(timeText(65_000)).toBe('1 min 5 s')
    expect(timeText(undefined)).toBe('')
    expect(costLine({ model: 'deepseek-v4.1-flash', calls: 1, tokens: 11_200, cost: 0.0004, ms: 3_240 })).toBe('3.2 s · deepseek-v4.1-flash · 11.2k tokens · $0.0004')
    expect(costLine({ model: 'answered in code', calls: 0, tokens: 0, cost: 0, code: true, ms: 420 })).toBe('0.4 s · Answered from your data · no AI · $0')
  })
  it('steps in plain English, no code words', () => {
    expect(plainStep('Checked sleep7')).toBe('Read your sleep log (7 nights)')
    expect(plainStep('Logged in code')).toBe('Logged it (no AI needed)')
    expect(plainStep('\u0001partial reply')).toBe('')
    expect(plainSteps(['Reading your day'])).toEqual(['Read your day'])
    expect(plainSteps(['Reading your day', 'Reading your day', 'Thinking it through', 'Answering faster'])).toEqual(['Thought it through (thinking model)', 'The thinking model was slow, so the quick model answered'])
  })
  it('a short readable summary of the reasoning', () => {
    const raw = '**Looking at the data.** He slept 7.5 h on average. {"reply": "x"} The gym is at 19:00 so tonight is fine. Also checking water. More scratch work here that goes on and on.'
    const s = reasoningSummary(raw, 120)
    expect(s).toBe('Looking at the data. He slept 7.5 h on average. The gym is at 19:00 so tonight is fine. Also checking water.')
    expect(reasoningSummary('')).toBe('')
  })
})
