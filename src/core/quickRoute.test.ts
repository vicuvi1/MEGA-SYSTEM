import { describe, expect, it } from 'vitest'
import { canReplay, doneLine, findExerciseWord, routeOptions, routeQuick, type RouteCtx } from './quickRoute'
import { seedSaved } from './foodSaved'

const ctx: RouteCtx = {
  today: '2026-11-06',
  now: '08:30',
  exercises: [
    { id: 'ex_pushups', name: 'Push-ups' },
    { id: 'ex_situps', name: 'Sit-ups' },
    { id: 'ex_squats', name: 'Squats' }
  ],
  counter: null,
  habits: [
    { id: 'h1', name: 'Read 10 pages' },
    { id: 'h2', name: 'Stretch', done: true },
    { id: 'h3', name: 'Journal' }
  ]
}
const kind = (s: string, c: RouteCtx = ctx) => routeQuick(s, c)?.kind

describe('quickRoute: reps', () => {
  it.each(['50 pushups', 'pushups 50', '50 push-ups', '50 push ups', 'push ups 50', '50 pushup', '50 Pushups', '50x pushups', 'pushups50', '50 puhsups', '50 pusups', '50 press-ups'])('"%s" logs 50 push-ups', (s) => {
    const r = routeQuick(s, ctx)
    expect(r).toMatchObject({ kind: 'reps', exId: 'ex_pushups', n: 50 })
    expect(r!.chip).toBe('Log 50 Push-ups')
  })
  it('reads other exercises and sets', () => {
    expect(routeQuick('30 situps', ctx)).toMatchObject({ kind: 'reps', exId: 'ex_situps', n: 30 })
    expect(routeQuick('squat 20', ctx)).toMatchObject({ kind: 'reps', exId: 'ex_squats', n: 20 })
    expect(routeQuick('3x15 squats', ctx)).toMatchObject({ kind: 'reps', exId: 'ex_squats', n: 45 })
  })
  it('"+50" goes to the default counter: push-ups, or the one picked', () => {
    expect(routeQuick('+50', ctx)).toMatchObject({ kind: 'reps', exId: 'ex_pushups', n: 50 })
    expect(routeQuick('+ 20', { ...ctx, counter: 'ex_squats' })).toMatchObject({ kind: 'reps', exId: 'ex_squats', n: 20 })
    expect(kind('+50', { ...ctx, exercises: [] })).toBe('ask')
  })
  it('refuses silly numbers', () => {
    expect(kind('9000 pushups')).toBe('ask')
    expect(kind('+0')).toBe('ask')
  })
  it('a bare number offers reps first, then focus and water (Tab)', () => {
    const o = routeOptions('40', ctx).map((r) => r.kind)
    expect(o.slice(0, 3)).toEqual(['reps', 'focus', 'water'])
  })
})

describe('quickRoute: water', () => {
  it.each([
    ['500 ml', 500],
    ['500ml', 500],
    ['0.5 l', 500],
    ['1,5l', 1500],
    ['water 500', 500],
    ['water 2', 500],
    ['water', 250],
    ['2 glasses', 500],
    ['water 1 bottle', 500],
    ['drank 300ml', 300],
    ['330 ml of water', 330]
  ])('"%s" adds %i ml', (s, ml) => {
    expect(routeQuick(s, ctx)).toMatchObject({ kind: 'water', ml })
  })
  it('glass size can change', () => {
    expect(routeQuick('water 2', { ...ctx, glassMl: 300 })).toMatchObject({ ml: 600 })
  })
  it('too much at once asks', () => {
    expect(kind('water 9000')).toBe('ask')
    expect(kind('water lots')).toBe('ask')
  })
})

describe('quickRoute: tasks', () => {
  it('"task …" uses the quick-add parser', () => {
    const r = routeQuick('task lab report tomorrow 2h p1', ctx)
    expect(r?.kind).toBe('task')
    if (r?.kind !== 'task') return
    expect(r.task).toMatchObject({ title: 'Lab report', day: '2026-11-07', minutes: 120, p: 1 })
    expect(r.confirm).toBeUndefined()
    expect(r.chip).toMatch(/^New task: Lab report/)
  })
  it('todo: and t also work', () => {
    expect(kind('todo: call mom')).toBe('task')
    expect(kind('t buy milk')).toBe('task')
  })
  it('unknown text becomes a task, but asks first', () => {
    const r = routeQuick('buy a birthday card saturday', ctx)
    expect(r).toMatchObject({ kind: 'task', confirm: true })
    expect(r!.chip).toMatch(/^Add as a task\?/)
  })
  it('a task the parser has a question about asks it', () => {
    expect(routeQuick('task x', ctx)?.kind).toMatch(/task|ask/)
  })
})

describe('quickRoute: food, focus, notes, habits, money', () => {
  it('food words', () => {
    const r = routeQuick('ate 200g chicken', ctx)
    expect(r?.kind).toBe('food')
    if (r?.kind !== 'food') return
    expect(r.items).toHaveLength(1)
    expect(r.protein).toBeGreaterThan(30)
    expect(r.chip).toMatch(/^Log food: .*200 g · \d+ g protein$/)
    expect(kind('200g chicken, 2 eggs')).toBe('food')
    expect(kind('ate a dragon steak')).toBe('ask')
  })
  it('focus', () => {
    expect(routeQuick('focus 25', ctx)).toMatchObject({ kind: 'focus', minutes: 25, subject: 'Focus', chip: 'Start focus: 25 min' })
    expect(routeQuick('focus 25 Essay intro', ctx)).toMatchObject({ kind: 'focus', minutes: 25, subject: 'Essay intro' })
    expect(routeQuick('focus essay', ctx)).toMatchObject({ minutes: 25, subject: 'essay' })
    expect(routeQuick('f 500', ctx)).toMatchObject({ minutes: 180 })
  })
  it('notes', () => {
    expect(routeQuick('note call the bank about the card', ctx)).toMatchObject({ kind: 'note', text: 'call the bank about the card' })
  })
  it('habits: your own, typo-tolerant, never twice', () => {
    expect(routeQuick('done read', ctx)).toMatchObject({ kind: 'habit', id: 'h1' })
    expect(routeQuick('done jurnal', ctx)).toMatchObject({ kind: 'habit', id: 'h3' })
    expect(routeQuick('done stretch', ctx)).toMatchObject({ kind: 'ask' })
    expect(routeQuick('done fly', ctx)?.kind).toBe('ask')
  })
  it('money lines go to the bot rules', () => {
    expect(routeQuick('45 lunch', ctx)).toMatchObject({ kind: 'money', text: '45 lunch' })
    expect(kind('spent 30 on taxi')).toBe('money')
  })
})

describe('quickRoute: honest points', () => {
  it.each(['50 pushups yesterday', 'water 500 yesterday', 'ate 200g chicken yesterday', 'done read yesterday', '500 ml yesterday', '30 squats 2 hours ago'])('"%s" is refused (no back-dating)', (s) => {
    const r = routeQuick(s, ctx)
    expect(r?.kind).toBe('ask')
    expect(r!.chip).toMatch(/only what you do now/)
  })
})

describe('quickRoute: helpers', () => {
  it('empty lines give nothing', () => {
    expect(routeQuick('   ', ctx)).toBeNull()
    expect(routeOptions('', ctx)).toEqual([])
  })
  it('options are unique and Tab has more than one for unclear lines', () => {
    const o = routeOptions('45 lunch', ctx)
    expect(new Set(o.map((r) => r.chip)).size).toBe(o.length)
    expect(o.length).toBeGreaterThan(1)
  })
  it('finds exercises by id too, and not by tiny words', () => {
    expect(findExerciseWord('situp', ctx.exercises)?.id).toBe('ex_situps')
    expect(findExerciseWord('ab', ctx.exercises)).toBeNull()
  })
  it('done lines and replay rules', () => {
    expect(doneLine(routeQuick('50 pushups', ctx)!)).toBe('50 Push-ups logged')
    expect(doneLine(routeQuick('500 ml', ctx)!)).toBe('500 ml water added')
    expect(canReplay(routeQuick('500 ml', ctx)!)).toBe(true)
    expect(canReplay(routeQuick('task call mom', ctx)!)).toBe(false)
    expect(canReplay(routeQuick('focus 25', ctx)!)).toBe(false)
  })
})

describe('quickRoute: saved foods and meals come first', () => {
  const withSaved: RouteCtx = { ...ctx, saved: seedSaved() }
  it('"standard day" logs every slot as its own meal', () => {
    const r = routeQuick('standard day', withSaved)!
    expect(r).toMatchObject({ kind: 'food', name: 'Standard day', saved: true, kcal: 2332 })
    if (r.kind === 'food') expect(r.meals!.map((m) => m.slot)).toEqual(['ds-morning', 'ds-lunch', 'ds-afternoon', 'ds-evening', 'ds-anytime'])
    expect(r.chip).toBe('Log my standard day: 2,332 kcal · 118 g protein')
  })
  it('"breakfast" logs the saved breakfast; "2 eggs" logs two saved eggs', () => {
    expect(routeQuick('breakfast', withSaved)).toMatchObject({ kind: 'food', name: 'Breakfast: 3 eggs + 2 bread + banana', kcal: 486, saved: true })
    const eggs = routeQuick('2 eggs', withSaved)!
    expect(eggs).toMatchObject({ kind: 'food', name: '2 × Egg', kcal: 144, protein: 13 })
    if (eggs.kind === 'food') expect(eggs.items[0]).toMatchObject({ qty: 2, grams: 100 })
  })
  it('without saved foods, or for other lines, nothing changes', () => {
    expect(kind('breakfast')).toBe('task')
    expect(kind('50 pushups', withSaved)).toBe('reps')
    expect(kind('45 coffee', withSaved)).toBe('money')
    expect(kind('2 eggs yesterday', withSaved)).toBe('ask')
  })
})
