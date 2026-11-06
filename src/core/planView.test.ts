import { describe, expect, it } from 'vitest'
import { fmtMinutes, planTimeline, planTone } from './planView'
import { toMin } from './rhythm'

const plan = {
  blocks: [
    { title: 'Study algebra', start: '14:00', minutes: 90 },
    { title: 'App dev', start: '09:00', minutes: 120 }
  ],
  training: { time: '18:00', what: 'Gym' }
}

describe('plan timeline', () => {
  it('sorts the blocks and places them on the bar', () => {
    const t = planTimeline(plan, toMin('08:00'))
    expect(t.items.map((x) => x.title)).toEqual(['App dev', 'Study algebra', 'Gym'])
    expect(t.from).toBe('09:00')
    expect(t.to).toBe('19:00')
    expect(t.items[0].left).toBe(0)
    expect(t.items[0].width).toBeCloseTo(120 / 600)
    expect(t.items[2].left + t.items[2].width).toBeCloseTo(1)
    expect(t.now).toBeNull()
    expect(t.totalMin).toBe(210)
  })

  it('marks past, now and next', () => {
    const t = planTimeline(plan, toMin('10:00'))
    expect(t.items.map((x) => x.state)).toEqual(['now', 'next', 'later'])
    expect(t.now).toBeCloseTo(60 / 600)
    expect(planTimeline(plan, toMin('16:00')).items.map((x) => x.state)).toEqual(['past', 'past', 'next'])
  })

  it('colours by what a block is', () => {
    expect(planTone('Gym', true)).toBe('train')
    expect(planTone('Read 20 pages')).toBe('read')
    expect(planTone('Deep block 1')).toBe('study')
    expect(planTone('App dev')).toBe('build')
    expect(planTone('Groceries')).toBe('life')
  })

  it('an empty plan has no bar', () => {
    expect(planTimeline({ blocks: [], training: null }, 600).items).toEqual([])
  })

  it('says minutes the short way', () => {
    expect(fmtMinutes(250)).toBe('4h 10m')
    expect(fmtMinutes(120)).toBe('2h')
    expect(fmtMinutes(45)).toBe('45 min')
  })
})
