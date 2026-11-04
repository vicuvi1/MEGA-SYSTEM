// Desktop: the window's own slim title bar (replaces the white Windows bar,
// the File/Edit menu and the old row of buttons). Drag it to move the window;
// Windows' own minimize/maximize/close sit on the right, in the same dark.
// Shows sync state in one word; update / sign-in / conflict buttons appear
// only when they're needed. Backups live in Settings → Backups on this PC.
import { useEffect, useRef, useState } from 'react'
import type { UpdateStatus } from '../../shared/api'
import type {} from '../../shared/desktop'

export function DesktopBar() {
  const [sync, setSync] = useState<{ pending: number; error: string | null; syncedAt: string | null }>({ pending: 0, error: null, syncedAt: null })
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const desktop = window.desktop
  const bar = useRef<HTMLDivElement>(null)
  // Floating things sit below this bar, whatever its height.
  useEffect(() => {
    const el = bar.current
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--desk-bar', `${el.offsetHeight}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => { ro.disconnect(); document.documentElement.style.removeProperty('--desk-bar') }
  }, [desktop])
  // Windows' buttons take this bar's colors (and follow light/dark).
  useEffect(() => {
    const el = bar.current
    if (!el || !desktop?.titleBar) return
    const paint = () => {
      const cs = getComputedStyle(el)
      const hex = (c: string) => {
        const n = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((x) => Math.round(Number(x)))
        return n.length === 3 ? '#' + n.map((x) => x.toString(16).padStart(2, '0')).join('') : '#07090e'
      }
      desktop.titleBar!(hex(cs.backgroundColor), hex(cs.color))
    }
    paint()
    const mo = new MutationObserver(paint)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-design', 'style'] })
    return () => mo.disconnect()
  }, [desktop])
  useEffect(() => {
    if (!desktop) return
    const changed = (event: Event) => setSync((event as CustomEvent).detail)
    window.addEventListener('life-desktop-sync', changed)
    // The update status arrives when it changes; a slow poll is only a safety net.
    const poll = () => desktop.updateStatus().then(setUpdate).catch(() => {})
    void poll()
    desktop.onUpdateStatus?.(setUpdate)
    const interval = setInterval(poll, 60_000)
    return () => { clearInterval(interval); window.removeEventListener('life-desktop-sync', changed) }
  }, [desktop])
  // Just updated: say so once, with what's new (saved when the update was ready).
  useEffect(() => {
    if (!update?.current || update.state === 'dev') return
    try {
      const before = localStorage.getItem('ls.version')
      if (before && before !== update.current) {
        const notes = localStorage.getItem('ls.updateNotes')
        setMessage(`Updated to ${update.current}${notes ? ` · ${notes}` : ''}`)
        localStorage.removeItem('ls.updateNotes')
      }
      localStorage.setItem('ls.version', update.current)
    } catch {
      /* private storage: no note */
    }
  }, [update?.current, update?.state])
  useEffect(() => {
    if (update?.state === 'ready' && update.notes) {
      try {
        localStorage.setItem('ls.updateNotes', update.notes)
      } catch {
        /* fine */
      }
    }
  }, [update?.state, update?.notes])
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(''), 6000)
    return () => clearTimeout(t)
  }, [message])
  if (!desktop) return null

  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMessage('')
    try { await fn() } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }
  const conflict = !!sync.error?.startsWith('Sync conflict:')
  const state = conflict ? 'bad' : sync.error ? 'warn' : sync.pending ? 'warn' : sync.syncedAt ? 'ok' : 'idle'
  const label = conflict ? 'Sync needs you' : sync.pending ? `${sync.pending} waiting to sync` : sync.error ? 'Offline · saved here' : sync.syncedAt ? 'Synced' : 'Opening…'
  const needsLogin = !!update?.error && /sign in|401|403|404|auth|token|credential/i.test(update.error)

  return (
    <div ref={bar} className="dbar">
      <span className="dbar-brand">
        <i className="dbar-logo" />
        Life System
        {update?.current && <small title={update.state === 'downloading' ? `Downloading ${update.latest} in the background (${update.progress}%)` : update.state === 'up-to-date' ? 'Up to date' : undefined}>{update.current}{update.state === 'downloading' ? ' · updating…' : ''}</small>}
      </span>
      <button className={`dbar-sync ${state}`} disabled={busy} onClick={() => window.dispatchEvent(new Event('life-desktop-retry'))} title={sync.error ?? (sync.syncedAt ? `Last synced ${new Date(sync.syncedAt).toLocaleTimeString()}. Click to sync now.` : 'Sync now')}>
        <i />
        {label}
      </button>
      {message && <span className="dbar-note">{message}</span>}
      <span className="dbar-space" />
      {conflict && (
        <button className="dbar-btn" disabled={busy} onClick={() => void action(async () => {
          if (!window.confirm('Save a backup of your local changes, then replace this device’s copy with the server copy? Your unsynced changes will remain in the backup, and will not be uploaded automatically.')) return
          const path = await desktop.backup()
          if (path) window.dispatchEvent(new Event('life-desktop-use-server'))
        })}>Back up and use server copy</button>
      )}
      {needsLogin && <button className="dbar-btn" disabled={busy} onClick={() => void action(async () => { await desktop.loginGithub(); setMessage('Signed in to GitHub'); setUpdate(await desktop.checkUpdates()) })}>Sign in to GitHub for updates</button>}
      {/* Updates download by themselves; only a finished one asks for anything. */}
      {update?.state === 'ready' && (
        <button className="dbar-btn primary dbar-update" disabled={busy} title={`${update.latest}${update.notes ? `: ${update.notes}` : ''}. Also installs by itself when you quit.`} onClick={() => void action(async () => setUpdate(await desktop.installUpdate()))}>
          Restart to update
        </button>
      )}
      {update?.state === 'installing' && (
        <div className="dbar-updating" role="status">
          <div>
            <i className="dbar-spinner" />
            <b>Updating Life System</b>
            <span>Back in a few seconds. Your data is saved.</span>
          </div>
        </div>
      )}
    </div>
  )
}
