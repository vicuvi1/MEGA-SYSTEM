import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../shared/api'
import type {} from '../../shared/desktop'

export function DesktopBar() {
  const [sync, setSync] = useState<{ pending: number; error: string | null; syncedAt: string | null }>({ pending: 0, error: null, syncedAt: null })
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const desktop = window.desktop
  useEffect(() => {
    if (!desktop) return
    const changed = (event: Event) => setSync((event as CustomEvent).detail)
    window.addEventListener('life-desktop-sync', changed)
    const poll = () => desktop.updateStatus().then(setUpdate).catch(() => {})
    void poll()
    const interval = setInterval(poll, 1500)
    return () => { clearInterval(interval); window.removeEventListener('life-desktop-sync', changed) }
  }, [desktop])
  if (!desktop) return null
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMessage('')
    try { await fn() } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }
  const installing = update && ['checking', 'downloading', 'installing'].includes(update.state)
  return <div style={{ padding: '6px 16px', background: 'var(--surface, #161a20)', borderBottom: '1px solid var(--border, #30343a)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
    <strong>Life System desktop {update?.current}</strong>
    <span role="status">{sync.pending ? `${sync.pending} changes saved locally · waiting to sync` : sync.syncedAt ? 'Saved locally and synced' : 'Opening your local data…'}</span>
    <button className="btn small" disabled={busy} onClick={() => window.dispatchEvent(new Event('life-desktop-retry'))}>Sync now</button>
    <button className="btn small" disabled={busy} onClick={() => void action(async () => { const path = await desktop.backup(); if (path) setMessage('Backup saved') })}>Save backup</button>
    {sync.error?.startsWith('Sync conflict:') && <button className="btn small" disabled={busy} onClick={() => void action(async () => {
      if (!window.confirm('Save a backup of your local changes, then replace this device’s copy with the server copy? Your unsynced changes will remain in the backup, and will not be uploaded automatically.')) return
      const path = await desktop.backup()
      if (path) window.dispatchEvent(new Event('life-desktop-use-server'))
    })}>Back up and use server copy</button>}
    <button className="btn small" disabled={busy || !!installing} onClick={() => void action(async () => setUpdate(await desktop.checkUpdates()))}>Check for updates</button>
    {update && ['available', 'ready'].includes(update.state) && <button className="btn primary small" disabled={busy} onClick={() => void action(async () => setUpdate(await desktop.installUpdate()))}>Update to {update.latest}</button>}
    <button className="btn small" disabled={busy} onClick={() => void action(async () => { await desktop.loginGithub(); setMessage('Signed in to GitHub') })}>Sign in to GitHub</button>
    {update?.state === 'downloading' && <span>Downloading {update.progress}%</span>}
    {update?.state === 'up-to-date' && <span>You have the latest release</span>}
    {(sync.error || update?.error || message) && <span role="status">{message || sync.error || update?.error}</span>}
  </div>
}
