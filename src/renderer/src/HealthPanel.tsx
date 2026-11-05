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
  if (!life.system) return null
  if (!h)
    return (
      <section className="panel hp-panel">
        <header className="panel-head">
          <h2>
            <Icon name="shield" /> System health
          </h2>
        </header>
        <p className="muted bk-note">Checking every part…</p>
      </section>
    )
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
              <small>
                {e.source}
                {e.version ? ` · ${e.version}` : ''}
                {e.place ? ` · ${e.place}` : ''}
              </small>
              <small className="hp-msg">{e.msg}</small>
              {e.stack && (
                <details className="hp-stack">
                  <summary>Stack trace</summary>
                  <pre>{e.stack}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      <ReminderTimer tick={h.checks.find((c) => c.id === 'tick') ?? null} />
    </section>
  )
}

/**
 * Reminders on the minute (F4): Ben's server checks reminders when it's
 * woken (every ~10 min by a timer, every 2 min while the app is open). A free
 * outside timer that opens this link every minute makes them exact.
 */
function ReminderTimer({ tick }: { tick: Check | null }) {
  const [copied, setCopied] = useState(false)
  if (typeof window === 'undefined' || window.desktop) return null
  const url = `${window.location.origin}/api/cron?job=tick`
  return (
    <details className="bd-more" style={{ marginTop: 12 }}>
      <summary>⏰ Reminders on the minute {tick ? `· last check ${tick.detail.replace(/^(Ran|Last ran) /, '')}` : ''}</summary>
      <p className="hint small">
        Ben checks your reminders and check-ins when his server wakes up: about every 10 minutes, and every 2 minutes while the app is open. For exact times,
        add a free timer at cron-job.org (or any uptime pinger) that opens this link every minute. No password needed: it only sends what is due, once.
      </p>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <code style={{ overflowWrap: 'anywhere' }}>{url}</code>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(() => setCopied(true)).catch(() => {})
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </details>
  )
}
