import { describe, expect, it } from 'vitest'
import { cleanZoom, cleanZoomPrefs, nextZoom, zoomFor, zoomKey, zoomLabel, ZOOM_STEPS } from './zoom'

describe('zoom', () => {
  it('steps in and out like a browser and stops at the ends', () => {
    expect(nextZoom(1, 'in')).toBe(1.1)
    expect(nextZoom(1.1, 'in')).toBe(1.25)
    expect(nextZoom(1, 'out')).toBe(0.9)
    expect(nextZoom(2, 'in')).toBe(2)
    expect(nextZoom(0.67, 'out')).toBe(0.67)
    expect(nextZoom(1.33, 'in')).toBe(1.5)
    expect(nextZoom(1.33, 'out')).toBe(1.25)
    expect(nextZoom(1.75, 'reset')).toBe(1)
    let z = 0.67
    const seen = [z]
    for (let i = 0; i < 12; i++) seen.push((z = nextZoom(z, 'in')))
    expect([...new Set(seen)]).toEqual([...ZOOM_STEPS])
  })
  it('keeps odd values in range', () => {
    expect(cleanZoom('abc')).toBe(1)
    expect(cleanZoom(9)).toBe(2)
    expect(cleanZoom(0.1)).toBe(0.67)
    expect(cleanZoom('1.25')).toBe(1.25)
    expect(zoomLabel(1.1)).toBe('110%')
  })
  it('reads the zoom keys', () => {
    expect(zoomKey({ key: '=', control: true })).toBe('in')
    expect(zoomKey({ key: '+', control: true, shift: true })).toBe('in')
    expect(zoomKey({ key: '-', control: true })).toBe('out')
    expect(zoomKey({ key: '0', control: true })).toBe('reset')
    expect(zoomKey({ key: 'Subtract', code: 'NumpadSubtract', control: true })).toBe('out')
    expect(zoomKey({ key: '0', control: false })).toBe(null)
    expect(zoomKey({ key: '0', control: true, alt: true })).toBe(null)
    expect(zoomKey({ key: 'k', control: true })).toBe(null)
  })
  it('remembers a zoom per screen', () => {
    const p = cleanZoomPrefs({ last: 1.25, byScreen: { '1': 1.5, 'bad key!': 2, '2': 'x' } })
    expect(p.byScreen).toEqual({ '1': 1.5, '2': 1 })
    expect(zoomFor(p, '1')).toBe(1.5)
    expect(zoomFor(p, '3')).toBe(1.25)
    expect(cleanZoomPrefs(null)).toEqual({ last: 1, byScreen: {} })
  })
})
