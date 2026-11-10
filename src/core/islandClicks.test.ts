import { describe, expect, it } from 'vitest'
import { finalShapeRect, HOVER_INTENT_MS, HOVER_OFF, hoverStep, inRects, padRect, peekWaitAfterIntent, roundOut, SHIELD_MS, SHIELD_NEAR, SHIELD_OFF, SHIELD_PAD, shieldHit, shieldStep, snapshotKey, takeExpired, TAKE_TTL_MS, tapVerdict, targetRects, unionRect } from './islandClicks'
import { cleanIslandPrefs, HOVER_MIN_MS } from './islandModel'
import { HIDE_HOUR_ITEM, withHide } from './islandCommands'

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
    expect(shieldStep(SHIELD_OFF, { inside: true, pressed: false, now: 1000 })).toEqual({ st: { take: true, lastInside: 1000, pressIn: false }, recheckIn: null })
  })
  it('keeps taking them for a moment after the pointer left, then lets them through', () => {
    const on = { take: true, lastInside: 1000 }
    const r = shieldStep(on, { inside: false, pressed: false, now: 1100 })
    expect(r.st.take).toBe(true)
    expect(r.recheckIn).toBe(SHIELD_MS - 100)
    expect(shieldStep(on, { inside: false, pressed: false, now: 1000 + SHIELD_MS }).st.take).toBe(false)
  })
  it('never lets go while a press that began on it is held', () => {
    const on = { take: true, lastInside: 1000, pressIn: true }
    expect(shieldStep(on, { inside: false, near: false, pressed: true, now: 9000 }).st.take).toBe(true)
    // ...but a press doesn't start taking clicks off the island.
    expect(shieldStep(SHIELD_OFF, { inside: false, pressed: true, now: 9000 }).st.take).toBe(false)
  })
})

// IC30: the window is far bigger than the pill and takes clicks everywhere while it takes them.
describe('click shield stays tight (IC30)', () => {
  const pill = [{ x: 190, y: 0, w: 240, h: 40 }]
  it('starts taking clicks only ON the shape, never in the space around it', () => {
    expect(shieldHit(310, 20, pill, false)).toEqual({ inside: true, near: true })
    // 4 px under the pill (a browser tab strip): not yet.
    expect(shieldHit(310, 44, pill, false).inside).toBe(false)
    // Once taking, a few px of slack so the edge doesn't flicker.
    expect(shieldHit(310, 40 + SHIELD_PAD - 1, pill, true).inside).toBe(true)
    expect(shieldHit(310, 40 + SHIELD_PAD + 2, pill, true).inside).toBe(false)
    expect(shieldHit(310, 40 + SHIELD_NEAR - 2, pill, true).near).toBe(true)
    expect(shieldHit(310, 200, pill, true)).toEqual({ inside: false, near: false })
  })
  it('lets go at once when the pointer is well away (no linger over the apps below)', () => {
    const on = { take: true, lastInside: 1000 }
    expect(shieldStep(on, { inside: false, near: false, pressed: false, now: 1010 }).st.take).toBe(false)
    // Still close: only a short moment.
    const r = shieldStep(on, { inside: false, near: true, pressed: false, now: 1050 })
    expect(r.st.take).toBe(true)
    expect(r.recheckIn).toBe(SHIELD_MS - 50)
    expect(SHIELD_MS).toBeLessThanOrEqual(200)
  })
  it('a press that began off the shape lets the clicks go', () => {
    const on = { take: true, lastInside: 1000, pressIn: false }
    expect(shieldStep(on, { inside: false, near: false, pressed: true, now: 1500 }).st.take).toBe(false)
    // A press right at the edge just after leaving still belongs to the island (a quick flick off the pill).
    const edge = shieldStep(on, { inside: false, near: true, pressed: true, now: 1050 })
    expect(edge.st).toMatchObject({ take: true, pressIn: true })
    expect(shieldStep(edge.st, { inside: false, near: false, pressed: true, now: 4000 }).st.take).toBe(true)
    expect(shieldStep(edge.st, { inside: false, near: false, pressed: false, now: 4000 }).st.take).toBe(false)
  })
  it('the desktop lets clicks through by itself when the page stops repeating "take"', () => {
    expect(takeExpired({ taking: true, lastTakeAt: 1000, now: 1000 + TAKE_TTL_MS - 1 })).toBe(false)
    expect(takeExpired({ taking: true, lastTakeAt: 1000, now: 1000 + TAKE_TTL_MS + 1 })).toBe(true)
    expect(takeExpired({ taking: false, lastTakeAt: 0, now: 99_999 })).toBe(false)
  })
})

describe('hover intent (IC30)', () => {
  it('a pass over the pill does nothing; resting on it counts as hover', () => {
    let g = hoverStep(HOVER_OFF, { onShape: true, take: true, now: 1000 })
    expect(g.st.over).toBe(false)
    expect(g.recheckIn).toBe(HOVER_INTENT_MS)
    // It moved off before the intent time: back to zero.
    g = hoverStep(g.st, { onShape: false, take: true, now: 1060 })
    expect(g.st).toEqual({ over: false, since: null })
    g = hoverStep(g.st, { onShape: true, take: true, now: 1100 })
    g = hoverStep(g.st, { onShape: true, take: true, now: 1100 + HOVER_INTENT_MS })
    expect(g.st.over).toBe(true)
    // Clicks pass through again: hover is over.
    expect(hoverStep(g.st, { onShape: false, take: false, now: 2000 }).st).toEqual(HOVER_OFF)
  })
  it('the peek waits the rest, so the whole wait is your setting, and never less than 300 ms', () => {
    expect(peekWaitAfterIntent(350) + HOVER_INTENT_MS).toBe(350)
    expect(peekWaitAfterIntent(50)).toBe(0)
    expect(HOVER_MIN_MS).toBeGreaterThanOrEqual(300)
    expect(cleanIslandPrefs({ hoverMs: 100 }).hoverMs).toBe(HOVER_MIN_MS)
    expect(cleanIslandPrefs({}).hoverMs).toBeGreaterThanOrEqual(300)
    expect(cleanIslandPrefs({}).hoverMs).toBeLessThanOrEqual(400)
  })
})

describe('get it out of the way (IC30)', () => {
  it('the right-click menu ends with Hide for 1 hour on the desktop', () => {
    const items = [{ id: 'm:pause', label: 'Pause', act: { kind: 'pause' } } as never]
    expect(withHide(items, true).at(-1)).toBe(HIDE_HOUR_ITEM)
    expect(HIDE_HOUR_ITEM.act).toBe('hide')
    expect(withHide(items, false)).toEqual(items)
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
