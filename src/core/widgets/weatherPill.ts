// LF1 / LF2: rain soon and the light left today, on the island's pill.
// Read from what the weather plugin saved (plugin_weather_data, Open-Meteo:
// src/plugins/weather). Pure and tested (weatherPill.test.ts).
//   "Rain at 17:00"                      a pill item, and a peek 30 min before
//   "Sunset 16:40 · 2 h of light left"   a pill item, and one gentle daylight nudge
import type { RainSpan, WeatherData } from '../../plugins/weather/weather'
import { daylightBy } from '../../plugins/weather/weather'
import type { IslandAlert } from '../islandModel'

/** What the island gets: today only, a few small fields. */
export interface IslandWeather {
  day: string
  rain: RainSpan[]
  sunrise: string | null
  sunset: string | null
  /** Morning cloud cover, % (sleep care), when known. */
  cloud?: number
}

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

/** The weather plugin's saved data → today's part for the island (null when there's nothing for today). */
export function weatherForIsland(data: WeatherData | null | undefined, today: string): IslandWeather | null {
  const d = data?.days?.find((x) => x && x.day === today)
  if (!d) return null
  const hm = (v: unknown) => (typeof v === 'string' && HM.test(v) ? v : null)
  const rain = (Array.isArray(d.rain) ? d.rain : [])
    .filter((r) => r && hm(r.from) && (hm(r.to) || r.to === '24:00'))
    .slice(0, 8)
    .map((r) => ({ from: r.from, to: r.to, prob: Math.max(0, Math.min(100, Math.round(Number(r.prob) || 0))) }))
  const cloud = typeof d.cloud === 'number' && Number.isFinite(d.cloud) ? Math.max(0, Math.min(100, Math.round(d.cloud))) : null
  return { day: d.day, rain, sunrise: hm(d.sunrise), sunset: hm(d.sunset), ...(cloud != null ? { cloud } : {}) }
}

/** "17:00" on the day of `now` → ms (local time). */
export function atLocal(now: number, hm: string): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime() + toMin(hm) * 60_000
}

/** "2 h", "1 h 20 min", "40 min". */
export function lightLeft(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r < 10 ? `${h} h` : r > 50 ? `${h + 1} h` : `${h} h ${r} min`
}

/** The next rain still to come or going on now (within the next 6 hours), or null. */
export function nextRain(w: IslandWeather | null | undefined, now: number): (RainSpan & { start: number; end: number }) | null {
  if (!w) return null
  for (const r of w.rain) {
    const start = atLocal(now, r.from)
    const end = atLocal(now, r.to)
    if (end > now && start - now <= 6 * 3600_000) return { ...r, start, end }
  }
  return null
}

export interface WeatherItem { key: string; text: string; sub: string; pct: number; at?: number }

/** LF1: "Rain at 17:00" (or "Rain now · until 18:00"). */
export function rainItem(w: IslandWeather | null | undefined, now: number): WeatherItem | null {
  const r = nextRain(w, now)
  if (!r) return null
  if (r.start <= now) return { key: `rain:${r.from}`, text: 'Rain now', sub: `until ${r.to}`, pct: Math.min(1, (now - r.start) / Math.max(1, r.end - r.start)) }
  return { key: `rain:${r.from}`, text: `Rain at ${r.from}`, sub: `${r.prob}%`, pct: 0, at: r.start }
}

/** LF2: "Sunset 16:40 · 2 h of light left" while it's light (from sunrise to sunset). */
export function sunItem(w: IslandWeather | null | undefined, now: number): WeatherItem | null {
  if (!w?.sunset) return null
  const set = atLocal(now, w.sunset)
  const rise = w.sunrise ? atLocal(now, w.sunrise) : set - 10 * 3600_000
  if (now < rise || now >= set) return null
  return { key: 'sun', text: `Sunset ${w.sunset}`, sub: `${lightLeft(set - now)} of light left`, pct: Math.min(1, (now - rise) / Math.max(1, set - rise)), at: set }
}

/** LF1: the peek 30 minutes before rain starts (once per rain span). */
export function rainPeek(w: IslandWeather | null | undefined, now: number, dismissed: Record<string, number>): IslandAlert | null {
  const r = nextRain(w, now)
  if (!r || r.start <= now || r.start - now > 30 * 60_000) return null
  const id = `rain:${w!.day}:${r.from}`
  if ((dismissed[id] ?? 0) > now) return null
  const mins = Math.max(1, Math.round((r.start - now) / 60_000))
  return {
    id,
    kind: 'weather',
    face: '🌧',
    title: `Rain at ${r.from}`,
    text: `In ${mins} min (${r.prob}%), until ${r.to}. Going out? Go now or take a jacket.`,
    actions: [
      { label: 'Got it', action: { kind: 'dismiss', id }, primary: true },
      { label: 'Remind me in 15 min', action: { kind: 'dismiss', id, snoozeMin: 15 } }
    ]
  }
}

/**
 * LF2: one gentle daylight nudge on short (winter) days, when the sun sets by
 * 18:30, in the half hour before "get daylight by" (90 min before sunset).
 * `busy`: a focus timer or a call (it waits).
 */
export function daylightPeek(w: IslandWeather | null | undefined, now: number, dismissed: Record<string, number>, busy = false): IslandAlert | null {
  if (busy || !w?.sunset || toMin(w.sunset) > 18 * 60 + 30) return null
  const by = atLocal(now, daylightBy(w.sunset))
  const set = atLocal(now, w.sunset)
  if (now < by - 30 * 60_000 || now >= by) return null
  const id = `daylight:${w.day}`
  if ((dismissed[id] ?? 0) > now) return null
  const rain = nextRain(w, now)
  const wet = !!rain && rain.start <= set && rain.end > now
  return {
    id,
    kind: 'weather',
    face: '🌇',
    title: `Sunset ${w.sunset} · ${lightLeft(set - now)} of light left`,
    text: wet ? 'Rain is coming too. Ten minutes outside now still counts.' : 'A short walk while it’s light helps you sleep tonight.',
    actions: [
      { label: 'Going out', action: { kind: 'dismiss', id }, primary: true },
      { label: 'Later', action: { kind: 'dismiss', id, snoozeMin: 20 } },
      { label: 'Not today', action: { kind: 'dismiss', id, snoozeMin: 24 * 60 } }
    ]
  }
}
