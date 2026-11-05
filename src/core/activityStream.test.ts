import { describe, expect, it } from 'vitest'
import { addContextSec, appChanged, contextLine, contextMinutes, currentSession, minutesIn, pushEvent, sessionize, type ActivityEvent } from './activityStream'

const T = Date.parse('2026-11-04T10:00:00')
const s = (n: number) => T + n * 1000
const app = (at: number, context: any, label = 'App', conf = 0.9): ActivityEvent => ({ t: 'app', at, label, kind: 'neutral', context, conf })

describe('the activity stream (SI1, SI9)', () => {
  it('sends an app event only when something changes', () => {
    const a = { label: 'VS Code', context: 'coding' as const, kind: 'work' as const }
    expect(appChanged(null, a)).toBe(true)
    expect(appChanged(a, { ...a })).toBe(false)
    expect(appChanged(a, { ...a, context: 'study' })).toBe(true)
  })
  it('keeps two hours', () => {
    let list: ActivityEvent[] = []
    list = pushEvent(list, app(s(0), 'coding'))
    list = pushEvent(list, app(s(3 * 3600), 'video'))
    expect(list).toHaveLength(1)
  })
  it('a quick look elsewhere (< 90 s) does not break a session (SI9)', () => {
    const ev = [app(s(0), 'coding', 'VS Code'), app(s(600), 'browsing', 'Chrome'), app(s(660), 'coding', 'VS Code')]
    const out = sessionize(ev, s(1800))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ context: 'coding', start: s(0), end: s(1800) })
    expect(out[0].labels).toEqual(['VS Code'])
    // A long one does.
    const long = sessionize([app(s(0), 'coding'), app(s(600), 'video'), app(s(900), 'coding')], s(1800))
    expect(long.map((x) => x.context)).toEqual(['coding', 'video', 'coding'])
  })
  it('away time is its own session; back resumes what was in front', () => {
    const ev: ActivityEvent[] = [app(s(0), 'study', 'Acrobat'), { t: 'idle', at: s(300) }, { t: 'lock', at: s(320) }, { t: 'unlock', at: s(900) }]
    const out = sessionize(ev, s(1200))
    expect(out.map((x) => [x.context, (x.end - x.start) / 1000])).toEqual([
      ['study', 300],
      ['idle', 600],
      ['study', 300]
    ])
  })
  it('minutes per kind in a window, the session now, and minutes in a row', () => {
    const out = sessionize([app(s(0), 'email'), app(s(600), 'video'), app(s(1800), 'gaming')], s(2400))
    expect(contextMinutes(out, s(0), s(2400))).toEqual({ email: 10, video: 20, gaming: 10 })
    expect(contextMinutes(out, s(900), s(1200))).toEqual({ video: 5 })
    expect(currentSession(out, s(2400))).toMatchObject({ context: 'gaming', minutes: 10 })
    expect(minutesIn(out, ['video', 'gaming'], s(2400))).toBe(30)
    expect(minutesIn(out, ['email'], s(2400))).toBe(0)
  })
  it('the day line for Ben (SI8)', () => {
    let d = addContextSec(undefined, 'coding', 3 * 3600 + 600)
    d = addContextSec(d, 'study', 3900)
    d = addContextSec(d, 'video', 55 * 60)
    d = addContextSec(d, 'idle', 7200)
    d = addContextSec(d, 'social', 120)
    expect(contextLine(d)).toBe('coding 3h10, study 1h05, video 55m')
    expect(contextLine(null)).toBe('')
  })
})
