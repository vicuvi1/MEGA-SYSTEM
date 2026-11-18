// Settings → Data safety → Sync folder (desktop, 2026-11-18): a live copy of
// all data in a folder you choose (OneDrive, Google Drive, Dropbox, a USB
// drive…), written a few seconds after every change, with rolling versions you
// can preview and restore. It never needs the server. The website shows nothing.
import { useCallback, useEffect, useState } from 'react'
import { KEEP_TEXT, sizeLabel, statusLine, type SyncFolderStatus, type SyncPreview, type SyncSuggestion, type SyncVersion } from '@core/syncFolder'
import { askConfirm } from '../confirmSheet'
import { Icon } from '../Icon'
import { useAction } from '../ui'
import { syncFolder } from './syncFolder'
import { APP_KEYS } from './syncFolderClient'

const DOT: Record<string, string> = { green: 'on', amber: 'idle', red: 'off', off: 'idle' }
const APP_EVENTS = ['life-finance-changed', 'life-sport-changed', 'life-waky-changed', 'life-man-changed']
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const shortWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })

let wired = false
/** Headless: answers the desktop when it wants a copy, and tells it when an app's own data changed. */
export function SyncFolderLive() {
  useEffect(() => {
    const ipc = window.desktop?.syncFolder
    if (!ipc || wired) return
    wired = true
    let busy = false
    let again = false
    const copy = () => {
      if (busy) {
        again = true
        return
      }
      busy = true
      void syncFolder
        .writeIfChanged()
        .catch(() => null)
        .finally(() => {
          busy = false
          if (again) {
            again = false
            copy()
          }
        })
    }
    ipc.onWant(copy)
    const touch = () => ipc.touch()
    // The embedded apps keep their data in this window's storage, not in the database file.
    window.addEventListener('storage', (e) => {
      if (e.key && APP_KEYS.has(e.key)) touch()
    })
    for (const n of APP_EVENTS) window.addEventListener(n, touch)
  }, [])
  return null
}

export function SyncFolderPanel() {
  const act = useAction()
  const [s, setS] = useState<SyncFolderStatus | null>(null)
  const [found, setFound] = useState<SyncSuggestion[]>([])
  const [versions, setVersions] = useState<SyncVersion[]>([])
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<SyncPreview | null>(null)
  const [pass, setPass] = useState('')
  const [askPass, setAskPass] = useState(false)
  const on = syncFolder.available()

  const reload = useCallback(() => {
    if (!syncFolder.available()) return
    void syncFolder.status().then(setS).catch(() => {})
    void syncFolder.listVersions().then(setVersions).catch(() => {})
    void syncFolder.suggestions().then(setFound).catch(() => {})
  }, [])
  useEffect(() => {
    reload()
    window.desktop?.syncFolder?.onChanged(reload)
    const t = window.setInterval(reload, 60_000)
    return () => clearInterval(t)
  }, [reload])

  if (!on) return null

  const run = async <T,>(key: string, fn: () => Promise<T>, done?: string) => {
    setBusy(key)
    const out = await act(fn, done)
    setBusy(null)
    reload()
    return out
  }
  const line = s ? statusLine(s) : null
  const shown = all ? versions : versions.slice(0, 8)

  const restore = async (p: SyncPreview) => {
    if (!(await askConfirm(`Put back your data from the copy of ${when(p.at)} (${p.rows.toLocaleString()} rows, made on ${p.device})? Everything changes to how it was then, on every device (your PIN and bot setup stay). A backup of today is saved first, so you can undo this.`))) return
    const ok = await run('restore', () => syncFolder.restore(p.id), `Restored the copy of ${when(p.at)}. Reloading…`)
    if (ok) setTimeout(() => window.location.reload(), 1200)
  }

  return (
    <section className="panel safety" data-testid="sync-folder">
      <header className="panel-head">
        <h2>
          <Icon name="shield" /> Sync folder
        </h2>
        {s && <span className={`chip ${!s.enabled ? 'ghost' : line?.light === 'green' ? 'ok' : 'warn'}`} data-testid="sync-folder-chip">{!s.enabled ? 'Off' : line?.light === 'green' ? 'On' : 'Needs a look'}</span>}
      </header>
      <p className="muted bk-note">A live copy of all your data (the database, Money, Sport Track, Waky, MAN) in a folder you choose: your OneDrive, Google Drive or Dropbox folder, or a USB drive. It is written a few seconds after every change and works with no internet and no server.</p>
      {line && (
        <ul className="safety-rows">
          <li data-testid="sync-folder-status" data-light={line.light}>
            <span className={`sporty-dot ${DOT[line.light]}`} aria-label={line.light} />
            <b>Live copy</b>
            <span>{line.text}</span>
          </li>
        </ul>
      )}
      {s && !s.enabled && (
        <div className="bk-row" data-testid="sync-folder-choose">
          {found.slice(0, 3).map((f) => (
            <button key={f.path} className="btn" disabled={!!busy} title={f.path} onClick={() => void run('choose', () => syncFolder.choose(f.path), 'Sync folder is on. The first copy is being written.')}>
              Use {f.label}
            </button>
          ))}
          <button className={`btn ${found.length ? 'ghost' : 'primary'}`} disabled={!!busy} onClick={() => void run('choose', () => syncFolder.choose())}>
            Choose a folder…
          </button>
        </div>
      )}
      {s?.enabled && (
        <>
          <div className="bk-where">
            <div>
              <small>Folder</small>
              <b title={s.folder ?? ''}>{s.folder}</b>
              <span>This PC writes to "Life System Sync/{s.device}" inside it · {KEEP_TEXT}</span>
              <div className="bk-row">
                <button className="btn small primary" disabled={!!busy} onClick={() => void run('write', () => syncFolder.writeNow(), 'Copied and checked')}>
                  {busy === 'write' ? 'Copying…' : 'Copy now'}
                </button>
                <button className="btn small" onClick={() => void syncFolder.open()}>Open folder</button>
                <button className="btn small ghost" disabled={!!busy} onClick={() => void run('choose', () => syncFolder.choose())}>Change</button>
                <button className="btn small ghost" disabled={!!busy} onClick={async () => { if (await askConfirm('Stop the live copy? The copies already in the folder stay there.')) void run('off', () => syncFolder.turnOff(), 'Sync folder is off') }}>Turn off</button>
              </div>
            </div>
            <div>
              <small>Encryption</small>
              <label className="bk-row">
                <input
                  type="checkbox"
                  data-testid="sync-folder-encrypt"
                  checked={s.encrypt}
                  disabled={!!busy}
                  onChange={(e) => {
                    if (!e.target.checked) void run('enc', () => syncFolder.setEncryption(false), 'New copies are not encrypted')
                    else if (s.passphraseSaved) void run('enc', () => syncFolder.setEncryption(true), 'New copies are encrypted')
                    else setAskPass(true)
                  }}
                />
                <b>Encrypt the sync folder copy</b>
              </label>
              <span>Nobody who gets into the folder can read an encrypted copy, but it opens only with the passphrase, which is kept only on this PC: write it down, or a new PC can't restore it.</span>
              {askPass && !s.encrypt && (
                <div className="bk-row">
                  <input type="password" className="input" placeholder="Passphrase (8+ characters)" value={pass} onChange={(e) => setPass(e.target.value)} />
                  <button
                    className="btn small primary"
                    disabled={!!busy || pass.length < 8}
                    onClick={async () => {
                      const ok = await run('enc', () => syncFolder.setEncryption(true, pass), 'New copies are encrypted')
                      if (ok) {
                        setPass('')
                        setAskPass(false)
                      }
                    }}
                  >
                    Turn on
                  </button>
                </div>
              )}
              {!s.encrypt && !askPass && versions.some((v) => v.encrypted) && !s.passphraseSaved && (
                <button className="btn small ghost" onClick={() => setAskPass(true)}>Enter the passphrase to open encrypted copies</button>
              )}
            </div>
          </div>
          {!!s.others.length && (
            <p className="muted bk-note" data-testid="sync-folder-others">
              {s.others.length === 1 ? 'Another PC also copies here' : 'Other PCs also copy here'}: {s.others.map((o) => `${o.device}${o.lastWrite ? ` (last copy ${when(o.lastWrite)})` : ''}`).join(', ')}. You can restore one of its versions below; merging two PCs' copies is not available yet.
            </p>
          )}
          <h3 className="safety-h">Versions in the folder</h3>
          {versions.length ? (
            <ul className="bk-list" data-testid="sync-folder-versions">
              {shown.map((v) => (
                <li key={v.id}>
                  <span title={when(v.at)}>{shortWhen(v.at)}</span>
                  <small>{v.mine ? 'this PC' : v.device} · {sizeLabel(v.sizeBytes)}{v.encrypted ? ' · encrypted' : ''}</small>
                  <button className="btn small ghost" disabled={!!busy} onClick={() => void run('preview', async () => setPreview(await syncFolder.preview(v.id)))}>Preview</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted bk-note">No copy yet. The first one is written within a minute.</p>
          )}
          {versions.length > 8 && !all && <button className="btn small ghost" onClick={() => setAll(true)}>Show all {versions.length}</button>}
          {preview && (
            <div className="bk-where" data-testid="sync-folder-preview">
              <div>
                <small>Copy of {when(preview.at)}</small>
                <b>{preview.rows.toLocaleString()} rows in {Object.keys(preview.tables).length} tables · {sizeLabel(preview.sizeBytes)}</b>
                <span>Made on {preview.device} with version {preview.appVersion || 'unknown'}. Every file matched its checksum.</span>
                <span>{preview.apps.length ? `Apps: ${preview.apps.map((a) => a.label).join(', ')}` : 'No app data in this copy'}</span>
                <span>
                  {Object.entries(preview.tables)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([t, n]) => `${t} ${n.toLocaleString()}`)
                    .join(' · ')}
                </span>
                <div className="bk-row">
                  <button className="btn small primary" disabled={!!busy} onClick={() => void restore(preview)}>{busy === 'restore' ? 'Restoring…' : 'Restore this version'}</button>
                  <button className="btn small ghost" onClick={() => setPreview(null)}>Close</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      <p className="muted bk-note">A restore needs the server (it changes the data on every device). While the server is down the copies stay whole in the folder and open without the app: docs/RECOVERY.md.</p>
    </section>
  )
}
