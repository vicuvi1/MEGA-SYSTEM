// Settings → System health: every part green or red with when it last worked,
// and the shared error log from all devices. Ben warns you on Telegram when
// something stays broken for 30+ minutes and sends a weekly check on Sundays.
import { useCallback, useEffect, useState } from 'react'
import type { Check, ErrorEntry } from '@core/health'
import { life } from './bridge'
import { Icon } from './Icon'

export function HealthPanel() {
  const [h, setH] = useState<{ checks: Check[]; errors: ErrorEntry[] } | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const load = useCallback(() => {
    life.system?.health().then(setH).catch(() => {})
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])
  if (!life.system || !h) return null
  const bad = h.checks.filter((c) => !c.ok)
  return (
    <section className="panel hp-panel">
      <header className="panel-head">
        <h2>
          <Icon name="shield" /> System health
        </h2>
        <span className={`sporty-dot ${bad.length ? 'idle' : 'on'}`}>{bad.length ? `${bad.length} need${bad.length === 1 ? 's' : ''} a look` : 'Everything works'}</span>
      </header>
      <p className="muted bk-note">Ben messages you on Telegram when something stays broken for 30+ minutes, and says when it works again. A short report comes on Sunday evenings.</p>
      <ul className="hp-list">
        {h.checks.map((c) => (
          <li key={c.id} className={c.ok ? 'ok' : 'bad'}>
            <i />
            <b>{c.label}</b>
            <span>{c.detail}</span>
          </li>
        ))}
      </ul>
      <div className="bk-row">
        <button className="btn small ghost" onClick={load}>
          Check again
        </button>
        <button className="btn small ghost" onClick={() => setShowErrors((x) => !x)}>
          {showErrors ? 'Hide' : 'Show'} error log ({h.errors.length})
        </button>
      </div>
      {showErrors && (
        <ul className="bk-list hp-errors">
          {h.errors.length === 0 && <li>No errors recorded.</li>}
          {[...h.errors].reverse().slice(0, 50).map((e, i) => (
            <li key={i}>
              <span>{new Date(e.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              <small>{e.source}</small>
              <small className="hp-msg">{e.msg}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
