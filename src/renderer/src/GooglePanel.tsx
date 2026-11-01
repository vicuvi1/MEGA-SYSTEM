// Settings → Google Calendar: sign in once, pick which calendars show and
// where new blocks (focus, planned tasks) go.
import { useEffect, useState } from 'react'
import { life, type GoogleStatus } from './bridge'
import { Icon } from './Icon'
import { useAction } from './ui'

export function GooglePanel() {
  const act = useAction()
  const [st, setSt] = useState<GoogleStatus | null>(null)
  const load = () => life.google?.status().then(setSt).catch(() => setSt({ configured: false, connected: false }))
  useEffect(() => {
    void load()
  }, [])
  if (!life.google) return null
  const on = new Set(st?.on?.length ? st.on : (st?.calendars ?? []).map((c) => c.id))
  const save = async (nextOn: string[], target: string | null) => {
    if (await act(() => life.google!.setCalendars(nextOn, target).then(() => true), 'Saved')) void load()
  }
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="calendar" /> Google Calendar
        </h2>
        <span className={`chip ${st?.connected ? 'ok' : 'muted'}`}>{st?.connected ? 'Connected' : 'Not connected'}</span>
      </header>
      {!st && <p className="hint">Checking…</p>}
      {st && !st.configured && (
        <p className="hint">
          Add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in Vercel (Settings → Environment Variables), then come back here and connect.
        </p>
      )}
      {st && st.configured && !st.connected && (
        <div className="gc-connect">
          <p className="hint">
            Sign in once. Your events show on Today and the Calendar page, every focus session is added to your calendar, and the coach plans your day in your free time.
            {st.error ? ` (${st.error})` : ''}
          </p>
          <button className="btn primary" onClick={() => void act(() => life.google!.connect())}>
            <Icon name="calendar" size={14} /> Connect Google Calendar
          </button>
          <p className="hint small">Google may say the app isn't verified: it's your own private app. Tap “Advanced” → “Go to Life System”.</p>
        </div>
      )}
      {st?.connected && (
        <div className="gc-on">
          <p className="hint">Signed in as <b>{st.email ?? 'your Google account'}</b>.</p>
          <h3>Calendars to show</h3>
          <div className="gc-cals">
            {(st.calendars ?? []).map((c) => (
              <label key={c.id} className="gc-cal">
                <input
                  type="checkbox"
                  checked={on.has(c.id)}
                  onChange={(e) => {
                    const next = new Set(on)
                    e.target.checked ? next.add(c.id) : next.delete(c.id)
                    void save([...next], st.target ?? null)
                  }}
                />
                <i style={{ background: c.color }} />
                <span>{c.name}</span>
                {c.primary && <small>main</small>}
              </label>
            ))}
          </div>
          <label className="field">
            <span>New blocks (focus, planned tasks) go to</span>
            <select value={st.target ?? (st.calendars ?? []).find((c) => c.primary)?.id ?? ''} onChange={(e) => void save([...on], e.target.value)}>
              {(st.calendars ?? [])
                .filter((c) => c.canWrite)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <button className="btn small ghost" onClick={() => void act(() => life.google!.disconnect(), 'Disconnected').then(load)}>
            Disconnect
          </button>
        </div>
      )}
    </section>
  )
}
