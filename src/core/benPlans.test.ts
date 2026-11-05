import { describe, expect, it } from 'vitest'

import { planningSteps } from './benPlans'
describe('planning agent steps', () => {
  it('4 steps: calendar, free time, deadlines, proposal waiting for OK', () => {
    const s = planningSteps({ events: 9, busyMin: 600, days: 5, today: '2026-11-05', goals: [{ title: 'Etica', hoursLeft: 6, deadline: '2026-11-12' }], blocks: [{ day: '2026-11-06', start: '09:00', minutes: 50, title: 'Etica', kind: 'deep' }] })
    expect(s.map((x) => x.label)).toEqual(['Read your calendar', 'Found free time', 'Checked deadlines', 'Proposed'])
    expect(s[1].detail).toBe('about 60 h free between 8:00 and 22:00')
    expect(s[2].detail).toBe('Etica: 6 h left, 7 days')
    expect(s[3].detail).toMatch(/Waiting for your OK/)
  })
})
