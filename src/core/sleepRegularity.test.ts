import { describe, expect, it } from 'vitest'
import { sleepRegularity } from './sleepRegularity'

const log = (day: string, bedTime: string | null, wakeTime: string) => ({ id: 1, day, wakeTime, wakeTarget: '07:00', onTime: true, bedTime, bedTarget: '23:00', bedOnTime: true, quality: null, createdAt: '' })

describe('sleep regularity', () => {
  it('steady times score high; bedtimes around midnight are compared the right way', () => {
    const steady = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map((d, i) => log(d, i % 2 ? '23:50' : '00:10', '07:30'))
    const r = sleepRegularity(steady)
    expect(r.bedSpreadMin).toBe(10)
    expect(r.score).toBeGreaterThan(90)
    expect(r.nights[0]).toEqual({ day: '2026-11-02', minutes: 440 })
  })
  it('weekend lie-ins show as social jet lag', () => {
    const r = sleepRegularity([log('2026-11-05', '23:00', '07:00'), log('2026-11-04', '23:00', '07:00'), log('2026-11-07', '01:00', '10:00'), log('2026-11-08', '01:00', '10:00')])
    expect(r.socialJetLagMin).toBe(150) // midpoint 03:00 → 05:30
    expect(r.score).toBeLessThan(60)
  })
  it('too little data: no score', () => {
    expect(sleepRegularity([log('2026-11-05', null, '07:00')]).score).toBeNull()
  })
})

import { examSleepGuard } from './sleepRegularity'
describe('exam-week sleep guard', () => {
  const nights = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((day) => ({ day, minutes: 330 }))
  it('warns before an exam when sleep debt is over budget', () => {
    const g = examSleepGuard({ today: '2026-11-05', nights, exams: [{ title: 'Etica exam', deadline: '2026-11-08' }], bedTarget: '23:00' })
    expect(g).toMatchObject({ daysLeft: 3, debtMin: 600 })
    expect(g!.text).toMatch(/Etica exam in 3 days.*10 h short/)
  })
  it('quiet without an exam soon or with enough sleep', () => {
    expect(examSleepGuard({ today: '2026-11-05', nights, exams: [{ title: 'x', deadline: '2026-12-20' }], bedTarget: '23:00' })).toBeNull()
    expect(examSleepGuard({ today: '2026-11-05', nights: nights.map((n) => ({ ...n, minutes: 470 })), exams: [{ title: 'x', deadline: '2026-11-06' }], bedTarget: '23:00' })).toBeNull()
  })
})
