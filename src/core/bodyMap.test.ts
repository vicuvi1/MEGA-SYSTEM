import { describe, expect, it } from 'vitest'
import { bodyMap, mobilityRoutine, muscleDetail, REGIONS, setZone, zoneHeat, zoneLine } from './bodyMap'

describe('body map set zones', () => {
  it('0 none, 1–9 under, 10–20 the growth zone, over 20 too much', () => {
    expect(setZone(0)).toBe('none')
    expect(setZone(1)).toBe('low')
    expect(setZone(9)).toBe('low')
    expect(setZone(10)).toBe('grow')
    expect(setZone(20)).toBe('grow')
    expect(setZone(21)).toBe('high')
    expect(setZone(-3)).toBe('none')
    expect(setZone(Number.NaN)).toBe('none')
  })

  it('brightness grows with sets and is full at 20', () => {
    expect(zoneHeat(0)).toBe(0)
    expect(zoneHeat(10)).toBe(0.5)
    expect(zoneHeat(20)).toBe(1)
    expect(zoneHeat(40)).toBe(1)
  })

  it('the four groups in order with their zone', () => {
    const m = bodyMap({ push: 12, pull: 4, legs: 25 })
    expect(m.map((g) => [g.muscle, g.sets, g.zone])).toEqual([
      ['push', 12, 'grow'],
      ['pull', 4, 'low'],
      ['core', 0, 'none'],
      ['legs', 25, 'high']
    ])
  })

  it('plain lines for each zone', () => {
    expect(zoneLine(0)).toMatch(/No hard sets yet/)
    expect(zoneLine(6)).toBe('6 hard sets this week: 4 more to reach 10.')
    expect(zoneLine(1)).toBe('1 hard set this week: 9 more to reach 10.')
    expect(zoneLine(14)).toMatch(/growth zone \(10–20\)/)
    expect(zoneLine(24)).toMatch(/over 20/)
  })

  it('every drawn region belongs to one of the four groups, front and back', () => {
    const groups = new Set(REGIONS.map((r) => r.muscle))
    expect([...groups].sort()).toEqual(['core', 'legs', 'pull', 'push'])
    expect(REGIONS.some((r) => r.side === 'front')).toBe(true)
    expect(REGIONS.some((r) => r.side === 'back')).toBe(true)
  })

  it('a tapped muscle: its sets, your own moves first, then library ideas you do not do yet', () => {
    const ex = [
      { id: 'a', name: 'Push-ups', target: 50 },
      { id: 'b', name: 'Diamond push-ups', target: 20 },
      { id: 'c', name: 'Squats', target: 40 },
      { id: 'd', name: 'Pike push-ups', target: 10, active: false }
    ]
    const d = muscleDetail('push', 13, ex)
    expect(d.zone).toBe('grow')
    expect(d.parts).toMatch(/chest/)
    expect(d.yours.map((y) => y.name)).toEqual(['Push-ups', 'Diamond push-ups'])
    expect(d.ideas).toHaveLength(3)
    expect(d.ideas.every((m) => m.group === 'push' && m.id !== 'pushup' && m.id !== 'diamond_pushup')).toBe(true)
    // Easiest first.
    expect(d.ideas[0].diff).toBeLessThanOrEqual(d.ideas[2].diff)
  })

  it('a 5–10 minute mobility routine from the library', () => {
    const r = mobilityRoutine()
    expect(r.length).toBeGreaterThanOrEqual(5)
    expect(r.every((x) => x.move.group === 'mobility' && x.move.anim)).toBe(true)
  })
})
