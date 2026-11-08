// The planner learns from what really happened: the end-of-day check, the
// learned task times and the plan score. Made-up data only; the clock is pinned.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanReview, dropItem, EMPTY_REVIEW, markLabel, mergeReview, putItem, reviewFrom, reviewItem, reviewLine, reviewOpen, reviewRows, timerFor, type ReviewItem, type ReviewStore } from './planReview'
import { learnedTime, learnTimes, taskKeys, titleWords, HIGH, LOW } from './taskTimes'
import { dayScore, scoreItems, weekLine, weekScores, yesterdayLine } from './planScore'
import { estimateMinutes, packDay, type PlanTask } from './dayPacker'
import { blockWhy } from './planAudit'
import { addDays } from './dates'
import type { DayProposal } from './rhythm'

const today = '2030-03-12'
const at = `${today}T21:00:00`

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${today}T21:00:00`))
})
afterEach(() => vi.useRealTimers())

const plan: DayProposal = {
  day: today,
  headline: '',
  mustdos: ['Lab report intro'],
  blocks: [
    { id: 'b1', title: 'Lab report intro', start: '09:00', minutes: 60, kind: 'focus', tasks: ['Lab report intro'] },
    { id: 'b2', title: 'Lunch', start: '12:30', minutes: 30 },
    { id: 'b3', title: 'Reading: networking ch. 3', start: '14:00', minutes: 45, kind: 'focus', tasks: ['Reading: networking ch. 3'], done: ['Reading: networking ch. 3'] },
    { id: 'b4', title: 'Quick tasks (2)', start: '16:00', minutes: 20, kind: 'quick', tasks: ['Pay the phone bill', 'Reply to the club email'] },
    { id: 'b5', title: 'Practice CTF', start: '20:00', minutes: 60, kind: 'focus', tasks: ['Practice CTF'] }
  ],
  training: { time: '18:00', what: 'Home workout', minutes: 30 },
  waterMl: 2500
}

const item = (id: string, over: Partial<ReviewItem>): ReviewItem => ({ id, title: 'Lab report', start: '09:00', planned: 60, guess: 45, outcome: 'done', actual: null, src: 'plan', at, ...over })

describe('the end-of-day check (planReview)', () => {
  it('lists the work blocks that have started, with the timer minutes and ticks', () => {
    const rows = reviewRows(plan, {
      now: '19:00',
      sessions: [
        { subject: 'Lab report intro', startedAt: `${today}T09:05:00`, endedAt: `${today}T10:20:00`, minutes: 75 },
        // No subject match: counts for the block it mostly sat in.
        { subject: 'Focus', startedAt: `${today}T14:05:00`, endedAt: `${today}T14:45:00`, minutes: 40 },
        // Outside every block: counts for none.
        { subject: 'Focus', startedAt: `${today}T07:00:00`, endedAt: `${today}T07:30:00`, minutes: 30 }
      ]
    })
    // Lunch, the workout and the 20:00 block (not started) are not listed.
    expect(rows.map((r) => r.id)).toEqual(['b1', 'b3', 'b4'])
    expect(rows.find((r) => r.id === 'b1')!.timer).toBe(75)
    expect(rows.find((r) => r.id === 'b3')!.timer).toBe(40)
    expect(rows.find((r) => r.id === 'b3')!.ticked).toBe(true)
    expect(rows.find((r) => r.id === 'b4')!.ticked).toBe(false)
  })

  it('opens after the last work block', () => {
    expect(reviewFrom(plan)).toBe('21:00')
    expect(reviewOpen(plan, '20:59')).toBe(false)
    expect(reviewOpen(plan, '21:00')).toBe(true)
  })

  it('prefers the timer, then typed minutes win, and assumes nothing without either', () => {
    const [row] = reviewRows(plan, { now: '19:00', sessions: [{ subject: 'Lab report intro', startedAt: `${today}T09:00:00`, endedAt: `${today}T10:30:00`, minutes: 90 }] })
    const timer = reviewItem(row, 'done', { at })
    expect(timer).toMatchObject({ outcome: 'done', actual: 90, src: 'timer', planned: 60, guess: estimateMinutes({ content: 'Lab report intro' }) })
    expect(reviewItem(row, 'done', { at, minutes: 70 })).toMatchObject({ actual: 70, src: 'said' })
    const noTimer = { ...row, timer: 0 }
    expect(reviewItem(noTimer, 'done', { at })).toMatchObject({ actual: null, src: 'plan' })
    expect(reviewItem(noTimer, 'part', { at, minutes: 25 })).toMatchObject({ outcome: 'part', actual: 25, src: 'said' })
    expect(reviewItem(noTimer, 'slip', { at, minutes: 25 })).toMatchObject({ outcome: 'slip', actual: null, src: 'plan' })
    // A batch of several tasks is compared with its own length (it teaches nothing about one kind).
    const batch = reviewRows(plan, { now: '19:00' }).find((r) => r.id === 'b4')!
    expect(reviewItem(batch, 'done', { at }).guess).toBe(20)
  })

  it('is idempotent: marking twice keeps one record, and a re-mark replaces it', () => {
    const a = putItem(EMPTY_REVIEW, today, item('b1', {}), today)
    expect(putItem(a, today, item('b1', {}), today)).toEqual(a)
    const b = putItem(a, today, item('b1', { outcome: 'slip' }), today)
    expect(Object.keys(b.days[today].items)).toEqual(['b1'])
    expect(b.days[today].items.b1.outcome).toBe('slip')
    expect(dropItem(b, today, 'b1').days[today]).toBeUndefined()
  })

  it('keeps the last 90 days and reads broken data safely', () => {
    let s: ReviewStore = putItem(EMPTY_REVIEW, addDays(today, -120), item('old', {}), addDays(today, -120))
    s = putItem(s, today, item('b1', {}), today)
    expect(Object.keys(s.days)).toEqual([today])
    const back = cleanReview(JSON.parse(JSON.stringify(s)))
    expect(back).toEqual(s)
    expect(cleanReview({ days: { nope: {}, [today]: { items: { x: { title: 1 }, y: { title: 'T', outcome: 'what', planned: 10 } } } } })).toEqual(EMPTY_REVIEW)
    expect(cleanReview(null)).toEqual(EMPTY_REVIEW)
  })

  it('merges two devices: the newer mark wins per block, nothing is lost', () => {
    const a = putItem(EMPTY_REVIEW, today, item('b1', { outcome: 'done', at: `${today}T21:00:00` }), today)
    const b = putItem(putItem(EMPTY_REVIEW, today, item('b1', { outcome: 'slip', at: `${today}T21:05:00` }), today), today, item('b3', {}), today)
    const m = mergeReview(a, b)
    expect(m.days[today].items.b1.outcome).toBe('slip')
    expect(Object.keys(m.days[today].items).sort()).toEqual(['b1', 'b3'])
    expect(mergeReview(m, m)).toEqual(m)
  })

  it('says what was marked in plain words', () => {
    expect(markLabel({ outcome: 'part', actual: 30 })).toBe('Partly · 30 min')
    expect(markLabel({ outcome: 'slip', actual: null })).toBe('Tomorrow')
    const rows = reviewRows(plan, { now: '19:00', store: putItem(EMPTY_REVIEW, today, item('b1', {}), today) })
    expect(reviewLine(rows)).toBe('1 of 3 blocks checked: 1 done')
  })

  it('gives each timer session to one block only', () => {
    const m = timerFor(
      [
        { id: 'a', title: 'Reading', start: '10:00', minutes: 30 },
        { id: 'b', title: 'Reading', start: '11:00', minutes: 30 }
      ],
      [{ subject: 'Reading', startedAt: `${today}T11:00:00`, endedAt: `${today}T11:30:00`, minutes: 30 }]
    )
    expect([...m.values()].reduce((t, x) => t + x, 0)).toBe(30)
  })
})

// Done blocks of "Lab report …" that really took twice the plain guess.
const learnStore = (ratios: number[], over: Partial<ReviewItem> = {}): ReviewStore => {
  let s = EMPTY_REVIEW
  ratios.forEach((r, i) => {
    const day = addDays(today, -(i + 1))
    s = putItem(s, day, item(`d${i}`, { title: 'Lab report draft', tasks: ['Lab report draft'], guess: 45, actual: Math.round(45 * r), src: 'timer', ...over }), today)
  })
  return s
}

describe('learned task times (taskTimes)', () => {
  it('names a kind by its words, labels and project', () => {
    expect(titleWords('📚 Reading: networking ch. 3 (45 min)')).toEqual(['read', 'network'])
    expect(taskKeys({ title: 'Lab report chapter 2', project: 'University', labels: ['writing', 'today'] })).toEqual(['w:lab report', 'w:lab', 'l:writing', 'p:university'])
    expect(taskKeys({ title: 'Gym' })).toEqual(['w:gym'])
  })

  it('needs at least 3 samples', () => {
    expect(learnedTime({ content: 'Lab report intro' }, 45, learnTimes(learnStore([2, 2])))).toBeNull()
    expect(learnedTime({ content: 'Lab report intro' }, 45, learnTimes(learnStore([2, 2, 2])))?.minutes).toBe(90)
  })

  it('uses the median of the last 9, so one odd day does not move it', () => {
    const t = learnTimes(learnStore([1.2, 1.4, 6, 1.4, 1.3]))
    expect(t['w:lab report']).toEqual({ ratio: 1.4, n: 5 })
    const old = learnTimes(learnStore([1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 3, 3, 3]))
    expect(old['w:lab report']).toEqual({ ratio: 1, n: 9 })
  })

  it('stays between 0.5x and 2.5x the plain guess', () => {
    expect(learnedTime({ content: 'Lab report' }, 40, learnTimes(learnStore([5, 5, 5])))).toMatchObject({ ratio: HIGH, minutes: 100, why: 'usually takes you 1h40' })
    expect(learnedTime({ content: 'Lab report' }, 40, learnTimes(learnStore([0.1, 0.1, 0.1])))).toMatchObject({ ratio: LOW, minutes: 20 })
  })

  it('learns only from Done blocks with a real number', () => {
    expect(learnTimes(learnStore([2, 2, 2], { src: 'plan' }))).toEqual({})
    expect(learnTimes(learnStore([2, 2, 2], { outcome: 'part' }))).toEqual({})
    expect(learnTimes(learnStore([2, 2, 2], { tasks: ['Lab report draft', 'Email Ana'] }))).toEqual({})
    // Not from today's own check (the plan for today was made before it).
    expect(learnTimes(learnStore([2, 2, 2]), { before: addDays(today, -1) })['w:lab report']?.n).toBe(2)
  })

  it('falls back from the words to the project', () => {
    const s = learnStore([2, 2, 2], { title: 'Essay outline', tasks: ['Essay outline'], project: 'University' })
    const l = learnedTime({ content: 'Physics problem set', project: 'University' }, 45, learnTimes(s))
    expect(l).toMatchObject({ key: 'p:university', minutes: 90 })
  })

  it('the packer uses it for new blocks and says why', () => {
    const times = learnTimes(learnStore([2.2, 2.2, 2.2]))
    const tasks: PlanTask[] = [
      { id: 't1', content: 'Lab report results', priority: 4, project: 'University', due: today },
      { id: 't2', content: 'Lab report figures', priority: 4, project: 'University', due: today, duration: 30 }
    ]
    const p = packDay({
      today,
      now: '08:00',
      events: [],
      tasks,
      top3: [],
      waterTarget: 2500,
      workoutDone: true,
      learned: (t) => (t.duration ? null : learnedTime(t, estimateMinutes(t), times))
    })
    const b = p.blocks.find((x) => x.tasks?.includes('Lab report results'))!
    // 60 min plain guess x 2.2 = 130, a block holds 90 at most; the why says the real time.
    expect(b.minutes).toBe(90)
    expect(b.why).toBe('usually takes you 2h10')
    expect(blockWhy(b, p)).toContain('usually takes you 2h10')
    // Your own Todoist duration wins: no learned why there.
    const own = p.blocks.find((x) => x.tasks?.includes('Lab report figures'))!
    expect(own.minutes).toBe(30)
    expect(own.why).toBeUndefined()
  })
})

describe('the plan score (planScore)', () => {
  it('is 100 when every block was done in its time', () => {
    expect(scoreItems(today, [item('a', {}), item('b', { actual: 70 })])?.score).toBe(100)
  })

  it('counts minutes done, blocks on time and slips', () => {
    const s = scoreItems(today, [
      item('a', { planned: 60, actual: 90, src: 'timer' }), // done, late: 60 of 60 min, not on time
      item('b', { planned: 40, outcome: 'part', actual: 20, src: 'said' }), // 20 of 40
      item('c', { planned: 30, outcome: 'slip' }),
      item('d', { planned: 30, outcome: 'drop' })
    ])!
    // 0.5 * 80/160 + 0.3 * 0/4 + 0.2 * (1 - 2/4) = 0.25 + 0 + 0.1
    expect(s).toMatchObject({ score: 35, plannedMin: 160, doneMin: 80, blocks: 4, done: 1, slipped: 2 })
  })

  it('counts half a block for Partly without a number', () => {
    expect(scoreItems(today, [item('a', { outcome: 'part', planned: 60 })])?.doneMin).toBe(30)
  })

  it('has no score for a day nobody checked, and a 7-day trend', () => {
    const y = addDays(today, -1)
    const s = putItem(putItem(EMPTY_REVIEW, y, item('a', { planned: 60, actual: 60, src: 'timer' }), today), addDays(today, -3), item('b', { outcome: 'slip' }), today)
    expect(dayScore(s, today)).toBeNull()
    expect(yesterdayLine(s, today)).toBe("Yesterday's plan: 100% realistic")
    expect(yesterdayLine(EMPTY_REVIEW, today)).toBeNull()
    const w = weekScores(s, today)
    expect(w).toHaveLength(7)
    expect(w[6]).toEqual({ day: today, score: null })
    expect(w[5]).toEqual({ day: y, score: 100 })
    expect(w[3]).toEqual({ day: addDays(today, -3), score: 0 })
    expect(weekLine(s, today)).toBe('Plan realism, last 7 days: 50% on average (2 days checked)')
  })
})
