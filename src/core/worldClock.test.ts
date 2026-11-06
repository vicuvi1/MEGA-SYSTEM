import { describe, expect, it } from 'vitest'
import { allZones, cityOf, cleanZones, dayMark, dayOffset, FALLBACK_ZONES, isZone, nextZoneIndex, searchZones, worldLine, zoneName, zoneTime, ZONES_MAX } from './worldClock'

// A fixed moment: 23:30 UTC on 10 January (winter: New York is UTC−5, Tokyo UTC+9).
const at = new Date(Date.UTC(2026, 0, 10, 23, 30))

describe('world clock', () => {
  it('knows real zones and refuses made-up ones', () => {
    expect(isZone('America/New_York')).toBe(true)
    expect(isZone('UTC')).toBe(true)
    expect(isZone('Mars/Olympus_Mons')).toBe(false)
    expect(isZone('')).toBe(false)
    expect(isZone(42)).toBe(false)
  })

  it('cleans the saved list: valid, no doubles, at most 5, short labels', () => {
    const z = cleanZones([
      { tz: 'America/New_York', label: '  NYC  ' },
      'Asia/Tokyo',
      { tz: 'Nowhere/Land', label: 'x' },
      { tz: 'America/New_York', label: 'again' },
      { tz: 'Europe/London', label: 'A very long label indeed' },
      null,
      { tz: 'Europe/Paris' },
      { tz: 'Australia/Sydney' },
      { tz: 'Asia/Dubai' }
    ])
    expect(z.map((x) => x.tz)).toEqual(['America/New_York', 'Asia/Tokyo', 'Europe/London', 'Europe/Paris', 'Australia/Sydney'])
    expect(z).toHaveLength(ZONES_MAX)
    expect(z[0].label).toBe('NYC')
    expect(z[1].label).toBe('')
    expect(z[2].label.length).toBeLessThanOrEqual(12)
    expect(cleanZones(undefined)).toEqual([])
    expect(cleanZones('UTC')).toEqual([])
  })

  it('names a zone by its label or its city', () => {
    expect(cityOf('America/New_York')).toBe('New York')
    expect(cityOf('America/Argentina/Buenos_Aires')).toBe('Buenos Aires')
    expect(cityOf('UTC')).toBe('UTC')
    expect(cityOf('Etc/GMT+5')).toBe('UTC−5')
    expect(cityOf('Etc/GMT-3')).toBe('UTC+3')
    expect(zoneName({ tz: 'Asia/Tokyo', label: '' })).toBe('Tokyo')
    expect(zoneName({ tz: 'Asia/Tokyo', label: 'Office' })).toBe('Office')
  })

  it('cycles local → each zone → local', () => {
    expect(nextZoneIndex(0, 2)).toBe(1)
    expect(nextZoneIndex(1, 2)).toBe(2)
    expect(nextZoneIndex(2, 2)).toBe(0)
    expect(nextZoneIndex(0, 0)).toBe(0)
    // A zone was removed while it showed: back to local.
    expect(nextZoneIndex(4, 2)).toBe(0)
    expect(nextZoneIndex(-1, 2)).toBe(0)
  })

  it('tells the time in a zone and the day difference', () => {
    expect(zoneTime(at, 'UTC')).toBe('23:30')
    expect(zoneTime(at, 'America/New_York')).toBe('18:30')
    expect(zoneTime(at, 'Asia/Tokyo')).toBe('08:30')
    expect(dayOffset(at, 'Asia/Tokyo', 'UTC')).toBe(1)
    expect(dayOffset(at, 'America/New_York', 'UTC')).toBe(0)
    expect(dayOffset(at, 'America/New_York', 'Asia/Tokyo')).toBe(-1)
    expect(dayMark(1)).toBe('+1')
    expect(dayMark(-1)).toBe('−1')
    expect(dayMark(0)).toBe('')
  })

  it('midnight shows as 00, never 24', () => {
    expect(zoneTime(new Date(Date.UTC(2026, 0, 10, 0, 5)), 'UTC')).toBe('00:05')
  })

  it('puts every zone in one line for the tooltip', () => {
    expect(worldLine(at, [{ tz: 'America/New_York', label: 'NYC' }, { tz: 'Asia/Tokyo', label: '' }], 'UTC')).toBe('Local 23:30 · NYC 18:30 · Tokyo 08:30 +1')
  })

  it('lists and searches zones', () => {
    const all = allZones()
    expect(all.length).toBeGreaterThan(20)
    expect(FALLBACK_ZONES.every((z) => isZone(z))).toBe(true)
    expect(searchZones('new york', all)[0]).toBe('America/New_York')
    expect(searchZones('tok', all)[0]).toBe('Asia/Tokyo')
    expect(searchZones('buenos_aires', all).some((z) => z.endsWith('Buenos_Aires'))).toBe(true)
    expect(searchZones('buenos', FALLBACK_ZONES)).toEqual(['America/Argentina/Buenos_Aires'])
    expect(searchZones('', all, 5)).toHaveLength(5)
    expect(searchZones('zzzz', all)).toEqual([])
  })
})
