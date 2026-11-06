import { describe, expect, it } from 'vitest'
import { entriesOf, liveIds, mergeEvents, numberDeltas, toggleId, totalsOf, withTotals, deviceSource, type BodyEvent } from './bodyLog'

const ev = (id: string, amount: number, extra: Partial<BodyEvent> = {}): BodyEvent => ({ id, at: `2026-11-06T10:00:0${id.length % 10}.000Z`, day: '2026-11-06', kind: 'water', amount, source: 'pc', undoes: null, ...extra })

describe('the water and reps log', () => {
  it('sums the day, never below 0, and keeps each row once when two devices merge', () => {
    const phone = [ev('a', 500), ev('b', 250)]
    const pc = [ev('b', 250), ev('c', -250)]
    const all = mergeEvents(phone, pc)
    expect(all.map((e) => e.id).sort()).toEqual(['a', 'b', 'c'])
    expect(totalsOf(all, '2026-11-06').water).toBe(500)
    expect(totalsOf([ev('x', -300)], '2026-11-06').water).toBe(0)
    expect(totalsOf(all, '2026-11-07')).toEqual({})
  })

  it('remove and bring back: a chain of cancels, the newest link decides, the same id on every device', () => {
    let rows = [ev('a', 500), ev('b', 250)]
    const t1 = toggleId(rows, 'b')
    expect(t1).toEqual({ id: 'x-b', undoes: 'b' })
    rows = [...rows, ev(t1.id, 0, { undoes: t1.undoes })]
    expect(totalsOf(rows, '2026-11-06').water).toBe(500)
    expect(entriesOf(rows, '2026-11-06', 'water').find((e) => e.id === 'b')?.removed).toBe(true)
    // Removed on two devices at once: the same row, counted once.
    expect(mergeEvents(rows, [ev('x-b', 0, { undoes: 'b' })]).length).toBe(3)
    const t2 = toggleId(rows, 'b')
    expect(t2).toEqual({ id: 'x-x-b', undoes: 'x-b' })
    rows = [...rows, ev(t2.id, 0, { undoes: t2.undoes })]
    expect(totalsOf(rows, '2026-11-06').water).toBe(750)
    expect([...liveIds(rows)].sort()).toEqual(['a', 'b', 'x-x-b'])
  })

  it("a copy's change becomes rows; a new day or a new exercise is not a change", () => {
    const a = { lastDate: '2026-11-06', water: { currentMl: 250 }, exercises: [{ id: 'ex_pushups', doneToday: 10 }] }
    const b = { lastDate: '2026-11-06', water: { currentMl: 500 }, exercises: [{ id: 'ex_pushups', doneToday: 5 }, { id: 'ex_new', doneToday: 9 }] }
    expect(numberDeltas(a, b)).toEqual([{ kind: 'water', amount: 250 }, { kind: 'reps:ex_pushups', amount: -5 }])
    expect(numberDeltas(a, { ...b, lastDate: '2026-11-07' })).toEqual([])
  })

  it("writes the log's sums into a copy (and the training calendar's today), dropping old take-back marks", () => {
    const st = { lastDate: '2026-11-06', water: { currentMl: 100, fixedAt: 9 }, exercises: [{ id: 'ex_pushups', doneToday: 3, fixedAt: 9 }], days: { '2026-11-06': { ex_pushups: 3 } } }
    const out = withTotals(st, '2026-11-06', { water: 750, 'reps:ex_pushups': 40 })
    expect(out.water).toEqual({ currentMl: 750 })
    expect(out.exercises[0]).toEqual({ id: 'ex_pushups', doneToday: 40 })
    expect(out.days['2026-11-06']).toEqual({ ex_pushups: 40 })
    expect(withTotals(st, '2026-11-07', { water: 1 })).toBe(st)
  })

  it('names the device', () => {
    expect(deviceSource({ userAgent: 'Mozilla/5.0 (iPhone)' }, false)).toBe('phone')
    expect(deviceSource({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }, false)).toBe('web')
    expect(deviceSource({ userAgent: 'anything' }, true)).toBe('pc')
  })
})
