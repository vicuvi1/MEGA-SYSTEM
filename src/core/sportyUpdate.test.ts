import { describe, expect, it } from 'vitest'
import { pollSporty, sportyUpdated, sportyView } from './sportyUpdate'

const t = (m: number) => new Date(Date.UTC(2026, 10, 4, 10, m))

describe('Sporty self-update', () => {
  it('first poll saves the status, no update without a request', () => {
    const r = pollSporty(null, null, { version: 'abc', behind: 2, latest: 'def' }, t(0))
    expect(r).toMatchObject({ update: false, save: true, status: { version: 'abc', behind: 2, latest: 'def' } })
  })

  it('same poll a minute later is not written again', () => {
    const a = pollSporty(null, null, { version: 'abc', behind: 0 }, t(0)).status
    expect(pollSporty(a, null, { version: 'abc', behind: 0 }, t(1)).save).toBe(false)
    expect(pollSporty(a, null, { version: 'abc', behind: 0 }, t(6)).save).toBe(true)
  })

  it('a button press is handed to Sporty exactly once', () => {
    const a = pollSporty(null, null, { version: 'abc' }, t(0)).status
    const req = { at: t(1).toISOString() }
    const b = pollSporty(a, req, { version: 'abc' }, t(2))
    expect(b.update).toBe(true)
    expect(pollSporty(b.status, req, { version: 'abc' }, t(3)).update).toBe(false)
  })

  it('a request older than the last update is ignored', () => {
    const a = sportyUpdated(pollSporty(null, null, { version: 'abc' }, t(0)).status, { ok: true, updated: true, version: 'def' }, t(5))
    expect(pollSporty(a, { at: t(4).toISOString() }, { version: 'def' }, t(6)).update).toBe(false)
  })

  it('records the update result', () => {
    const a = pollSporty(null, null, { version: 'abc', behind: 3 }, t(0)).status
    const b = sportyUpdated(a, { ok: true, updated: true, version: 'def', changes: ['New card'] }, t(1))
    expect(b).toMatchObject({ version: 'def', behind: 0, lastUpdate: { ok: true, updated: true, changes: ['New card'] } })
    const c = sportyUpdated(b, { ok: false, error: 'local changes' }, t(2))
    expect(c).toMatchObject({ version: 'def', lastUpdate: { ok: false, error: 'local changes' } })
  })

  it('view: online, pending, old Sporty', () => {
    const s = pollSporty(null, null, { version: 'abc', behind: 1 }, t(0)).status
    expect(sportyView(s, null, { at: t(1).toISOString() }, t(2))).toMatchObject({ online: true, connected: true, behind: 1, pending: true, canUpdate: true })
    expect(sportyView(s, null, null, t(10)).online).toBe(false)
    expect(sportyView(null, { at: t(0).toISOString() }, null, t(1))).toMatchObject({ connected: true, canUpdate: false, online: false })
    expect(sportyView(null, null, null, t(1)).connected).toBe(false)
  })
})
