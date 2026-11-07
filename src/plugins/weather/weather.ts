// Weather and daylight from Open-Meteo (free, no key). Pure helpers: the
// forecast → one small day summary, and the plain advice Ben gives with it
// ("Rain at 17:00, move the run indoors", "Sunset 16:40, get daylight before 15:00").

export interface RainSpan {
  from: string // HH:MM
  to: string // HH:MM (the end of the last rainy hour)
  prob: number // the highest chance in the span, %
}

export interface WeatherDay {
  day: string // YYYY-MM-DD
  sunrise: string | null // HH:MM
  sunset: string | null
  tmin: number | null
  tmax: number | null
  rain: RainSpan[]
  /** Morning cloud cover (08–12), %, when the forecast has it (sleep care: longer morning light on grey days). */
  cloud?: number
}

export interface WeatherData {
  place: string
  lat: number
  lon: number
  at: string
  days: WeatherDay[]
}

const hmOf = (iso: unknown): string | null => {
  const m = /T(\d{2}:\d{2})/.exec(String(iso ?? ''))
  return m ? m[1] : null
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
const fromMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** An hour counts as rainy at 50%+ with at least a little rain, or at 70%+ either way. */
const rainy = (prob: number | null, mm: number | null) => (prob ?? 0) >= 70 || ((prob ?? 0) >= 50 && (mm ?? 0) >= 0.2)

/** Open-Meteo's forecast JSON → the summary of one day. */
export function summarizeDay(json: any, day: string): WeatherDay | null {
  const d = json?.daily
  const i = Array.isArray(d?.time) ? d.time.indexOf(day) : -1
  if (i < 0) return null
  const h = json?.hourly ?? {}
  const times: string[] = Array.isArray(h.time) ? h.time.map(String) : []
  const spans: RainSpan[] = []
  times.forEach((t, k) => {
    if (!t.startsWith(day)) return
    const prob = num(h.precipitation_probability?.[k])
    if (!rainy(prob, num(h.precipitation?.[k]))) return
    const from = hmOf(t)!
    const last = spans[spans.length - 1]
    if (last && last.to === from) {
      last.to = fromMin(toMin(from) + 60)
      last.prob = Math.max(last.prob, prob ?? 0)
    } else spans.push({ from, to: fromMin(toMin(from) + 60), prob: prob ?? 0 })
  })
  const r = (v: number | null) => (v == null ? null : Math.round(v))
  const clouds = times.map((t, k) => (t.startsWith(day) && Number(hmOf(t)?.slice(0, 2)) >= 8 && Number(hmOf(t)?.slice(0, 2)) < 12 ? num(h.cloudcover?.[k]) : null)).filter((v): v is number => v != null)
  return { day, sunrise: hmOf(d.sunrise?.[i]), sunset: hmOf(d.sunset?.[i]), tmin: r(num(d.temperature_2m_min?.[i])), tmax: r(num(d.temperature_2m_max?.[i])), rain: spans, ...(clouds.length ? { cloud: Math.round(clouds.reduce((t, v) => t + v, 0) / clouds.length) } : {}) }
}

/** "Get daylight before 15:00": 90 minutes before sunset, on the half hour before. */
export function daylightBy(sunset: string): string {
  const m = toMin(sunset) - 90
  return fromMin(Math.max(0, m - (m % 30)))
}

/** The advice for the rest of the day (from `nowHM`); empty when there's nothing to say. */
export function weatherAdvice(w: WeatherDay, nowHM = '00:00'): string[] {
  const out: string[] = []
  const now = toMin(nowHM)
  const next = w.rain.find((s) => toMin(s.to) > now)
  if (next) {
    const long = toMin(next.to) - toMin(next.from) > 60
    out.push(`${long ? `Rain ${toMin(next.from) <= now ? 'now' : `from ${next.from}`} to ${next.to}` : `Rain at ${next.from}`} (${next.prob}%), move the run indoors or go before`)
  }
  // Winter days: say when to get outside, while there's still light (only before it's too late).
  if (w.sunset && toMin(w.sunset) <= 18 * 60 + 30) {
    const by = daylightBy(w.sunset)
    if (now < toMin(by)) out.push(`Sunset ${w.sunset}, get daylight before ${by}`)
    else if (now < toMin(w.sunset)) out.push(`Sunset ${w.sunset}, light is almost gone`)
  }
  return out
}

/** One line for what Ben knows. */
export function weatherLine(data: WeatherData, today: string, nowHM: string): string | null {
  const w = data.days.find((d) => d.day === today)
  if (!w) return null
  const temp = w.tmin != null && w.tmax != null ? `${w.tmin}–${w.tmax}°C` : ''
  const rain = w.rain.length ? '' : 'no rain expected'
  const advice = weatherAdvice(w, nowHM)
  return `Weather today in ${data.place}: ${[temp, rain, ...advice].filter(Boolean).join('; ')}.`
}

export const forecastUrl = (lat: number, lon: number) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&hourly=precipitation_probability,precipitation,cloudcover&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=2`

export const geocodeUrl = (city: string) => `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`

/** "47.0, 28.8" → coordinates (when you type them instead of a city). */
export function readCoords(text: string): { lat: number; lon: number } | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text)
  if (!m) return null
  const lat = Number(m[1])
  const lon = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
}
