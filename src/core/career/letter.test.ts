import { describe, expect, it } from 'vitest'
import { careerLetter, cleanLetters, letterDue, letterText, pickChange, type CareerMonthFacts } from './letter'

const facts: CareerMonthFacts = {
  month: '2026-10',
  applied: 12,
  quota: 3,
  interviews: 2,
  offers: 0,
  proofs: [{ title: 'Made-up CTF: SQL injection', kind: 'ctf' }],
  newSkills: ['SQL injection', 'Burp Suite'],
  cardsReviewed: 340,
  retention: 0.86,
  careerMinutes: 14 * 60,
  packs: 9,
  income: 7300,
  incomeTarget: 10000,
  efPct: 42,
  payStreak: 3,
  essaysDone: 2,
  essaysLate: 0
}

describe('monthly career letter', () => {
  it('says the numbers and one change', () => {
    const l = careerLetter(facts, '2026-11-01')
    expect(l.title).toBe('Your career in October 2026')
    expect(l.lines[0]).toBe('📨 You sent 12 applications (the quota asked for about 13), got 2 interviews.')
    expect(l.lines).toContain('⏱ 14 h of career work, 9 shift packs included.')
    expect(l.lines).toContain('💸 Income 7,300 of 10,000 lei (73%).')
    expect(l.change).toMatch(/^Income was 7,300 of 10,000 lei/)
    expect(letterText(l)).toContain('👉 One change: Income was')
  })
  it('picks the change by what held you back most', () => {
    expect(pickChange({ ...facts, applied: 3 })).toMatch(/^Applications: 3 of about 13/)
    expect(pickChange({ ...facts, proofs: [] })).toMatch(/^No portfolio entry/)
    expect(pickChange({ ...facts, essaysLate: 1 })).toMatch(/^1 essay went late/)
    expect(pickChange({ ...facts, retention: 0.6 })).toMatch(/stuck 60%/)
    expect(pickChange({ ...facts, careerMinutes: 120 })).toMatch(/^Only 2 h/)
    expect(pickChange({ ...facts, income: 12000 })).toMatch(/^A strong month\. Raise the weekly quota to 4/)
  })
  it('due in the first week of a month, once', () => {
    expect(letterDue([], '2026-11-01')).toBe('2026-10')
    expect(letterDue([], '2026-11-09')).toBeNull()
    expect(letterDue(cleanLetters([careerLetter(facts, '2026-11-01')]), '2026-11-03')).toBeNull()
    expect(letterDue([], '2026-01-02')).toBe('2025-12')
  })
})
