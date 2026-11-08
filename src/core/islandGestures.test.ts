import { describe, expect, it } from 'vitest'
import { gestureAction, gestureOf, wheelSwipe, GESTURE } from './islandGestures'

describe('gestureOf', () => {
  it('tap and long press', () => {
    expect(gestureOf({ dx: 2, dy: 3, ms: 120 })).toBe('tap')
    expect(gestureOf({ dx: 2, dy: 1, ms: GESTURE.longPressMs })).toBe('longPress')
  })
  it('swipes by the main axis', () => {
    expect(gestureOf({ dx: -60, dy: 5, ms: 300 })).toBe('swipeLeft')
    expect(gestureOf({ dx: 60, dy: -10, ms: 300 })).toBe('swipeRight')
    expect(gestureOf({ dx: 4, dy: -50, ms: 300 })).toBe('swipeUp')
    expect(gestureOf({ dx: 4, dy: 50, ms: 300 })).toBe('swipeDown')
  })
  it('a quick short flick counts, a slow short move and a diagonal do not', () => {
    expect(gestureOf({ dx: -25, dy: 0, ms: 30 })).toBe('swipeLeft')
    expect(gestureOf({ dx: -25, dy: 0, ms: 400 })).toBeNull()
    expect(gestureOf({ dx: 50, dy: 45, ms: 200 })).toBeNull()
  })
})

describe('wheelSwipe (trackpad)', () => {
  it('adds up sideways scroll into one swipe', () => {
    let r = wheelSwipe(0, 30, 2)
    expect(r.gesture).toBeNull()
    r = wheelSwipe(r.acc, 35, 1)
    expect(r).toEqual({ gesture: 'swipeLeft', acc: 0 })
    expect(wheelSwipe(0, -70, 0).gesture).toBe('swipeRight')
  })
  it('ignores mostly vertical scroll and restarts on a change of direction', () => {
    expect(wheelSwipe(40, 10, 50)).toEqual({ gesture: null, acc: 40 })
    expect(wheelSwipe(50, -20, 0)).toEqual({ gesture: null, acc: -20 })
  })
})

describe('gestureAction', () => {
  const on = { split: true, enabled: true }
  it('split halves: tap peeks that half, long press its menu, swipe swaps', () => {
    expect(gestureAction('tap', 'right', on)).toEqual({ do: 'peek', side: 'right' })
    expect(gestureAction('hover', 'left', on)).toEqual({ do: 'peek', side: 'left' })
    expect(gestureAction('longPress', 'left', on)).toEqual({ do: 'menu', side: 'left' })
    expect(gestureAction('swipeLeft', 'right', on)).toEqual({ do: 'swap' })
    expect(gestureAction('swipeRight', 'pill', on)).toEqual({ do: 'swap' })
  })
  it('no split: swipes switch views; peek and card close on swipe up', () => {
    const one = { split: false, enabled: true }
    expect(gestureAction('swipeLeft', 'pill', one)).toEqual({ do: 'switch', dir: 1 })
    expect(gestureAction('swipeRight', 'card', one)).toEqual({ do: 'switch', dir: -1 })
    expect(gestureAction('swipeUp', 'peek', one)).toEqual({ do: 'close' })
    expect(gestureAction('swipeUp', 'card', one)).toEqual({ do: 'close' })
    expect(gestureAction('swipeUp', 'pill', one)).toBeNull()
    expect(gestureAction('swipeDown', 'pill', one)).toEqual({ do: 'open' })
    expect(gestureAction('tap', 'pill', one)).toEqual({ do: 'open' })
    expect(gestureAction('tap', 'card', one)).toBeNull()
  })
  it('gestures off: only tap and hover', () => {
    const off = { split: true, enabled: false }
    expect(gestureAction('tap', 'left', off)).toEqual({ do: 'peek', side: 'left' })
    expect(gestureAction('hover', 'pill', off)).toEqual({ do: 'peek' })
    expect(gestureAction('longPress', 'left', off)).toBeNull()
    expect(gestureAction('swipeLeft', 'pill', off)).toBeNull()
  })
})
