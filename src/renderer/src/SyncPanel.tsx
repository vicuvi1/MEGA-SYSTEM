// Settings → Backups & data: how syncing is doing on this device (Y9).
// Last sync, changes waiting, anything that couldn't be sent, backup trouble,
// and each app's own sync (Money, Sport Track…) with "Sync Money now", the
// Money PIN when Money is locked, and the last sync events ("Show history").
import { useCallback, useEffect, useState } from 'react'
import type { SyncHealth } from '@shared/api'
import { life } from './bridge'
import { timeAgo } from './ui'
import { appSyncEventLine, appSyncHistory, appSyncLine, type AppSyncEvent } from './web/appSync'
import { moneyPinState, setMoneyPin } from './web/financeSync'

export function SyncPanel() {
  const [h, setH] = useState<SyncHealth | null>(null)
  const [money, setMoney] = useState<{ busy: boolean; text: string; ok: boolean } | null>(null)
  const [history, setHistory] = useState<AppSyncEvent[] | null>(null)
  const [pinText, setPinText] = useState('')
  const [pinState, setPinState] = useState(moneyPinState)
  const load = useCallback(() => {
    void life.sync.health?.().then(setH).catch(() => {})
    setPinState(moneyPinState())
    setHistory((open) => (open ? appSyncHistory() : open))
  }, [])
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
  // Money locked with its PIN: the PIN stays in this window's memory only (never saved, never sent).
  const unlockMoney = async () => {
    if (!pinText) return
    setMoneyPin(pinText)
    setPinText('')
    await syncMoney()
  }
  const askPin = pinState.wanted && !pinState.held
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
      {life.sync.moneyNow && askPin && (
        <form
          className="row"
          data-testid="money-pin-form"
          style={{ marginTop: 8, gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
          onSubmit={(e) => {
            e.preventDefault()
            void unlockMoney()
          }}
        >
          <span className="small">Money is locked with its PIN. Enter it to sync Money here. It stays in this window only and is never sent.</span>
          <input type="password" className="input small" aria-label="Money PIN" data-testid="money-pin" autoComplete="off" value={pinText} onChange={(e) => setPinText(e.target.value)} style={{ width: 120 }} />
          <button type="submit" className="btn small" disabled={!pinText || money?.busy}>
            Unlock Money sync
          </button>
        </form>
      )}
      <div style={{ marginTop: 8 }}>
        <button type="button" className="btn ghost small" data-testid="sync-history-toggle" aria-expanded={history != null} onClick={() => setHistory(history ? null : appSyncHistory())}>
          {history ? 'Hide history' : 'Show history'}
        </button>
        {history && (
          <ul className="list-plain small" data-testid="sync-history" style={{ margin: '6px 0 0', paddingLeft: '1.1rem', maxHeight: 220, overflow: 'auto' }}>
            {history.length === 0 && <li className="hint">No sync events on this device yet.</li>}
            {history.map((e) => (
              <li key={`${e.setting}-${e.at}`} data-app={e.setting}>
                {appSyncEventLine(e)}
              </li>
            ))}
          </ul>
        )}
      </div>
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
