import { describe, expect, it } from 'vitest'
import { neutral } from './stealth'

describe('stealth wording', () => {
  it('neutral words for the challenge', () => {
    expect(neutral('Urge crusher: crushed 3 urges, clean day 12 in MAN')).toBe('Focus reset: crushed 3 tough moments, good day 12 in Challenge')
    expect(neutral('No relapse today, keep the clean streak')).toBe('No slip today, keep the streak')
    expect(neutral('Clean check-in done')).toBe('Daily check-in done')
  })
  it('leaves other text alone', () => {
    expect(neutral('Clean your room, then 50 min of Math')).toBe('Clean your room, then 50 min of Math')
  })
})
