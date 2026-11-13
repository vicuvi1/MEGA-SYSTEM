// Settings → Data safety (2026-11-12): can your data be lost? One light per
// copy (cloud backup, backup on this PC, off-site copy) and for the last
// restore test, the size, "Export everything", "Restore from file", the
// backup folder, and "Undo to before X" for every backup made before a risky step.
import { useCallback, useEffect, useState } from 'react'
import { sizeText } from '@core/dataSafety'
import { askConfirm } from '../confirmSheet'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { useAction } from '../ui'
import { backupNow, testLocalRestore } from '../DesktopBackups'
import { backupTextOf, download, exportEverything } from './backupFiles'
import { listRiskPoints, readRiskPoint, type RiskPoint } from './riskPoints'
import { loadSafety, loadSql, onSafety, safetyChanged, type SafetyState } from './safetyState'

const DOT: Record<string, string> = { green: 'on', amber: 'idle', red: 'off' }

export function DataSafetyPanel() {
  const desk = typeof window !== 'undefined' ? window.desktop : undefined
  const act = useAction()
  const [s, setS] = useState<SafetyState | null>(null)
  const [points, setPoints] = useState<RiskPoint[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const reload = useCallback(() => {
    void loadSafety(true).then(setS).catch(() => {})
    void listRiskPoints().then(setPoints).catch(() => {})
  }, [])
  useEffect(() => {
    reload()
    return onSafety((x) => {
      setS(x)
      void listRiskPoints().then(setPoints).catch(() => {})
    })
  }, [reload])

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key)
    const out = await act(fn, done)
    setBusy(null)
    safetyChanged()
    return out
  }

  const backUp = () =>
    run(
      'backup',
      async () => {
        if (desk?.writeBackup) await backupNow()
        if (!(await life.data.saveDailySnapshot?.())) {
          if (!desk?.writeBackup) throw new Error('The cloud backup did not save: see the line above')
        }
      },
      desk?.writeBackup ? 'Backed up on this PC and in the cloud' : 'Backed up in the cloud'
    )

  const exportAll = () =>
    run(
      'export',
      async () => {
        const snap = JSON.parse(await life.data.exportJson())
        download(await exportEverything(snap), `life-system-everything-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip')
      },
      'Everything exported (one zip: CSV + JSON)'
    )

  const restoreText = async (text: string, what: string) => {
    if (!(await askConfirm(`Put back your data from ${what}? Everything changes to how it was then, on every device (your PIN and bot setup stay). A backup of today is saved first, so you can undo this.`))) return
    const ok = await run('restore', async () => {
      if (!life.data.restoreSnapshot) throw new Error('Restore is not available here')
      return life.data.restoreSnapshot(text)
    }, `Restored ${what}. Reloading…`)
    if (ok) setTimeout(() => window.location.reload(), 1200)
  }

  const fromFile = async (file: File | undefined) => {
    if (!file) return
    const text = await act(async () => backupTextOf(new Uint8Array(await file.arrayBuffer()), loadSql))
    if (text) await restoreText(text, file.name)
  }

  const undo = async (p: RiskPoint) => {
    const text = await act(async () => {
      const raw = await readRiskPoint(p)
      return typeof raw === 'string' ? raw : backupTextOf(raw, loadSql)
    })
    if (text) await restoreText(text, `before ${p.label} (${p.at.replace('T', ' ').slice(0, 16)})`)
  }

  const restoreFile = async (where: 'local' | 'drive' | 'old', name: string, day: string) => {
    if (!desk?.readBackup) return
    const text = await act(async () => backupTextOf(await desk.readBackup!(where, name), loadSql))
    if (text) await restoreText(text, day)
  }

  const restoreCloud = async (day: string) => {
    if (!(await askConfirm(`Put back your data from the cloud backup of ${day}? A backup of today is saved first, so you can undo this.`))) return
    const ok = await run('restore', async () => {
      if (!(await life.data.restoreCloudSnapshot?.(day))) throw new Error('That backup could not be restored')
      return true
    }, `Restored ${day}. Reloading…`)
    if (ok) setTimeout(() => window.location.reload(), 1200)
  }

  const [cloudDays, setCloudDays] = useState<{ day: string; sizeBytes: number }[]>([])
  useEffect(() => {
    void life.data.cloudSnapshots?.().then((l) => setCloudDays(l.slice(0, 8))).catch(() => {})
  }, [s?.at])

  const local = s?.local
  const daily = local ? [...local.local.files.filter((f) => f.kind === 'daily').map((f) => ({ ...f, where: 'local' as const })), ...local.old.files.map((f) => ({ ...f, where: 'old' as const }))].slice(0, 8) : []

  return (
    <section className="panel safety" data-testid="data-safety">
      <header className="panel-head">
        <h2>
          <Icon name="shield" /> Data safety
        </h2>
        {s && <span className={`chip ${s.red ? 'warn' : 'ok'}`} data-testid="safety-overall">{s.red ? 'Needs a look' : 'Your data is safe'}</span>}
      </header>
      <p className="muted bk-note">Your data lives in the cloud and is copied every day to a cloud backup, to a backup file on this PC (desktop app) and once a week to an encrypted off-site copy. Nothing is ever deleted: a restore saves a backup of today first.</p>
      <ul className="safety-rows">
        {(s?.rows ?? []).map((r) => (
          <li key={r.id} data-testid={`safety-row-${r.id}`} data-light={r.light}>
            <span className={`sporty-dot ${DOT[r.light]}`} aria-label={r.light} />
            <b>{r.label}</b>
            <span>{r.text}</span>
          </li>
        ))}
        {!s && <li className="muted">Checking…</li>}
      </ul>
      {s && (
        <p className="muted bk-note" data-testid="safety-size">
          Size: cloud backup {sizeText(s.cloud?.cloud.bytes) || 'unknown'}
          {s.cloud?.cloud.parts && s.cloud.cloud.parts > 1 ? ` in ${s.cloud.cloud.parts} parts` : ''}
          {local ? ` · backup on this PC ${sizeText(local.lastSize) || 'none yet'}` : ''}
        </p>
      )}
      <div className="bk-row">
        <button className="btn primary" disabled={!!busy} onClick={() => void backUp()}>
          {busy === 'backup' ? 'Backing up…' : 'Back up now'}
        </button>
        {desk?.writeBackup && (
          <button className="btn" disabled={!!busy} onClick={() => void run('drill', async () => { const r = await testLocalRestore(); if (r && !r.ok) throw new Error(r.msg); if (!r) throw new Error('No backup on this PC yet: back up first') }, 'Restore test passed: every table and app copy came back')}>
            {busy === 'drill' ? 'Testing…' : 'Test a restore'}
          </button>
        )}
        <button className="btn" disabled={!!busy} data-testid="export-everything" onClick={() => void exportAll()}>
          {busy === 'export' ? 'Exporting…' : 'Export everything'}
        </button>
        <label className={`btn ghost ${busy ? 'disabled' : ''}`} data-testid="restore-from-file">
          Restore from file
          <input type="file" accept=".zip,.json,application/zip,application/json" hidden disabled={!!busy} onChange={(e) => { void fromFile(e.target.files?.[0]); e.target.value = '' }} />
        </label>
      </div>

      {local && (
        <div className="bk-where">
          <div>
            <small>Backup folder on this PC</small>
            <b title={local.local.dir}>{local.local.dir}</b>
            <span>{local.local.files.length} files · 14 daily, 8 weekly, 12 monthly kept</span>
            <div className="bk-row">
              <button className="btn small" onClick={() => void desk!.openBackupFolder!('local')}>Open folder</button>
              <button className="btn small ghost" onClick={async () => { await desk!.chooseBackupFolder!('local'); safetyChanged() }}>Change</button>
              {local.local.chosen && <button className="btn small ghost" onClick={async () => { await desk!.resetBackupFolder?.(); safetyChanged() }}>Use Documents</button>}
            </div>
          </div>
          <div>
            <small>Copy in Google Drive</small>
            <b title={local.drive.dir ?? ''}>{local.drive.dir ?? 'Not found'}</b>
            <span>{local.drive.dir ? `${local.drive.files.length} files` : 'Install Google Drive for desktop, or choose its folder.'}</span>
            <div className="bk-row">
              {local.drive.dir && <button className="btn small" onClick={() => void desk!.openBackupFolder!('drive')}>Open folder</button>}
              <button className="btn small ghost" onClick={async () => { await desk!.chooseBackupFolder!('drive'); safetyChanged() }}>{local.drive.dir ? 'Change' : 'Choose folder'}</button>
            </div>
          </div>
        </div>
      )}

      <h3 className="safety-h">Undo to before…</h3>
      {points.length ? (
        <ul className="bk-list" data-testid="risk-points">
          {points.slice(0, 8).map((p) => (
            <li key={p.id}>
              <span>{p.at.replace('T', ' ').slice(0, 16)}</span>
              <small>before {p.label}{p.size ? ` · ${sizeText(p.size)}` : ''}</small>
              <button className="btn small ghost" disabled={!!busy} onClick={() => void undo(p)}>Undo to before {p.label}</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted bk-note">A backup is saved by itself before a restore, an import, a big delete or a big change of an app's data. It shows here with one-click undo.</p>
      )}

      {!!daily.length && (
        <>
          <h3 className="safety-h">Daily backups on this PC</h3>
          <ul className="bk-list">
            {daily.map((f) => (
              <li key={f.where + f.name}>
                <span>{f.day}</span>
                <small>{f.where === 'old' ? 'old folder' : 'this PC'} · {sizeText(f.size)}</small>
                <button className="btn small ghost" disabled={!!busy} onClick={() => void restoreFile(f.where, f.name, f.day)}>Restore</button>
              </li>
            ))}
          </ul>
        </>
      )}

      {!!cloudDays.length && (
        <>
          <h3 className="safety-h">Cloud backups (30 days kept)</h3>
          <ul className="bk-list" data-testid="cloud-backups">
            {cloudDays.map((c) => (
              <li key={c.day}>
                <span>{c.day}</span>
                <small>{sizeText(c.sizeBytes)}</small>
                <button className="btn small ghost" disabled={!!busy} onClick={() => void restoreCloud(c.day)}>Restore</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted bk-note">How to restore from each copy, even without the app: docs/RECOVERY.md.</p>
    </section>
  )
}
