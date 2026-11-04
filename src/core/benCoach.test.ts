import { describe, expect, it } from 'vitest'
import { addExcuse, classifyExcuse, energyMap, excuseCallout, excuseCounts, hoursText, moodDue, moodLinks, addMood, profileCorrections, profileNote, weeklyPatterns, type MoodEntry } from './benKnows'
import { addTopic, dueTopics, freeRanges, nextReview, parseStack, planWeek, rescueDay, reviewTopic, stackStreak, tickStack } from './benPlans'
import { addStake, big3Of, callDue, keepStake, loseStakes, minutesUntil, monthStory, overdueStakes, readDue, saysStartAt, stakeStats } from './benStakes'
import { purchaseCheck, readPurchase, recurringCharges, sleepLink, spendPace } from './benMoney'
import { addDays } from './dates'

const at = (day: string, h: number, m = 0) => new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString()
const today = '2026-11-04' // a Wednesday

describe('Ben knows you', () => {
  it('energy map: mornings strong, 15:00 weak → best hours before noon', () => {
    const s = []
    for (let k = 0; k < 10; k++) {
      const d = addDays(today, -k)
      s.push({ day: d, startedAt: at(d, 9), minutes: 50 }, { day: d, startedAt: at(d, 10), minutes: 50 })
      if (k % 3 === 0) s.push({ day: d, startedAt: at(d, 15), minutes: 20 })
      if (k % 2 === 0) s.push({ day: d, startedAt: at(d, 12), minutes: 30 }, { day: d, startedAt: at(d, 18), minutes: 30 }, { day: d, startedAt: at(d, 20), minutes: 25 })
    }
    const blocks = [0, 1, 2].map((k) => ({ at: at(addDays(today, -k), 15), result: 'no' as const }))
    const m = energyMap(s, [], blocks)
    expect(m.ready).toBe(true)
    expect(m.best.slice(0, 2).sort((a, b) => a - b)).toEqual([9, 10])
    expect(m.worst).toContain(15)
    expect(hoursText([9, 10, 16])).toBe('09–11 and 16–17')
    expect(energyMap([], [], []).ready).toBe(false)
  })

  it('patterns: morning focus and a lost Tue/Thu afternoon, each with a change', () => {
    const sessions = []
    for (let k = 0; k < 40; k++) {
      const d = addDays(today, -k)
      sessions.push({ day: d, startedAt: at(d, 9), minutes: 90 })
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay()
      if (dow !== 2 && dow !== 4) sessions.push({ day: d, startedAt: at(d, 16), minutes: 40 })
    }
    const p = weeklyPatterns({ today, sessions, sleep: [], workouts: [] })
    expect(p.map((x) => x.id)).toEqual(expect.arrayContaining(['am', 'lost-pm']))
    expect(p.find((x) => x.id === 'lost-pm')!.text).toContain('Tue/Thu')
    expect(p.every((x) => x.change.length > 5)).toBe(true)
  })

  it('excuses: classifies EN/RO, ignores non-excuses, counts repeats kindly', () => {
    expect(classifyExcuse("didn't go, too tired")).toBe('tired')
    expect(classifyExcuse('nu am făcut, eram obosit')).toBe('tired')
    expect(classifyExcuse('n-am timp azi')).toBe('busy')
    expect(classifyExcuse('I am tired of winning')).toBeNull()
    let l = addExcuse([], "didn't train, too tired", at(today, 20))
    l = addExcuse(l, "skipped it, I'm exhausted", at(addDays(today, -3), 20))
    l = addExcuse(l, "skipped it, exhausted again", at(addDays(today, -3), 21))
    expect(excuseCounts(l, today)).toEqual([expect.objectContaining({ kind: 'tired', n: 2 })])
    expect(excuseCallout(l, 'tired', today)).toContain('2nd time')
  })

  it('mood: one per slot, due at noon/evening, links to training', () => {
    let m: MoodEntry[] = []
    m = addMood(m, { day: today, slot: 'noon', mood: 4, at: at(today, 13) })
    m = addMood(m, { day: today, slot: 'noon', mood: 5, at: at(today, 13, 5) })
    expect(m).toHaveLength(1)
    expect(moodDue(m, new Date(at(today, 13)))).toBeNull()
    expect(moodDue(m, new Date(at(today, 20)))).toBe('evening')
    expect(moodDue(m, new Date(at(today, 10)))).toBeNull()
    const moods: MoodEntry[] = []
    const workouts: string[] = []
    for (let k = 0; k < 8; k++) {
      const d = addDays(today, -k)
      if (k % 2) workouts.push(d)
      moods.push({ day: d, slot: 'evening', mood: k % 2 ? 5 : 3, at: at(d, 20) })
    }
    expect(moodLinks(moods, { sleep: [], workouts, spending: null })[0].id).toBe('sport')
  })

  it('profile note keeps your corrections section on refresh', () => {
    const p = { today, aboutMe: '', goals: [{ title: 'Pass algebra', deadline: '2026-12-15' }], exams: [], people: [{ name: 'Ana', note: 'sister' }], works: ['25-min blocks'], fails: [], patterns: [], energy: energyMap([]), excuses: [], moodAvg: null }
    const first = profileNote(p)
    expect(first).toContain('Pass algebra (by 2026-12-15, 41 days)')
    const edited = first.replace('- \n', '- Ana is 15, not 17\n')
    const again = profileNote({ ...p, works: ['morning study'] }, edited)
    expect(again).toContain('morning study')
    expect(again).toContain('Ana is 15, not 17')
    expect(profileCorrections(again)).toBe('- Ana is 15, not 17')
  })
})

describe('Ben plans for you', () => {
  it('free ranges skip busy time with a buffer', () => {
    const busy = [{ start: Date.parse(at(today, 10)), end: Date.parse(at(today, 12)) }]
    expect(freeRanges(today, busy, '08:00', '14:00')).toEqual([
      [480, 590],
      [730, 840]
    ])
  })

  it('plans the week: goal blocks in best hours, gym not on rest days or back-to-back', () => {
    const monday = '2026-11-02'
    const weekBlocks = planWeek({ start: monday, today: monday, busy: [], goals: [{ title: 'Algebra', hoursLeft: 10, deadline: '2026-11-20' }], energy: energyMap([]), restDays: ['2026-11-03'], gymPerWeek: 3 })
    const deep = weekBlocks.filter((b) => b.kind === 'deep')
    expect(deep.length).toBeGreaterThanOrEqual(5)
    expect(deep[0].start).toBe('09:00')
    const gym = weekBlocks.filter((b) => b.kind === 'gym').map((b) => b.day)
    expect(gym).not.toContain('2026-11-03')
    for (let k = 1; k < gym.length; k++) expect(addDays(gym[k - 1], 1)).not.toBe(gym[k])
    expect(weekBlocks.some((b) => b.day === '2026-11-08' && b.kind === 'deep')).toBe(false) // Sunday off
  })

  it('rescues the day: keeps fixed and must-dos, shrinks the rest, spills to tomorrow', () => {
    const t = (h: number, m = 0) => Date.parse(at(today, h, m))
    const r = rescueDay(
      [
        { id: 'class', title: 'Class', start: t(14), end: t(16), fixed: true },
        { id: 'lab', title: 'Lab report', start: t(11), end: t(12, 30), must: true },
        { id: 'read', title: 'Reading', start: t(12, 30), end: t(14) },
        { id: 'cv', title: 'CV', start: t(16, 30), end: t(18) },
        { id: 'extra', title: 'Extra', start: t(18), end: t(20) }
      ],
      t(13),
      t(19)
    )
    const by = Object.fromEntries(r.moves.map((m) => [m.id, m]))
    expect(by.class.action).toBe('keep')
    expect(by.lab.end! - by.lab.start!).toBe(90 * 60000)
    expect(['shrink', 'move', 'keep']).toContain(by.read.action)
    expect(r.moves.some((m) => m.action === 'tomorrow')).toBe(true)
    expect(r.lines.length).toBeGreaterThan(2)
  })

  it('study topics come back after 1, 3, 7 days and never after the exam', () => {
    let l = addTopic([], 'Algebra', 'Chapter 3', '2026-11-01', '2026-11-20')
    expect(nextReview(l[0])).toBe('2026-11-02')
    expect(dueTopics(l, '2026-11-02')).toHaveLength(1)
    l = reviewTopic(l, l[0].id, '2026-11-02')
    expect(nextReview(l[0])).toBe('2026-11-05')
    expect(dueTopics(l, '2026-11-03')).toHaveLength(0)
    expect(dueTopics(l, '2026-11-25')).toHaveLength(0)
  })

  it('habit stacks parse, tick and count a streak', () => {
    let s = parseStack('after coffee → 10 pushups → plan review', today)!
    expect(s.cue).toBe('coffee')
    expect(s.steps).toEqual(['10 pushups', 'plan review'])
    s = tickStack(tickStack(s, addDays(today, -1), 0), addDays(today, -1), 1)
    s = tickStack(tickStack(s, today, 0), today, 1)
    expect(stackStreak(s, today)).toBe(2)
    expect(parseStack('just one thing', today)).toBeNull()
  })
})

describe('Ben holds you to it', () => {
  const now = new Date(at(today, 14))
  it('stakes: due times, enforcement and stats', () => {
    expect(new Date(readDue('by 18:00', now)!).getHours()).toBe(18)
    expect(readDue('9', now)!.slice(0, 10) >= today).toBe(true)
    expect(new Date(readDue('tomorrow 9', now)!).getDate()).toBe(5)
    let l = addStake([], 'Lab report', readDue('18:00', now)!, 50, now)
    l = addStake(l, 'Gym', readDue('15:00', now)!, 30, now)
    const later = new Date(at(today, 19))
    l = keepStake(l, l[1].id, now)
    expect(overdueStakes(l, later).map((s) => s.text)).toEqual(['Lab report'])
    l = loseStakes(l, [l[0].id], later)
    expect(stakeStats(l, later)).toEqual({ kept: 1, lost: 1, pointsLost: 50, open: 0 })
  })

  it('check-ins at a clock time', () => {
    expect(minutesUntil('15:00', now)).toBe(60)
    expect(minutesUntil('13:00', now)).toBe(23 * 60)
    expect(saysStartAt("I'll start the lab at 15:00")).toBe('15:00')
    expect(saysStartAt('o să încep la 16')).toBe('16:00')
    expect(saysStartAt('the class is at 15')).toBeNull()
  })

  it('coach call: due on Sunday until done; big 3 from lines', () => {
    expect(callDue([], new Date(at('2026-11-08', 19)))).toBe(true)
    expect(callDue([{ week: '2026-11-02', at: '', answers: {} as any }], new Date(at('2026-11-08', 19)))).toBe(false)
    expect(callDue([], new Date(at('2026-11-04', 19)))).toBe(false)
    expect(big3Of('1. Lab report\n2. Gym x3\n3) CV')).toEqual(['Lab report', 'Gym x3', 'CV'])
  })

  it('month story: calendar cells, numbers, compare to last month', () => {
    const s = monthStory({
      month: '2026-11',
      today,
      focus: [
        { day: '2026-11-02', minutes: 200 },
        { day: '2026-11-03', minutes: 60 },
        { day: '2026-10-02', minutes: 120 },
        { day: '2026-10-20', minutes: 600 }
      ],
      workouts: ['2026-11-02', '2026-10-05'],
      restDays: [],
      sleep: [{ day: '2026-11-03', bed: '23:30', wake: '07:00', onTime: true }],
      spent: [{ day: '2026-11-01', bani: 50000 }],
      moods: [],
      stakes: { kept: 1, lost: 0 },
      promises: { kept: 2, missed: 1 }
    })
    expect(s.days).toHaveLength(4)
    expect(s.pad).toBe(6) // Nov 1 2026 is a Sunday
    expect(s.days[1]).toMatchObject({ level: 4, trained: true })
    expect(s.stats.focusH).toBe(4.3)
    expect(s.stats.avgSleep).toBe('7h30')
    expect(s.lines[0]).toContain('+117% vs the same days last month')
  })
})

describe('money and life', () => {
  const cat = (id: string) => ({ f: 'Food', t: 'Transport' })[id] ?? id
  it('spending pace: over on food this week', () => {
    const tx = []
    for (let w = 1; w <= 4; w++) tx.push({ type: 'expense', date: addDays('2026-11-02', -7 * w), amount: 20000, category: 'f' })
    tx.push({ type: 'expense', date: '2026-11-02', amount: 30000, category: 'f' }, { type: 'expense', date: '2026-11-03', amount: 10000, category: 'f' })
    const p = spendPace(tx, cat, today)
    expect(p.daysLeft).toBe(5)
    expect(p.line).toContain('100% over on food')
  })

  it('finds a forgotten monthly subscription', () => {
    const tx = ['2026-07-03', '2026-08-03', '2026-09-04', '2026-10-03'].map((date) => ({ type: 'expense', date, amount: 15900, note: 'Spotify', category: 's' }))
    const r = recurringCharges(tx, cat, today)
    expect(r[0]).toMatchObject({ name: 'Spotify', months: 4, next: '2026-11-03' })
  })

  it('purchase check: reads the question, waits on big ones', () => {
    expect(readPurchase('should I buy headphones 1200')).toEqual({ what: 'headphones', price: 120000 })
    expect(readPurchase('să cumpăr adidași 900 lei?')).toEqual({ what: 'adidași', price: 90000 })
    const big = purchaseCheck({ price: 120000, what: 'headphones', hourly: 10000, safeToday: 30000, limitLeft: 200000, perDay: 25000, balance: 600000, goals: [{ title: 'Laptop', left: 500000 }] })
    expect(big.verdict).toBe('wait')
    expect(big.lines[0]).toBe('It costs you 12.0 h of work.')
    expect(purchaseCheck({ price: 5000, what: 'coffee beans', hourly: null, safeToday: 30000, limitLeft: 100000, perDay: 25000, balance: 600000, goals: [] }).verdict).toBe('buy')
    expect(purchaseCheck({ price: 300000, what: 'phone', hourly: null, safeToday: 10000, limitLeft: 50000, perDay: 25000, balance: 400000, goals: [] }).verdict).toBe('skip')
  })

  it('sleep link: lighter morning after a short night', () => {
    expect(sleepLink('01:30', '07:00').level).toBe('short')
    expect(sleepLink('01:30', '07:00').lightUntil).toBe('11:00')
    expect(sleepLink('03:00', '07:30').level).toBe('very short')
    expect(sleepLink('23:00', '07:00').level).toBe('ok')
    expect(sleepLink(null, '07:00').slept).toBeNull()
  })
})
