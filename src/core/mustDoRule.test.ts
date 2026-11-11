import { describe, expect, it } from 'vitest'
import { checkPick, isVague, looksLikePick, pickBody, splitMustDos, vagueReason } from './mustDoRule'

describe('concrete must-dos', () => {
  it('rejects one word or no number', () => {
    expect(isVague('sport')).toBe(true)
    expect(isVague('Dorm')).toBe(true)
    expect(isVague('study math')).toBe(true)
    expect(vagueReason('sport')).toMatch(/one word/)
    expect(vagueReason('clean the dorm')).toMatch(/no number/)
    expect(isVague('')).toBe(true)
  })

  it('accepts something concrete', () => {
    expect(isVague('sport: 25 min, 30 push-ups')).toBe(false)
    expect(isVague('read 20 pages')).toBe(false)
    expect(isVague('essay intro 45 min')).toBe(false)
  })

  it('splits by line, semicolon or numbers', () => {
    expect(splitMustDos('a 1\nb 2\nc 3')).toEqual(['a 1', 'b 2', 'c 3'])
    expect(splitMustDos('a 1; b 2; c 3')).toEqual(['a 1', 'b 2', 'c 3'])
    expect(splitMustDos('1. read 20 pages 2. gym 40 min 3) essay 30 min')).toEqual(['read 20 pages', 'gym 40 min', 'essay 30 min'])
    expect(splitMustDos('sport: 25 min, 30 push-ups')).toEqual(['sport: 25 min, 30 push-ups'])
  })

  it('takes exactly 3 concrete items', () => {
    expect(checkPick('sport\nDorm\nread').ok).toBe(false)
    expect(checkPick('sport\nDorm\nread').reply).toMatch(/Too vague/)
    expect(checkPick('read 20 pages\ngym 40 min').reply).toMatch(/exactly 3/)
    const ok = checkPick('sport: 25 min, 30 push-ups\nread 20 pages\nclean the dorm 15 min')
    expect(ok.ok).toBe(true)
    expect(ok.items).toHaveLength(3)
  })

  it('reads a "tomorrow:" answer', () => {
    expect(looksLikePick("tomorrow's 3: a 1; b 2; c 3")).toBe(true)
    expect(looksLikePick('how was my day')).toBe(false)
    expect(pickBody('tomorrow: a 1; b 2; c 3')).toBe('a 1; b 2; c 3')
  })
})
