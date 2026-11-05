import { describe, expect, it } from 'vitest'
import { daylightBy, readCoords, summarizeDay, weatherAdvice, weatherLine } from './weather'

/** A made-up Open-Meteo answer: rain at 17:00–18:59 on the first day. */
function forecast() {
  const time: string[] = []
  const prob: number[] = []
  const mm: number[] = []
  for (const day of ['2026-11-05', '2026-11-06']) {
    for (let h = 0; h < 24; h++) {
      time.push(`${day}T${String(h).padStart(2, '0')}:00`)
      const wet = day === '2026-11-05' && (h === 17 || h === 18)
      prob.push(wet ? (h === 17 ? 80 : 65) : 10)
      mm.push(wet ? 1.2 : 0)
    }
  }
  return {
    hourly: { time, precipitation_probability: prob, precipitation: mm },
    daily: { time: ['2026-11-05', '2026-11-06'], sunrise: ['2026-11-05T06:58', '2026-11-06T07:00'], sunset: ['2026-11-05T16:40', '2026-11-06T16:39'], temperature_2m_min: [3.6, 2.1], temperature_2m_max: [11.4, 9] }
  }
}

describe('weather plugin', () => {
  it('sums up a day: temperatures, sun times and rain spans', () => {
    const w = summarizeDay(forecast(), '2026-11-05')!
    expect(w).toEqual({ day: '2026-11-05', sunrise: '06:58', sunset: '16:40', tmin: 4, tmax: 11, rain: [{ from: '17:00', to: '19:00', prob: 80 }] })
    expect(summarizeDay(forecast(), '2026-11-06')!.rain).toEqual([])
    expect(summarizeDay(forecast(), '2026-12-01')).toBeNull()
  })

  it('gives the advice Ben plans with', () => {
    const w = summarizeDay(forecast(), '2026-11-05')!
    expect(daylightBy('16:40')).toBe('15:00')
    expect(weatherAdvice(w, '09:00')).toEqual(['Rain from 17:00 to 19:00 (80%), move the run indoors or go before', 'Sunset 16:40, get daylight before 15:00'])
    expect(weatherAdvice(w, '15:30')).toEqual(['Rain from 17:00 to 19:00 (80%), move the run indoors or go before', 'Sunset 16:40, light is almost gone'])
    expect(weatherAdvice(w, '20:00')).toEqual([])
  })

  it('says one rainy hour simply', () => {
    expect(weatherAdvice({ day: 'd', sunrise: null, sunset: '20:30', tmin: 20, tmax: 28, rain: [{ from: '17:00', to: '18:00', prob: 70 }] }, '08:00')).toEqual(['Rain at 17:00 (70%), move the run indoors or go before'])
  })

  it('writes one line for Ben, only for today', () => {
    const data = { place: 'Testville', lat: 1, lon: 2, at: '', days: [summarizeDay(forecast(), '2026-11-05')!] }
    expect(weatherLine(data, '2026-11-05', '08:00')).toBe('Weather today in Testville: 4–11°C; Rain from 17:00 to 19:00 (80%), move the run indoors or go before; Sunset 16:40, get daylight before 15:00.')
    expect(weatherLine(data, '2026-11-07', '08:00')).toBeNull()
  })

  it('reads typed coordinates', () => {
    expect(readCoords('47.01, 28.86')).toEqual({ lat: 47.01, lon: 28.86 })
    expect(readCoords('Testville')).toBeNull()
    expect(readCoords('95, 10')).toBeNull()
  })
})
