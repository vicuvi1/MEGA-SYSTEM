import { describe, expect, it } from 'vitest'
import { activityLine, addActivity, appLabel, classifyApp, cleanPcPrefs, DEFAULT_PC, focusQualityPc, lateNight, siteBlocked } from './pcActivity'

describe('Ben on this PC (P1–P19)', () => {
  it('is off by default for the app sensor and keeps your lists', () => {
    const p = cleanPcPrefs(null)
    expect(p.activeApp).toBe(false)
    expect(p.titles).toBe(false)
    expect(p.history).toBe(false)
    expect(cleanPcPrefs({ activeApp: true, work: ['Code', 'code', ''] }).work).toEqual(['code'])
  })
  it('tells work from distraction, your list first (P2, P3)', () => {
    expect(classifyApp('Code.exe', null, DEFAULT_PC)).toBe('work')
    expect(classifyApp('steam.exe', null, DEFAULT_PC)).toBe('distract')
    expect(classifyApp('chrome.exe', 'Lofi beats - YouTube', DEFAULT_PC)).toBe('distract')
    expect(classifyApp('chrome.exe', null, DEFAULT_PC)).toBe('neutral') // no titles: just "Chrome"
    expect(classifyApp('chrome.exe', 'Algorithms lecture - YouTube', { ...DEFAULT_PC, work: [...DEFAULT_PC.work, 'algorithms lecture'] })).toBe('work')
    expect(appLabel('chrome.exe', 'Lofi - YouTube')).toBe('YouTube')
    expect(appLabel('code.exe', null)).toBe('VS Code')
  })
  it('adds up the day and says it in one line (P8)', () => {
    let d = addActivity(null, '2026-11-05', 'VS Code', 'work', 3 * 3600)
    d = addActivity(d, '2026-11-05', 'YouTube', 'distract', 35 * 60)
    d = addActivity(d, '2026-11-05', 'Notepad', 'neutral', 30)
    expect(activityLine(d)).toBe('VS Code 3h, YouTube 35m · work 3h, distracting 35m')
    expect(addActivity(d, '2026-11-06', 'X', 'neutral', 10).apps['VS Code']).toBeUndefined()
  })
  it('counts distraction against focus quality (P7)', () => {
    expect(focusQualityPc(3000, 300, 300)).toBe(80)
    expect(focusQualityPc(0, 0, 0)).toBe(100)
  })
  it('knows a late night from a normal evening (P13)', () => {
    expect(lateNight(new Date('2026-11-05T23:45:00'), '23:00', 10)).toBe(true)
    expect(lateNight(new Date('2026-11-06T01:30:00'), '23:00', 10)).toBe(true)
    expect(lateNight(new Date('2026-11-05T23:15:00'), '23:00', 10)).toBe(false)
    expect(lateNight(new Date('2026-11-06T06:00:00'), '23:00', 10)).toBe(false)
    expect(lateNight(new Date('2026-11-05T23:45:00'), '23:00', 600)).toBe(false) // not at the PC
    expect(lateNight(new Date('2026-11-06T01:10:00'), '00:30', 5)).toBe(true)
  })
  it('matches blocked sites (P19)', () => {
    expect(siteBlocked('www.youtube.com', DEFAULT_PC.sites)).toBe(true)
    expect(siteBlocked('m.reddit.com', DEFAULT_PC.sites)).toBe(true)
    expect(siteBlocked('notyoutube.com', DEFAULT_PC.sites)).toBe(false)
  })
})

describe('real breaks (P11, P14)', () => {
  it('asks for a break after 50 minutes of input, with "lock the PC"', async () => {
    const { moveAlert } = await import('./islandBody')
    const now = Date.parse('2026-11-05T15:00:00')
    const base = { now, busy: false, idleSec: 10, water: { ml: 0, target: 0 }, lastWaterAt: 0, lastMoveAt: 0, lastEyesAt: 0, eyeBreaks: false, dismissed: {} }
    expect(moveAlert({ ...base, activeSince: now - 45 * 60_000 } as any)).toBeNull()
    const a = moveAlert({ ...base, activeSince: now - 52 * 60_000 } as any)
    expect(a?.actions.some((x) => x.action.kind === 'lockPc')).toBe(true)
  })
})
