import { describe, expect, it } from 'vitest'
import { autoLabel, fitIsland, islandSizing, logicalArea, panelRoom, sizingKey } from './islandFit'

// Work areas are the screen minus a 48 px (logical) taskbar, like Windows.
const work = (physW: number, physH: number, scale: number) => {
  const a = logicalArea(physW, physH, scale)
  return { width: a.width, height: a.height - 48 }
}

describe('fitIsland: the island fits the screen', () => {
  it('a 1920×1080 laptop at 150 % (1280×720 logical) is Compact, narrow and at most ~70 % tall', () => {
    const wa = work(1920, 1080, 1.5)
    expect(wa).toEqual({ width: 1280, height: 672 })
    const f = fitIsland(wa)
    expect(f.pick).toBe('compact')
    expect(f.density).toBe('compact')
    expect(f.zoom).toBe(1)
    expect(f.panelW).toBeGreaterThanOrEqual(460)
    expect(f.panelW).toBeLessThanOrEqual(500)
    expect(f.panelH).toBeLessThanOrEqual(Math.round(wa.height * 0.7))
    // Never past the bottom of the screen (the pill sits above the panel).
    expect(f.panelH + 100).toBeLessThanOrEqual(wa.height)
  })

  it('a 1366×768 laptop at 100 % is Compact too', () => {
    const wa = work(1366, 768, 1)
    const f = fitIsland(wa)
    expect(f.density).toBe('compact')
    expect(f.panelW).toBe(500)
    expect(f.panelH).toBeLessThanOrEqual(Math.round(wa.height * 0.7))
  })

  it('a 1920×1080 monitor at 100 % gets the roomy Normal look', () => {
    const f = fitIsland(work(1920, 1080, 1))
    expect(f).toMatchObject({ pick: 'normal', density: 'normal', zoom: 1, panelW: 600 })
    expect(f.panelH).toBeGreaterThanOrEqual(520)
    expect(f.panelH).toBeLessThanOrEqual(600)
  })

  it('a 2560×1440 monitor at 100 % gets the Normal look a little larger', () => {
    const f = fitIsland(work(2560, 1440, 1))
    expect(f.pick).toBe('large')
    expect(f.density).toBe('normal')
    expect(f.zoom).toBeGreaterThan(1)
    expect(f.zoom).toBeLessThanOrEqual(1.15)
    expect(f.panelW).toBeGreaterThanOrEqual(600)
  })

  it('a 3840×2160 screen at 200 % is 1920×1080 logical: Normal, not huge', () => {
    const wa = work(3840, 2160, 2)
    expect(wa.width).toBe(1920)
    const f = fitIsland(wa)
    expect(f).toMatchObject({ pick: 'normal', density: 'normal', zoom: 1, panelW: 600 })
  })

  it('a short screen is Compact even when it is wide enough', () => {
    expect(fitIsland({ width: 1600, height: 700 }).density).toBe('compact')
  })

  it('nonsense in: a sane Normal answer out', () => {
    expect(fitIsland({ width: NaN, height: -1 }).density).toBe('normal')
    expect(logicalArea(1920, 1080, 0)).toEqual({ width: 1920, height: 1080 })
  })
})

describe('islandSizing: your choice wins over Auto', () => {
  const laptop = work(1920, 1080, 1.5)
  const desk = work(1920, 1080, 1)

  it('Auto follows the screen', () => {
    expect(islandSizing({ pick: 'auto', area: laptop }).density).toBe('compact')
    expect(islandSizing({ pick: 'auto', area: desk }).density).toBe('normal')
    expect(islandSizing({ pick: undefined, area: laptop }).auto).toBe(true)
  })

  it('an explicit Normal stays Normal on a laptop, but still fits the screen', () => {
    const s = islandSizing({ pick: 'normal', area: laptop, panelWidth: 600 })
    expect(s).toMatchObject({ auto: false, density: 'normal', zoom: 1, panelW: 600 })
    expect(s.panelH).toBeLessThanOrEqual(panelRoom(laptop, 1).h)
  })

  it('an explicit Compact stays Compact on a big monitor', () => {
    const s = islandSizing({ pick: 'compact', area: work(2560, 1440, 1), panelWidth: 480 })
    expect(s).toMatchObject({ density: 'compact', zoom: 1, panelW: 480 })
  })

  it('a panel you resized wins over Auto, kept within the screen', () => {
    const s = islandSizing({ pick: 'auto', area: laptop, resized: { w: 700, h: 900 } })
    expect(s.panelW).toBe(700)
    expect(s.panelH).toBe(panelRoom(laptop, 1).h)
    expect(s.density).toBe('compact')
  })

  it('Large zooms the island but the panel never goes past the screen', () => {
    const s = islandSizing({ pick: 'large', area: laptop, panelWidth: 640 })
    expect(s.zoom).toBeGreaterThan(1)
    expect((s.panelH + 100) * s.zoom).toBeLessThanOrEqual(laptop.height + 1)
  })

  it('the key changes only when the size does', () => {
    expect(sizingKey(islandSizing({ pick: 'auto', area: laptop }))).toBe(sizingKey(islandSizing({ pick: 'auto', area: { ...laptop } })))
    expect(sizingKey(islandSizing({ pick: 'auto', area: laptop }))).not.toBe(sizingKey(islandSizing({ pick: 'auto', area: desk })))
  })

  it('says what Auto picked here', () => {
    expect(autoLabel(islandSizing({ pick: 'auto', area: laptop }))).toBe('Auto (fits your screen) · Compact here')
    expect(autoLabel(null)).toBe('Auto (fits your screen)')
  })
})
