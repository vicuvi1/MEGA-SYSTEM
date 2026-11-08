import { describe, expect, it } from 'vitest'
import { dedupeColumn, type ColumnItem } from './dayColumn'

const ev = (key: string, title: string, start: number, end: number, extra: Partial<ColumnItem> = {}): ColumnItem => ({ key, title, start, end, kind: 'event', ...extra })
const task = (id: string, title: string, start: number, end: number): ColumnItem => ({ key: `t:${id}`, title, start, end, kind: 'task', taskId: id })

describe('Your day column: one thing once', () => {
  it('a moved task and its old calendar event show once', () => {
    const out = dedupeColumn([ev('e:1', 'Draft the networking lab report', 720, 780, { ours: true }), task('t4', 'Draft the networking lab report (60 min)', 745, 805)])
    expect(out.map((b) => b.key)).toEqual(['e:1'])
  })
  it('the same words in an old and a moved event show once, ours kept', () => {
    const out = dedupeColumn([ev('e:old', 'Draft the networking lab report', 720, 780), ev('e:new', 'Draft the networking lab report', 745, 805, { ours: true })])
    expect(out.map((b) => b.key)).toEqual(['e:new'])
  })
  it('a task already in an event checklist is not drawn again', () => {
    const out = dedupeColumn([ev('e:1', 'Study block', 600, 660, { holds: ['t1'] }), task('t1', 'Read chapter 4', 900, 930)])
    expect(out.map((b) => b.key)).toEqual(['e:1'])
  })
  it('two different things stay, also at the same time', () => {
    const out = dedupeColumn([ev('e:1', 'Chapter 3 notes', 720, 780), ev('e:2', 'Chapter 4 notes', 720, 780), task('t1', 'Gym', 720, 780)])
    expect(out).toHaveLength(3)
  })
  it('the same title at a different time (no overlap) stays twice', () => {
    const out = dedupeColumn([ev('e:1', 'Stand-up', 540, 555), ev('e:2', 'Stand-up', 1020, 1035)])
    expect(out).toHaveLength(2)
  })
})
