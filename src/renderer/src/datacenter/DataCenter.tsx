// Data center (owner, 2026-11-18): one page for your data. How safe it is, how
// much room each place it lives in has left, how long that lasts at your pace,
// and the controls: back up, sync, restore, export, clean up, download.
// Backups, restore and the sync status moved here from Settings → Data safety
// (the same panels, not copies). Rules and numbers: core/dataCenter.ts.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { agoText, overviewLine, pctOf, sizeLabel, soonest, spanText, usedText, type Meter } from '@core/dataCenter'
import type { SyncHealth } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { PageTabs, TabPanel, usePageTab, type PageTab } from '../PageTabs'
import { DataSafetyPanel } from '../safety/DataSafetyPanel'
import { loadSafety, onSafety, type SafetyState } from '../safety/safetyState'
import { SyncFolderPanel } from '../safety/SyncFolderPanel'
import { BackupCheckRow } from '../settings/backups'
import { SyncPanel } from '../SyncPanel'
import { backUpEverywhere, clearBeforeRestore, clearCaches, downloadApp, downloadLife, historyPlan, pruneHistory, syncEverything, undoHistory, undoKeys, type HistoryUndo, type KeysUndo } from './actions'
import { DATA_APPS, gather, keepCache, type Gathered } from './usage'
import './dataCenter.css'

const TABS: PageTab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'space', label: 'Space' },
  { id: 'long', label: 'How long' },
  { id: 'backups', label: 'Backups' },
  { id: 'sync', label: 'Sync' },
  { id: 'clean', label: 'Clean up' }
]

function Bar({ m }: { m: Meter }) {
  const pct = pctOf(m)
  return (
    <li className="dc-meter" data-testid={`dc-meter-${m.id}`} data-level={m.level} data-used={Math.round(m.used)}>
      <div className="dc-meter-head">
        <b>{m.label}</b>
        <span>
          {usedText(m)}
          {m.limit ? ` · ${pct}%` : ''}
        </span>
      </div>
      {m.limit ? (
        <div className="dc-bar" role="img" aria-label={`${pct}% used`}>
          <i style={{ transform: `scaleX(${Math.max(0.004, pct / 100)})` }} />
          {m.warnAt != null && <u style={{ left: `${Math.min(100, (m.warnAt / m.limit) * 100)}%` }} title="Warning level" />}
        </div>
      ) : null}
      <small>
        {m.where}
        {m.note ? ` · ${m.note}` : ''}
      </small>
    </li>
  )
}

/** A clean-up or control with its confirmation in the page, what it frees, the result and Undo. */
function Control({ id, title, detail, button, confirm, disabled, run, undo }: { id: string; title: string; detail: ReactNode; button: string; confirm?: string; disabled?: string | null; run: () => Promise<string>; undo?: (() => Promise<string>) | null }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const go = async (fn: () => Promise<string>) => {
    setAsking(false)
    setBusy(true)
    try {
      setMsg({ ok: true, text: await fn() })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
    setBusy(false)
  }
  return (
    <li className="dc-control" data-testid={`dc-${id}`}>
      <div>
        <b>{title}</b>
        <small>{detail}</small>
        {msg && (
          <span className={`dc-result ${msg.ok ? '' : 'bad'}`} role="status" data-testid={`dc-${id}-result`}>
            {msg.text}
            {msg.ok && undo && (
              <button type="button" className="btn small ghost" data-testid={`dc-${id}-undo`} disabled={busy} onClick={() => void go(undo)}>
                Undo
              </button>
            )}
          </span>
        )}
        {asking && (
          <span className="dc-confirm" role="alertdialog" aria-label={confirm}>
            {confirm}
            <button type="button" className="btn small primary" data-testid={`dc-${id}-yes`} onClick={() => void go(run)}>
              Yes, go ahead
            </button>
            <button type="button" className="btn small ghost" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </span>
        )}
      </div>
      <button type="button" className="btn small" data-testid={`dc-${id}-go`} disabled={busy || asking || !!disabled} title={disabled ?? undefined} onClick={() => (confirm ? setAsking(true) : void go(run))}>
        {busy ? 'Working…' : button}
      </button>
    </li>
  )
}

/** Where there is no desktop app (the website): the Sync folder is a desktop feature, so only a note. */
function SyncFolderNote() {
  if (typeof window !== 'undefined' && window.desktop?.syncFolder) return null
  return (
    <section className="panel" data-testid="sync-folder-slot">
      <header className="panel-head">
        <h2>
          <Icon name="cloud" /> Sync folder
        </h2>
        <span className="chip ghost">Not set up</span>
      </header>
      <p className="muted bk-note">A live copy of all your data in a folder you choose (OneDrive, a USB drive…). It is part of the desktop app: open the Data center there to set it up.</p>
    </section>
  )
}

export function DataCenter({ onGo }: { onGo: (page: 'money') => void }) {
  const [tab, setTab] = usePageTab('data', TABS.map((t) => t.id), 'overview')
  const [g, setG] = useState<Gathered | null>(null)
  const [safety, setSafety] = useState<SafetyState | null>(null)
  const [health, setHealth] = useState<SyncHealth | null>(null)
  const [days, setDays] = useState(30)
  const [hist, setHist] = useState<{ drop: number; freed: number } | null>(null)
  const [histUndo, setHistUndo] = useState<HistoryUndo | null>(null)
  const [keysUndo, setKeysUndo] = useState<KeysUndo | null>(null)

  const reload = useCallback(async () => {
    void life.sync.health?.().then(setHealth).catch(() => {})
    setG(await gather().catch(() => null))
  }, [])
  useEffect(() => {
    void reload()
    void loadSafety().then(setSafety).catch(() => {})
    const off = onSafety(setSafety)
    const onSync = () => void life.sync.health?.().then(setHealth).catch(() => {})
    window.addEventListener('life-app-sync', onSync)
    return () => {
      off()
      window.removeEventListener('life-app-sync', onSync)
    }
  }, [reload])
  useEffect(() => {
    let live = true
    void historyPlan(days)
      .then((p) => live && setHist({ drop: p.drop.length, freed: p.freed }))
      .catch(() => live && setHist(null))
    return () => {
      live = false
    }
  }, [days, g?.at])

  const now = Date.now()
  const lastBackup = Math.max(safety?.local?.lastAt ? Date.parse(safety.local.lastAt) : 0, g?.cloud?.newestAt ? Date.parse(g.cloud.newestAt) : 0) || null
  const badApps = (health?.apps ?? []).filter((a) => a.state === 'error')
  const line = overviewLine({
    now,
    backupRed: safety?.red ? safety.rows.filter((r) => r.light === 'red').map((r) => r.label) : [],
    lastBackupAt: lastBackup,
    syncedAt: health?.syncedAt ? Date.parse(health.syncedAt) : null,
    syncTrouble: health?.error ?? (badApps.length ? `${badApps.map((a) => a.label).join(', ')} did not sync` : null),
    warnings: g?.warnings ?? []
  })
  const limited = (g?.meters ?? []).filter((m) => m.limit)
  const tightest = limited.slice().sort((a, b) => pctOf(b) - pctOf(a))[0] ?? null
  const first = g ? soonest(g.forecasts) : null
  const local = g?.meters.find((m) => m.id === 'local') ?? null
  const copies = (g?.desktop?.backupFiles ?? 0) + (g?.cloud?.days ?? 0)
  const clearable = (g?.caches ?? []).filter((c) => !keepCache(c.name))
  const cacheBytes = clearable.reduce((n, c) => n + c.bytes, 0)
  const brChars = (g?.beforeRestore ?? []).reduce((n, b) => n + b.chars, 0)

  return (
    <div className="dc" data-testid="data-center">
      <PageTabs page="data" label="Data center views" tabs={TABS.map((t) => (t.id === 'space' && g?.warnings.length ? { ...t, count: g.warnings.length } : t))} value={tab} onChange={setTab} />

      <TabPanel page="data" id="overview" value={tab}>
        <section className="panel">
          <p className={`dc-health ${line.level}`} data-testid="dc-health" data-level={g && safety ? line.level : 'loading'}>
            <span className={`sporty-dot ${line.level === 'ok' ? 'on' : line.level === 'warn' ? 'idle' : 'off'}`} aria-hidden="true" />
            {g ? line.text : 'Measuring your data…'}
          </p>
          <div className="dc-numbers" data-testid="dc-numbers">
            <div>
              <small>Closest to a limit</small>
              <b>{tightest ? `${pctOf(tightest)}%` : '…'}</b>
              <span>{tightest ? `${tightest.label}: ${usedText(tightest)}` : 'Measuring'}</span>
            </div>
            <div>
              <small>Enough for</small>
              <b data-testid="dc-enough">{!g ? '…' : first ? spanText(first.days!).replace(/^about /, '') : 'Years'}</b>
              <span>{!g ? 'Measuring' : first ? `${first.label} fills first (${first.when})` : 'No limit in sight at your pace'}</span>
            </div>
            <div>
              <small>This device</small>
              <b>{local ? `${pctOf(local)}%` : '…'}</b>
              <span>{local ? `App storage: ${usedText(local)}` : 'Measuring'}</span>
            </div>
            <div>
              <small>Backups</small>
              <b>{g && safety ? copies : '…'}</b>
              <span>{lastBackup ? `copies kept · newest ${agoText(lastBackup, now)}` : 'copies kept'}</span>
            </div>
          </div>
          <ul className="dc-controls">
            <Control id="backup" title="Back up now" detail="A full backup file on this PC (desktop app) and today's cloud backup." button="Back up now" run={backUpEverywhere} />
            <Control id="sync" title="Sync now" detail="Life's tables, then Money, Sport Track, Waky and MAN compare with the cloud and send what is missing." button="Sync now" run={() => syncEverything().finally(() => void reload())} />
          </ul>
          <p className="muted bk-note">
            Restore, export everything and the backup check are in <button type="button" className="dc-link" onClick={() => setTab('backups')}>Backups</button>. What may be removed safely is in <button type="button" className="dc-link" onClick={() => setTab('clean')}>Clean up</button>.
          </p>
        </section>
      </TabPanel>

      <TabPanel page="data" id="space" value={tab}>
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="chart" /> Space
            </h2>
            <span className="hint small">Amber at the warning mark, red when nearly full</span>
          </header>
          <ul className="dc-meters" data-testid="dc-meters">
            {(g?.meters ?? []).map((m) => (
              <Bar key={m.id} m={m} />
            ))}
            {!g && <li className="muted">Measuring…</li>}
          </ul>
          {g && (
            <details className="dc-more">
              <summary>What takes the room</summary>
              <div className="dc-cols">
                <div>
                  <small>App storage on this device</small>
                  <ul>
                    {g.local.keys.slice(0, 7).map((k) => (
                      <li key={k.key} title={k.key}>
                        <span>{k.label}</span>
                        <b>{sizeLabel(k.chars)}</b>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <small>Biggest tables</small>
                  <ul>
                    {(g.db?.tables ?? []).slice(0, 7).map((t) => (
                      <li key={t.name}>
                        <span>
                          {t.name} · {t.rows.toLocaleString('en-US')} rows
                        </span>
                        <b>{sizeLabel(t.bytes)}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </details>
          )}
        </section>
      </TabPanel>

      <TabPanel page="data" id="long" value={tab}>
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="clock" /> How long is it enough
            </h2>
          </header>
          <ul className="dc-forecasts" data-testid="dc-forecasts">
            {(g?.forecasts ?? []).map((f) => (
              <li key={f.id} data-level={f.level} data-testid={`dc-forecast-${f.id}`}>
                <span>{f.text}</span>
                {f.assumption && <small>Based on: {f.assumption}</small>}
              </li>
            ))}
            {!g && <li className="muted">Measuring…</li>}
          </ul>
          <p className="muted bk-note">These are estimates on the careful side: the fastest growth seen is used, the date is rounded down, and the limit is the careful one (48 MB for an app's synced copy, the size it is tested at; 4.5 MB for any other single setting; about 5 million characters of app storage; 5 GB of cloud database on the free plan). This page takes one size sample a day, so the estimate gets better with time.</p>
        </section>
      </TabPanel>

      <TabPanel page="data" id="backups" value={tab}>
        <DataSafetyPanel />
        <BackupCheckRow />
      </TabPanel>

      <TabPanel page="data" id="sync" value={tab}>
        <SyncPanel />
        <SyncFolderPanel />
        <SyncFolderNote />
      </TabPanel>

      <TabPanel page="data" id="clean" value={tab}>
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="trash" /> Clean up
            </h2>
            <span className="hint small">Nothing here removes your records</span>
          </header>
          <ul className="dc-controls">
            <Control
              id="history"
              title="Money change history"
              detail={
                <>
                  {g?.history?.sealed ? 'Locked with the Money PIN: open Money to manage it.' : `${g?.history?.entries ?? 0} entries on this device (${sizeLabel(g?.history?.bytes ?? 0)}). Remove entries older than `}
                  {!g?.history?.sealed && (
                    <select aria-label="Days of history to keep" data-testid="dc-history-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                      {[7, 30, 60].map((d) => (
                        <option key={d} value={d}>
                          {d} days
                        </option>
                      ))}
                    </select>
                  )}
                  {!g?.history?.sealed && hist ? `: frees ${sizeLabel(hist.freed)} (${hist.drop} entries). Your records stay; only the list of old changes gets shorter.` : ''}
                </>
              }
              button="Remove old entries"
              confirm={`Remove ${hist?.drop ?? 0} change-history entries older than ${days} days from this device? Your Money records are not touched. You can undo this until you leave the page.`}
              disabled={g?.history?.sealed ? 'Money is locked' : !hist?.drop ? 'Nothing that old' : null}
              run={async () => {
                const u = await pruneHistory(days)
                setHistUndo(u)
                void reload()
                return `Removed ${u.dropped.length} entries (${sizeLabel(u.freed)} freed).`
              }}
              undo={
                histUndo?.dropped.length
                  ? async () => {
                      await undoHistory(histUndo)
                      setHistUndo(null)
                      void reload()
                      return 'The entries are back.'
                    }
                  : null
              }
            />
            <Control
              id="before-restore"
              title="Copy from before a restore"
              detail={g?.beforeRestore.length ? `${g.beforeRestore.map((b) => `${b.label}${b.at ? ` (${b.at.slice(0, 10)})` : ''}`).join(', ')}: frees ${sizeLabel(brChars)} of app storage. Kept after a restore so nothing was lost; safe to clear once the restored data looks right.` : 'None on this device.'}
              button="Clear the copy"
              confirm="Clear the copy kept from before the last restore? A full backup with this copy inside is saved first, and you can undo this until you leave the page."
              disabled={g?.beforeRestore.length ? null : 'Nothing to clear'}
              run={async () => {
                const u = await clearBeforeRestore((g?.beforeRestore ?? []).map((b) => b.key))
                setKeysUndo(u)
                void reload()
                return `Cleared (${sizeLabel(u.chars)} freed). Backup saved first: ${u.backup}.`
              }}
              undo={
                keysUndo && Object.keys(keysUndo.values).length
                  ? async () => {
                      undoKeys(keysUndo)
                      setKeysUndo(null)
                      void reload()
                      return 'The copy is back.'
                    }
                  : null
              }
            />
            <Control
              id="caches"
              title="App caches"
              detail={clearable.length ? `${clearable.length} cache${clearable.length === 1 ? '' : 's'} of app files: frees ${sizeLabel(cacheBytes)}. They download again when needed. Voice models you downloaded stay.` : 'No app caches on this device.'}
              button="Clear caches"
              confirm="Clear the app's file caches? No data is removed; the files download again when needed (the app may start a little slower once)."
              disabled={clearable.length ? null : 'Nothing to clear'}
              run={async () => {
                const n = await clearCaches()
                void reload()
                return `Cleared ${n} cache${n === 1 ? '' : 's'} (${sizeLabel(cacheBytes)} freed).`
              }}
            />
            <li className="dc-control" data-testid="dc-tombstones">
              <div>
                <b>Old deletion marks</b>
                <small>
                  Money remembers {g?.tombstones.count ?? 0} deleted records ({sizeLabel(g?.tombstones.bytes ?? 0)}) so a deleted record never comes back from another device; {g?.tombstones.old ?? 0} are older than 90 days. {g?.tombstones.plan.reason} They are kept: dropping one is only safe when every device has synced since, and they are tiny.
                </small>
              </div>
            </li>
            <li className="dc-control" data-testid="dc-archive">
              <div>
                <b>Archive old years</b>
                <small>In Money → Settings. It makes Money's lists shorter and faster; archived records stay in your data, so it does not free space.</small>
              </div>
              <button type="button" className="btn small" onClick={() => onGo('money')}>
                Open Money
              </button>
            </li>
          </ul>
        </section>
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="cloud" /> Download an app's data
            </h2>
            <span className="hint small">A JSON file of what this device holds</span>
          </header>
          <div className="bk-row" data-testid="dc-downloads">
            {DATA_APPS.map((a) => (
              <DownloadButton key={a.setting} label={a.label} run={async () => downloadApp(a.setting)} />
            ))}
            <DownloadButton label="Life tables" run={downloadLife} />
          </div>
        </section>
      </TabPanel>
    </div>
  )
}

function DownloadButton({ label, run }: { label: string; run: () => Promise<string> }) {
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <span className="dc-dl">
      <button
        type="button"
        className="btn small ghost"
        onClick={() =>
          void run()
            .then(setMsg)
            .catch((e: Error) => setMsg(e.message))
        }
      >
        {label}
      </button>
      {msg && <small role="status">{msg}</small>}
    </span>
  )
}

export default DataCenter
