// How steady your sleep is: a regularity score, social jet lag and the real
// hours slept each night (bedtime and wake-up of the same night).
import type { SleepLog } from '@core/sleep'
import { sleepRegularity } from '@core/sleepRegularity'

const hm = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`

export function SleepSteady({ logs }: { logs: SleepLog[] }) {
  const r = sleepRegularity(logs)
  if (r.score == null && !r.nights.length) return null
  const max = Math.max(9 * 60, ...r.nights.map((n) => n.minutes))
  const lag = r.socialJetLagMin
  return (
    <section className="panel ss-card">
      <header className="panel-head">
        <h2>How steady is your sleep?</h2>
        <span className="hint">last 2 weeks</span>
      </header>
      <div className="ss-nums">
        <div>
          <b>{r.score ?? '–'}</b>
          <small>regularity /100</small>
        </div>
        <div>
          <b>{r.avgMin != null ? hm(r.avgMin) : '–'}</b>
          <small>slept a night (avg)</small>
        </div>
        <div>
          <b>{lag == null ? '–' : `${lag > 0 ? '+' : ''}${Math.round(lag / 6) / 10} h`}</b>
          <small>weekend shift (social jet lag)</small>
        </div>
      </div>
      <p className="hint small">
        {r.bedSpreadMin != null && r.wakeSpreadMin != null ? `Bedtime varies ±${r.bedSpreadMin} min, wake-up ±${r.wakeSpreadMin} min. ` : ''}
        {lag != null && Math.abs(lag) >= 60 ? 'An hour or more later on weekends feels like jet lag on Monday: keep weekends within an hour.' : lag != null ? 'Weekends stay close to weekdays: good.' : ''}
      </p>
      {r.nights.length > 0 && (
        <div className="ss-bars" role="img" aria-label={`Hours slept, last ${r.nights.length} nights`}>
          {r.nights.map((n) => (
            <span key={n.day} title={`${n.day}: ${hm(n.minutes)}`} style={{ ['--h' as string]: `${(n.minutes / max) * 100}%` }} className={n.minutes < 7 * 60 ? 'short' : ''} />
          ))}
        </div>
      )}
    </section>
  )
}
