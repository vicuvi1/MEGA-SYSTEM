function downloadBlob(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

import { useEffect, useState } from 'react'
import type { AppPrefs, AuthStatus, BackupStatus, LogEntry, TelegramConfig, UpdateStatus, VerifyResult, AIConfig } from '@shared/api'
import { POPULAR_MODELS, DEFAULT_AI_CONFIG } from '@core/ai'
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
  const [logs, setLogs] = useState<LogEntry[] | null>(null)
  const [tg, setTg] = useState<TelegramConfig>({ botToken: '', chatId: '', enabled: false, morningBriefing: true, eveningNudge: true })
  const [testingTg, setTestingTg] = useState(false)

  useEffect(() => {
    life.telegram.config().then(setTg).catch(() => {})
  }, [])

  async function saveTg(patch: Partial<TelegramConfig>) {
    const next = await act(() => life.telegram.saveConfig(patch), 'Telegram settings saved')
    if (next) setTg(next)
  }

  async function testTg() {
    setTestingTg(true)
    const res = await act(() => life.telegram.test(), 'Test message sent to Telegram!')
    setTestingTg(false)
  }

  const [aiCfg, setAiCfg] = useState<AIConfig>(DEFAULT_AI_CONFIG)
  const [showGemini, setShowGemini] = useState(false)
  const [showOr, setShowOr] = useState(false)
  const [testingProvider, setTestingProvider] = useState<string | null>(null)
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; message: string; model: string } | null>(null)

  useEffect(() => {
    life.ai.config().then(setAiCfg).catch(() => {})
  }, [])

  async function saveAiConfig() {
    const next = await act(() => life.ai.saveConfig(aiCfg), 'AI configuration saved')
    if (next) setAiCfg(next)
  }

  async function testAiConnection(provider?: 'gemini' | 'openrouter') {
    setTestingProvider(provider || 'auto')
    setAiTestResult(null)
    try {
      const res = await life.ai.test(provider)
      setAiTestResult(res)
    } catch (err: any) {
      setAiTestResult({ ok: false, message: err?.message || 'Connection failed', model: 'none' })
    } finally {
      setTestingProvider(null)
    }
  }


  useEffect(() => {
    life.app.recentErrors().then(setLogs).catch(() => setLogs([]))
  }, [])

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
            <Icon name="spark" /> AI Intelligence & Multi-Model Oracle
          </h2>
          <span className={`chip ${aiCfg.enabled && (aiCfg.geminiKey || aiCfg.openRouterKey) ? 'ok' : 'muted'}`}>
            {aiCfg.enabled && (aiCfg.geminiKey || aiCfg.openRouterKey) ? 'Oracle Active' : 'Not Configured'}
          </span>
        </header>
        <p className="hint block">
          Connect Google Gemini (official free API keys) or OpenRouter (DeepSeek V3/R1, Claude, GPT) to unlock AI dream reward generation, Solo Leveling performance reports, and tactical coaching.
        </p>

        <div className="field">
          <span>Official Google Gemini API Key (Free)</span>
          <div className="row">
            <input
              type={showGemini ? 'text' : 'password'}
              placeholder="AIzaSy..."
              value={aiCfg.geminiKey}
              onChange={(e) => setAiCfg({ ...aiCfg, geminiKey: e.target.value })}
            />
            <button className="btn ghost" type="button" onClick={() => setShowGemini(!showGemini)}>
              {showGemini ? 'Hide' : 'Show'}
            </button>
            <button
              className="btn"
              type="button"
              disabled={!aiCfg.geminiKey || testingProvider === 'gemini'}
              onClick={() => testAiConnection('gemini')}
            >
              {testingProvider === 'gemini' ? 'Testing...' : 'Test Gemini'}
            </button>
          </div>
          <small className="hint">
            Get a free key instantly from <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer">Google AI Studio</a>. Free models: Gemini 2.5 Flash, 2.0 Flash, 1.5 Pro.
          </small>
        </div>

        <div className="field">
          <span>OpenRouter API Key (DeepSeek V3 / DeepSeek R1 / Claude / GPT)</span>
          <div className="row">
            <input
              type={showOr ? 'text' : 'password'}
              placeholder="sk-or-v1-..."
              value={aiCfg.openRouterKey}
              onChange={(e) => setAiCfg({ ...aiCfg, openRouterKey: e.target.value })}
            />
            <button className="btn ghost" type="button" onClick={() => setShowOr(!showOr)}>
              {showOr ? 'Hide' : 'Show'}
            </button>
            <button
              className="btn"
              type="button"
              disabled={!aiCfg.openRouterKey || testingProvider === 'openrouter'}
              onClick={() => testAiConnection('openrouter')}
            >
              {testingProvider === 'openrouter' ? 'Testing...' : 'Test OpenRouter'}
            </button>
          </div>
          <small className="hint">
            Connect to openrouter.ai to access DeepSeek V3, DeepSeek R1 reasoning models, and 100+ open models.
          </small>
        </div>

        <div className="field">
          <span>Model Routing Strategy</span>
          <select
            value={aiCfg.selectedModel}
            onChange={(e) => setAiCfg({ ...aiCfg, selectedModel: e.target.value })}
          >
            <option value="auto">⚡ Auto (Smart Task Routing: Flash for rewards, DeepSeek R1/Pro for strategy)</option>
            <optgroup label="Official Google Gemini (Direct / Free)">
              {POPULAR_MODELS.filter((m) => m.provider === 'gemini').map((m) => (
                <option key={m.model} value={m.model}>{m.label}</option>
              ))}
            </optgroup>
            <optgroup label="OpenRouter Models">
              {POPULAR_MODELS.filter((m) => m.provider === 'openrouter').map((m) => (
                <option key={m.model} value={m.model}>{m.label}</option>
              ))}
            </optgroup>
          </select>
        </div>

        <label className="check toggle-row">
          <input
            type="checkbox"
            checked={aiCfg.enabled}
            onChange={(e) => setAiCfg({ ...aiCfg, enabled: e.target.checked })}
          />
          <span>
            Enable AI Systems
            <small>Allows the Shop to summon dream reward ideas and Journey to compile Solo Leveling tactical reports.</small>
          </span>
        </label>

        {aiTestResult && (
          <div className={`notice ${aiTestResult.ok ? 'ok' : 'warn'}`} style={{ margin: '0.75rem 0', padding: '0.6rem 0.8rem', borderRadius: '6px', fontSize: '0.85rem' }}>
            <b>{aiTestResult.ok ? '✅ Connection Verified:' : '❌ Connection Problem:'}</b>{' '}
            {aiTestResult.message} {aiTestResult.model ? `(${aiTestResult.model})` : ''}
          </div>
        )}

        <div className="row" style={{ marginTop: '0.5rem' }}>
          <button className="btn primary" onClick={saveAiConfig}>
            Save AI Configuration
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={(!aiCfg.geminiKey && !aiCfg.openRouterKey) || testingProvider !== null}
            onClick={() => testAiConnection()}
          >
            {testingProvider === 'auto' ? 'Testing...' : 'Test Active Auto-Route'}
          </button>
        </div>
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
          <button className="btn" onClick={() => life.app.openLogs()}>
            Open log folder
          </button>
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
