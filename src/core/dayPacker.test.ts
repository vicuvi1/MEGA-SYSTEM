import { describe, expect, it } from 'vitest'
import { checkModelPlan, estimateMinutes, packDay, unaccounted, type PlanTask } from './dayPacker'
import { editPlan, lightenForSleep, proposalText, toMin } from './rhythm'
import type { CalEvent } from './dayTime'

// A made-up student day: 12 tasks across 4 areas, 3 classes.
const today = '2030-03-12'
const ev = (title: string, s: string, e: string): CalEvent => ({ id: title, calendarId: 'c', title, start: `${today}T${s}:00`, end: `${today}T${e}:00`, allDay: false })
const classes = [ev('Physics lecture', '09:00', '10:30'), ev('Algebra seminar', '11:00', '12:30'), ev('Chemistry lab', '14:00', '15:30')]
const tasks: PlanTask[] = [
  { id: 't1', content: 'Finish the physics problem set', priority: 4, project: 'University', due: today },
  { id: 't2', content: 'Write the lab report intro', priority: 4, project: 'University', due: '2030-03-11' },
  { id: 't3', content: 'Apply to the summer internship', priority: 3, project: 'Job & Career', due: today },
  { id: 't4', content: 'Practice a beginner CTF challenge', priority: 3, project: 'Cyber', due: today },
  { id: 't5', content: 'Read chapter 3 of the networking book', priority: 2, project: 'Cyber', due: today },
  { id: 't6', content: 'Update the CV skills section', priority: 2, project: 'Job & Career', due: today },
  { id: 't7', content: 'Revise algebra notes', priority: 2, project: 'University', due: today },
  { id: 't8', content: 'Reply to the club email', priority: 1, project: 'Inbox', due: today },
  { id: 't9', content: 'Pay the phone bill', priority: 1, project: 'Inbox', due: '2030-03-10' },
  { id: 't10', content: 'Buy printer paper', priority: 1, project: 'Inbox', due: today },
  { id: 't11', content: 'Watch the refactoring video part 1', priority: 1, project: 'Cyber', due: today },
  { id: 't12', content: 'Check the job board 15 min', priority: 1, project: 'Job & Career', due: today }
]
const base = { today, now: '07:30', events: classes, tasks, top3: [], waterTarget: 2500, workoutDone: false }

const overlaps = (a: { start: string; minutes: number }, s: string, e: string) => toMin(a.start) < toMin(e) && toMin(a.start) + a.minutes > toMin(s)

describe('the whole-day plan (DP1)', () => {
  it('plans every task: 3 must-dos, at least 3 blocks between classes, the rest listed', () => {
    const p = packDay(base)
    expect(p.mustdos).toHaveLength(3)
    expect(p.mustdos).toEqual(['Write the lab report intro', 'Finish the physics problem set', 'Apply to the summer internship'])
    expect(p.blocks.length).toBeGreaterThanOrEqual(3)
    for (const b of p.blocks) for (const c of classes) expect(overlaps(b, c.start.slice(11, 16), c.end.slice(11, 16))).toBe(false)
    expect(p.blocks.every((b) => b.start >= '07:30' && toMin(b.start) + b.minutes <= toMin('22:00'))).toBe(true)
    // Every other task is in "Also today" (nothing is lost).
    expect((p.also ?? []).length + (p.deferred ?? []).length).toBe(9)
    // Lunch and a share of free time are kept: at most one lower task waits for tomorrow, with the reason.
    expect((p.also ?? []).length).toBeGreaterThanOrEqual(8)
    expect((p.deferred ?? []).every((d) => d.why.length > 0)).toBe(true)
    expect(unaccounted(p, tasks)).toEqual([])
    // Sorted by priority, each with a time estimate.
    const pr = (p.also ?? []).map((a) => a.priority)
    expect(pr).toEqual([...pr].sort((a, b) => b - a))
    expect((p.also ?? []).every((a) => a.minutes > 0)).toBe(true)
    // Small tasks batched into one block.
    const quick = p.blocks.find((b) => b.kind === 'quick')
    expect(quick?.tasks).toEqual(expect.arrayContaining(['Reply to the club email', 'Pay the phone bill', 'Buy printer paper', 'Check the job board 15 min']))
    expect(p.why).toMatch(/12 tasks and 3 events/)
    expect(p.headline).toMatch(/3 must-dos · \d blocks/)
  })

  it('a short night lowers the load but never to one tiny block', () => {
    const p = packDay({ ...base, sleptMin: 335 })
    expect(p.blocks.length).toBeGreaterThanOrEqual(3)
    expect(p.blocks.length).toBeLessThanOrEqual(5)
    expect(p.blocks.every((b) => b.minutes <= 60)).toBe(true)
    expect(p.blocks.reduce((t, b) => t + b.minutes, 0)).toBeLessThanOrEqual(240)
    expect((p.deferred ?? []).every((d) => /Short night/.test(d.why))).toBe(true)
    expect(p.headline).toContain('Short night (5h35)')
    expect(p.why).toContain('Short night')
    expect(p.light).toBe(true)
    // Not lightened a second time.
    expect(lightenForSleep(p, 335)).toBe(p)
    expect(unaccounted(p, tasks)).toEqual([])
  })

  it('urgent and overdue tasks get a slot first, and the free time is filled before anything waits', () => {
    const two = [ev('Morning class', '08:00', '09:30'), ev('Afternoon class', '13:00', '14:30')]
    const list: PlanTask[] = [
      { id: 'a', content: 'Ship the settings screen', priority: 2, project: 'Projects' },
      { id: 'b', content: 'Revise algebra chapter 4', priority: 2, project: 'University' },
      { id: 'c', content: 'Gym plan for next week', priority: 1, project: 'Life' },
      { id: 'd', content: 'Draft the networking lab report', priority: 4, project: 'University', due: '2030-03-10', duration: 60 },
      { id: 'e', content: 'Update the CV projects section', priority: 3, project: 'Job & Career' },
      { id: 'f', content: 'Try one beginner CTF challenge', priority: 2, project: 'Cyber' },
      { id: 'g', content: 'Watch the refactoring talk, part 1', priority: 1, project: 'Cyber' },
      { id: 'h', content: 'Pay the internet bill', priority: 1, project: 'Inbox' },
      { id: 'i', content: 'Email the lab partner', priority: 1, project: 'Inbox' }
    ]
    const p = packDay({ ...base, now: '07:00', events: two, tasks: list, top3: ['Ship the settings screen', 'Revise algebra chapter 4', 'Gym plan for next week'] })
    const lab = p.blocks.find((b) => b.tasks?.includes('Draft the networking lab report'))
    expect(lab).toBeTruthy()
    // It gets the first free slot after the must-dos, before the lower-priority work.
    const low = p.blocks.find((b) => b.tasks?.includes('Watch the refactoring talk, part 1'))
    if (low) expect(lab!.start < low.start).toBe(true)
    // There's room for everything: nothing waits without a slot, nothing moves to tomorrow.
    expect((p.also ?? []).every((a) => !!a.at)).toBe(true)
    expect(p.deferred).toEqual([])
    expect(unaccounted(p, list)).toEqual([])
    expect(p.blocks.some((b) => b.start >= '15:00')).toBe(true)
  })

  it('a really full day: urgent work first, the rest moves to tomorrow with the reason', () => {
    const busy = [ev('Lectures', '07:00', '12:00'), ev('Work shift', '13:30', '22:00')]
    // (Lunch is tested on its own: here the one gap at noon is for work.)
    const p = packDay({ ...base, events: busy, meal: null })
    expect(p.blocks.length).toBeGreaterThan(0)
    expect((p.also ?? []).every((a) => !!a.at)).toBe(true)
    const placedPrio = (p.also ?? []).map((a) => a.priority)
    const waiting = tasks.filter((t) => (p.deferred ?? []).some((d) => d.id === t.id)).map((t) => t.priority ?? 1)
    if (placedPrio.length && waiting.length) expect(Math.max(...waiting)).toBeLessThanOrEqual(Math.max(...placedPrio))
    expect((p.deferred ?? []).every((d) => /full/.test(d.why))).toBe(true)
  })

  it('a quick must-do goes into the quick block, not its own 40 minutes', () => {
    const p = packDay({ ...base, top3: ['Check the job board 15 min'] })
    expect(p.mustdos[0]).toBe('Check the job board 15 min')
    expect(p.blocks.find((b) => b.title === 'Check the job board 15 min')).toBeUndefined()
    expect(p.blocks.find((b) => b.kind === 'quick')?.tasks).toContain('Check the job board 15 min')
  })

  it('behind-pace goals get time first', () => {
    const p = packDay({ ...base, goals: [{ title: 'Goal: Save for a laptop', minutes: 25 }] })
    expect(p.blocks.some((b) => b.kind === 'goal' && b.title === 'Goal: Save for a laptop')).toBe(true)
  })

  it('a full day moves low tasks to tomorrow with the reason', () => {
    const busy = [ev('Lectures', '07:00', '17:00'), ev('Work shift', '17:30', '21:30')]
    const p = packDay({ ...base, events: busy })
    expect(unaccounted(p, tasks)).toEqual([])
    expect((p.deferred ?? []).every((d) => d.why.length > 0)).toBe(true)
  })

  it('estimates: Todoist duration first, then the words', () => {
    expect(estimateMinutes({ content: 'Anything', duration: 40 })).toBe(40)
    expect(estimateMinutes({ content: 'Check the mail' })).toBe(15)
    expect(estimateMinutes({ content: 'Study for the exam', priority: 4 })).toBe(60)
    expect(estimateMinutes({ content: 'Read 20 min' })).toBe(20)
  })

  it('keeps the model plan when it is good, and fills in every task it forgot', () => {
    const packed = packDay(base)
    const model = { ...packed, blocks: packed.blocks.slice(0, 6), also: [{ title: 'Pay the phone bill', minutes: 5, priority: 1 }], deferred: [{ title: 'Buy printer paper', why: 'The shop is closed today' }] }
    const out = checkModelPlan(model, packed, tasks)
    expect(out.blocks).toHaveLength(6)
    expect(out.deferred).toEqual([{ title: 'Buy printer paper', why: 'The shop is closed today' }])
    expect(out.also).toHaveLength(8)
    expect(out.also?.find((a) => a.title === 'Pay the phone bill')?.minutes).toBe(5)
    expect(unaccounted(out, tasks)).toEqual([])
  })

  it('falls back to the packer when the model returns too little', () => {
    const packed = packDay(base)
    const thin = { ...packed, blocks: packed.blocks.slice(0, 1), also: [] }
    expect(checkModelPlan(thin, packed, tasks).blocks).toEqual(packed.blocks)
  })

  it('"add X" and "move Y to the afternoon" change the plan in code', () => {
    const p = packDay({ ...base, tasks: tasks.slice(0, 7) })
    const free = (p.also ?? []).find((a) => !a.at)
    if (free) {
      const added = editPlan(p, `add ${free.title}`)!
      expect(added.blocks.length).toBe(p.blocks.length + 1)
      expect(added.also?.find((a) => a.title === free.title)?.at).toBeTruthy()
    }
    const walk = editPlan(p, 'add a walk this evening 30 min')!
    const block = walk.blocks.find((b) => b.title === 'walk')!
    expect(block.start >= '18:00').toBe(true)
    // A day block short enough for the evening's free time.
    const first = p.blocks.find((b) => b.start < '17:00' && b.minutes <= 45 && (b.tasks?.length ?? 0) <= 1)!
    const moved = editPlan(p, `move ${first.title} to the evening`)!
    const after = moved.blocks.find((b) => b.title === first.title)!
    expect(after.start >= '18:00').toBe(true)
    if (moved.training) expect(overlaps(after, moved.training.time, `${String(Math.floor(toMin(moved.training.time) / 60) + 1).padStart(2, '0')}${moved.training.time.slice(2)}`)).toBe(false)
    // A small task inside the quick block moves on its own.
    const q = packDay({ ...base, tasks: [...tasks.slice(0, 2), ...tasks.slice(7, 10)] })
    const split = editPlan(q, 'move the phone bill to the evening')!
    expect(split.blocks.find((b) => b.title === 'Pay the phone bill')!.start >= '18:00').toBe(true)
    expect(split.blocks.find((b) => b.kind === 'quick')!.tasks).not.toContain('Pay the phone bill')
    for (const c of classes) expect(overlaps(after, c.start.slice(11, 16), c.end.slice(11, 16))).toBe(false)
  })

  it('the Telegram text lists "Also today" and the reason', () => {
    const p = packDay(base)
    const t = proposalText(p)
    // Only tasks without a block: a task in a block is listed under its block, not again.
    const open = (p.also ?? []).filter((a) => !a.at).length
    if (open) expect(t).toContain(`Also today (${open})`)
    else expect(t).not.toContain('Also today')
    const group = p.blocks.find((b) => (b.tasks ?? []).length > 1)!
    for (const x of group.tasks!) expect(t.split(x.replace(/&/g, '&amp;')).length - 1).toBe(1)
    expect(t).toContain('12 tasks')
  })
})

describe('the workout slot in the plan (BD8)', () => {
  const shift = { from: '17:00', to: '23:59', mode: 'normal' as const, busy: { from: '17:00', to: '23:59' }, light: null }
  const end = (start: string, m: number) => {
    const t = toMin(start) + m
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
  }
  it('books the workout before the evening shift, around the classes, as the plan training block', () => {
    const p = packDay({ ...base, work: shift, train: { minutes: 30 } })
    expect(p.training).toMatchObject({ what: 'Workout · 30 min', minutes: 30 })
    const t = toMin(p.training!.time)
    expect(t).toBeGreaterThanOrEqual(toMin('12:00'))
    expect(t + 30).toBeLessThanOrEqual(toMin('16:30'))
    for (const c of classes) expect(overlaps({ start: p.training!.time, minutes: 30 }, c.start.slice(11, 16), c.end.slice(11, 16))).toBe(false)
    for (const b of p.blocks) expect(overlaps(b, p.training!.time, end(p.training!.time, 30))).toBe(false)
  })
  it('no workout once it is done, and never after 22:00', () => {
    expect(packDay({ ...base, workoutDone: true, train: { minutes: 30 } }).training).toBeNull()
    expect(packDay({ ...base, now: '21:40', train: { minutes: 30 } }).training).toBeNull()
  })

  it('always leaves free time, a lunch break and a real break after long deep work', () => {
    // Lots of work and a nearly empty day (the "6h10 of focus in 7h free" case).
    const many: PlanTask[] = Array.from({ length: 14 }, (_, i) => ({ id: `w${i}`, content: `Write chapter ${i + 1} of the report`, priority: 3, project: 'University', due: today, duration: 90 }))
    for (const [events, now] of [[[], '09:00'], [[ev('Shift', '16:00', '19:00')], '10:00'], [classes, '07:30']] as const) {
      const p = packDay({ ...base, now, events: [...events], tasks: many, workoutDone: true })
      const freeMin = (p.free ?? []).reduce((t, w) => t + toMin(w.end) - toMin(w.start), 0)
      const focus = p.blocks.reduce((t, b) => t + b.minutes, 0)
      // At least 15% of the free time stays unplanned.
      expect(focus).toBeLessThanOrEqual(freeMin * 0.85)
      // Lunch: 30 free minutes between 12:00 and 14:00 when the plan runs through it.
      const lunchBusy = p.blocks.filter((b) => toMin(b.start) < toMin('14:00') && toMin(b.start) + b.minutes > toMin('12:00'))
      if (lunchBusy.length) {
        const spans = [...lunchBusy.map((b) => [toMin(b.start), toMin(b.start) + b.minutes]), ...events.map((e) => [toMin(e.start.slice(11, 16)), toMin(e.end.slice(11, 16))])].sort((a, c) => a[0] - c[0])
        let at = toMin('12:00')
        let gap = 0
        for (const [s0, e0] of spans) {
          gap = Math.max(gap, Math.min(s0, toMin('14:00')) - at)
          at = Math.max(at, e0)
        }
        gap = Math.max(gap, toMin('14:00') - at)
        expect(gap).toBeGreaterThanOrEqual(30)
      }
      // Never back to back: 15 min after a block of an hour or more, 10 after a shorter one.
      const sorted = [...p.blocks].sort((a, c) => a.start.localeCompare(c.start))
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]
        const gapMin = toMin(sorted[i].start) - (toMin(prev.start) + prev.minutes)
        expect(gapMin).toBeGreaterThanOrEqual(prev.minutes >= 60 && prev.kind !== 'quick' ? 15 : 10)
      }
      expect(p.why).toMatch(/left free/)
    }
  })

  it('the free share comes from My life', () => {
    const many: PlanTask[] = Array.from({ length: 14 }, (_, i) => ({ id: `w${i}`, content: `Write chapter ${i + 1}`, priority: 3, due: today, duration: 90 }))
    const focusOf = (share?: number) => packDay({ ...base, now: '09:00', events: [], tasks: many, workoutDone: true, endBy: '17:00', freeShare: share }).blocks.reduce((t, b) => t + b.minutes, 0)
    expect(focusOf(0.3)).toBeLessThan(focusOf(0.1))
  })
})
