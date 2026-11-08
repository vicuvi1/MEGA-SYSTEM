import { describe, expect, it } from 'vitest'
import { STARTERS, SHELVES, budgetMeter, featuredPick, monthSpendLei, rarityOf, shelfOf } from './shopShelves'
import { isRewardCategory } from './shop'

describe('shop shelves', () => {
  it('puts every category on a shelf, and unknown ones on the small treats shelf', () => {
    expect(shelfOf({ category: 'gear' })).toBe('tech')
    expect(shelfOf({ category: 'fun' })).toBe('games')
    expect(shelfOf({ category: 'selfcare' })).toBe('skin')
    expect(shelfOf({ category: null })).toBe('treat')
  })
  it('only uses real categories in the shelves and starters', () => {
    for (const s of SHELVES) for (const c of s.cats) expect(isRewardCategory(c)).toBe(true)
    for (const list of Object.values(STARTERS)) for (const it of list) expect(isRewardCategory(it.category) && it.price > 0 && it.title.length > 0).toBe(true)
  })
  it('sets rarity by price in points', () => {
    expect(rarityOf(120)).toBe('common')
    expect(rarityOf(500)).toBe('rare')
    expect(rarityOf(1499)).toBe('rare')
    expect(rarityOf(1500)).toBe('epic')
    expect(rarityOf(6000)).toBe('legendary')
  })
  it('picks the same featured reward all day, whatever the order', () => {
    const xs = [{ id: 3 }, { id: 1 }, { id: 2 }, { id: 9 }]
    const a = featuredPick(xs, '2026-11-08')
    expect(featuredPick([...xs].reverse(), '2026-11-08')).toEqual(a)
    expect(new Set(Array.from({ length: 20 }, (_, i) => featuredPick(xs, `2026-11-${String(i + 1).padStart(2, '0')}`)!.id)).size).toBeGreaterThan(1)
    expect(featuredPick([], '2026-11-08')).toBeNull()
  })
  it('sums this month only and skips undone buys', () => {
    const r = [
      { day: '2026-11-02', realCost: 80 },
      { day: '2026-11-05', realCost: 160, undone: true },
      { day: '2026-10-30', realCost: 500 },
      { day: '2026-11-07', realCost: null }
    ]
    expect(monthSpendLei(r, '2026-11')).toBe(80)
  })
  it('warns softly and defaults to 500 lei', () => {
    expect(budgetMeter(240, 500)).toMatchObject({ state: 'ok', left: 260 })
    expect(budgetMeter(240, null).left).toBe(260)
    expect(budgetMeter(400, 500).state).toBe('close')
    const over = budgetMeter(560, 500)
    expect(over.state).toBe('over')
    expect(over.frac).toBe(1)
  })
})
