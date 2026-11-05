// Settings → backups (LT11: split out of pages/Settings.tsx; the state lives in useSettingsState).
import { askConfirm } from '../confirmSheet'
import { features, life } from '../bridge'
import { DesktopBackupPanel } from '../DesktopBackups'
import { Icon } from '../Icon'
import { SyncPanel } from '../SyncPanel'
import { timeAgo } from '../ui'
import { soundSuccess } from '../sound'
import type { SettingsState } from './useSettingsState'

export function BackupsSection({ s }: { s: SettingsState }) {
  const { logs, backupFolderName, backupSchedule, setBackupSchedule, cloudSnapshots, lastBackupTime, backupStatusMsg, setBackupStatusMsg, syncCfg, setSyncCfg, syncTestMsg, syncingNow, showSyncSecret, setShowSyncSecret, syncInstructionsOpen, setSyncInstructionsOpen, saveSyncConfig, testSyncConnection, pullSyncNow, handleDownloadBackupFile, handleSelectFolder, handleSaveBackupNow, handleFileRestore } = s
  return (
        <>
      <SyncPanel />
      <DesktopBackupPanel />
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="cloud" /> Data Safety & Automated Regular Backups
          </h2>
          <span className="chip ok">☁️ Turso Cloud Sync: Active</span>
        </header>

        <p className="hint block">
          Your life operating data is critical. Everything is backed up continuously to your Turso Cloud database.
          You can select a dedicated local folder on your PC (or your cloud drive folder) where automated full timestamped backups are saved regularly.
        </p>

        <dl className="facts">
          <dt>Cloud Database</dt>
          <dd className="mono">libsql://life-os-vicuvi1.aws-eu-central-1.turso.io</dd>

          <dt>Local Backup Folder</dt>
          <dd>
            {backupFolderName ? (
              <span className="ok-text" style={{ fontWeight: 600 }}>📁 {backupFolderName}</span>
            ) : (
              <span className="muted">No folder selected yet</span>
            )}
          </dd>

          <dt>Auto-Backup Schedule</dt>
          <dd>
            <select
              value={backupSchedule}
              onChange={(e) => {
                setBackupSchedule(e.target.value)
                localStorage.setItem('life_backup_schedule', e.target.value)
              }}
              style={{ width: 'auto', display: 'inline-block', padding: '4px 10px', fontSize: '13px' }}
            >
              <option value="daily">Every 24 Hours (Daily)</option>
              <option value="12h">Every 12 Hours</option>
              <option value="session">Every Session (On Open)</option>
              <option value="manual">Manual Only</option>
            </select>
          </dd>

          <dt>Last Full Snapshot</dt>
          <dd>{lastBackupTime ? `${timeAgo(lastBackupTime)} (${new Date(lastBackupTime).toLocaleTimeString()})` : 'Ready to create'}</dd>
        </dl>

        <div className="row" style={{ flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
          <button className="btn primary" onClick={handleSelectFolder}>
            📁 {backupFolderName ? 'Change Backup Folder' : 'Select Backup Folder on PC'}
          </button>

          <button className="btn" onClick={handleSaveBackupNow}>
            ⚡ Back Up Now
          </button>

          <button className="btn ghost" onClick={handleDownloadBackupFile}>
            💾 Download Backup (.json)
          </button>

          <label className="btn ghost" style={{ cursor: 'pointer', margin: 0, display: 'inline-flex', alignItems: 'center' }}>
            📥 Restore from Backup File
            <input
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleFileRestore}
            />
          </label>
        </div>

        {backupStatusMsg && (
          <div style={{ marginTop: '12px', padding: '8px 12px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid #22c55e', borderRadius: '6px', color: '#22c55e', fontSize: '13px' }}>
            {backupStatusMsg}
          </div>
        )}

        {cloudSnapshots.length > 0 && (
          <div style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '14px' }}>
            <h3 style={{ fontSize: '13px', margin: '0 0 8px', color: '#c8f135', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>☁️</span> 30-Day Automated Cloud Snapshot Vault
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
              {cloudSnapshots.map((snap) => (
                <div key={snap.day} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: '6px', fontSize: '12px' }}>
                  <span><b>{snap.day}</b> <span className="muted">({Math.round(snap.sizeBytes / 1024)} KB · {timeAgo(snap.exportedAt)})</span></span>
                  <button
                    className="btn small ghost"
                    style={{ fontSize: '11px', padding: '3px 8px' }}
                    onClick={async () => {
                      if (!await askConfirm(`Restore entire system state to ${snap.day}? A full snapshot is restored across all 4 apps.`)) return
                      const ok = await life.data.restoreCloudSnapshot?.(snap.day)
                      if (ok) {
                        setBackupStatusMsg(`🎉 Successfully restored cloud snapshot for ${snap.day}! Reloading...`)
                        soundSuccess()
                        setTimeout(() => window.location.reload(), 1200)
                      }
                    }}
                  >
                    Restore This Day
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
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
