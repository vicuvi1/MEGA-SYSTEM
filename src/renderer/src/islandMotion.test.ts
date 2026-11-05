// The island's motion helpers: the particle engine (IM4), the border path (IM2),
// jelly drag (IM6), the snap spots and bounce (IM7) and the lean (IM12).
import { describe, expect, it } from 'vitest'
import { GRAVITY, MAX_PARTICLES, makeBurst, stepParticles } from './IslandParticles'
import { roundedRectPath } from './islandShapes'
import { jellyScale, leanFor } from './islandWidgets'
import { cursorNear, dropPlacement, snapBounce } from '../../desktop/islandPlace'

describe('particles (IM4)', () => {
  it('a burst is ~60 bits, never more than the cap', () => {
    let r = 0
    const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280)
    expect(makeBurst({ x: 100, y: 20, colors: ['#fff'] }, rand)).toHaveLength(60)
    expect(makeBurst({ x: 0, y: 0, colors: ['#fff'], n: 999 }, rand)).toHaveLength(MAX_PARTICLES)
  })
  it('bits fall with gravity and die when their time is up', () => {
    const p = { x: 0, y: 0, vx: 100, vy: 0, life: 0, max: 0.5, size: 4, color: '#fff', rot: 0, vr: 0, round: false }
    const [a] = stepParticles([p], 0.1)
    expect(a.x).toBeCloseTo(10)
    expect(a.vy).toBeGreaterThan(GRAVITY * 0.1 * 0.8)
    expect(stepParticles([p], 0.6)).toEqual([])
  })
})

describe('the liquid border (IM2)', () => {
  it('starts at the top middle and goes round with the corners', () => {
    const d = roundedRectPath(200, 38, 19, 1)
    expect(d.startsWith('M100 1')).toBe(true)
    expect(d.match(/A/g)).toHaveLength(4)
    expect(d.endsWith('Z')).toBe(true)
  })
  it('never uses a corner bigger than half the height', () => {
    expect(roundedRectPath(100, 20, 40, 1)).toContain('A9 9')
  })
})

describe('jelly drag (IM6)', () => {
  it('stretches along the move, at most 6 %', () => {
    expect(jellyScale(0, 0)).toEqual({ sx: 1, sy: 1 })
    const s = jellyScale(10_000, 0)
    expect(s.sx).toBeCloseTo(1.06)
    expect(s.sy).toBeCloseTo(0.97)
  })
})

describe('snap to a spot (IM7)', () => {
  const sb = { x: 0, y: 0, width: 1920, height: 1080 }
  it('near the top: the nearest of top left, center and right', () => {
    expect(dropPlacement({ x: 300, y: 100 }, sb)).toBe('top-left')
    expect(dropPlacement({ x: 900, y: 30 }, sb)).toBe('top')
    expect(dropPlacement({ x: 1700, y: 150 }, sb)).toBe('top-right')
  })
  it('a side edge docks; the middle of the screen floats', () => {
    expect(dropPlacement({ x: 20, y: 600 }, sb)).toBe('left')
    expect(dropPlacement({ x: 1900, y: 600 }, sb)).toBe('right')
    expect(dropPlacement({ x: 900, y: 600 }, sb)).toBe('free')
  })
  it('the bounce plays the last bit of the way, at most 60 px', () => {
    expect(snapBounce({ x: 700, y: 90 }, { x: 710, y: 0 })).toEqual({ dx: -10, dy: 60 })
    expect(snapBounce({ x: 700, y: 20 }, { x: 710, y: 0 }, 2)).toEqual({ dx: -5, dy: 10 })
    expect(snapBounce({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ dx: 0, dy: 0 })
  })
})

describe('leaning toward the mouse (IM11, IM12)', () => {
  const rect = { x: 100, y: 6, w: 200, h: 38 }
  it('only within 40 px of the island', () => {
    expect(cursorNear({ x: 200, y: 70 }, rect)?.dist).toBe(26)
    expect(cursorNear({ x: 200, y: 100 }, rect)).toBeNull()
    expect(cursorNear({ x: 200, y: 20 }, undefined)).toBeNull()
  })
  it('2–3 px toward it, nothing without a pointer', () => {
    expect(leanFor(null)).toEqual({ x: 0, y: 0 })
    const l = leanFor({ dx: 120, dy: 0 })
    expect(l.x).toBe(3)
    expect(Math.abs(leanFor({ dx: 0, dy: 120 }).y)).toBeLessThanOrEqual(2)
  })
})
