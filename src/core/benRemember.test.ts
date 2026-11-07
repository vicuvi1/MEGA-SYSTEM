// Ben remembers (ME2–ME5, TL1, TL2, TL5): pure parts. Made-up data only.
import { describe, expect, it } from 'vitest'
import { cleanLearn, keepPlan, kindOf, learnedEstimate, learnRhythm, plannedRows, rhythmLine, withRest, EMPTY_RHYTHM } from './benLearn'
import { packDay } from './dayPacker'
import { workToday, DEFAULT_LIFE_FIT } from './lifeFit'
import { addPoint, cleanConvo, EMPTY_CONVO, pastLine, pointOf, rollSummary, searchPoints } from './benConvo'
import { answerPromise, promiseAsk, promiseButtons, promiseReminder, promisesFor, readPromise, readPromiseAnswer, type PromiseReminder } from './benPromise'
import { armSmart, readSmartRemind, smartPlan, type SmartReminder } from './benSmartRemind'
import { notePushbacks, parseSteps, readBreakdown, staleBig, stepTask, templateSteps } from './benBreak'
import { askedToBuy, pickByName, readToolAction, saidHabit } from './benTools'

const iso = (day: string, hm: string) => new Date(`${day}T${hm}:00`).toISOString()

describe('ME2: his real rhythm', () => {
  const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']
  const planned = days.flatMap((day) => [
    { day, title: 'Write essay draft', start: '10:00', minutes: 50 },
    { day, title: 'Email the teacher', start: '16:00', minutes: 20 }
  ])
  const sessions = days.flatMap((day) => [
    { day, subject: 'Essay', startedAt: iso(day, '10:05'), minutes: 70 },
    { day, subject: 'Emails', startedAt: iso(day, '16:00'), minutes: 15 }
  ])
  const results = days.map((day) => ({ day, at: iso(day, '21:00'), title: 'Reading', result: 'no' as const }))

  it('learns that essays take 1.4× the plan, admin 0.75×, and that 21:00 blocks get skipped', () => {
    const r = learnRhythm({ planned, sessions, results })
    expect(kindOf('Write essay draft')).toBe('write')
    expect(r.mult.write).toBe(1.4)
    expect(r.mult.admin).toBe(0.75)
    expect(r.skip).toEqual([21])
    expect(r.best).toContain(10)
    expect(rhythmLine(r)).toMatch(/write 1\.4×/)
  })

  it('needs 3 samples before it trusts a multiplier', () => {
    const r = learnRhythm({ planned: planned.slice(0, 4), sessions: sessions.slice(0, 4) })
    expect(r.mult.write).toBeUndefined()
  })

  it('estimates: his own words first, then the learned pace', () => {
    const r = learnRhythm({ planned, sessions, results })
    expect(learnedEstimate({ content: 'Write the lab report' }, r)).toBe(65)
    expect(learnedEstimate({ content: 'Write the lab report' }, r, 30)).toBe(30)
    expect(learnedEstimate({ content: 'Write the lab report' }, EMPTY_RHYTHM)).toBe(45)
  })

  it('the packer uses the learned estimates and keeps hard work out of skipped hours', () => {
    const r = learnRhythm({ planned, sessions, results })
    const base = { today: '2026-11-07', now: '08:00', events: [], top3: [], waterTarget: 2000, workoutDone: true, endBy: '23:00' }
    const tasks = [{ id: 'a', content: 'Write the lab report', priority: 4 }]
    const plain = packDay({ ...base, tasks })
    const learned = packDay({ ...base, tasks, estimate: (t) => learnedEstimate(t, r), best: [21], avoid: r.skip })
    expect(plain.blocks[0].minutes).toBe(60)
    expect(learned.blocks[0].minutes).toBe(85)
    expect(learned.blocks[0].start.slice(0, 2)).not.toBe('21')
  })

  it('keeps 30 days of plans to learn from', () => {
    let s = cleanLearn(null)
    for (let i = 1; i <= 35; i++) s = keepPlan(s, `2026-10-${String(i).padStart(2, '0')}`.replace('2026-10-3', '2026-10-3'), [{ title: 'X', start: '10:00', minutes: 30 }])
    expect(Object.keys(s.plans).length).toBeLessThanOrEqual(30)
    expect(plannedRows(keepPlan(cleanLearn(null), '2026-11-06', [{ title: 'A', start: '09:00', minutes: 30 }]), '2026-11-07')).toEqual([{ day: '2026-11-06', title: 'A', start: '09:00', minutes: 30 }])
  })
})

describe('ME3: his evening job', () => {
  const fit = { ...DEFAULT_LIFE_FIT, work: { on: true, days: [6], from: '17:00', to: '22:00', minH: 2, maxH: 4 } }
  it('the shift is quick-tasks-only, and the hour after a long shift is too', () => {
    const w = withRest(workToday(fit, '2026-11-07'))
    expect(w?.light).toEqual({ from: '17:00', to: '22:00' })
    expect(w?.rest).toEqual({ from: '22:00', to: '23:00' })
    const plan = packDay({ today: '2026-11-07', now: '16:00', events: [], tasks: [{ content: 'Study algebra chapter 3', priority: 4 }, { content: 'Reply to email', priority: 1 }], top3: [], waterTarget: 2000, workoutDone: true, endBy: '23:30', work: w })
    const deep = plan.blocks.filter((b) => b.kind !== 'quick')
    expect(deep.every((b) => b.start < '17:00' || b.start >= '23:00')).toBe(true)
  })
  it('a short shift or no work tonight adds no rest hour', () => {
    expect(withRest(workToday({ ...fit, tonight: { day: '2026-11-07', mode: 'short' } }, '2026-11-07'))?.rest).toBeUndefined()
    expect(withRest(workToday({ ...fit, work: { ...fit.work, from: '19:00', to: '22:00' } }, '2026-11-07'))?.rest).toBeUndefined()
  })
})

describe('ME4: past conversations', () => {
  it('keeps decisions, struggles and wins; a summary; finds the one that fits', () => {
    expect(pointOf('the essay feels so hard today')).toBe('struggle')
    expect(pointOf('I finished the lab!')).toBe('win')
    expect(pointOf('from now on no phone in bed')).toBe('decision')
    expect(pointOf('water 500')).toBeNull()
    let c = EMPTY_CONVO
    c = addPoint(c, 'the essay feels so hard today', '2026-10-30')
    c = addPoint(c, 'the essay feels so hard today', '2026-10-30')
    c = addPoint(c, 'I finished the lab!', '2026-11-02')
    c = addPoint(c, 'from now on no phone in bed', '2026-11-03')
    expect(c.points).toHaveLength(3)
    c = rollSummary(c, '2026-11-07')
    expect(c.summary).toMatch(/Decided: from now on no phone in bed/)
    expect(c.summary).toMatch(/Found hard: the essay/)
    expect(searchPoints(c, 'essay')[0].text).toMatch(/essay/)
    expect(pastLine(c, 'should I start the essay now?', '2026-11-07')).toMatch(/last week he said \(struggle\): "the essay feels so hard today"/)
    expect(pastLine(c, 'hello', '2026-11-07')).toBe('')
    expect(cleanConvo(JSON.parse(JSON.stringify(c))).points).toHaveLength(3)
  })
})

describe('ME5: promises', () => {
  const now = new Date(2026, 10, 6, 21, 0) // a Friday evening
  it('finds "I\'ll … tomorrow" in three languages, with the time to ask', () => {
    const p = readPromise("I'll start the essay tomorrow", now)
    expect(p).toMatchObject({ what: 'start the essay', when: 'tomorrow' })
    expect(new Date(p!.at).getDate()).toBe(7)
    expect(new Date(p!.at).getHours()).toBe(10)
    expect(readPromise('o să fac laboratorul mâine', now)?.what).toBe('fac laboratorul')
    expect(readPromise('завтра сделаю лабу', now)?.what).toBe('сделаю лабу')
    expect(readPromise("I'll do the dishes on monday", now)?.when).toBe('on Monday')
    expect(readPromise("I'll try to read tomorrow", now)).toBeNull()
    expect(readPromise('will you remind me tomorrow?', now)).toBeNull()
  })
  it('asks at that time with Done / Tomorrow / Drop, and the answers work', () => {
    const p = readPromise("I'll start the essay tomorrow", now)!
    const r: PromiseReminder = { ...promiseReminder(p), id: 'pr1', createdAt: now.toISOString() }
    expect(promiseAsk(r, new Date(2026, 10, 7, 10, 0))).toBe("🤝 You said you'd start the essay today. How did it go?")
    expect(promiseButtons('pr1').map((b) => b.do)).toEqual(['say:Promise done (pr1)', 'say:Promise tomorrow (pr1)', 'say:Promise drop (pr1)'])
    expect(readPromiseAnswer('Promise tomorrow (pr1)')).toEqual({ id: 'pr1', op: 'tomorrow' })
    expect(promisesFor([r], '2026-11-07')).toEqual(['start the essay'])
    const later = new Date(2026, 10, 7, 11, 0)
    const moved = answerPromise([r], 'pr1', 'tomorrow', later).list[0]
    expect(new Date(moved.at).getDate()).toBe(8)
    expect(answerPromise([r], 'pr1', 'done', later).list[0].outcome).toBe('kept')
    expect(answerPromise([r], 'pr1', 'drop', later).list[0]).toMatchObject({ done: true })
  })
})

describe('TL5: smart reminders', () => {
  const now = new Date(2026, 10, 7, 11, 0)
  it('reads home, after an event and after the workout', () => {
    expect(readSmartRemind('remind me to take out the trash when I get home')).toEqual({ text: 'take out the trash', when: { kind: 'home' } })
    expect(readSmartRemind('remind me to stretch after my workout')).toEqual({ text: 'stretch', when: { kind: 'workout' } })
    expect(readSmartRemind('remind me to email the professor after the lab')).toEqual({ text: 'email the professor', when: { kind: 'event', match: 'lab' } })
    expect(readSmartRemind('remind me at 20 to call mom')).toBeNull()
  })
  it('an event reminder fires at that event\'s end; home and workout have a latest time and fire early on a signal', () => {
    const events = [{ title: 'Lab: Programming', start: new Date(2026, 10, 7, 13, 30).toISOString(), end: new Date(2026, 10, 7, 15, 0).toISOString() }]
    const ev = smartPlan({ text: 'email', when: { kind: 'event', match: 'lab' } }, now, events)!
    expect(new Date(ev.at).getHours()).toBe(15)
    expect(ev.words).toBe('after Lab: Programming (15:00)')
    expect(smartPlan({ text: 'x', when: { kind: 'event', match: 'concert' } }, now, events)).toBeNull()
    const home = smartPlan({ text: 'trash', when: { kind: 'home' } }, now)!
    expect(home.honest).toMatch(/PC waking up/)
    const list: SmartReminder[] = [{ id: 'h', at: home.at, text: 'trash', kind: 'remind', createdAt: now.toISOString(), when: { kind: 'home', fallback: home.at } }, { id: 'w', at: new Date(2026, 10, 7, 21).toISOString(), text: 'stretch', kind: 'remind', createdAt: now.toISOString(), when: { kind: 'workout', fallback: '' } }]
    // 12:00 the PC is seen; at 13:00 still the 12:00 sighting (away); at 17:00 it is back after 5 h.
    const t12 = new Date(2026, 10, 7, 12, 0)
    let armed = armSmart(list, { now: t12, deskAt: t12.getTime(), workoutAt: null })
    expect(armed[0].when?.seen).toBe(t12.getTime())
    armed = armSmart(armed, { now: new Date(2026, 10, 7, 13, 0), deskAt: t12.getTime() })
    expect(armed[0].at).toBe(home.at)
    const at = new Date(2026, 10, 7, 17, 0)
    armed = armSmart(armed, { now: at, deskAt: at.getTime() - 60000, workoutAt: null })
    expect(armed[0].at).toBe(at.toISOString())
    expect(armed[1].at).toBe(list[1].at)
    // A workout logged after the reminder was made fires "after my workout".
    expect(armSmart(list, { now: at, workoutAt: at.getTime() - 5000 })[1].at).toBe(at.toISOString())
  })
})

describe('TL2: break big tasks down', () => {
  it('reads the ask, makes 3–6 steps (model or template) and Todoist lines', () => {
    expect(readBreakdown("break down 'harder sport system implement'")).toBe('harder sport system implement')
    expect(readBreakdown('split the essay into steps')).toBe('essay')
    expect(readBreakdown('разбей эссе на шаги')).toBe('эссе')
    expect(templateSteps('harder sport system implement').length).toBeGreaterThanOrEqual(3)
    expect(parseSteps('{"steps":[{"title":"Outline","minutes":15},{"title":"Draft","minutes":200},{"title":"Edit","minutes":30}]}')).toEqual([
      { title: 'Outline', minutes: 15 },
      { title: 'Draft', minutes: 90 },
      { title: 'Edit', minutes: 30 }
    ])
    expect(parseSteps('{"steps":[{"title":"One","minutes":10}]}')).toBeNull()
    expect(stepTask('Essay', { title: 'Outline', minutes: 15 })).toBe('Essay · Outline (15 min)')
  })
  it('a big task still open 3 days after it was first due is worth breaking down', () => {
    const open = [{ id: '1', content: 'Implement the sport system', priority: 4 }, { id: '2', content: 'Reply to email' }]
    let p = notePushbacks({}, open, '2026-11-03')
    p = notePushbacks(p, open, '2026-11-07')
    expect(staleBig(p, open, '2026-11-07')).toEqual(['Implement the sport system'])
    expect(staleBig(p, open, '2026-11-04')).toEqual([])
  })
})

describe('TL1: tools that were missing', () => {
  it('reads buy and myhabit, and checks his own words', () => {
    expect(readToolAction('buy: Movie night')).toEqual({ kind: 'buy', title: 'Movie night' })
    expect(readToolAction('myhabit: Read 10 pages')).toEqual({ kind: 'myhabit', name: 'Read 10 pages' })
    expect(readToolAction('task: buy milk')).toBeNull()
    expect(askedToBuy('buy the movie night reward')).toBe(true)
    expect(askedToBuy('what rewards do I have')).toBe(false)
    expect(saidHabit('I read 10 pages today', 'Read 10 pages')).toBe(true)
    expect(saidHabit('should I read?', 'Meditate')).toBe(false)
    expect(pickByName('movie nigth', [{ t: 'Movie night' }, { t: 'Pizza' }], (x) => x.t)?.t).toBe('Movie night')
  })
})
