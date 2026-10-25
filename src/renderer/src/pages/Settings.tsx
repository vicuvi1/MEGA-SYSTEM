import { useEffect, useState } from 'react'
import type { AppPrefs, AuthStatus, BackupStatus, UpdateStatus, VerifyResult } from '@shared/api'
import { UpdatePanel } from '../updates'
import { useUiPrefs } from '../uiPrefs'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { timeAgo, useAction } from '../ui'

interface Props {
  auth: AuthStatus
  onAuth: (a: AuthStatus) => void
  backup: BackupStatus | null
  onBackup: (b: BackupStatus) => void
  onRestored: () => void
  update: UpdateStatus | null
  onUpdate: (s: UpdateStatus) => void
}

export function Settings({ auth, onAuth, backup, onBackup, onRestored, update, onUpdate }: Props) {
  const act = useAction()
  const [pin, setPin] = useState('')
  const [currentPin, setCurrentPin] = useState('')
  const [pass, setPass] = useState('')
  const [verify, setVerify] = useState<VerifyResult | null>(null)
  const [names, setNames] = useState<string[]>([])
  const [restoreName, setRestoreName] = useState('')
  const [restorePass, setRestorePass] = useState('')
  const [prefs, setPrefs] = useState<AppPrefs | null>(null)
  const [ui, setUi] = useUiPrefs()

  useEffect(() => {
    life.app.prefs().then(setPrefs)
  }, [])

  async function changePrefs(p: Partial<AppPrefs>) {
    const next = await act(() => life.app.setPrefs(p))
    if (next) setPrefs(next)
  }

  useEffect(() => {
    life.backup.list().then((n) => {
      setNames(n.slice().reverse())
      setRestoreName(n[n.length - 1] ?? '')
    })
  }, [backup])

  async function savePin() {
    const a = await act(() => life.auth.setPin(pin, currentPin || undefined), 'PIN saved')
    if (a) {
      onAuth(a)
      setPin('')
      setCurrentPin('')
    }
  }

  async function savePass() {
    const b = await act(() => life.backup.setPassphrase(pass), 'Passphrase saved. Backup written.')
    if (b) {
      onBackup(b)
      setPass('')
    }
  }

  async function restore() {
    if (!window.confirm(`Replace all current data with ${restoreName}? A backup of the current state is made first.`)) return
    const ok = await act(async () => {
      await life.backup.restore(restoreName, restorePass)
      return true
    }, 'Restored')
    if (ok) {
      setRestorePass('')
      onRestored()
    }
  }

  return (
    <div className="settings">
      <UpdatePanel status={update} onStatus={onUpdate} />

      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="sun" /> Appearance
          </h2>
        </header>
        <div className="field">
          <span>Theme</span>
          <div className="seg">
            {(['dark', 'light', 'system'] as const).map((t) => (
              <button key={t} type="button" className={ui.theme === t ? 'on' : ''} onClick={() => setUi({ theme: t })}>
                {t === 'dark' ? 'Dark' : t === 'light' ? 'Light' : 'Like Windows'}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Your name, for the greeting on Today</span>
          <input value={ui.name} maxLength={30} placeholder="e.g. Victor" onChange={(e) => setUi({ name: e.target.value })} />
        </label>
        <label className="check toggle-row">
          <input type="checkbox" checked={ui.sound} onChange={(e) => setUi({ sound: e.target.checked })} />
          <span>
            Sounds
            <small>A short chime when coins come in, a lower one when they go out.</small>
          </span>
        </label>
        <p className="hint block">Size: Ctrl + and Ctrl − make everything bigger or smaller, Ctrl 0 resets. The apps inside keep their own dark look in the light theme.</p>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="cloud" /> Google Drive backup
          </h2>
          {backup && <span className={`chip ${backup.lastError ? 'warn' : 'ok'}`}>{backup.lastError ? 'Needs attention' : 'On'}</span>}
        </header>
        {backup && (
          <dl className="facts">
            <dt>Folder</dt>
            <dd className="mono">{backup.dir}</dd>
            <dt>Google Drive</dt>
            <dd>{backup.driveAvailable ? 'Found' : 'Not found. Backups wait on this PC.'}</dd>
            <dt>Last backup</dt>
            <dd>{backup.last ? `${timeAgo(backup.last.at)} · ${backup.last.name}` : 'None yet'}</dd>
            <dt>Snapshots</dt>
            <dd>
              {backup.count} in Drive{backup.pending ? `, ${backup.pending} waiting on this PC` : ''}
            </dd>
            {backup.lastError && (
              <>
                <dt>Problem</dt>
                <dd className="warn-text">{backup.lastError}</dd>
              </>
            )}
          </dl>
        )}
        <p className="hint block">
          Backups are encrypted with your passphrase before they go to Drive. Write it down somewhere safe: without it a backup can't be opened on another PC.
        </p>
        <div className="row">
          <input type="password" placeholder={backup?.passphraseSet ? 'Change passphrase (8+ characters)' : 'Backup passphrase (8+ characters)'} value={pass} onChange={(e) => setPass(e.target.value)} />
          <button className="btn primary" disabled={pass.length < 8} onClick={savePass}>
            Save
          </button>
        </div>
        <div className="row">
          <button className="btn" onClick={async () => { const b = await act(() => life.backup.runNow()); if (b) onBackup(b) }}>
            Back up now
          </button>
          <button className="btn ghost" onClick={async () => setVerify((await act(() => life.backup.verifyLatest())) ?? null)}>
            Check latest backup
          </button>
          {verify && <span className={verify.ok ? 'ok-text' : 'warn-text'}>{verify.detail}</span>}
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="undo" /> Restore
          </h2>
        </header>
        {names.length === 0 ? (
          <p className="hint block">No backups in Drive yet.</p>
        ) : (
          <div className="row">
            <select value={restoreName} onChange={(e) => setRestoreName(e.target.value)} aria-label="Backup to restore">
              {names.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
            <input type="password" placeholder="Passphrase" value={restorePass} onChange={(e) => setRestorePass(e.target.value)} />
            <button className="btn danger" disabled={!restoreName || !restorePass} onClick={restore}>
              Restore
            </button>
          </div>
        )}
      </section>

      {prefs && (
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="bolt" /> Background
            </h2>
          </header>
          <label className="check toggle-row">
            <input type="checkbox" checked={prefs.keepInTray} onChange={(e) => changePrefs({ keepInTray: e.target.checked })} />
            <span>
              Keep running in the tray when the window is closed
              <small>Needed for block reminders. Quit from the tray icon.</small>
            </span>
          </label>
          <label className="check toggle-row">
            <input type="checkbox" checked={prefs.matchAppThemes} onChange={(e) => changePrefs({ matchAppThemes: e.target.checked })} />
            <span>
              Match the apps to Life System's look
              <small>Finance Helper, Waky and MAN use Life System's dark colors and fonts. Picking a theme inside an app overrides it for that app; switching this off and on brings Life System's look back.</small>
            </span>
          </label>
          <label className={`check toggle-row ${prefs.canAutoStart ? '' : 'muted'}`}>
            <input type="checkbox" disabled={!prefs.canAutoStart} checked={prefs.openAtLogin} onChange={(e) => changePrefs({ openAtLogin: e.target.checked })} />
            <span>
              Start with Windows
              <small>{prefs.canAutoStart ? 'Opens quietly when you sign in.' : 'Available once the app is installed (not in dev mode).'}</small>
            </span>
          </label>
        </section>
      )}

      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="lock" /> App lock
          </h2>
          <span className={`chip ${auth.pinSet ? 'ok' : ''}`}>{auth.pinSet ? 'PIN set' : 'No PIN'}</span>
        </header>
        <p className="hint block">The app locks on start, after 10 minutes idle, and when Windows locks or sleeps.</p>
        <div className="row">
          {auth.pinSet && <input type="password" inputMode="numeric" placeholder="Current PIN" value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))} />}
          <input type="password" inputMode="numeric" placeholder={auth.pinSet ? 'New PIN' : 'Choose a PIN (4-12 digits)'} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          <button className="btn primary" disabled={pin.length < 4} onClick={savePin}>
            {auth.pinSet ? 'Change PIN' : 'Set PIN'}
          </button>
        </div>
      </section>
    </div>
  )
}
