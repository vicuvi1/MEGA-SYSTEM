// Today: steps and sleep from your phone.
import { Icon } from '../../renderer/src/Icon'
import { usePluginData } from '../usePluginData'
import type { HealthData } from './health'

export function HealthCard() {
  const d = usePluginData<HealthData>('plugin_health_data')
  const t = d?.days[new Date().toLocaleDateString('sv-SE')]
  if (!t) return null
  return (
    <section className="pl-card" aria-label="From your phone">
      <div className="pl-card-head">
        <Icon name="chart" size={14} />
        <b>From your phone</b>
      </div>
      <div className="pl-line">
        {t.steps != null ? `${t.steps.toLocaleString('en-US')} steps` : 'No steps yet'}
        {t.sleepHours != null ? ` · slept ${t.sleepHours} h` : ''}
      </div>
    </section>
  )
}
