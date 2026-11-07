// Which career message the tick sends (made-up data), and that each goes once a day.
import { describe, expect, it } from 'vitest'
import { cleanAsks, pickCareerPing } from './careerTick'

const base: any = {
  letterDue: null,
  money: { asks: [] },
  followUps: [],
  study: { essays: [], shift: null }
}
const at = (h: number, m = 0) => h * 60 + m

describe('career tick', () => {
  it('nothing to say: nothing sent', () => {
    expect(pickCareerPing(base, { day: 'd', sent: [] }, at(12))).toBeNull()
  })
  it('the letter first, then pay yourself first, then a follow-up, then an essay', () => {
    const v = { ...base, letterDue: '2026-10', money: { asks: [{ txId: 't1' }] }, followUps: [{ id: 'j1' }], study: { essays: [{ essay: { id: 'e1' }, status: { state: 'behind' } }], shift: null } }
    expect(pickCareerPing(v, { day: 'd', sent: [] }, at(12))?.key).toBe('letter:2026-10')
    expect(pickCareerPing(v, { day: 'd', sent: ['letter:2026-10'] }, at(12))?.key).toBe('pay:t1')
    expect(pickCareerPing(v, { day: 'd', sent: ['letter:2026-10', 'pay:t1'] }, at(12))?.key).toBe('fu:j1')
    expect(pickCareerPing(v, { day: 'd', sent: ['letter:2026-10', 'pay:t1', 'fu:j1'] }, at(12))?.key).toBe('essay')
    // Not before 10:00.
    expect(pickCareerPing(v, { day: 'd', sent: [] }, at(8))).toBeNull()
  })
  it('the study pack only once the shift has run 30 minutes, once a day, never when the shift is off', () => {
    const v = { ...base, study: { essays: [], shift: { from: '17:00', to: '24:00', mode: 'normal', now: true } } }
    expect(pickCareerPing(v, { day: 'd', sent: [] }, at(17, 10))).toBeNull()
    expect(pickCareerPing(v, { day: 'd', sent: [] }, at(17, 45))?.kind).toBe('pack')
    expect(pickCareerPing(v, { day: 'd', sent: ['pack'] }, at(19))).toBeNull()
    expect(pickCareerPing({ ...v, study: { essays: [], shift: { ...v.study.shift, mode: 'off' } } }, { day: 'd', sent: [] }, at(18))).toBeNull()
  })
  it('the marks start over each day', () => {
    expect(cleanAsks({ day: '2026-11-06', sent: ['pack'] }, '2026-11-07')).toEqual({ day: '2026-11-07', sent: [] })
    expect(cleanAsks({ day: '2026-11-07', sent: ['pack', 3] }, '2026-11-07')).toEqual({ day: '2026-11-07', sent: ['pack'] })
  })
})
