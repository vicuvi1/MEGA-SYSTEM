import { describe, expect, it } from 'vitest'
import { DEFAULT_COST, cleanCostPrefs, costReport, usdText } from './aiCost'

describe('AI cost meter', () => {
  it('defaults to Gemini 3.5 Flash at $1.50 / $9 per million tokens', () => {
    expect(cleanCostPrefs(null)).toEqual({ model: 'Gemini 3.5 Flash', inPerM: 1.5, outPerM: 9 })
    expect(cleanCostPrefs({ model: '  My model ', inPerM: '0.3', outPerM: -1 })).toEqual({ model: 'My model', inPerM: 0.3, outPerM: 9 })
  })
  it('turns the recorded token counts into money', () => {
    const r = costReport(
      {
        month: '2030-03',
        photos: 40,
        rows: [
          { kind: 'foodPhoto', calls: 36, prompt: 36 * 1500, completion: 36 * 400 },
          { kind: 'foodPhoto2', calls: 4, prompt: 4 * 1500, completion: 4 * 1400 },
          { kind: 'chat', calls: 99, prompt: 9e6, completion: 9e6 }
        ]
      },
      DEFAULT_COST
    )
    expect(r.inTokens).toBe(60000)
    expect(r.outTokens).toBe(20000)
    expect(r.usd).toBe(0.27)
    expect(r.perPhoto).toBe(0.0068)
    expect(r.line).toBe('40 photos read this month · about $0.27 ($0.007 a photo)')
    expect(r.secondLooks).toBe(4)
  })
  it('with no photo counter, counts the reads', () => {
    const r = costReport({ month: '2030-03', photos: null, rows: [{ kind: 'foodPhoto', calls: 2, prompt: 100, completion: 10 }] }, DEFAULT_COST)
    expect(r.photos).toBe(2)
    expect(costReport({ month: '2030-03', photos: 0, rows: [] }, DEFAULT_COST).line).toBe('No photos read this month yet.')
    expect(usdText(0.004)).toBe('$0.004')
  })
})
