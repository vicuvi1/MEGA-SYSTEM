// Settings → Sporty bot: is the bot on your server connected, which version it
// runs, and an Update Sporty button (it pulls the latest from GitHub and
// restarts itself within a minute).
import { useCallback, useEffect, useState } from 'react'
import type { SportyView } from '@core/sportyUpdate'
import { life } from './bridge'
import { useLive } from './live'
import { Icon } from './Icon'
import { timeAgo, useAction } from './ui'

export function SportyPanel() {
  const [v, setV] = useState<SportyView | null>(null)
  const act = useAction()
  const load = useCallback(() => {
    life.coach?.sporty?.().then(setV).catch(() => {})
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, 20_000)
    return () => clearInterval(t)
  }, [load])
  useLive(load)
  if (!life.coach?.sporty || !v) return null

  const u = v.lastUpdate
  const state = !v.connected ? 'off' : v.online ? 'on' : 'idle'
  const press = async () => {
    const next = await act(() => life.coach!.updateSporty!(), 'Sent. Sporty updates within a minute.')
    if (next) setV(next)
  }

  return (
    <section className="panel sporty-panel">
      <header className="panel-head">
        <h2>
          <Icon name="bot" /> Sporty bot
        </h2>
        <span className={`sporty-dot ${state}`}>{state === 'on' ? 'Online' : state === 'idle' ? 'Not seen lately' : 'Not connected'}</span>
      </header>
      <div className="sporty-grid">
        <div>
          <small>Last seen</small>
          <b>{v.lastSeen ? timeAgo(v.lastSeen) : 'never'}</b>
        </div>
        <div>
          <small>Version</small>
          <b>{v.version ?? '—'}</b>
        </div>
        <div>
          <small>On GitHub</small>
          <b>{!v.canUpdate ? '—' : v.behind ? `${v.behind} new change${v.behind === 1 ? '' : 's'}` : 'Up to date'}</b>
        </div>
      </div>
      {u && (
        <p className={`sporty-last ${u.ok ? '' : 'bad'}`}>
          {u.ok ? (u.updated ? `Updated to ${u.version ?? 'the latest'} ${timeAgo(u.at)}` : `Checked ${timeAgo(u.at)}: already up to date`) : `Update failed ${timeAgo(u.at)}: ${u.error ?? 'unknown error'}`}
          {u.ok && u.updated && !!u.changes?.length && <small>{u.changes.slice(0, 4).join(' · ')}</small>}
        </p>
      )}
      {!v.canUpdate ? (
        <p className="muted">
          {v.connected
            ? 'Sporty syncs but runs an old version that cannot update itself. Update it once on the server (git pull + restart); after that this button does it.'
            : 'Sporty has not talked to Life System yet. Set LIFE_API_URL and LIFE_SYNC_KEY on the server and restart it.'}
        </p>
      ) : (
        <div className="sporty-actions">
          <button className="btn primary" disabled={v.pending || !v.online} onClick={() => void press()}>
            {v.pending ? 'Updating…' : '⬆️ Update Sporty'}
          </button>
          <small className="muted">{!v.online ? 'Sporty is offline, so it cannot update now.' : 'Pulls the latest from GitHub and restarts. Your data stays.'}</small>
        </div>
      )}
    </section>
  )
}
