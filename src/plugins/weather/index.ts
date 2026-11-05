// MC6 Weather and daylight: Open-Meteo (free, no key). Your city or
// coordinates are a setting (never in the code). The server fetches the
// forecast each morning and every few hours, keeps it in settings, and Ben
// plans around it ("Rain at 17:00, move the run indoors").
import { definePlugin, type PluginJobCtx } from '../types'
import { readConfig, readData } from '../store'
import { forecastUrl, geocodeUrl, readCoords, summarizeDay, weatherAdvice, weatherLine, type WeatherData } from './weather'
import { calendarDay } from '../../core/dates'

export const WEATHER = 'weather'
const dayOf = (d: Date) => calendarDay(d)
const hmOf = (d: Date) => d.toTimeString().slice(0, 5)

const job = async (ctx: PluginJobCtx) => {
  const cfg = JSON.parse((await ctx.get(`plugin_${WEATHER}`)) || '{}') as { city?: string }
  const city = String(cfg.city ?? '').trim()
  if (!city) return { need: ['a city in Settings → Plugins'] }
  const prev = JSON.parse((await ctx.get(`plugin_${WEATHER}_data`)) || 'null') as WeatherData | null
  let place = prev?.place ?? city
  let where = readCoords(city)
  if (where) place = `${where.lat.toFixed(2)}, ${where.lon.toFixed(2)}`
  // The same city as last time: no need to look it up again.
  else if (prev && (prev as any).city === city) where = { lat: prev.lat, lon: prev.lon }
  else {
    const g: any = await (await ctx.fetch(geocodeUrl(city), { signal: AbortSignal.timeout(10_000) })).json()
    const hit = g?.results?.[0]
    if (!hit) return { need: [`a city Open-Meteo knows ("${city}" was not found)`] }
    where = { lat: Number(hit.latitude), lon: Number(hit.longitude) }
    place = String(hit.name ?? city)
  }
  const res = await ctx.fetch(forecastUrl(where.lat, where.lon), { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const json = await res.json()
  const today = dayOf(ctx.now)
  const tomorrow = dayOf(new Date(ctx.now.getTime() + 86400_000))
  const days = [summarizeDay(json, today), summarizeDay(json, tomorrow)].filter((d): d is NonNullable<typeof d> => !!d)
  const data: WeatherData & { city: string } = { place, lat: where.lat, lon: where.lon, at: ctx.now.toISOString(), days, city }
  await ctx.set(`plugin_${WEATHER}_data`, JSON.stringify(data))
  const w = days[0]
  return { note: w ? `${place}: ${w.tmin}–${w.tmax}°C${w.rain.length ? `, rain from ${w.rain[0].from}` : ', dry'}${w.sunset ? `, sunset ${w.sunset}` : ''}` : `${place}: no forecast for today` }
}

export default definePlugin({
  id: WEATHER,
  title: 'Weather and daylight',
  icon: 'sun',
  about: 'Rain and sunset times from Open-Meteo (free). Ben plans your run and your daylight around them.',
  settings: { fields: [{ key: 'city', label: 'City', placeholder: 'Your city, or "47.0, 28.8"', hint: 'Only used to ask Open-Meteo for the forecast' }] },
  context(db, now) {
    const data = readData<WeatherData>(db, WEATHER)
    return data ? weatherLine(data, dayOf(now), hmOf(now)) : null
  },
  commands: {
    weather: {
      help: 'Today’s weather and daylight',
      run({ db, now }) {
        const data = readData<WeatherData>(db, WEATHER)
        const w = data?.days.find((d) => d.day === dayOf(now))
        if (!data || !w) return readConfig(db, WEATHER).city ? '🌤 No forecast yet. It comes with the next check (every few hours).' : '🌤 Set your city in Settings → Plugins → Weather first.'
        const advice = weatherAdvice(w, hmOf(now))
        return [`🌤 <b>${data.place}</b>: ${w.tmin}–${w.tmax}°C`, w.sunrise && w.sunset ? `Sunrise ${w.sunrise} · sunset ${w.sunset}` : '', ...advice.map((a) => `• ${a}`)].filter(Boolean).join('\n')
      }
    }
  },
  jobs: { morning: job, tick: job, tickEvery: 180 },
  mcpTools: [
    {
      name: 'weather_today',
      description: 'Today and tomorrow: temperature range, rain times, sunrise and sunset for the saved city.',
      inputSchema: { type: 'object', properties: {} },
      run: ({ db }) => readData<WeatherData>(db, WEATHER)
    }
  ]
})
