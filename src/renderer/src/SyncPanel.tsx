// Settings → Backups & data: how syncing is doing on this device (Y9).
// Last sync, changes waiting, anything that couldn't be sent, backup trouble.
import { useCallback, useEffect, useState } from 'react'
import type { SyncHealth } from '@shared/api'
import { life } from './bridge'
import { timeAgo } from './ui'

export function SyncPanel() {
  const [h, setH] = useState<SyncHealth | null>(null)
  const load = useCallback(() => void life.sync.health?.().then(setH).catch(() => {}), [])
  useEffect(() => {
    load()
    const t = setInterval(load, 15_000)
    window.addEventListener('life-desktop-sync', load)
    return () => {
      clearInterval(t)
      window.removeEventListener('life-desktop-sync', load)
    }
  }, [load])
  if (!life.sync.health || !h) return null
  const ok = !h.error && !h.waiting && !h.desktopPending && !h.failed.length && !h.backupError
  return (
    <section className="panel" aria-label="Sync status">
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
