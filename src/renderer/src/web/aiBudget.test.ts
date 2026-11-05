import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module without types
import { budgetPlan, budgetTier, costOf } from '../../../../api/_budget.mjs'
import { brainPrompt, pickFacts } from './botBrain'

describe('cheaper Ben', () => {
  const mid = new Date('2026-11-15T12:00:00Z') // half the month gone
  it('steps down as the month budget fills up', () => {
    expect(budgetTier(2, 10, mid)).toBe('normal')
    expect(budgetTier(7, 10, mid)).toBe('save') // 25%+ ahead of the pace (5)
    expect(budgetTier(8.5, 10, new Date('2026-11-29T12:00:00Z'))).toBe('save') // 80% used
    expect(budgetTier(10, 10, mid)).toBe('minimal')
    expect(budgetTier(500, 0, mid)).toBe('normal') // 0 = no limit
    expect(budgetTier(1, 10, new Date('2026-11-01T12:00:00Z'))).toBe('normal') // day 1: no pace check yet
  })
  it('what each step allows', () => {
    expect(budgetPlan('normal', { strong: true })).toEqual({ strong: true, useChosen: true })
    expect(budgetPlan('save', { strong: true })).toEqual({ strong: false, useChosen: true })
    expect(budgetPlan('minimal', { kind: 'chat' })).toEqual({ strong: false, useChosen: false })
    expect(() => budgetPlan('minimal', { kind: 'nudge' })).toThrow(/budget/)
  })
  it('the prompt keeps only the facts that matter', () => {
    const facts = Array.from({ length: 60 }, (_, i) => ({ t: `filler fact number ${i}`, at: '2026-10-01' }))
    facts.splice(3, 0, { t: 'Etica exam on Friday, chapters 3-5', at: '2026-10-02' })
    const kept = pickFacts(facts, 'how should I study for etica?')
    expect(kept.length).toBeLessThanOrEqual(24)
    expect(kept.some((f) => f.t.startsWith('Etica exam'))).toBe(true)
    expect(kept.at(-1)!.t).toBe('filler fact number 59')
    const memory = { facts, chat: Array.from({ length: 40 }, (_, i) => ({ role: 'me' as const, text: `message ${i} ${'x'.repeat(400)}`, at: '' })) } as any
    const p = brainPrompt('mega' as any, 'ctx', memory, 'hi')
    expect(p).not.toContain('message 27 ')
    expect(p).toContain('message 39 ')
    expect(p).not.toContain('filler fact number 10 ')
  })
})

describe('cost when the provider reports none (A7)', () => {
  it('uses the reported cost, else estimates from tokens', () => {
    expect(costOf('x', 1000, 1000, 0.002)).toBe(0.002)
    expect(costOf('google/gemini-3.5-flash', 1_000_000, 0, null)).toBeCloseTo(0.3)
    expect(costOf('google/gemini-3.1-flash-lite', 0, 1_000_000, null)).toBeCloseTo(0.4)
    expect(costOf('some/model', 1_000_000, 1_000_000, undefined)).toBeCloseTo(2.5)
    expect(costOf('some/model', 0, 0, null)).toBeNull()
  })
})
