import { describe, expect, it } from 'vitest'
import { boundsKey, clip, covered, fillHeight, savedZoom, SCWEB_ZOOM_DEFAULT, toWindowBounds } from './scBounds'
import { cleanZoom } from './scAccount'

describe('scBounds', () => {
  it('turns the box into window pixels with the app zoom only', () => {
    // 100 %: the same numbers (Windows scaling is already in window pixels).
    expect(toWindowBounds({ left: 316, top: 180, right: 1972, bottom: 1074 }, 1)).toEqual({ x: 316, y: 180, width: 1656, height: 894 })
    // App zoomed to 125 %: the page's CSS pixels are bigger on the window.
    expect(toWindowBounds({ left: 200, top: 100, right: 1000, bottom: 600 }, 1.25)).toEqual({ x: 250, y: 125, width: 1000, height: 625 })
    // A bad zoom counts as 100 %.
    expect(toWindowBounds({ left: 10, top: 10, right: 110, bottom: 110 }, NaN)).toEqual({ x: 10, y: 10, width: 100, height: 100 })
  })
  it('rounds the edges, so the view never ends a pixel short', () => {
    // 90 % zoom with fractions: the right and bottom edges land where the box ends.
    const b = toWindowBounds({ left: 111.5, top: 50.5, right: 1283.5, bottom: 700.5 }, 0.9)
    expect(b.x + b.width).toBe(Math.round(1283.5 * 0.9))
    expect(b.y + b.height).toBe(Math.round(700.5 * 0.9))
  })
  it('keeps only the part of the box you can see', () => {
    expect(clip({ left: 300, top: 120, right: 1800, bottom: 900 }, { left: 316, top: 150, right: 2000, bottom: 1090 })).toEqual({ left: 316, top: 150, right: 1800, bottom: 900 })
  })
  it('fills down to the bottom of the window, with a margin and a floor', () => {
    expect(fillHeight({ viewport: 1090, top: 200 })).toBe(874)
    expect(fillHeight({ viewport: 720, top: 180, margin: 12 })).toBe(528)
    expect(fillHeight({ viewport: 400, top: 300 })).toBe(320)
    expect(fillHeight({ viewport: NaN, top: 0, min: 200 })).toBe(200)
  })
  it('sees a menu, dialog or toast over the box, not one beside it', () => {
    const box = { left: 300, top: 200, right: 1800, bottom: 1000 }
    expect(covered(box, [])).toBe(false)
    expect(covered(box, [{ left: 1500, top: 900, right: 1900, bottom: 1060 }])).toBe(true)
    expect(covered(box, [{ left: 0, top: 0, right: 300, bottom: 1000 }])).toBe(false)
    expect(covered(box, [{ left: 0, top: 0, right: 2000, bottom: 201 }])).toBe(false)
    expect(covered(box, [{ left: 500, top: 0, right: 900, bottom: 260 }])).toBe(true)
  })
  it('a new key when the box moves, the zoom changes or it hides', () => {
    const r = { left: 300, top: 200, right: 1800, bottom: 1000 }
    expect(boundsKey(r, 1, false)).toBe(boundsKey({ ...r }, 1, false))
    expect(boundsKey(r, 1, false)).not.toBe(boundsKey({ ...r, left: 120 }, 1, false))
    expect(boundsKey(r, 1, false)).not.toBe(boundsKey(r, 1.1, false))
    expect(boundsKey(r, 1, true)).toBe('hidden')
  })
  it('starts at 100 %, moves the old 80 % default up, keeps a zoom you picked', () => {
    expect(savedZoom(null, cleanZoom)).toBe(SCWEB_ZOOM_DEFAULT)
    expect(savedZoom({}, cleanZoom)).toBe(1)
    expect(savedZoom({ zoom: 0.8 }, cleanZoom)).toBe(1)
    expect(savedZoom({ zoom: 0.9 }, cleanZoom)).toBe(0.9)
    expect(savedZoom({ zoom: 0.8, zoomSet: true }, cleanZoom)).toBe(0.8)
    expect(savedZoom({ zoom: 'x', zoomSet: true }, cleanZoom)).toBe(1)
  })
})
