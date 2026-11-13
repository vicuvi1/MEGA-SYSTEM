// Settings → Backups & data: how syncing is doing on this device (Y9).
// Last sync, changes waiting, anything that couldn't be sent, backup trouble,
// and each app's own sync (Money, Sport Track…) with "Sync Money now".
import { useCallback, useEffect, useState } from 'react'
import type { SyncHealth } from '@shared/api'
import { life } from './bridge'
import { timeAgo } from './ui'
import { appSyncLine } from './web/appSync'

export function SyncPanel() {
  const [h, setH] = useState<SyncHealth | null>(null)
  const [money, setMoney] = useState<{ busy: boolean; text: string; ok: boolean } | null>(null)
  const load = useCallback(() => void life.sync.health?.().then(setH).catch(() => {}), [])
  useEffect(() => {
    load()
    const t = setInterval(load, 15_000)
    window.addEventListener('life-desktop-sync', load)
    window.addEventListener('life-app-sync', load)
    return () => {
      clearInterval(t)
      window.removeEventListener('life-desktop-sync', load)
      window.removeEventListener('life-app-sync', load)
    }
  }, [load])
  if (!life.sync.health || !h) return null
  const apps = h.apps ?? []
  const appsOk = apps.every((a) => a.state === 'ok' || a.state === 'never')
  const ok = !h.error && !h.waiting && !h.desktopPending && !h.failed.length && !h.backupError && appsOk
  const syncMoney = async () => {
    setMoney({ busy: true, text: 'Comparing Money with the cloud…', ok: true })
    try {
      const r = await life.sync.moneyNow!()
      setMoney({ busy: false, text: r.text, ok: r.ok })
    } catch (e) {
      setMoney({ busy: false, text: `Not synced: ${(e as Error).message}`, ok: false })
    }
    load()
  }
  return (
    <section className="panel" aria-label="Sync status" data-testid="sync-panel">
      <header className="panel-head">
        <h2>{ok ? '✅' : '⚠️'} Sync</h2>
        <span className="hint small">{h.syncedAt ? `Last synced ${timeAgo(h.syncedAt)}` : 'Not synced yet'}</span>
      </header>
      <ul className="list-plain small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
        {ok && <li>Everything on this device is saved in the cloud.</li>}
        {h.waiting > 0 && <li>{h.waiting} change{h.waiting === 1 ? '' : 's'} made offline, waiting to be sent.</li>}
        {h.desktopPending > 0 && <li>{h.desktopPending} change{h.desktopPending === 1 ? '' : 's'} on this PC not sent yet.</li>}
        {h.error && <li>{h.error}</li>}
        {h.backupError && <li>{h.backupError}</li>}
      </ul>
      {apps.length > 0 && (
        <ul className="list-plain small" data-testid="app-sync" style={{ margin: '8px 0 0', paddingLeft: '1.1rem' }}>
          {apps.map((a) => (
            <li key={a.setting} data-app={a.setting} data-state={a.state}>
              <b>{a.label}</b>: {appSyncLine(a)}
            </li>
          ))}
        </ul>
      )}
      {life.sync.moneyNow && (
        <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn ghost small" data-testid="sync-money-now" disabled={money?.busy} onClick={() => void syncMoney()}>
            Sync Money now
          </button>
          {money && (
            <span className={`small ${money.ok ? 'hint' : ''}`} data-testid="sync-money-result" role="status">
              {money.text}
            </span>
          )}
        </div>
      )}
      {h.failed.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <strong className="small">Couldn't sync ({h.failed.length})</strong>
          <p className="hint small">Another device changed the same thing first, so these offline changes were not applied. Re-enter them if you still need them.</p>
          <ul className="small" style={{ maxHeight: 140, overflow: 'auto' }}>
            {h.failed.slice(-10).reverse().map((f, i) => (
              <li key={i}>
                {timeAgo(f.at)}: {f.error}
              </li>
            ))}
          </ul>
          <button type="button" className="btn ghost small" onClick={() => void life.sync.clearFailed?.().then(load)}>
            Clear this list
          </button>
        </div>
      )}
    </section>
  )
}
