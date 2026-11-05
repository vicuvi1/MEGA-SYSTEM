import { describe, expect, it } from 'vitest'
import { comebackPlan } from './comeback'

describe('comeback plan after a reset', () => {
  it('turns the 72 hours into tasks and check-ins at the right times', () => {
    const now = new Date('2026-11-05T15:00:00')
    const p = comebackPlan(now, 'Phone in bed', '23:30')
    expect(p.filter((x) => x.kind === 'task')).toHaveLength(3)
    expect(p.filter((x) => x.kind === 'checkin')).toHaveLength(4)
    expect(p[1].text).toMatch(/phone .* desk across the room/)
    expect(new Date(p[1].at).getHours()).toBe(22) // an hour before bedtime
    expect(Date.parse(p.at(-1)!.at) - now.getTime()).toBe(72 * 3600_000)
  })
  it('a generic if-then without a known trigger', () => {
    expect(comebackPlan(new Date('2026-11-05T23:50:00'), null)[1].text).toMatch(/urge crusher/)
  })
})
