// Desktop: a backup file every day, on its own (PC folder + Google Drive), and
// Settings → Backups on this PC to see them, back up now, and restore one.
import { useCallback, useEffect, useState } from 'react'
import type { BackupStatus, BackupWhere } from '../../desktop/backups'
import { life } from './bridge'
import { Icon } from './Icon'
import { timeAgo, useAction } from './ui'

const localDay = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function backupNow(): Promise<BackupStatus | null> {
  const desk = window.desktop
  if (!desk?.writeBackup) return null
  try {
    const text = await life.data.exportJson()
    const s = await desk.writeBackup(text, localDay())
    void life.system?.beat('desktopBackup', !s.lastError, s.lastError ?? undefined).catch(() => {})
    return s
  } catch (e) {
    void life.system?.beat('desktopBackup', false, (e as Error).message).catch(() => {})
    throw e
  }
}

/** Headless: today's backup once the data is there, then checks every hour. */
export function DesktopAutoBackup() {
  useEffect(() => {
    const desk = window.desktop
    if (!desk?.backupStatus) return
    let busy = false
    const run = async () => {
      if (busy) return
      busy = true
      try {
        const s = await desk.backupStatus!()
        if (s.lastDay !== localDay()) await backupNow()
      } catch {
        /* locked or still loading: the next run tries again */
      } finally {
        busy = false
      }
    }
    const first = window.setTimeout(run, 45_000)
    const t = window.setInterval(run, 60 * 60_000)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [])
  return null
}

const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

export function DesktopBackupPanel() {
  const desk = window.desktop
  const act = useAction()
  const [s, setS] = useState<BackupStatus | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const load = useCallback(() => {
    desk?.backupStatus?.().then(setS).catch(() => {})
  }, [desk])
  useEffect(load, [load])
  if (!desk?.backupStatus || !s) return null

  const restore = async (where: BackupWhere, name: string, day: string) => {
    if (!window.confirm(`Put back your data from ${day}? Everything changes to how it was then, on every device (your PIN and bot setup stay). Today's backup is saved first.`)) return
    setRestoring(name)
    const ok = await act(async () => {
      await backupNow()
      const text = await desk.readBackup!(where, name)
      return life.data.restoreSnapshot!(text)
    }, `Restored ${day}. Reloading…`)
    setRestoring(null)
    if (ok) setTimeout(() => window.location.reload(), 1200)
  }

  const recent = [...s.local.files.map((f) => ({ ...f, where: 'local' as const })), ...s.drive.files.filter((f) => !s.local.files.some((l) => l.name === f.name)).map((f) => ({ ...f, where: 'drive' as const }))].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 8)

  return (
    <section className="panel bk-panel">
      <header className="panel-head">
        <h2>
          <Icon name="shield" /> Backups on this PC
        </h2>
        <span className={`sporty-dot ${s.lastError ? 'idle' : s.lastDay === localDay() ? 'on' : 'off'}`}>{s.lastError ? 'Needs a look' : s.lastDay === localDay() ? 'Backed up today' : 'Not yet today'}</span>
      </header>
      <p className="muted bk-note">A backup file every day on its own: the last 30 days, plus the first of each month for a year. Your data also stays in the cloud (main copy) with 30 daily snapshots.</p>
      <div className="bk-where">
        <div>
          <small>This PC</small>
          <b title={s.local.dir}>{s.local.dir}</b>
          <span>{s.local.files.length} files{s.lastAt ? ` · last ${timeAgo(s.lastAt)}` : ''}</span>
          <button className="btn small" onClick={() => void desk.openBackupFolder!('local')}>Open folder</button>
        </div>
        <div>
          <small>Google Drive</small>
          {s.drive.dir ? (
            <>
              <b title={s.drive.dir}>{s.drive.dir}</b>
              <span>{s.drive.files.length} files</span>
            </>
          ) : (
            <>
              <b>Not found</b>
              <span>Install Google Drive for desktop, or choose its folder.</span>
            </>
          )}
          <div className="bk-row">
            {s.drive.dir && <button className="btn small" onClick={() => void desk.openBackupFolder!('drive')}>Open folder</button>}
            <button className="btn small ghost" onClick={async () => setS(await desk.chooseBackupFolder!())}>{s.drive.dir ? 'Change' : 'Choose folder'}</button>
          </div>
        </div>
      </div>
      {s.lastError && <p className="bk-error">{s.lastError}</p>}
      <div className="bk-row">
        <button className="btn primary" onClick={async () => { const r = await act(() => backupNow(), 'Backed up'); if (r) setS(r) }}>
          Back up now
        </button>
      </div>
      {!!recent.length && (
        <ul className="bk-list">
          {recent.map((f) => (
            <li key={f.where + f.name}>
              <span>{f.day}</span>
              <small>
                {f.where === 'drive' ? 'Google Drive' : 'This PC'} · {size(f.size)}
              </small>
              <button className="btn small ghost" disabled={!!restoring} onClick={() => void restore(f.where, f.name, f.day)}>
                {restoring === f.name ? 'Restoring…' : 'Restore'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
