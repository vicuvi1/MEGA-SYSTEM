import { describe, expect, it } from 'vitest'
import { expiredLabel, PLANNER_VERSION, rhythmFor } from './rhythm'

describe('expired drafts (Coach fix)', () => {
  const plan = { day: '2026-03-09', headline: 'Short night: one block', mustdos: [], blocks: [{ title: 'Check mail', start: '15:20', minutes: 40 }], training: null, waterMl: 2700 }
  it("last night's draft expires when the app day turns", () => {
    const st = rhythmFor({ day: '2026-03-09', water: [], briefing: { status: 'proposed', sentAt: '2026-03-09T23:50:00Z', plan, version: 1, planner: PLANNER_VERSION } }, '2026-03-10')
    expect(st.briefing).toBeUndefined()
    expect(st.expired).toMatchObject({ why: 'night', version: 1, headline: 'Short night: one block' })
    expect(expiredLabel(st.expired!)).toBe("Expired · last night's draft")
  })
  it("a draft from the old planner expires the same morning; a current or approved one doesn't", () => {
    const old = rhythmFor({ day: '2026-03-10', water: [], briefing: { status: 'proposed', sentAt: '2026-03-10T02:10:00Z', plan, version: 1 } }, '2026-03-10')
    expect(old.briefing).toBeUndefined()
    expect(old.expired?.why).toBe('planner')
    const fresh = rhythmFor({ day: '2026-03-10', water: [], briefing: { status: 'proposed', sentAt: '2026-03-10T06:10:00Z', plan, version: 2, planner: PLANNER_VERSION } }, '2026-03-10')
    expect(fresh.briefing?.version).toBe(2)
    expect(fresh.expired).toBeUndefined()
    const approved = rhythmFor({ day: '2026-03-10', water: [], briefing: { status: 'approved', sentAt: '2026-03-10T02:10:00Z', plan, version: 1 } }, '2026-03-10')
    expect(approved.briefing?.status).toBe('approved')
  })
})
