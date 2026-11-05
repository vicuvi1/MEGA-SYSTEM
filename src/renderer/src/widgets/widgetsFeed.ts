// The app window's part of widgets and the weather pill: it reads the
// weather plugin's saved forecast and your synced widget layout for the
// island's snapshot, and answers the widgets' asks (network through the
// allowlist, add a task or a note). The island window never opens your data.
import { calendarDay } from '@core/dates'
import type { IslandAlert } from '@core/islandModel'
import { daylightPeek, rainPeek, weatherForIsland, type IslandWeather } from '@core/widgets/weatherPill'
import type { WeatherData } from '../../../plugins/weather/weather'
import { life } from '../bridge'

let wx: { at: number; v: IslandWeather | null } = { at: 0, v: null }

async function weatherNow(now: number): Promise<IslandWeather | null> {
  if (now - wx.at < 5 * 60_000 && (!wx.v || wx.v.day === calendarDay(new Date(now)))) return wx.v
  wx.at = now
  const p = life.plugins
  if (!p) return (wx.v = null)
  const on = await p.state().then((s) => s.on?.weather === true).catch(() => false)
  const data = on ? await p.data<WeatherData>('plugin_weather_data').catch(() => null) : null
  return (wx.v = weatherForIsland(data, calendarDay(new Date(now))))
}

/** The snapshot's weather part. */
export async function widgetsForIsland(now: number): Promise<{ weather: IslandWeather | null }> {
  return { weather: await weatherNow(now).catch(() => null) }
}

/** LF1 / LF2: rain in 30 minutes, or the light going (once a day). `busy`: a timer or a call. */
export function weatherAlert(now: number, dismissed: Record<string, number>, busy: boolean): IslandAlert | null {
  return rainPeek(wx.v, now, dismissed) ?? daylightPeek(wx.v, now, dismissed, busy)
}
