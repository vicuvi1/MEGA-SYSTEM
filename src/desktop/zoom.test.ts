// The app window's zoom: Ctrl + / - / 0 and Ctrl + wheel change it one step, it is
// saved on this PC (per screen) and put back on the next start, and the window's
// zoom is isolated so the island (same origin) never zooms with it.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

let displayId = 1
vi.mock('electron', () => ({ screen: { getDisplayMatching: () => ({ id: displayId }) } }))

const { setupZoom } = await import('./zoom')

type Handler = (...a: any[]) => void
function fakeWindow() {
  const on: Record<string, Handler[]> = {}
  const winOn: Record<string, Handler[]> = {}
  let factor = 1
  const modes: string[] = []
  const wc = {
    on: (ev: string, h: Handler) => void (on[ev] ??= []).push(h),
    getZoomFactor: () => factor,
    setZoomFactor: (f: number) => void (factor = f),
    setZoomMode: (m: string) => void modes.push(m)
  }
  const win = { webContents: wc, getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }), on: (ev: string, h: Handler) => void (winOn[ev] ??= []).push(h) }
  const emit = (ev: string, ...a: any[]) => on[ev]?.forEach((h) => h(...a))
  const key = (k: Partial<{ key: string; code: string; control: boolean; shift: boolean }>) => {
    const e = { prevented: false, preventDefault() { this.prevented = true } }
    emit('before-input-event', e, { type: 'keyDown', key: '', code: '', control: true, meta: false, alt: false, shift: false, ...k })
    return e.prevented
  }
  return { win: win as any, emit, key, factor: () => factor, modes, moved: () => winOn.moved?.forEach((h) => h()) }
}

const dirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'zoom-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  displayId = 1
})

describe('desktop zoom', () => {
  it('Ctrl + / Ctrl - / Ctrl 0 step the zoom once per press and tell the page', () => {
    const f = fakeWindow()
    const told: number[] = []
    setupZoom(f.win, tmp(), (x) => told.push(x))
    expect(f.modes).toEqual(['isolated'])
    expect(f.key({ key: '=', code: 'Equal' })).toBe(true)
    expect(f.factor()).toBe(1.1)
    f.key({ key: '+', code: 'Equal', shift: true })
    expect(f.factor()).toBe(1.25)
    f.key({ key: '-', code: 'Minus' })
    expect(f.factor()).toBe(1.1)
    f.key({ key: '0', code: 'Digit0' })
    expect(f.factor()).toBe(1)
    f.key({ key: 'Subtract', code: 'NumpadSubtract' })
    expect(f.factor()).toBe(0.9)
    expect(told).toEqual([1.1, 1.25, 1.1, 1, 0.9])
    // Other keys are left alone.
    expect(f.key({ key: 'k', code: 'KeyK' })).toBe(false)
    expect(f.key({ key: '=', code: 'Equal', control: false })).toBe(false)
  })

  it('Ctrl + mouse wheel steps it too', () => {
    const f = fakeWindow()
    setupZoom(f.win, tmp(), () => {})
    f.emit('zoom-changed', {}, 'in')
    expect(f.factor()).toBe(1.1)
  })

  it('is saved on this PC and put back on the next start, per screen', () => {
    const dir = tmp()
    const a = fakeWindow()
    setupZoom(a.win, dir, () => {})
    a.key({ key: '=' })
    a.key({ key: '=' })
    expect(JSON.parse(readFileSync(join(dir, 'zoom.json'), 'utf8'))).toEqual({ last: 1.25, byScreen: { '1': 1.25 } })

    // Next start: the page loads at 100 %, then goes back to 125 %.
    const b = fakeWindow()
    setupZoom(b.win, dir, () => {})
    expect(b.factor()).toBe(1)
    b.emit('did-finish-load')
    expect(b.factor()).toBe(1.25)

    // On the big monitor it gets its own zoom; back on the laptop screen, the laptop's.
    displayId = 2
    b.moved()
    b.key({ key: '-' })
    expect(b.factor()).toBe(1.1)
    displayId = 1
    b.moved()
    expect(b.factor()).toBe(1.25)
  })

  it('a broken saved file starts at 100 %', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'zoom.json'), '{oops')
    const f = fakeWindow()
    setupZoom(f.win, dir, () => {})
    f.emit('did-finish-load')
    expect(f.factor()).toBe(1)
  })
})
