// A dragged island stays where it was dropped (save, clamp, snap), and the notch is only for the top centre.
import { describe, expect, it } from 'vitest'
import { barHome, savedSpot } from './islandPlace'
import { clampFree, dropSpot } from '../core/islandMove'
import { placeIsland } from './islandWin'

const wa = { x: 0, y: 0, width: 1920, height: 1040 }

describe('drop and save', () => {
  it('a top drop on the right quarter docks top right', () => {
    expect(dropSpot({ x: 1700, y: 20 }, wa)).toBe('top-right')
  })
  it('a top drop in the middle but off centre stays put as a capsule (free)', () => {
    const spot = dropSpot({ x: 1300, y: 20 }, wa)
    expect(spot).toBe('top')
    expect(savedSpot(spot, 1300 / 1920)).toEqual({ place: 'free', cx: 1300 / 1920 })
  })
  it('only the true centre stays top (the notch spot) and snaps to exactly 0.5', () => {
    expect(savedSpot('top', 0.52)).toEqual({ place: 'top', cx: 0.5 })
  })
  it('corners, sides and free keep their spot', () => {
    expect(savedSpot('top-right', 0.9).place).toBe('top-right')
    expect(savedSpot('free', 0.7)).toEqual({ place: 'free', cx: 0.7 })
  })
  it('a saved off-centre spot lands in the same place after a re-open or a resize', () => {
    const cx = 0.7
    const at = (w: typeof wa) => clampFree({ x: w.x + cx * w.width - 250, y: w.y }, { width: 500, height: 660 }, w, { x: 120, y: 0, w: 260, h: 48 })
    expect(at(wa).x).toBe(Math.round(0.7 * 1920 - 250))
    expect(at({ ...wa, width: 1600 }).x).toBe(Math.round(0.7 * 1600 - 250))
  })
})

describe('the thin bar keeps its side', () => {
  it('stays on the right instead of jumping to the middle', () => {
    expect(barHome(wa, 300, 'free', 0.8)).toEqual({ x: Math.round(0.8 * 1920 - 150), y: 0 })
    expect(barHome(wa, 300, 'top-right', 0.5)).toEqual({ x: 1620, y: 0 })
    expect(barHome(wa, 300, 'top-left', 0.5)).toEqual({ x: 0, y: 0 })
  })
  it('centres for top and stays on the screen at the edges', () => {
    expect(barHome(wa, 300, 'top', 0.5)).toEqual({ x: 810, y: 0 })
    expect(barHome(wa, 300, 'free', 1).x).toBe(1620)
    expect(barHome(wa, 300, 'free', Number.NaN).x).toBe(810)
  })
  it('the free spot is the same as the window placement when no bar', () => {
    expect(placeIsland({ wa, width: 500, height: 660, place: 'free', pos: { cx: 0.7, top: 0, cy: 0.5 }, sidePillY: 40 }).x).toBe(Math.round(0.7 * 1920 - 250))
  })
})
