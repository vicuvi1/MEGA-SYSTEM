import { describe, expect, it } from 'vitest'
import { cleanHiddenStarters, cleanUnavailable, looksLikeWorkout, pickForNow, RETRY_AFTER_MS, STARTER_STATIONS, stationVerdict, toggleHidden, visibleStarters } from './starterStations'
import { cleanStation } from './soundcloud'
import { cleanMusicKit, DEFAULT_MUSIC, shouldToastTrack } from './music'

describe('starter stations', () => {
  it('are 6–8 clean public SoundCloud stations with unique ids, colours and icons', () => {
    expect(STARTER_STATIONS.length).toBeGreaterThanOrEqual(6)
    expect(STARTER_STATIONS.length).toBeLessThanOrEqual(8)
    expect(new Set(STARTER_STATIONS.map((s) => s.id)).size).toBe(STARTER_STATIONS.length)
    expect(new Set(STARTER_STATIONS.map((s) => s.vibe)).size).toBe(STARTER_STATIONS.length)
    for (const s of STARTER_STATIONS) {
      // They pass the same cleaning as a pasted station (so they play and sync the same way).
      expect(cleanStation(s)).toEqual({ id: s.id, name: s.name, url: s.url, kind: s.kind })
      expect(s.colors.every((c) => /^#[0-9a-f]{6}$/i.test(c))).toBe(true)
      expect(s.icon).toBeTruthy()
    }
  })
  it('hiding syncs in the music kit (only real ids)', () => {
    expect(DEFAULT_MUSIC.hiddenStarters).toEqual([])
    expect(cleanMusicKit({ hiddenStarters: ['svlofi', 'svlofi', 'nope', 3] }).hiddenStarters).toEqual(['svlofi'])
    expect(cleanHiddenStarters('x')).toEqual([])
    expect(toggleHidden(toggleHidden([], 'svjazz'), 'svjazz')).toEqual([])
  })
})

describe('starter stations: the fallback when SoundCloud will not play one', () => {
  const t0 = 1_000_000
  it('a track showing is fine; an error is not', () => {
    expect(stationVerdict({ since: t0, now: t0 + 1000, ready: true, readyAt: t0, title: 'A song', error: '' })).toBe('ok')
    expect(stationVerdict({ since: t0, now: t0 + 1000, ready: false, readyAt: null, title: '', error: 'SoundCloud could not play that' })).toBe('bad')
  })
  it('never ready, or ready with no track, gives up after a while', () => {
    expect(stationVerdict({ since: t0, now: t0 + 10_000, ready: false, readyAt: null, title: '', error: '' })).toBe('wait')
    expect(stationVerdict({ since: t0, now: t0 + 26_000, ready: false, readyAt: null, title: '', error: '' })).toBe('bad')
    expect(stationVerdict({ since: t0, now: t0 + 20_000, ready: true, readyAt: t0 + 10_000, title: '', error: '' })).toBe('wait')
    expect(stationVerdict({ since: t0, now: t0 + 26_000, ready: true, readyAt: t0 + 10_000, title: '', error: '' })).toBe('bad')
  })
  it('an unavailable station is hidden, and tried again after a week', () => {
    const url = STARTER_STATIONS[0].url
    const un = cleanUnavailable({ [url]: t0, 'https://evil.example': t0 }, t0 + 1000)
    expect(Object.keys(un)).toEqual([url])
    expect(visibleStarters({ hidden: [], unavailable: un }).some((s) => s.url === url)).toBe(false)
    expect(cleanUnavailable({ [url]: t0 }, t0 + RETRY_AFTER_MS + 1)).toEqual({})
  })
  it('hidden ones and your own stations are not shown twice', () => {
    const [a, b] = STARTER_STATIONS
    const list = visibleStarters({ hidden: [a.id], unavailable: {}, mine: [{ id: 's0', name: 'Mine', url: b.url, kind: b.kind }] })
    expect(list.some((s) => s.id === a.id || s.id === b.id)).toBe(false)
    expect(list.length).toBe(STARTER_STATIONS.length - 2)
  })
})

describe('"Play something for now"', () => {
  const all = STARTER_STATIONS
  const vibe = (c: Parameters<typeof pickForNow>[0], list = all) => pickForNow(c, list)?.vibe
  it('focus → Deep focus, workout → Upbeat, evening → Chill', () => {
    expect(vibe({ hour: 14, focus: true })).toBe('focus')
    expect(vibe({ hour: 14, workout: true, focus: true })).toBe('workout')
    expect(vibe({ hour: 19 })).toBe('chill')
    expect(vibe({ hour: 8 })).toBe('jazz')
    expect(vibe({ hour: 13 })).toBe('lofi')
    expect(vibe({ hour: 2 })).toBe('ambient')
  })
  it('skips what is hidden or unavailable, and falls back to what is left', () => {
    const noFocus = all.filter((s) => s.vibe !== 'focus')
    expect(vibe({ hour: 14, focus: true }, noFocus)).toBe('lofi')
    const odd = all.filter((s) => s.vibe === 'classical')
    expect(vibe({ hour: 19 }, odd)).toBe('classical')
    expect(pickForNow({ hour: 19 }, [])).toBeNull()
  })
  it('spots a workout from a timer or block name', () => {
    expect(looksLikeWorkout('Gym: legs')).toBe(true)
    expect(looksLikeWorkout(null, 'Sport (20 min)')).toBe(true)
    expect(looksLikeWorkout('Algorithms', 'Lecture')).toBe(false)
  })
})

describe('the "now playing" card', () => {
  const cur = { url: 'https://soundcloud.com/a/b', title: 'B', playing: true }
  it('shows for a new track that plays, once, and only with the option on', () => {
    expect(shouldToastTrack(null, cur, true)).toBe(true)
    expect(shouldToastTrack(cur.url, cur, true)).toBe(false)
    expect(shouldToastTrack(null, { ...cur, playing: false }, true)).toBe(false)
    expect(shouldToastTrack(null, { ...cur, title: '' }, true)).toBe(false)
    expect(shouldToastTrack(null, cur, false)).toBe(false)
    expect(cleanMusicKit({ nowToast: false }).nowToast).toBe(false)
    expect(DEFAULT_MUSIC.nowToast).toBe(true)
  })
})
