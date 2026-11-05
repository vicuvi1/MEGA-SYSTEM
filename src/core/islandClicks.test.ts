import { describe, expect, it } from 'vitest'
import { finalShapeRect, inRects, padRect, roundOut, SHIELD_MS, SHIELD_OFF, shieldStep, snapshotKey, tapVerdict, targetRects, unionRect } from './islandClicks'

describe('island click area', () => {
  it('the shape ends where its anchor says: left, middle or right', () => {
    expect(finalShapeRect({ anchor: 'center', ax: 250, top: 6, w: 400, h: 90 })).toEqual({ x: 50, y: 6, w: 400, h: 90 })
    expect(finalShapeRect({ anchor: 'left', ax: 6, top: 21, w: 400, h: 90 })).toEqual({ x: 6, y: 21, w: 400, h: 90 })
    expect(finalShapeRect({ anchor: 'right', ax: 494, top: 21, w: 400, h: 90 })).toEqual({ x: 94, y: 21, w: 400, h: 90 })
  })
  it('while it grows, the area is where it is now and where it ends together', () => {
    const pill = { x: 175, y: 6, w: 150, h: 38 }
    const peek = { x: 50, y: 6, w: 400, h: 90 }
    expect(unionRect(pill, peek)).toEqual(peek)
    expect(targetRects([pill], [peek])).toEqual([peek])
    // The right end of a growing peek (where "Stop & log" sits) is already in.
    expect(inRects(445, 50, targetRects([pill], [peek]))).toBe(true)
    expect(targetRects([], [peek])).toEqual([peek])
    expect(targetRects([pill], [])).toEqual([pill])
  })
  it('pads and rounds out to whole pixels', () => {
    expect(padRect({ x: 10, y: 10, w: 10, h: 10 }, 12)).toEqual({ x: -2, y: -2, w: 34, h: 34 })
    expect(roundOut({ x: 10.6, y: 0.2, w: 10.1, h: 5.5 })).toEqual({ x: 10, y: 0, w: 11, h: 6 })
    expect(inRects(0, 0, [{ x: 10, y: 10, w: 10, h: 10 }], 12)).toBe(true)
    expect(inRects(0, 0, [{ x: 10, y: 10, w: 0, h: 10 }], 12)).toBe(false)
  })
})

describe('click shield', () => {
  it('takes clicks at once on the shape', () => {
    expect(shieldStep(SHIELD_OFF, { inside: true, pressed: false, now: 1000 })).toEqual({ st: { take: true, lastInside: 1000 }, recheckIn: null })
  })
  it('keeps taking them for a moment after the pointer left, then lets them through', () => {
    const on = { take: true, lastInside: 1000 }
    const r = shieldStep(on, { inside: false, pressed: false, now: 1100 })
    expect(r.st.take).toBe(true)
    expect(r.recheckIn).toBe(SHIELD_MS - 100)
    expect(shieldStep(on, { inside: false, pressed: false, now: 1000 + SHIELD_MS }).st.take).toBe(false)
  })
  it('never lets go while a button is held', () => {
    const on = { take: true, lastInside: 1000 }
    expect(shieldStep(on, { inside: false, pressed: true, now: 9000 }).st.take).toBe(true)
    // ...but a press doesn't start taking clicks off the island.
    expect(shieldStep(SHIELD_OFF, { inside: false, pressed: true, now: 9000 }).st.take).toBe(false)
  })
})

describe('taps fire on release', () => {
  const base = { now: 10_000, moved: 0, dragging: false }
  it('fires when the press and the release are on the same button, even redrawn', () => {
    expect(tapVerdict({ ...base, downId: 'peek:stop', downAt: 9900, upId: 'peek:stop' })).toBe('fire')
  })
  it('not on another button, not after a drag, not when it travelled', () => {
    expect(tapVerdict({ ...base, downId: 'peek:stop', downAt: 9900, upId: 'peek' })).toBe('none')
    expect(tapVerdict({ ...base, downId: 'peek:stop', downAt: 9900, upId: 'peek:stop', dragging: true })).toBe('none')
    expect(tapVerdict({ ...base, downId: 'peek:stop', downAt: 9900, upId: 'peek:stop', moved: 12 })).toBe('none')
    expect(tapVerdict({ ...base, downId: null, downAt: 9900, upId: 'peek:stop' })).toBe('none')
    expect(tapVerdict({ ...base, downId: 'x', downAt: 9900, upId: null })).toBe('none')
  })
  it('a release whose press Windows swallowed still counts', () => {
    expect(tapVerdict({ ...base, downId: null, downAt: 0, upId: 'peek:stop' })).toBe('lost-down')
    expect(tapVerdict({ ...base, downId: 'old', downAt: 1000, upId: 'peek:stop' })).toBe('lost-down')
  })
  it('never twice for one release', () => {
    expect(tapVerdict({ ...base, downId: null, downAt: 0, upId: 'peek:stop', lastFireId: 'peek:stop', lastFireAt: 9900 })).toBe('none')
  })
})

describe('snapshots', () => {
  it('the same picture at another time is the same key', () => {
    const a = { at: 1, water: { ml: 500 }, ben: { last: { at: 'x' } } }
    expect(snapshotKey(a)).toBe(snapshotKey({ ...a, at: 2 }))
    expect(snapshotKey(a)).not.toBe(snapshotKey({ ...a, water: { ml: 750 } }))
    // A message's own time still counts.
    expect(snapshotKey(a)).not.toBe(snapshotKey({ ...a, ben: { last: { at: 'y' } } }))
  })
})
