import { describe, expect, it } from 'vitest'
import { BAND_STRIP, boxesOverlap, layoutDay, minLenFor } from './calLayout'

const e = (id: string, s: number, en: number) => ({ id, start: s * 60, end: en * 60 })
const by = (r: ReturnType<typeof layoutDay<{ id: string; start: number; end: number }>>) => Object.fromEntries(r.placed.map((p) => [p.it.id, p]))

describe('calendar day layout', () => {
  it('a long window with things inside becomes a band; the things get the width', () => {
    const r = layoutDay([e('window', 18, 22), e('a', 18.5, 19), e('b', 19, 20), e('c', 20, 21)])
    const p = by(r)
    expect(p.window).toMatchObject({ backdrop: true, left: 0, width: 100 })
    // They leave a strip on the left for the band's name (U8).
    expect(p.a).toMatchObject({ backdrop: false, left: BAND_STRIP, width: 100 - BAND_STRIP })
    expect(p.b.width).toBe(100 - BAND_STRIP)
  })

  it('overlaps share the width and widen where they can', () => {
    const p = by(layoutDay([e('a', 9, 11), e('b', 9, 10), e('c', 10, 11)]))
    expect(p.a).toMatchObject({ left: 0, width: 50 })
    expect(p.b).toMatchObject({ left: 50, width: 50 })
    expect(p.c).toMatchObject({ left: 50, width: 50 })
    // A long one (under 2½ h) with two short ones next to it keeps half each.
    const q = by(layoutDay([e('x', 9, 11), e('y', 9, 10), e('z', 10.5, 11)]))
    expect(q.y.width).toBe(50)
  })

  it('more than 3 side by side folds into +N more', () => {
    const r = layoutDay([e('a', 9, 10), e('b', 9, 10), e('c', 9, 10), e('d', 9, 10), e('f', 9, 10)])
    expect(r.placed.map((p) => p.it.id)).toEqual(['a', 'b'])
    expect(r.placed[0].width).toBeCloseTo(100 / 3)
    expect(r.more).toHaveLength(1)
    expect(r.more[0].items.map((x) => x.id)).toEqual(['c', 'd', 'f'])
    expect(r.more[0].left).toBeCloseTo(200 / 3)
  })

  it('separate times never squeeze each other', () => {
    const p = by(layoutDay([e('a', 9, 10), e('b', 10, 11), e('c', 14, 15)]))
    expect([p.a.width, p.b.width, p.c.width]).toEqual([100, 100, 100])
  })
})

describe('side by side, like a calendar app', () => {
  const m = (id: string, s: string, en: string, allDay = false) => ({ id, start: Number(s.slice(0, 2)) * 60 + Number(s.slice(3)), end: Number(en.slice(0, 2)) * 60 + Number(en.slice(3)), allDay })
  const noCover = (r: ReturnType<typeof layoutDay<ReturnType<typeof m>>>, minLen = 0) => {
    for (const a of r.placed) for (const b of r.placed) if (a !== b && !a.backdrop && !b.backdrop) expect(boxesOverlap(a, b, minLen), `${a.it.id} covers ${b.it.id}`).toBe(false)
  }

  it('3 events in 30 minutes get 3 columns of equal width', () => {
    const r = layoutDay([m('a', '17:00', '17:30'), m('b', '17:10', '17:30'), m('c', '17:15', '17:30')])
    const p = Object.fromEntries(r.placed.map((x) => [x.it.id, x]))
    expect([p.a.col, p.b.col, p.c.col]).toEqual([0, 1, 2])
    for (const x of r.placed) {
      expect(x.cols).toBe(3)
      expect(x.width).toBeCloseTo(100 / 3)
    }
    noCover(r)
  })

  it('short events back to back sit side by side once drawn taller than they last', () => {
    // 16:45, 17:00, 17:15 (15–20 min each): drawn 36 min tall, they would cover each other in one column.
    const evs = [m('prep', '16:45', '17:00'), m('standup', '17:00', '17:15'), m('sport', '17:15', '17:35')]
    expect(layoutDay(evs).placed.every((x) => x.width === 100)).toBe(true)
    const r = layoutDay(evs, { minLen: 36 })
    expect(new Set(r.placed.map((x) => x.left)).size).toBe(3)
    noCover(r, 36)
    expect(minLenFor(24, 40)).toBe(36)
  })

  it('a nested event takes the second column; the outer one keeps the first', () => {
    const r = layoutDay([m('outer', '09:00', '11:00'), m('inner', '09:30', '10:00')])
    const p = Object.fromEntries(r.placed.map((x) => [x.it.id, x]))
    expect(p.outer).toMatchObject({ col: 0, left: 0, width: 50, backdrop: false })
    expect(p.inner).toMatchObject({ col: 1, left: 50, width: 50 })
    noCover(r)
  })

  it('a chain of overlaps is one cluster; a free column lets an event widen', () => {
    // a overlaps b, b overlaps c, a and c don't touch: 2 columns, c reuses a's column.
    const r = layoutDay([m('a', '10:00', '11:00'), m('b', '10:30', '11:30'), m('c', '11:00', '12:00'), m('d', '13:00', '14:00')])
    const p = Object.fromEntries(r.placed.map((x) => [x.it.id, x]))
    expect([p.a.col, p.b.col, p.c.col]).toEqual([0, 1, 0])
    expect(p.c.cols).toBe(2)
    expect(p.d).toMatchObject({ cols: 1, width: 100 })
    // Expand into free columns: e starts when y and z are over, so it takes columns 2 and 3.
    const q = layoutDay([m('x', '09:00', '10:00'), m('y', '09:00', '09:30'), m('z', '09:00', '09:20'), m('e', '09:30', '10:00')])
    const pq = Object.fromEntries(q.placed.map((x) => [x.it.id, x]))
    expect(pq.y.col).toBe(1)
    expect(pq.e.col).toBe(1)
    expect(pq.e.width).toBeCloseTo(200 / 3)
    noCover(r)
    noCover(q)
  })

  it('all-day events are kept apart and never squeeze the timed ones', () => {
    const r = layoutDay([m('trip', '00:00', '23:59', true), m('lecture', '09:00', '10:30'), m('gym', '18:00', '19:00')])
    expect(r.allDay.map((x) => x.id)).toEqual(['trip'])
    expect(r.placed.map((x) => x.it.id).sort()).toEqual(['gym', 'lecture'])
    expect(r.placed.every((x) => x.width === 100 && !x.backdrop)).toBe(true)
  })

  it('a long window behind others is a band, the rest side by side within it', () => {
    const r = layoutDay([m('window', '18:00', '22:00'), m('a', '18:30', '19:00'), m('b', '18:30', '19:15'), m('c', '20:00', '21:00')], { minLen: 20 })
    const p = Object.fromEntries(r.placed.map((x) => [x.it.id, x]))
    expect(p.window.backdrop).toBe(true)
    expect(p.a.left).toBeGreaterThanOrEqual(BAND_STRIP)
    expect(p.a.width + p.b.width).toBeCloseTo(100 - BAND_STRIP)
    noCover(r, 20)
  })
})
