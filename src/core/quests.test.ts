import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './ledger'
import { questRef, questsFor, questState } from './quests'

let id = 1
const e = (p: Partial<LedgerEntry>): LedgerEntry => ({ id: id++, ts: '2026-10-26T10:00:00Z', day: '2026-10-26', module: 'test', kind: 'earn', coins: 10, xp: 10, ...p })

describe('daily quests', () => {
  it('picks the same three quests all day, different days differ', () => {
    expect(questsFor('2026-10-26').map((q) => q.id)).toEqual(questsFor('2026-10-26').map((q) => q.id))
    expect(questsFor('2026-10-26')).toHaveLength(3)
    const days = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'].map((d) => questsFor(d).map((q) => q.id).join())
    expect(new Set(days).size).toBeGreaterThan(1)
  })

  it('tracks progress from the day and knows when the bonus was claimed', () => {
    const day = '2026-10-26'
    const qs = questsFor(day)
    // Satisfy every quest generously.
    const rows: LedgerEntry[] = []
    for (const id of ['study.block_done', 'study.block_done', 'sleep.up_on_time', 'sleep.bed_on_time', 'money.logged', 'discipline.clean_day', 'body.workout_done', 'face.routine_done']) rows.push(e({ ruleId: id, coins: 15 }))
    for (let i = 0; i < 3; i++) rows.push(e({ ref: `task:${i}` }))
    const s = questState(day, rows)
    expect(s.quests.map((q) => q.id)).toEqual(qs.map((q) => q.id))
    expect(s.allDone).toBe(true)
    expect(s.claimed).toBe(false)
    expect(questState(day, [...rows, e({ ref: questRef(day) })]).claimed).toBe(true)
    expect(questState(day, []).allDone).toBe(false)
  })

  it('counts focus sessions as study blocks (FX7)', () => {
    const study = (day: string, rows: LedgerEntry[]) => questState(day, rows)
    const day = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'].find((d) => questsFor(d).some((q) => q.id === 'study2'))!
    const rows = [e({ day, ruleId: 'focus.session' }), e({ day, ruleId: 'focus.session' })]
    expect(study(day, rows).quests.find((q) => q.id === 'study2')).toMatchObject({ progress: 2, done: true })
  })
})
