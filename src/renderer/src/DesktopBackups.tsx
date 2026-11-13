// Desktop: a full backup .zip every day on its own (offline, in the backup
// folder, plus Google Drive when found), a restore test of it once a day, and
// one of the day's 4 notifications when something about your backups is red
// (2026-11-12), and a weekly check of the newest backup file (2026-11-13). Settings → Data safety shows it all (safety/DataSafetyPanel.tsx).
import { useEffect } from 'react'
import type { BackupStatus } from '../../desktop/localBackups'
import { life } from './bridge'
import { calendarDay } from '@core/dates'
import { slotNotifId } from '@core/notifyBudget'
import { backupTextOf } from './safety/backupFiles'
import { loadSafety, loadSql, readLocalDrill, safetyChanged, saveLocalDrill } from './safety/safetyState'
import { restoreDrill } from './web/restoreDrill'
import { weeklyCheckIfDue } from './safety/weeklyCheck'

const localDay = () => calendarDay(new Date())

/** Writes a full backup now: the daily one, or one before a risky step (`reason`). */
export async function backupNow(reason?: string): Promise<BackupStatus | null> {
  const desk = window.desktop
  if (!desk?.writeBackup) return null
  try {
    const text = await life.data.exportJson()
    const s = await desk.writeBackup(text, localDay(), reason ?? null)
    void life.system?.beat('desktopBackup', !s.lastError, s.lastError ?? undefined).catch(() => {})
    return s
  } catch (e) {
    void life.system?.beat('desktopBackup', false, (e as Error).message).catch(() => {})
    throw e
  } finally {
    safetyChanged()
  }
}

/** Puts the newest local backup back into an empty test database and checks every table and app copy. */
export async function testLocalRestore(): Promise<{ ok: boolean; msg: string } | null> {
  const desk = window.desktop
  if (!desk?.backupStatus || !desk.readBackup) return null
  const s = await desk.backupStatus()
  const f = s.local.files.find((x) => x.name.endsWith('.zip') && x.name === s.lastFile) ?? s.local.files.find((x) => x.name.endsWith('.zip'))
  if (!f) return null
  let r: { ok: boolean; msg: string }
  try {
    const text = await backupTextOf(await desk.readBackup('local', f.name), loadSql)
    r = restoreDrill(await loadSql(), text)
  } catch (e) {
    r = { ok: false, msg: (e as Error).message }
  }
  saveLocalDrill({ at: new Date().toISOString(), ok: r.ok, msg: `${f.name}: ${r.msg}`.slice(0, 200), file: f.name })
  void life.system?.beat('localRestoreDrill', r.ok, r.ok ? undefined : r.msg).catch(() => {})
  safetyChanged()
  return r
}

/** One of the day's 4 notifications when something about your backups is red (at most once a day). */
async function warnIfRed() {
  const day = localDay()
  if (localStorage.getItem('life_backup_warned') === day) return
  const s = await loadSafety(true)
  if (!s.red) return
  const red = s.rows.filter((r) => r.light === 'red')
  const shown = await window.desktop?.notify?.({ id: slotNotifId('backup', day), title: 'Life System: a backup needs a look', body: `${red.map((r) => r.label).join(', ')}. Open Settings → Data safety.` }).catch(() => false)
  if (shown !== false) localStorage.setItem('life_backup_warned', day)
}

/** Headless: today's backup once the data is there, its restore test, then a check every hour. */
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
        if (s.lastDay !== localDay()) await backupNow().catch(() => null)
        const drill = readLocalDrill()
        if (!drill || drill.at.slice(0, 10) !== new Date().toISOString().slice(0, 10)) await testLocalRestore().catch(() => null)
        await weeklyCheckIfDue().catch(() => null)
        await warnIfRed().catch(() => {})
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
