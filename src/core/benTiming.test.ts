import { describe, expect, it } from 'vitest'
import { quietNow, quietRules } from './benTiming'

const at = (d: string, h: number) => new Date(`${d}T${String(h).padStart(2, '0')}:20:00`).toISOString()
describe('Ben learns your timing', () => {
  const now = new Date('2026-11-06T12:00:00')
  it('two 👎 in the same weekly slot make a quiet rule; a 👍 can win it back', () => {
    const fb = [
      { at: at('2026-10-27', 14), kind: 'down' }, // Tue 14–16
      { at: at('2026-11-03', 15), kind: 'down' }, // Tue
      { at: at('2026-10-29', 14), kind: 'down' }, // Thu
      { at: at('2026-11-05', 14), kind: 'down' }, // Thu
      { at: at('2026-11-02', 9), kind: 'down' }, // Mon, only one
      { at: at('2026-11-05', 15), kind: 'up' } // Thu: back to 1
    ]
    const r = quietRules(fb, now)
    expect(r.map((x) => x.text)).toEqual(['No nudges 14–16 on Tue'])
    expect(quietNow(r, new Date('2026-11-10T14:30:00'))?.text).toBe('No nudges 14–16 on Tue')
    expect(quietNow(r, new Date('2026-11-10T16:30:00'))).toBeNull()
  })
  it('old feedback is forgotten', () => {
    expect(quietRules([{ at: at('2026-06-02', 14), kind: 'down' }, { at: at('2026-06-09', 14), kind: 'down' }], now)).toEqual([])
  })
})
