import { describe, expect, it } from 'vitest'
import { addFocusSample, focusAppsLine, focusAppsQuality, newFocusApps } from './focusApps'
import { distractMinutes, domainOf, fromChromeTime, historyFiles, historyLine, listedSite, toChromeTime } from './browserHistory'

describe('focus quality from the apps on screen (MC10)', () => {
  it('counts work and distraction minutes and warns once after 2 minutes of drift', () => {
    let s = newFocusApps(1000, 'Lab report')
    const warns: boolean[] = []
    const feed = (kind: 'work' | 'distract' | 'neutral', label: string, n: number) => {
      for (let i = 0; i < n; i++) {
        const r = addFocusSample(s, kind, label)
        s = r.s
        warns.push(r.warn)
      }
    }
    feed('work', 'VS Code', 8) // 4 min
    feed('distract', 'Discord', 3) // 1.5 min: no warning yet
    expect(warns.some(Boolean)).toBe(false)
    feed('work', 'VS Code', 2)
    feed('distract', 'YouTube', 4) // 2 min in a row: one warning
    feed('distract', 'YouTube', 4) // still drifting: no second warning
    expect(warns.filter(Boolean).length).toBe(1)
    expect(s.workSec).toBe(300)
    expect(s.distractSec).toBe(330)
    expect(focusAppsQuality(s)).toBe(Math.round(100 * (300 / 630)))
    expect(Object.keys(s.apps).sort()).toEqual(['Discord', 'VS Code', 'YouTube'])
    expect(focusAppsLine(s)).toBe('Lab report: 5 min on work apps, 6 min on distracting ones · focus quality 48%')
  })
  it('no quality before 2 minutes of samples', () => {
    const s = addFocusSample(newFocusApps(0, 'x'), 'work', 'Word').s
    expect(focusAppsQuality(s)).toBeNull()
    expect(focusAppsLine(s)).toBe('')
  })
})

describe('distraction minutes from browser history (MC11)', () => {
  const list = ['youtube.com', 'reddit.com', 'x.com']
  const day = Date.parse('2026-11-04T00:00:00Z')
  const at = (h: number, m = 0) => day + h * 3600_000 + m * 60_000

  it('knows where Chrome, Edge and Brave keep their history on each system', () => {
    const w = historyFiles('win32', 'C:\\Users\\made-up', { LOCALAPPDATA: 'C:\\Users\\made-up\\AppData\\Local' })
    expect(w[0]).toEqual({ browser: 'Chrome', path: 'C:\\Users\\made-up\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\History' })
    expect(w.some((f) => f.browser === 'Edge' && f.path.includes('Microsoft\\Edge\\User Data\\Profile 1\\History'))).toBe(true)
    expect(historyFiles('darwin', '/Users/made-up')[0].path).toBe('/Users/made-up/Library/Application Support/Google/Chrome/Default/History')
    expect(historyFiles('linux', '/home/made-up').map((f) => f.path)).toContain('/home/made-up/.config/BraveSoftware/Brave-Browser/Default/History')
  })
  it('keeps only domains on the list, never full addresses', () => {
    expect(domainOf('https://www.youtube.com/watch?v=abc')).toBe('youtube.com')
    expect(domainOf('chrome://settings')).toBeNull()
    expect(listedSite('m.youtube.com', list)).toBe('youtube.com')
    expect(listedSite('notyoutube.com', list)).toBeNull()
    const visits = [
      { url: 'https://www.youtube.com/watch?v=1', at: at(20), durMs: 50 * 60_000 }, // capped at 30
      { url: 'https://www.youtube.com/watch?v=2', at: at(21), durMs: 0 }, // until the next visit, max 5
      { url: 'https://docs.example.test/a', at: at(21, 3), durMs: 0 },
      { url: 'https://old.reddit.com/r/x', at: at(22), durMs: 20 * 60_000 },
      { url: 'https://www.youtube.com/watch?v=3', at: at(30), durMs: 10 * 60_000 } // the next day
    ]
    const m = distractMinutes(visits, list, day, day + 86400_000)
    expect(m).toEqual({ 'youtube.com': 33, 'reddit.com': 20 })
    expect(JSON.stringify(m)).not.toContain('watch')
  })
  it('one line for Ben', () => {
    expect(historyLine({ 'youtube.com': 125, 'reddit.com': 25, 'x.com': 3 }, 'yesterday')).toBe('2 h on YouTube, 25 min on Reddit yesterday')
    expect(historyLine({ 'x.com': 3 }, 'today')).toBe('')
  })
  it('Chromium time round-trips', () => {
    expect(fromChromeTime(toChromeTime(day))).toBe(day)
  })
})
