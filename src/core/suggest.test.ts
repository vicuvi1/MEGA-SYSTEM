import { describe, expect, it } from 'vitest'
import { answerSuggestion, cleanSuggestState, EMPTY_SUGGEST, learned, markShown, pausedKinds, pickSuggestion, resetSuggestKind, suggestAlert, type Suggestion, type SuggestStats } from './suggest'

const T = Date.parse('2026-11-04T10:00:00')
const sg = (id: string, sk: any = 'back', own = false): Suggestion => ({ id, sk, title: 'Algorithms block · 20 min left', text: 'Back to it?', accept: { label: '↩ Back', action: { kind: 'start', subject: 'Algorithms', minutes: 20 } }, ...(own ? { own } : {}) })
const at = { now: T, hour: 10, stats: {} as SuggestStats }

describe('the suggestion queue (SI3–SI6)', () => {
  it('picks the first one that passes, once per id, with a cooldown per kind and a daily budget', () => {
    let st = cleanSuggestState(null, '2026-11-04')
    const a = sg('back:1')
    expect(pickSuggestion([null, a], st, at)?.s.id).toBe('back:1')
    st = markShown(st, a, T)
    // Still the current one for a few minutes, then never again.
    expect(pickSuggestion([a], st, { ...at, now: T + 60_000 })?.s.id).toBe('back:1')
    expect(pickSuggestion([a], st, { ...at, now: T + 11 * 60_000 })).toBeNull()
    // Same kind, new id: waits for the cooldown.
    expect(pickSuggestion([sg('back:2')], st, { ...at, now: T + 11 * 60_000 })).toBeNull()
    expect(pickSuggestion([sg('back:2')], st, { ...at, now: T + 31 * 60_000 })?.s.id).toBe('back:2')
    // The budget.
    const full = { ...st, shown: 6 }
    expect(pickSuggestion([sg('x', 'emailBox')], full, at)).toBeNull()
    expect(pickSuggestion([sg('x', 'bedtime', true)], full, at)?.s.id).toBe('x')
    // A new day starts the budget again.
    expect(cleanSuggestState(full, '2026-11-05').shown).toBe(0)
  })
  it('Not now hides it for a while; Never stops the kind', () => {
    const st = cleanSuggestState(null, '2026-11-04')
    const a = sg('back:1')
    const later = answerSuggestion(st, {}, { ...a, laterMin: 15 }, 'later', at)
    expect(later.state.later['back:1']).toBe(T + 15 * 60_000)
    const never = answerSuggestion(st, {}, a, 'never', at)
    expect(pickSuggestion([sg('back:9')], never.state, at)).toBeNull()
    expect(pausedKinds(never.state, never.stats)).toEqual(['back'])
    expect(resetSuggestKind(never.state, never.stats, 'back').state.never).toEqual([])
  })
  it('learns: 4 ignores in a row → a dot; under 15% after 10 → stops, with one notice (SI6)', () => {
    let stats: SuggestStats = {}
    let st = EMPTY_SUGGEST
    for (let i = 0; i < 4; i++) ({ stats, state: st } = answerSuggestion(st, stats, sg(`b${i}`), 'ignored', at))
    expect(learned(stats, 'back')).toBe('dot')
    expect(pickSuggestion([sg('new')], { ...st, day: 'd' }, { ...at, hour: 15, stats })?.dot).toBe(true)
    // A yes resets the row.
    ;({ stats } = answerSuggestion(st, stats, sg('b5'), 'accept', at))
    expect(learned(stats, 'back')).toBe('peek')
    let notice: string | null = null
    const notices: string[] = []
    for (let i = 0; i < 6; i++) {
      ;({ stats, notice } = answerSuggestion(st, stats, sg(`c${i}`), 'later', { ...at, hour: 14 }))
      if (notice) notices.push(notice)
    }
    // 1 yes of 11: stopped, said once.
    expect(learned(stats, 'back')).toBe('stop')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('Settings')
    expect(pickSuggestion([sg('d')], st, { ...at, stats })).toBeNull()
  })
  it('skips a moment (hour or context) you keep saying no to', () => {
    let stats: SuggestStats = {}
    for (let i = 0; i < 3; i++) ({ stats } = answerSuggestion(EMPTY_SUGGEST, stats, sg(`e${i}`, 'emailBox'), 'later', { now: T, hour: 9, ctx: 'email' }))
    expect(pickSuggestion([sg('e9', 'emailBox')], EMPTY_SUGGEST, { now: T, hour: 9, stats })).toBeNull()
    expect(pickSuggestion([sg('e9', 'emailBox')], EMPTY_SUGGEST, { now: T, hour: 15, ctx: 'video', stats })?.s.id).toBe('e9')
  })
  it('becomes an island alert: Accept / Not now / Never', () => {
    const a = suggestAlert(sg('back:1'))
    expect(a.kind).toBe('suggest')
    expect(a.actions.map((x) => x.label)).toEqual(['↩ Back', 'Not now', 'Never'])
    expect(a.actions[0].action).toMatchObject({ kind: 'suggest', answer: 'accept', run: { kind: 'start', subject: 'Algorithms' } })
    const extra = suggestAlert({ ...sg('back:1'), extra: { label: 'Push 15', action: { kind: 'stop' } } }, true)
    expect(extra.actions.map((x) => x.label)).toEqual(['↩ Back', 'Push 15', 'Not now', 'Never'])
    expect(extra.dot).toBe(true)
  })
})
