import { describe, expect, it } from 'vitest'
import { applyMark, blockKindOf, cleanBlockKinds, didYouGo, kindKey, setBlockKind } from './blockKind'
import { menuFor, quickButtons } from './islandCommands'
import { autoStartBlock, smartAlert, workNow } from './islandSmart'
import { DEFAULT_ISLAND_PREFS, EMPTY_ISLAND, pickAlert, type IslandBlock } from './islandModel'

const at = (hm: string) => Date.parse(`2026-11-06T${hm}:00`)

describe('focus blocks vs events', () => {
  it('Life System blocks and deep-work titles are focus blocks', () => {
    expect(blockKindOf({ title: 'Deep block 1', ours: true })).toBe('focus')
    expect(blockKindOf({ title: 'Deep work: thesis' })).toBe('focus')
    expect(blockKindOf({ title: '45-min focus block on the crypto project' })).toBe('focus')
  })
  it('classes, commutes, meetings and anything else from the calendar are events', () => {
    expect(blockKindOf({ title: 'University' })).toBe('event')
    expect(blockKindOf({ title: 'Going to university' })).toBe('event')
    expect(blockKindOf({ title: 'Spre Universitate, 9:25am' })).toBe('event')
    expect(blockKindOf({ title: 'c. Analiza Matematică' })).toBe('event')
    expect(blockKindOf({ title: 'Curs Programare' })).toBe('event')
    expect(blockKindOf({ title: 'Dentist' })).toBe('event')
    expect(blockKindOf({ title: 'Study group', call: true })).toBe('event')
    expect(blockKindOf({ title: 'Programarea Calculatoarelor' })).toBe('event')
  })
  it('your choice per title wins and covers every event with that title', () => {
    let k = setBlockKind({}, '📚 Programarea Calculatoarelor', 'focus')
    expect(blockKindOf({ title: 'Programarea calculatoarelor' }, k)).toBe('focus')
    k = setBlockKind(k, 'Deep block 1', 'event')
    expect(blockKindOf({ title: 'Deep block 1', ours: true }, k)).toBe('event')
    expect(kindKey('  Ședința   Lunară ')).toBe('sedinta lunara')
    expect(cleanBlockKinds({ a: 'event', b: 'nope', '': 'focus' })).toEqual({ a: 'event' })
  })
})

describe('the shared done state (the Today timeline’s ✓)', () => {
  it('sets and clears one mark and keeps 14 days', () => {
    let all = applyMark({}, '2026-11-06', 'ev1', 'done')
    expect(all['2026-11-06']).toEqual({ ev1: 'done' })
    all = applyMark(all, '2026-11-06', 'ev1', null)
    expect(all['2026-11-06']).toEqual({})
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, '0')}`, { x: 'done' as const }]))
    expect(Object.keys(applyMark(many, '2026-11-06', 'y', 'skip'))).toHaveLength(14)
  })
})

describe('the island with events', () => {
  const lecture: IslandBlock = { id: 'ev1', title: 'University', start: at('09:45'), end: at('11:15'), kind: 'event', mark: null }
  const deep: IslandBlock = { id: 'b1', title: 'Deep block 1', start: at('07:00'), end: at('08:30'), kind: 'focus' }

  it('an event never starts a timer, never drifts and never asks "did you finish it?"', () => {
    expect(autoStartBlock([lecture], at('09:46'), false, {})).toBeNull()
    expect(workNow([lecture], at('10:00'))).toBeNull()
    expect(autoStartBlock([deep], at('07:01'), false, {})?.id).toBe('b1')
    const a = smartAlert({ now: at('11:20'), blocks: [lecture], running: false, idleSec: 0, dismissed: {}, answered: {} })
    expect(a?.text).toBe('Did you go?')
    expect(a?.actions[0].action).toMatchObject({ kind: 'eventMark', mark: 'done' })
  })
  it('"Did you go?" only once: not after you marked it or answered', () => {
    expect(didYouGo([{ ...lecture, mark: 'done' }], at('11:20'), {})).toBeNull()
    expect(didYouGo([lecture], at('11:20'), { ev1: 'done' })).toBeNull()
    expect(didYouGo([lecture], at('10:00'), {})).toBeNull()
  })
  it('starting: ✓ Done / Didn\'t go instead of "Start 90 min"', () => {
    const a = pickAlert({ now: at('09:45'), running: null, blocks: [lecture], log: [], seenBen: 0, dismissed: {} })
    expect(a?.actions.map((x) => x.label)).toEqual(['✓ Done', "Didn't go", 'Later'])
  })
  it('the peek and the menu: ✓ Done, Didn\'t go and the switch to a focus block', () => {
    const s = { ...EMPTY_ISLAND, locked: false, now: lecture }
    const q = quickButtons({ key: 'now:1', kind: 'now', text: 'University', sub: '', pct: 0, over: false } as never, s, DEFAULT_ISLAND_PREFS.chips, at('10:00'))
    expect(q.map((x) => x.label)).toEqual(['✓ Done', "Didn't go"])
    const m = menuFor({ key: 'now:1', kind: 'now', text: 'University', sub: '', pct: 0, over: false } as never, s, DEFAULT_ISLAND_PREFS.chips, false)
    expect(m.map((x) => x.id)).toEqual(['m:evdone', 'm:evskip', 'm:asfocus'])
    expect(quickButtons({ key: 'now:1', kind: 'now', text: 'University', sub: '', pct: 0, over: false } as never, { ...s, now: { ...lecture, mark: 'done' } }, DEFAULT_ISLAND_PREFS.chips, at('10:00'))).toEqual([])
  })
})
