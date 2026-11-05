// Settings → diagnostics (LT11: split out of pages/Settings.tsx; the state lives in useSettingsState).
import { features, life } from '../bridge'
import { IslandLogPanel } from '../IslandLogPanel'
import { Icon } from '../Icon'
import { timeAgo } from '../ui'
import type { SettingsState } from './useSettingsState'

export function DiagnosticsSection({ s }: { s: SettingsState }) {
  const { act, logs, setLogs } = s
  return (
        <>
      <IslandLogPanel />
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="list" /> Diagnostics
          </h2>
          <span className={`chip ${logs && logs.some((l) => l.level === 'error') ? 'warn' : 'ok'}`}>{logs && logs.length ? `${logs.length} logged` : 'No problems'}</span>
        </header>
        <p className="hint block">Problems are saved to a log here instead of popping up error windows. If something misbehaves, this is what to send.</p>
        {logs && logs.length > 0 && (
          <ul className="log-list">
            {logs.slice(0, 8).map((l, i) => (
              <li key={i} className={l.level}>
                <span className="log-level">{l.level}</span>
                <span className="log-msg">
                  <b>{l.message}</b>
                  <small>
                    {l.source} · {timeAgo(l.at)}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          {features.logFolder && (
            <button className="btn" onClick={() => life.app.openLogs()}>
              Open log folder
            </button>
          )}
          <button className="btn ghost" onClick={() => life.app.recentErrors().then(setLogs)}>
            Refresh
          </button>
          {logs && logs.length > 0 && (
            <button
              className="btn ghost"
              onClick={async () => {
                const text = logs.map((l) => `${l.at} ${l.level} [${l.source}] ${l.message}\n${l.detail ?? ''}`).join('\n')
                await act(() => navigator.clipboard.writeText(text), 'Copied')
              }}
            >
              Copy all
            </button>
          )}
        </div>
      </section>
        </>
  )
}
