// Settings → Data safety (LT11: split out of pages/Settings.tsx; the state lives in useSettingsState).
// The backups, restore and export live in safety/DataSafetyPanel.tsx (2026-11-12).
import { useEffect, useState } from 'react'
import { features } from '../bridge'
import { checkLine } from '@core/weeklyBackupCheck'
import { checkBackupNow, readWeeklyCheck } from '../safety/weeklyCheck'
import { onSafety } from '../safety/safetyState'
import { DataSafetyPanel } from '../safety/DataSafetyPanel'
import { Icon } from '../Icon'
import { SyncPanel } from '../SyncPanel'
import { timeAgo } from '../ui'
import type { SettingsState } from './useSettingsState'

/** Desktop only: "Last backup check: 10 Nov · OK (backup from 9 Nov, 4,210 rows)" and a Check now button. */
function BackupCheckRow() {
  const desk = typeof window !== 'undefined' ? window.desktop : undefined
  const [note, setNote] = useState(readWeeklyCheck)
  const [busy, setBusy] = useState(false)
  useEffect(() => onSafety(() => setNote(readWeeklyCheck())), [])
  if (!desk?.readBackup) return null
  const bad = note?.state === 'failed'
  return (
    <section className="panel" data-testid="backup-check">
      <p className={`bk-note ${bad ? 'warn' : 'muted'}`} data-testid="backup-check-line" data-state={note?.state ?? 'none'}>
        {checkLine(note, note?.day)}
      </p>
      <div className="bk-row">
        <button
          className="btn"
          data-testid="backup-check-now"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void checkBackupNow()
              .catch(() => null)
              .finally(() => {
                setNote(readWeeklyCheck())
                setBusy(false)
              })
          }}
        >
          {busy ? 'Checking…' : 'Check now'}
        </button>
      </div>
    </section>
  )
}

export function BackupsSection({ s }: { s: SettingsState }) {
  const { syncCfg, setSyncCfg, syncTestMsg, syncingNow, showSyncSecret, setShowSyncSecret, syncInstructionsOpen, setSyncInstructionsOpen, saveSyncConfig, testSyncConnection, pullSyncNow } = s
  return (
        <>
      <DataSafetyPanel />
      <BackupCheckRow />
      <SyncPanel />
      {features.cloudflareSync && (
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="cloud" /> 24/7 Mobile Cloud Sync & Telegram Buffer
          </h2>
          <span className={`chip ${syncCfg.syncUrl ? 'ok' : 'ghost'}`}>
            {syncCfg.syncUrl ? 'Buffer Connected' : 'Setup Required'}
          </span>
        </header>

        <p className="hint block">
          Keep your streaks alive 24/7 even when your PC is off! Log habits, tasks, workouts, and expenses from your phone via Telegram, buffered in Cloudflare KV, and auto-synced to your PC on boot.
        </p>

        <div className="field">
          <span>Cloudflare Worker Sync URL</span>
          <input
            type="url"
            placeholder="https://life-system-sync.yourname.workers.dev"
            value={syncCfg.syncUrl}
            onChange={(e) => setSyncCfg({ ...syncCfg, syncUrl: e.target.value })}
          />
          <small className="hint">
            The public URL of your deployed 24/7 Cloudflare Worker.
          </small>
        </div>

        <div className="field">
          <span>Sync Secret Token</span>
          <div className="row" style={{ gap: '0.5rem' }}>
            <input
              type={showSyncSecret ? 'text' : 'password'}
              placeholder="Enter secret token"
              value={syncCfg.syncSecret}
              style={{ flex: 1 }}
              onChange={(e) => setSyncCfg({ ...syncCfg, syncSecret: e.target.value })}
            />
            <button
              type="button"
              className="btn ghost"
              onClick={() => setShowSyncSecret(!showSyncSecret)}
              style={{ padding: '0.4rem 0.8rem' }}
            >
              {showSyncSecret ? 'Hide' : 'Show'}
            </button>
          </div>
          <small className="hint">
            Bearer authentication token protecting your sync endpoint from unauthorized access.
          </small>
        </div>

        <div className="row" style={{ gap: '1.5rem', flexWrap: 'wrap' }}>
          <label className="check toggle-row" style={{ flex: 1, minWidth: '240px' }}>
            <input
              type="checkbox"
              checked={syncCfg.autoSyncOnStartup}
              onChange={(e) => setSyncCfg({ ...syncCfg, autoSyncOnStartup: e.target.checked })}
            />
            <span>
              Auto-Sync On PC Startup
              <small>Instantly pulls missed mobile logs and heals your streak whenever Life System launches.</small>
            </span>
          </label>

          <div className="field" style={{ minWidth: '160px' }}>
            <span>Auto-Sync Interval (minutes)</span>
            <input
              type="number"
              min={1}
              max={120}
              value={syncCfg.syncIntervalMinutes}
              onChange={(e) => setSyncCfg({ ...syncCfg, syncIntervalMinutes: Math.max(1, parseInt(e.target.value, 10) || 15) })}
            />
          </div>
        </div>

        {syncCfg.lastSyncedAt && (
          <dl className="facts" style={{ margin: '0.75rem 0' }}>
            <dt>Last Synced</dt>
            <dd>{timeAgo(syncCfg.lastSyncedAt)}</dd>
            <dt>Last Sync Volume</dt>
            <dd>{syncCfg.lastSyncedCount} events applied</dd>
          </dl>
        )}

        {syncTestMsg && (
          <div
            className={`notice ${syncTestMsg.ok ? 'ok' : 'warn'}`}
            style={{ margin: '0.75rem 0', padding: '0.6rem 0.8rem', borderRadius: '6px', fontSize: '0.85rem' }}
          >
            {syncTestMsg.ok ? '✅ ' : '❌ '} {syncTestMsg.message}
          </div>
        )}

        <div className="row" style={{ marginTop: '0.5rem', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={saveSyncConfig}>
            Save Sync Settings
          </button>
          <button
            className="btn ghost"
            disabled={!syncCfg.syncUrl}
            onClick={testSyncConnection}
          >
            Test Connection
          </button>
          <button
            className="btn ghost"
            disabled={!syncCfg.syncUrl || syncingNow}
            onClick={pullSyncNow}
          >
            {syncingNow ? 'Syncing...' : 'Sync Now (Heal Streaks)'}
          </button>
        </div>

        <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.75rem' }}>
          <button
            type="button"
            className="btn ghost"
            style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
            onClick={() => setSyncInstructionsOpen(!syncInstructionsOpen)}
          >
            {syncInstructionsOpen ? '▲ Hide 3-Minute Cloudflare Setup Guide' : '▼ View 3-Minute Cloudflare Setup Guide'}
          </button>

          {syncInstructionsOpen && (
            <div style={{ marginTop: '0.75rem', fontSize: '0.82rem', lineHeight: '1.5', background: 'rgba(0,0,0,0.3)', padding: '0.75rem', borderRadius: '6px' }}>
              <p style={{ margin: '0 0 0.5rem 0' }}><b>Quick 3-step setup (100% Free forever):</b></p>
              <ol style={{ paddingLeft: '1.2rem', margin: 0 }}>
                <li>In project folder <code>cloud/</code>, deploy the worker using <code>npx wrangler deploy</code> (or paste <code>cloud/worker.ts</code> into your Cloudflare dashboard).</li>
                <li>Link your Telegram Bot Webhook: open <code>https://api.telegram.org/bot&lt;BOT_TOKEN&gt;/setWebhook?url=&lt;WORKER_URL&gt;/webhook</code> in your browser.</li>
                <li>Copy the Worker URL &amp; Secret into this panel, click <b>Test Connection</b>, and you are ready! You can now message <code>/checkin</code>, <code>35 coffee</code>, or <code>/done 1</code> from your phone anytime.</li>
              </ol>
            </div>
          )}
        </div>
      </section>
      )}
        </>
  )
}
