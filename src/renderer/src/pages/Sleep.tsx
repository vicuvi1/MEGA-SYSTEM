import type { ConnectionsState } from '@shared/api'
import { ConnectCard } from './Connected'

const hm = (min: number | null) => (min == null ? '–' : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`)
const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function Sleep({ state, onState, onWallet }: { state: ConnectionsState; onState: (s: ConnectionsState) => void; onWallet: () => void }) {
  const w = state.waky
  if (!w.found || !w.connectedSince) {
    return (
      <div className="settings">
        <ConnectCard kind="waky" title="Connect Waky" icon="moon" color="#6EE7D8" {...w} what="Waky stays your alarm and check-in app. Connect it and every on-time wake-up (+10) and bedtime (+5) lands in this wallet." onState={onState} onWallet={onWallet} />
      </div>
    )
  }
  // Minutes late (or early) against the target, for the chart.
  const rows = w.mornings.slice(0, 14).reverse()
  const maxOff = Math.max(30, ...rows.map((m) => Math.abs(toMin(m.time) - toMin(m.target))))
  return (
    <div className="sleep">
      <section className="stats four">
        <div className="stat hero teal">
          <span className="label">This morning</span>
          <div className="big">{w.today ? w.today.time : '–'}</div>
          <span className="sub">{w.today ? (w.today.onTime ? `On time (target ${w.today.target}) · +10 paid` : `Late (target ${w.today.target})`) : 'No check-in in Waky yet today'}</span>
        </div>
        <div className="stat">
          <span className="label">Wake streak</span>
          <div className="big">{w.streak}</div>
          <span className="sub">best {w.best}</span>
        </div>
        <div className="stat">
          <span className="label">On time, last 2 weeks</span>
          <div className="big">{w.onTimeRate == null ? '–' : `${Math.round(w.onTimeRate * 100)}%`}</div>
          <span className="sub">
            targets {w.weekday} weekdays · {w.weekend} weekends
          </span>
        </div>
        <div className="stat">
          <span className="label">Average sleep</span>
          <div className="big small-big">{hm(w.avgSleepMin)}</div>
          <span className="sub">from Waky bedtimes</span>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Mornings</h2>
          <span className="hint">Bars show minutes early (down) or late (up) against your target. Green paid out.</span>
        </header>
        {rows.length === 0 ? (
          <div className="empty">No mornings recorded yet.</div>
        ) : (
          <div className="wake-chart" role="img" aria-label="Wake-up times against target, last two weeks">
            {rows.map((m) => {
              const off = toMin(m.time) - toMin(m.target)
              const h = Math.max(4, (Math.abs(off) / maxOff) * 60)
              return (
                <div key={m.day} className="wc-col" title={`${m.day}: up ${m.time}, target ${m.target}`}>
                  <div className="wc-track">
                    <i className={`wc-bar ${m.onTime ? 'ok' : 'late'} ${off > 0 ? 'up' : 'down'}`} style={{ height: h }} />
                  </div>
                  <b>{m.time}</b>
                  <small>{new Date(`${m.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</small>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Recent nights</h2>
        </header>
        <ul className="feed">
          {w.mornings.slice(0, 7).map((m) => (
            <li key={m.day}>
              <span className="what">
                {m.day} · up {m.time}
              </span>
              <span className="when">{m.sleptMin ? `slept ${hm(m.sleptMin)}` : 'no bedtime logged'}</span>
              <span className={m.onTime ? 'ok-text' : 'warn-text'}>{m.onTime ? 'on time' : 'late'}</span>
            </li>
          ))}
        </ul>
        <p className="hint block-hint">Waky keeps running as your alarm. Its check-ins sync here every few minutes, paying from {w.connectedSince}.</p>
      </section>
    </div>
  )
}
