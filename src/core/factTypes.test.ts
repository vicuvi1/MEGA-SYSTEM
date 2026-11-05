import { describe, expect, it } from 'vitest'
import { cleanFacts, dateIn, factLine, factType, toRecord } from './factTypes'

describe('typed long-term memory', () => {
  it('types facts and reads dates', () => {
    expect(factType('Etica exam on 12 Dec')).toBe('exam')
    expect(factType('Maxim is his lab partner and friend')).toBe('person')
    expect(factType('Hates running in the cold')).toBe('preference')
    expect(dateIn('Etica exam on 12 Dec', '2026-11-05')).toBe('2026-12-12')
    expect(dateIn('test 03.01', '2026-11-05')).toBe('2027-01-03')
  })
  it('an exam expires a week after its date; repeats raise confidence', () => {
    const r = toRecord('Etica exam on 12 Dec', '2026-11-05')
    expect(r).toMatchObject({ type: 'exam', until: '2026-12-19', conf: 0.6, seen: 1 })
    const again = toRecord('Etica exam on 12 Dec', '2026-11-20', r)
    expect(again).toMatchObject({ conf: 0.75, seen: 2 })
    expect(cleanFacts([r], '2026-12-20')).toEqual([])
    expect(cleanFacts([r], '2026-12-10')).toHaveLength(1)
    expect(factLine(again)).toBe('[exam until 2026-12-19] Etica exam on 12 Dec (noted 2026-11-20, said 2×)')
  })
  it('old unconfirmed guesses go after 90 days; old plain facts stay', () => {
    const guess = { t: 'maybe likes jazz', at: '2026-01-01', conf: 0.6 }
    const plain = { t: 'Lives in Chisinau', at: '2026-01-01' }
    expect(cleanFacts([guess, plain], '2026-11-05')).toEqual([plain])
  })
})
