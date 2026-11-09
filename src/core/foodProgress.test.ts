// The big bars and "protein behind for the time of day" (pinned times, made-up numbers).
import { describe, expect, it } from 'vitest'
import { dayProgress, dayShare, proteinBehind } from './foodProgress'
import { seedSaved } from './foodSaved'

const at = (hm: string) => new Date(`2026-11-09T${hm}:00`)

describe('day progress', () => {
  it('"1,900 / 2,700 kcal", "90 / 130 g protein", "800 kcal · 40 g left"', () => {
    const p = dayProgress({ kcal: 1900, protein: 90 }, { kcal: 2700, protein: 130 })
    expect([p.kcalLine, p.proteinLine, p.leftLine]).toEqual(['1,900 / 2,700 kcal', '90 / 130 g protein', '800 kcal · 40 g left'])
    expect(p.kcal.frac).toBeCloseTo(0.704, 2)
    expect(p.protein).toMatchObject({ eaten: 90, goal: 130, left: 40 })
  })
  it('over the goal: the bar is full, nothing is left; one done', () => {
    expect(dayProgress({ kcal: 3000, protein: 140 }, { kcal: 2700, protein: 130 })).toMatchObject({ leftLine: 'Goals reached today', kcal: { frac: 1, left: 0 } })
    expect(dayProgress({ kcal: 2800, protein: 100 }, { kcal: 2700, protein: 130 }).leftLine).toBe('30 g left (kcal done)')
    expect(dayProgress({ kcal: 0, protein: 0 }, { kcal: 0, protein: 0 }).kcal.frac).toBe(0)
  })
})

describe('protein behind', () => {
  const foods = seedSaved().foods
  it('an even day: 0% at 08:00, about 64% at 17:00, 100% at 22:00', () => {
    expect(dayShare(at('07:00'))).toBe(0)
    expect(dayShare(at('17:00'))).toBeCloseTo(9 / 14, 3)
    expect(dayShare(at('23:00'))).toBe(1)
  })
  it('under about half the goal at 17:00 is behind, with one plain hint from your saved foods', () => {
    const r = proteinBehind(at('17:00'), 60, 130, foods)
    expect(r.behind).toBe(true)
    expect(r.expected).toBe(84)
    expect(r.hint).toBe('Behind on protein: 250 g brânză de vaci 5% = +40 g')
    expect(proteinBehind(at('17:00'), 70, 130, foods).behind).toBe(false)
  })
  it('not before 10:00, not with a goal of 0, and a plain hint with no saved foods', () => {
    expect(proteinBehind(at('09:30'), 0, 130, foods).behind).toBe(false)
    expect(proteinBehind(at('20:00'), 0, 0, foods).behind).toBe(false)
    expect(proteinBehind(at('20:00'), 20, 130, []).hint).toMatch(/^Behind on protein: about 111 g by now, you have 20 g/)
  })
})
