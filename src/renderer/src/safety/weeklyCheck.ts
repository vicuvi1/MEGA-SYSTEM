// Weekly backup check, app side (2026-11-13): reads the newest backup on this PC, runs the pure check
// (core/weeklyBackupCheck.ts) against a throwaway database, stores the result with its date and, on a
// failure, sends one notification through the desktop's notify helper (its 4-a-day budget applies).
import { calendarDay } from '@core/dates'
import { slotNotifId } from '@core/notifyBudget'
import { listZip, looksLikeZip } from '@core/zip'
import { checkDue, runBackupCheck, type CheckNote } from '@core/weeklyBackupCheck'
import { restoreDrill } from '../web/restoreDrill'
import { backupTextOf } from './backupFiles'
import { loadSql, safetyChanged } from './safetyState'

const KEY = 'life_backup_weekly_check'
/** The local day the stored check ran (the note's own time is UTC). */
const DAY_KEY = 'life_backup_weekly_check_day'

export function readWeeklyCheck(): (CheckNote & { day?: string }) | null {
  try {
    const n = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!n || typeof n.at !== 'string' || typeof n.state !== 'string') return null
    return { ...n, day: localStorage.getItem(DAY_KEY) || undefined }
  } catch {
    return null
  }
}
function saveWeeklyCheck(n: CheckNote, day: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(n))
    localStorage.setItem(DAY_KEY, day)
  } catch {
    /* private window */
  }
}

/** Runs the check now and stores it. Returns null when this is not the desktop app. */
export async function checkBackupNow(): Promise<CheckNote | null> {
  const desk = window.desktop
  if (!desk?.backupStatus || !desk.readBackup) return null
  const s = await desk.backupStatus()
  const SQL = await loadSql()
  const note = await runBackupCheck({
    files: s.local.files.filter((f) => f.name.endsWith('.zip') || f.name.endsWith('.json')),
    read: (name) => desk.readBackup!('local', name),
    textOf: (bytes) => backupTextOf(bytes, loadSql),
    drill: (text) => restoreDrill(SQL, text),
    entryNames: (bytes) => (looksLikeZip(bytes) ? listZip(bytes).map((i) => i.name) : [])
  })
  const day = calendarDay(new Date())
  saveWeeklyCheck(note, day)
  if (note.state === 'failed') {
    void desk.notify?.({ id: slotNotifId('backup', day), title: 'Life System: your last backup did not pass its check', body: 'Make a new backup: Settings → Backups → Back up now.' })?.catch(() => false)
  }
  safetyChanged()
  return note
}

/** Called from the hourly backup run: checks only when 7 or more days have passed. */
export async function weeklyCheckIfDue(now = new Date()): Promise<CheckNote | null> {
  if (!checkDue(readWeeklyCheck(), now)) return null
  return checkBackupNow()
}
