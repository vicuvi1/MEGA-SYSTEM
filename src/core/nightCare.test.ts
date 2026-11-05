import { describe, expect, it } from 'vitest'
import { installNow, memoryReloadDue, quietReloadDue } from './nightCare'

const MB = 1024 * 1024

describe('night care (CL5, CL9)', () => {
  it('a hidden tab reloads at 04:00 after 3 days, or when it holds too much memory; never while you look at it', () => {
    expect(quietReloadDue({ hidden: true, hour: 4, ageMs: 4 * 86400_000 })).toBe(true)
    expect(quietReloadDue({ hidden: true, hour: 4, ageMs: 2 * 86400_000 })).toBe(false)
    expect(quietReloadDue({ hidden: true, hour: 15, ageMs: 9 * 86400_000 })).toBe(false)
    expect(quietReloadDue({ hidden: true, hour: 15, ageMs: 1000, heapBytes: 300 * MB })).toBe(true)
    expect(quietReloadDue({ hidden: false, hour: 4, ageMs: 9 * 86400_000, heapBytes: 900 * MB })).toBe(false)
  })
  it('the desktop reloads its windows at 04:00 only when nobody is there and they grew big', () => {
    expect(memoryReloadDue({ hour: 4, idleSec: 25 * 60, memBytes: 400 * MB })).toBe(true)
    expect(memoryReloadDue({ hour: 4, idleSec: 5 * 60, memBytes: 400 * MB })).toBe(false)
    expect(memoryReloadDue({ hour: 4, idleSec: 25 * 60, memBytes: 200 * MB })).toBe(false)
    expect(memoryReloadDue({ hour: 3, idleSec: 25 * 60, memBytes: 400 * MB })).toBe(false)
  })
  it('a ready update installs at the quiet hour, or at once when the app is too old to save', () => {
    const night = { state: 'ready', hour: 4, idleSec: 45 * 60, focusRunning: false }
    expect(installNow(night)).toBe(true)
    expect(installNow({ ...night, focusRunning: true })).toBe(false)
    expect(installNow({ ...night, idleSec: 60 })).toBe(false)
    expect(installNow({ ...night, hour: 14 })).toBe(false)
    expect(installNow({ ...night, hour: 14, idleSec: 0, schemaOld: true })).toBe(true)
    expect(installNow({ ...night, state: 'downloading', schemaOld: true })).toBe(false)
  })
})
