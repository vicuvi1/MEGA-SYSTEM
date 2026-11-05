import { describe, expect, it } from 'vitest'
import { activities, DEFAULT_PILL_ORDER, EMPTY_ISLAND } from '../islandModel'
import { atLocal, daylightPeek, lightLeft, rainItem, rainPeek, sunItem, weatherForIsland } from './weatherPill'

const day = '2026-11-05'
const data = { place: 'Testville', lat: 1, lon: 2, at: '', days: [{ day, sunrise: '07:05', sunset: '16:40', tmin: 2, tmax: 9, rain: [{ from: '17:00', to: '19:00', prob: 80 }] }] }
const at = (hm: string) => atLocal(new Date(2026, 10, 5, 12).getTime(), hm)

describe('rain and daylight on the pill (LF1, LF2)', () => {
  const w = weatherForIsland(data as any, day)!
  it('keeps today only, and only valid times', () => {
    expect(w).toEqual({ day, rain: [{ from: '17:00', to: '19:00', prob: 80 }], sunrise: '07:05', sunset: '16:40' })
    expect(weatherForIsland(data as any, '2026-11-06')).toBeNull()
    expect(weatherForIsland({ days: [{ day, sunset: '<b>', rain: [{ from: 'x', to: '1', prob: 9 }] }] } as any, day)).toEqual({ day, rain: [], sunrise: null, sunset: null })
  })
  it('"Rain at 17:00" within six hours, "Rain now" while it rains, nothing after', () => {
    expect(rainItem(w, at('10:00'))).toBeNull()
    expect(rainItem(w, at('14:30'))).toMatchObject({ text: 'Rain at 17:00', sub: '80%' })
    expect(rainItem(w, at('17:30'))).toMatchObject({ text: 'Rain now', sub: 'until 19:00' })
    expect(rainItem(w, at('19:00'))).toBeNull()
  })
  it('"Sunset 16:40 · 2 h of light left" while it is light', () => {
    expect(sunItem(w, at('14:40'))).toMatchObject({ text: 'Sunset 16:40', sub: '2 h of light left' })
    expect(sunItem(w, at('15:20'))).toMatchObject({ sub: '1 h 20 min of light left' })
    expect(sunItem(w, at('06:00'))).toBeNull()
    expect(sunItem(w, at('17:00'))).toBeNull()
    expect(lightLeft(40 * 60_000)).toBe('40 min')
    expect(lightLeft(118 * 60_000)).toBe('2 h')
  })
  it('peeks 30 minutes before rain, once', () => {
    expect(rainPeek(w, at('16:20'), {})).toBeNull()
    const p = rainPeek(w, at('16:35'), {})!
    expect(p.title).toBe('Rain at 17:00')
    expect(p.text).toContain('In 25 min')
    expect(rainPeek(w, at('16:35'), { [p.id]: at('23:00') })).toBeNull()
    expect(rainPeek(w, at('17:05'), {})).toBeNull()
  })
  it('a gentle daylight nudge on short days, before "get daylight by", never while busy', () => {
    // Sunset 16:40 → daylight by 15:00 → the nudge is 14:30–15:00.
    expect(daylightPeek(w, at('14:00'), {})).toBeNull()
    const n = daylightPeek(w, at('14:40'), {})!
    expect(n.title).toBe('Sunset 16:40 · 2 h of light left')
    expect(daylightPeek(w, at('14:40'), {}, true)).toBeNull()
    expect(daylightPeek(w, at('15:00'), {})).toBeNull()
    expect(daylightPeek({ ...w, sunset: '20:40' }, at('18:40'), {})).toBeNull()
  })
  it('shows as pill items (on by default)', () => {
    expect(DEFAULT_PILL_ORDER.filter((x) => x.id === 'rain' || x.id === 'sun').every((x) => x.on)).toBe(true)
    const s = { ...EMPTY_ISLAND, locked: false, weather: w }
    const acts = activities(s, at('14:40'))
    expect(acts.map((a) => a.text)).toEqual(['Rain at 17:00', 'Sunset 16:40'])
    expect(activities({ ...s, weather: null }, at('14:40'))).toEqual([])
  })
})
