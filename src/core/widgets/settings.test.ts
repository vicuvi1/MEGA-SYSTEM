import { describe, expect, it } from 'vitest'
import { budgetStep, dataDue, FRESH_BUDGET } from './budget'
import { validateManifest, type WidgetManifest } from './manifest'
import { cleanLook, cleanWidgets, installWidget, mergeLayout, removeWidget, setGrant } from './settings'

const m = (validateManifest({ id: 'pomo', name: 'P', version: '1.0.0', author: 'A', size: '1x1', refresh: 60, permissions: ['sound', 'add'] }) as { manifest: WidgetManifest }).manifest
const sha = 'b'.repeat(64)

describe('widget settings (PL2, PL8)', () => {
  it('install, revoke one permission, remove', () => {
    let s = installWidget(cleanWidgets(null), m, sha, 'fun', new Date(0))
    expect(s.installed[0].grants).toEqual({ read: false, network: [], add: true, sound: true })
    s = setGrant(s, m, 'pomo', { sound: false })
    expect(s.installed[0].grants.sound).toBe(false)
    // A grant the manifest never asked for can't be switched on.
    s = setGrant(s, m, 'pomo', { read: true, network: ['evil.io'] })
    expect(s.installed[0].grants).toMatchObject({ read: false, network: [] })
    expect(removeWidget(s, 'pomo').installed).toEqual([])
  })
  it('cleans saved values; unknown widgets kept for a newer PC', () => {
    const s = cleanWidgets({ installed: [{ id: 'future-one', sha256: sha, grants: { read: true } }, { id: 'pomo', sha256: 'bad' }], look: { style: 'weird', theme: 'dracula', clockColor: 'red' } }, { pomo: m })
    expect(s.installed.map((w) => w.id)).toEqual(['future-one'])
    expect(s.look).toMatchObject({ style: 'notch', theme: 'dracula', clockColor: '' })
    expect(cleanLook(null, 'capsule').style).toBe('capsule')
  })
  it('clock time zones: none by default, invalid ones dropped, going back on unless switched off', () => {
    expect(cleanLook(null)).toMatchObject({ zones: [], zoneBack: true })
    const l = cleanLook({ zones: [{ tz: 'America/New_York', label: 'NYC' }, { tz: 'Not/AZone', label: 'x' }, 'Asia/Tokyo'], zoneBack: false })
    expect(l.zones).toEqual([{ tz: 'America/New_York', label: 'NYC' }, { tz: 'Asia/Tokyo', label: '' }])
    expect(l.zoneBack).toBe(false)
  })
  it('layout: the first time on a PC takes the synced one; a change here is pushed; a change elsewhere is applied', () => {
    const order = [{ id: 'timer', on: true }, { id: 'rain', on: true }]
    const other = [{ id: 'rain', on: true }, { id: 'timer', on: false }]
    // Nothing synced yet: push this PC's.
    expect(mergeLayout({ pillOrder: order, look: 'black' }, { pillOrder: null, look: null, at: 0 }, null, 5).push).toEqual({ pillOrder: order, look: 'black', at: 5 })
    // A new PC: take the synced one.
    expect(mergeLayout({ pillOrder: order, look: 'black' }, { pillOrder: other, look: 'glass', at: 3 }, null, 5).apply).toEqual({ pillOrder: other, look: 'glass' })
    // Changed here since the last sync: push.
    expect(mergeLayout({ pillOrder: other, look: 'black' }, { pillOrder: order, look: 'black', at: 3 }, { pillOrder: order, look: 'black' }, 9).push?.pillOrder).toEqual(other)
    // Changed on another PC: apply.
    expect(mergeLayout({ pillOrder: order, look: 'black' }, { pillOrder: other, look: 'black', at: 7 }, { pillOrder: order, look: 'black' }, 9).apply).toEqual({ pillOrder: other, look: 'black' })
    // Same: nothing to do.
    expect(mergeLayout({ pillOrder: order, look: 'black' }, { pillOrder: order, look: 'black', at: 7 }, { pillOrder: order, look: 'black' }, 9)).toEqual({ push: null, apply: null })
  })
})

describe('speed budget (PL11)', () => {
  it('slow answers and busy time add strikes; three in a minute slow it down', () => {
    let b = budgetStep(FRESH_BUDGET, { kind: 'pong', lateMs: 10 }, 0)
    expect(b.strikes).toEqual([])
    b = budgetStep(b, { kind: 'busy', ms: 400 }, 1000)
    b = budgetStep(b, { kind: 'pong', lateMs: 1200 }, 2000)
    expect(b.slowed).toBe(false)
    b = budgetStep(b, { kind: 'silent' }, 3000)
    expect(b.slowed).toBe(true)
    expect(b.why).toBeTruthy()
  })
  it('strikes older than a minute are forgotten; a freeze slows it at once', () => {
    let b = budgetStep(FRESH_BUDGET, { kind: 'timeout' }, 0)
    b = budgetStep(b, { kind: 'timeout' }, 10_000)
    b = budgetStep(b, { kind: 'timeout' }, 90_000)
    expect(b.slowed).toBe(false)
    expect(budgetStep(FRESH_BUDGET, { kind: 'pong', lateMs: 3000 }, 0).slowed).toBe(true)
  })
  it('data never faster than every 15 s, never while hidden', () => {
    expect(dataDue(0, 1, 10_000, true)).toBe(false)
    expect(dataDue(0, 1, 15_000, true)).toBe(true)
    expect(dataDue(0, 60, 59_000, true)).toBe(false)
    expect(dataDue(0, 60, 600_000, false)).toBe(false)
  })
})
