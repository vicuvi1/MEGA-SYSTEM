// Today: the weather card (temperature, rain, sunset and the one tip).
import { Icon } from '../../renderer/src/Icon'
import { usePluginData } from '../usePluginData'
import { weatherAdvice, type WeatherData } from './weather'

export function WeatherCard() {
  const data = usePluginData<WeatherData>('plugin_weather_data')
  const now = new Date()
  const w = data?.days.find((d) => d.day === now.toLocaleDateString('sv-SE'))
  if (!data || !w) return null
  const advice = weatherAdvice(w, now.toTimeString().slice(0, 5))
  return (
    <section className="pl-card" aria-label="Weather">
      <div className="pl-card-head">
        <Icon name="sun" size={14} />
        <b>{data.place}</b>
        <span className="pl-spacer" />
        {w.sunrise && w.sunset && (
          <span>
            {w.sunrise} – {w.sunset}
          </span>
        )}
      </div>
      <div className="pl-big">{w.tmin != null && w.tmax != null ? `${w.tmin}–${w.tmax}°C` : '—'}</div>
      {advice.length ? (
        <ul className="pl-list">
          {advice.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : (
        <div className="pl-muted">{w.rain.length ? 'The rain is over for today.' : 'No rain expected today.'}</div>
      )}
    </section>
  )
}
