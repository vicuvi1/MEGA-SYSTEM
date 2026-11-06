import { describe, expect, it } from 'vitest'
import { cleanSysmonPrefs, cleanTemp, cpuDeltas, DEFAULT_SYSMON, fmtBytes, isSystemProc, kelvinTenthsToC, pushHistory, readsLocalUsage, sparkPath, topApps } from './sysmon'
import { pcActText, pcDenied, readPcAction } from './pcActions'

describe('closing an app goes through the PC action checks', () => {
  it('reads "pc: close" and refuses Windows parts', () => {
    expect(readPcAction('pc: close chrome')).toEqual({ kind: 'close', arg: 'chrome' })
    expect(pcActText({ kind: 'close', arg: 'chrome.exe' })).toBe('close chrome')
    expect(pcDenied({ kind: 'close', arg: 'chrome' })).toBeNull()
    expect(pcDenied({ kind: 'close', arg: 'svchost' })).toMatch(/never/)
    expect(pcDenied({ kind: 'close', arg: 'explorer.exe' })).toMatch(/never/)
    expect(pcDenied({ kind: 'close', arg: 'KeePass' })).toMatch(/never list/)
    expect(pcDenied({ kind: 'close', arg: 'a & b' })).toMatch(/plain name/)
  })
})

const t = (busy: number, idle: number) => ({ user: busy, nice: 0, sys: 0, idle, irq: 0 })

describe('CPU per core', () => {
  it('works out each core and the total from two readings', () => {
    const r = cpuDeltas([t(100, 100), t(100, 100)], [t(150, 150), t(190, 110)])
    expect(r.cores).toEqual([50, 90])
    expect(r.total).toBe(70)
  })
  it('a missing or unchanged core reads 0', () => {
    expect(cpuDeltas([t(1, 1)], [t(1, 1), t(5, 5)])).toEqual({ total: 0, cores: [0, 0] })
  })
})

describe('busiest apps', () => {
  const prev = [
    { pid: 1, name: 'chrome.exe', cpuSec: 10, mem: 100 },
    { pid: 2, name: 'chrome.exe', cpuSec: 5, mem: 100 },
    { pid: 3, name: 'svchost.exe', cpuSec: 1, mem: 50 },
    { pid: 4, name: 'Code.exe', cpuSec: 3, mem: 900 }
  ]
  const cur = [
    { pid: 1, name: 'chrome.exe', cpuSec: 11, mem: 200 },
    { pid: 2, name: 'chrome.exe', cpuSec: 6, mem: 200 },
    { pid: 3, name: 'svchost.exe', cpuSec: 1.5, mem: 50 },
    { pid: 4, name: 'Code.exe', cpuSec: 3.2, mem: 900 },
    { pid: 5, name: 'new.exe', cpuSec: 99, mem: 10 }
  ]
  it('groups by name, CPU as a share of the whole PC', () => {
    // 1 s on 4 cores: chrome used 2 CPU seconds → 50%.
    const top = topApps(prev, cur, 1000, 4)
    expect(top[0]).toEqual({ name: 'chrome', cpu: 50, mem: 400, count: 2, system: false })
    expect(top.find((a) => a.name === 'svchost')?.system).toBe(true)
    // A process with no earlier reading has used no CPU yet.
    expect(top.find((a) => a.name === 'new')?.cpu).toBe(0)
  })
  it('can sort by memory', () => {
    expect(topApps(prev, cur, 1000, 4, 'mem', 2).map((a) => a.name)).toEqual(['Code', 'chrome'])
  })
})

describe('system apps are never closed', () => {
  it('knows Windows parts and this app', () => {
    for (const n of ['svchost.exe', 'explorer', 'csrss', 'lsass.exe', 'dwm', 'MsMpEng', 'Life System', 'electron']) expect(isSystemProc(n)).toBe(true)
    for (const n of ['chrome.exe', 'Spotify', 'Code']) expect(isSystemProc(n)).toBe(false)
  })
})

describe('history and the small line', () => {
  it('keeps the newest values', () => {
    let h: number[] = []
    for (let i = 0; i < 70; i++) h = pushHistory(h, i)
    expect(h.length).toBe(60)
    expect(h[59]).toBe(69)
  })
  it('draws from the bottom up', () => {
    expect(sparkPath([0, 5, 10], 20, 10)).toBe('M0.0 10.0 L10.0 5.0 L20.0 0.0')
    expect(sparkPath([], 20, 10)).toBe('')
  })
})

describe('temperatures are never made up', () => {
  it('drops readings that cannot be right', () => {
    expect(cleanTemp(55.4)).toBe(55)
    expect(cleanTemp(0)).toBeNull()
    expect(cleanTemp(200)).toBeNull()
    expect(cleanTemp('x')).toBeNull()
    expect(kelvinTenthsToC(3232)).toBe(50)
  })
})

describe('settings', () => {
  it('defaults: the System page on, the AI page and readings off, alerts at 70 / 90', () => {
    expect(cleanSysmonPrefs(null)).toEqual(DEFAULT_SYSMON)
    expect(readsLocalUsage(DEFAULT_SYSMON)).toBe(false)
  })
  it('keeps the warning below the critical level', () => {
    const p = cleanSysmonPrefs({ alerts: { warn: 95, crit: 90 } })
    expect(p.alerts.warn).toBeLessThan(p.alerts.crit)
  })
  it('reads local logs only for the AI page or the rings', () => {
    expect(readsLocalUsage(cleanSysmonPrefs({ readings: { rings: true } }))).toBe(true)
    expect(readsLocalUsage(cleanSysmonPrefs({ pages: { ai: true }, tools: { claude: false, codex: false } }))).toBe(false)
  })
  it('formats bytes', () => {
    expect(fmtBytes(1536)).toBe('1.5 KB')
    expect(fmtBytes(16 * 1024 ** 3)).toBe('16 GB')
  })
})
