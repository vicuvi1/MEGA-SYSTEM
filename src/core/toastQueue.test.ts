import { describe, expect, it, vi } from 'vitest'
import { addToast, type ToastItem } from './toastQueue'

let n = 0
const note = (text: string, tone: ToastItem['tone'] = 'info'): ToastItem => ({ id: ++n, text, tone })
const undo = (text: string, run = () => {}): ToastItem => ({ id: ++n, text, tone: 'info', action: { label: 'Undo', run } })

describe('toast queue', () => {
  it('a new note replaces the older note', () => {
    const l = addToast(addToast([], note('a')), note('b'))
    expect(l.map((t) => t.text)).toEqual(['b'])
  })
  it('undo toasts merge and both undos run, newest first', () => {
    const calls: string[] = []
    let l = addToast([], undo('Moved X', () => calls.push('x')))
    l = addToast(l, undo('Added Y', () => calls.push('y')))
    l = addToast(l, undo('Added Z', () => calls.push('z')))
    expect(l).toHaveLength(1)
    expect(l[0].text).toBe('3 changes')
    l[0].action!.run()
    expect(calls).toEqual(['z', 'y', 'x'])
  })
  it('an error does not remove an undo toast', () => {
    const fn = vi.fn()
    let l = addToast([], undo('Moved X', fn))
    l = addToast(l, note("Ben isn't reachable", 'bad'))
    expect(l.map((t) => t.text)).toEqual(['Moved X', "Ben isn't reachable"])
    l = addToast(l, note('Saved'))
    expect(l).toHaveLength(2)
    expect(l.some((t) => t.action)).toBe(true)
  })
  it('never more than 2 at once', () => {
    let l: ToastItem[] = []
    for (let i = 0; i < 8; i++) l = addToast(l, i % 3 === 0 ? note('e' + i, 'bad') : i % 3 === 1 ? undo('u' + i) : note('n' + i))
    expect(l.length).toBeLessThanOrEqual(2)
  })
})
