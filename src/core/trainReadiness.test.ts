import { describe, expect, it } from 'vitest'
import { doseMinutes, trainReadiness } from './trainReadiness'

describe('training readiness (BD7)', () => {
  it('a good night and fresh: full', () => {
    expect(trainReadiness({ sleptMin: 470, soreness: 2 })).toMatchObject({ mode: 'full', pct: 100, hold: false, auto: true })
  })
  it('a short night: lighter, and progression holds', () => {
    const r = trainReadiness({ sleptMin: 340, soreness: 2 })
    expect(r.mode).toBe('light')
    expect(r.hold).toBe(true)
    expect(r.line).toMatch(/no level-ups/)
  })
  it('short night, sore and a big day yesterday: short (50%)', () => {
    const r = trainReadiness({ sleptMin: 320, soreness: 4, ydaySets: 26 })
    expect(r).toMatchObject({ mode: 'short', pct: 50 })
    expect(r.why).toMatch(/26 hard sets yesterday/)
  })
  it('your pick wins; Full also means push on', () => {
    expect(trainReadiness({ sleptMin: 340, soreness: 2, override: 'full' })).toMatchObject({ mode: 'full', hold: false, auto: false, suggested: 'light' })
    expect(trainReadiness({ sleptMin: 340, soreness: 2, override: 'short' }).hold).toBe(true)
  })
  it('minutes at a dose', () => {
    expect(doseMinutes(30, 'light')).toBe(20)
    expect(doseMinutes(45, 'short')).toBe(25)
    expect(doseMinutes(20, 'short')).toBe(15)
  })
})
