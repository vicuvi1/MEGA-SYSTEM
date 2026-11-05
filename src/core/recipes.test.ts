import { describe, expect, it } from 'vitest'
import { cleanAction, cleanRecipe, cleanRecipes, evaluate, parseRecipeLine, RECIPE_TEMPLATES, recipeText, safeLink } from './recipes'

// Wednesday 2026-11-04.
const at = (hm: string, day = '2026-11-04') => Date.parse(`${day}T${hm}:00`)
const coding = { ...RECIPE_TEMPLATES[0], on: true, ranOnce: true }

describe('recipes (SI7)', () => {
  it('keeps only whitelisted actions: no scripts, no programs, no logging', () => {
    expect(cleanAction({ do: 'run', cmd: 'calc.exe' })).toBeNull()
    expect(cleanAction({ do: 'water', ml: 250 })).toBeNull()
    expect(cleanAction({ do: 'open', page: 'settings' })).toBeNull()
    expect(cleanAction({ do: 'open', page: 'money' })).toEqual({ do: 'open', page: 'money' })
    expect(cleanAction({ do: 'focus', subject: 'Coding', minutes: 999 })).toEqual({ do: 'focus', subject: 'Coding', minutes: 180 })
    expect(cleanAction({ do: 'link', url: 'https://evil.example.com/x' })).toBeNull()
    expect(cleanAction({ do: 'link', url: 'http://open.spotify.com/playlist/1' })).toBeNull()
    expect(safeLink('https://open.spotify.com/playlist/abc')).toBe('https://open.spotify.com/playlist/abc')
    expect(cleanRecipe({ when: { on: 'context', ctx: 'coding' }, then: [{ do: 'run' }] })).toBeNull()
    expect(cleanRecipes([coding, coding, { when: { on: 'time', at: '25:00' }, then: [{ do: 'dnd' }] }])).toHaveLength(1)
  })
  it('VS Code on weekdays 9–12 → a Coding timer (once an hour, not over a running one)', () => {
    const e = { t: 'context' as const, at: at('09:30'), ctx: 'coding' as const, conf: 0.9 }
    const r = evaluate([coding], e, { running: false, fired: {} })
    expect(r).toHaveLength(1)
    expect(r[0].acts).toEqual([{ do: 'focus', subject: 'Coding', minutes: 50 }])
    expect(r[0].ask).toBe(false)
    expect(evaluate([coding], { ...e, at: at('13:00') }, { running: false, fired: {} })).toHaveLength(0)
    expect(evaluate([coding], { ...e, at: at('10:00', '2026-11-07') }, { running: false, fired: {} })).toHaveLength(0)
    expect(evaluate([coding], e, { running: true, fired: {} })).toHaveLength(0)
    expect(evaluate([coding], e, { running: false, fired: { [coding.id]: at('09:00') } })).toHaveLength(0)
    expect(evaluate([coding], { ...e, conf: 0.4 }, { running: false, fired: {} })).toHaveLength(0)
    expect(evaluate([{ ...coding, on: false }], e, { running: false, fired: {} })).toHaveLength(0)
  })
  it('the first run asks; confirm-first always asks', () => {
    const e = { t: 'meeting:start' as const, at: at('15:00') }
    const meet = { ...RECIPE_TEMPLATES[2], on: true }
    expect(evaluate([meet], e, { running: false, fired: {} })[0].ask).toBe(true)
    expect(evaluate([{ ...meet, ranOnce: true }], e, { running: false, fired: {} })[0].ask).toBe(false)
    expect(evaluate([{ ...meet, ranOnce: true, confirmFirst: true }], e, { running: false, fired: {} })[0].ask).toBe(true)
  })
  it('time recipes fire once a day, also a little late (the PC was asleep)', () => {
    const night = { ...RECIPE_TEMPLATES[4], on: true, ranOnce: true }
    expect(evaluate([night], { t: 'tick', at: at('22:20') }, { running: false, fired: {} })).toHaveLength(0)
    expect(evaluate([night], { t: 'tick', at: at('22:45') }, { running: false, fired: {} })).toHaveLength(1)
    expect(evaluate([night], { t: 'tick', at: at('23:10') }, { running: false, fired: {} })).toHaveLength(0)
    expect(evaluate([night], { t: 'tick', at: at('22:50') }, { running: false, fired: { [night.id]: at('22:31') } })).toHaveLength(0)
  })
  it('says what it does in plain words', () => {
    expect(recipeText(coding)).toBe('When coding · weekdays 09:00–12:00 no timer → focus “Coding” 50 min')
    expect(recipeText(RECIPE_TEMPLATES[4])).toBe('At 22:30 → wind-down reminder, quiet 90 min')
  })
  it("Ben's RECIPE: line is offered off, made by Ben, asking first (SI24)", () => {
    const r = parseRecipeLine('RECIPE: {"name":"Study evenings","when":{"on":"context","ctx":"study"},"then":[{"do":"focus","subject":"Study","minutes":45},{"do":"run","cmd":"x"}],"on":true}')
    expect(r).toMatchObject({ name: 'Study evenings', on: false, ranOnce: false, byBen: true, then: [{ do: 'focus', subject: 'Study', minutes: 45 }] })
    expect(parseRecipeLine('RECIPE: not json')).toBeNull()
    expect(parseRecipeLine('hello')).toBeNull()
  })
})
