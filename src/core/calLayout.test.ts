import { describe, expect, it } from 'vitest'
import { layoutDay } from './calLayout'

const e = (id: string, s: number, en: number) => ({ id, start: s * 60, end: en * 60 })
const by = (r: ReturnType<typeof layoutDay<{ id: string; start: number; end: number }>>) => Object.fromEntries(r.placed.map((p) => [p.it.id, p]))

describe('calendar day layout', () => {
  it('a long window with things inside becomes a band; the things get the width', () => {
    const r = layoutDay([e('window', 18, 22), e('a', 18.5, 19), e('b', 19, 20), e('c', 20, 21)])
    const p = by(r)
    expect(p.window).toMatchObject({ backdrop: true, left: 0, width: 100 })
    expect(p.a).toMatchObject({ backdrop: false, left: 0, width: 100 })
    expect(p.b.width).toBe(100)
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
