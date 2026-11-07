// BD18: Ben's weekly body report as a card: protein, the weight trend, hard
// sets per muscle, sleep and steps side by side, then one focus for next week
// with the likely cause. On Sunday it also rides along with Ben's weekly
// check on Telegram (no extra message). Lines slide in one by one (transform
// and opacity only; none with reduced motion).
import { useEffect, useState } from 'react'
import type { BodyWeek } from '@core/bodyReport'
import { life } from '../bridge'

export function BodyWeekCard({ sunday = false }: { sunday?: boolean }) {
  const [w, setW] = useState<BodyWeek | null>(null)
  useEffect(() => {
    const load = () =>
      void life.coach?.bodyPlus
        ?.week()
        .then(setW)
        .catch(() => {})
    load()
    window.addEventListener('life-body-changed', load)
    return () => window.removeEventListener('life-body-changed', load)
  }, [])
  if (!w) return null
  return (
    <section className={`card bw-card${sunday ? ' sunday' : ''}`} aria-label="Your body this week">
      <header className="card-head">
        <h2>🏋️ Your body this week</h2>
        <span className="hint small">{sunday ? "Ben's Sunday report" : 'the last 7 days'}</span>
      </header>
      <ul className="bw-lines">
        {w.lines.map((l, i) => (
          <li key={l.label} className={`bw-line ${l.tone}`} style={{ animationDelay: `${i * 70}ms` }}>
            <span className="bw-icon" aria-hidden="true">
              {l.icon}
            </span>
            <span>
              <b>{l.label}</b>
              <small>{l.value}</small>
            </span>
          </li>
        ))}
      </ul>
      <div className="bw-focus" style={{ animationDelay: `${w.lines.length * 70}ms` }}>
        <b>🎯 Next week: {w.focus}</b>
        {w.cause && <p>{w.cause}</p>}
      </div>
    </section>
  )
}
