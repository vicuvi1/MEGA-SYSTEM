import { describe, expect, it } from 'vitest'
import { photoPlan } from './bodyPhotos'

describe('progress photos plan (BD10)', () => {
  it('the first photo is due at once, then every 2 weeks', () => {
    expect(photoPlan([], '2026-11-07')).toMatchObject({ due: true, last: null, compare: null })
    const p = photoPlan([{ id: 'a', day: '2026-11-01' }], '2026-11-07')
    expect(p).toMatchObject({ due: false, dueIn: 8, next: '2026-11-15' })
    expect(photoPlan([{ id: 'a', day: '2026-11-01' }], '2026-11-16').due).toBe(true)
  })
  it('compares the latest photo with the one about 8 weeks before', () => {
    const list = [
      { id: 'a', day: '2026-09-01' },
      { id: 'b', day: '2026-09-12' },
      { id: 'c', day: '2026-10-20' },
      { id: 'd', day: '2026-11-06' }
    ]
    const p = photoPlan(list, '2026-11-07')
    expect(p.compare).toMatchObject({ before: { id: 'b' }, after: { id: 'd' }, weeks: 8 })
    expect(p.compareDue).toBe(true)
    expect(photoPlan(list.slice(2), '2026-11-07').compare).toMatchObject({ before: { id: 'c' }, weeks: 2 })
  })
})
