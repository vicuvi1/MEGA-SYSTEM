// "Am I improving?": every area in one place, your last 7 days against the
// 7 before and your usual week (numbers from @core/progress).
import { useCallback, useEffect, useState } from 'react'
import type { Metric, ProgressReport } from '@core/progress'
import { life } from '../bridge'
import { Icon } from '../Icon'

export function useProgress(): ProgressReport | null | undefined {
  const [r, setR] = useState<ProgressReport | null | undefined>(undefined)
  const load = useCallback(() => {
    if (!life.progress) return setR(null)
    life.progress.report().then(setR).catch(() => setR(null))
  }, [])
  useEffect(() => {
    load()
    for (const n of ['life-wallet-changed', 'life-focus-changed', 'life-discipline-changed', 'life-body-changed']) window.addEventListener(n, load)
    return () => {
      for (const n of ['life-wallet-changed', 'life-focus-changed', 'life-discipline-changed', 'life-body-changed']) window.removeEventListener(n, load)
    }
  }, [load])
  return r
}

const TREND = { better: '▲ better', worse: '▼ worse', same: 'about usual' } as const

function Bars({ m }: { m: Metric }) {
  const max = Math.max(1, ...m.weeks)
  return (
    <div className="pg-bars" role="img" aria-label={`${m.label}, last ${m.weeks.length} weeks: ${m.weeks.join(', ')}`}>
      {m.weeks.map((v, k) => (
        <i key={k} className={k === m.weeks.length - 1 ? 'now' : ''} style={{ height: `${Math.max(6, (v / max) * 100)}%` }} title={k === m.weeks.length - 1 ? 'Last 7 days' : `${m.weeks.length - 1 - k} week${m.weeks.length - 1 - k > 1 ? 's' : ''} before`} />
      ))}
    </div>
  )
}

function MetricCard({ m }: { m: Metric }) {
  return (
    <div className={`pg-card ${m.trend}`}>
      <div className="pg-top">
        <span className="pg-label">{m.label}</span>
        <span className={`pg-trend ${m.trend}`}>{TREND[m.trend]}</span>
      </div>
      <div className="pg-value">{m.text}</div>
      <div className="pg-before">before: {m.prevText}</div>
      <Bars m={m} />
    </div>
  )
}

/** The full page. */
export function Progress() {
  const r = useProgress()
  if (r === undefined) return <section className="panel"><p className="hint">Adding up your weeks…</p></section>
  if (r === null) return <section className="panel"><p className="hint">Progress needs your data on this device. Open it on the website.</p></section>
  return (
    <div className="pg">
      <section className="panel pg-head">
        <h2>
          <Icon name="chart" /> Am I improving?
        </h2>
        <p className="pg-verdict">{r.verdict}</p>
        <p className="hint">
          Last 7 days ({r.from.slice(5)} to {r.to.slice(5)}) against the 7 before. Green or red when it differs from your usual week (the 4 before). Bars: your last 6 weeks, the bright one is now.
        </p>
      </section>
      <div className="pg-grid">
        {r.metrics.map((m) => (
          <MetricCard key={m.id} m={m} />
        ))}
      </div>
    </div>
  )
}

/** The short version on Today: the verdict and one chip per area. */
export function ProgressCard({ onOpen }: { onOpen: () => void }) {
  const r = useProgress()
  if (!r) return null
  return (
    <section className="panel pg-mini">
      <header className="pg-mini-head">
        <h3>
          <Icon name="chart" size={16} /> This week
        </h3>
        <button className="btn small ghost" onClick={onOpen}>
          See all
        </button>
      </header>
      <p className="pg-verdict">{r.verdict}</p>
      <div className="pg-chips">
        {r.metrics.map((m) => (
          <span key={m.id} className={`pg-chip ${m.trend}`} title={`${m.label}: ${m.text} (before: ${m.prevText})`}>
            {m.trend === 'better' ? '▲' : m.trend === 'worse' ? '▼' : '•'} {m.label} <b>{m.text}</b>
          </span>
        ))}
      </div>
    </section>
  )
}
