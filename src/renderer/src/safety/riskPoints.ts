// Backup before risk (2026-11-12): before a restore, an import, a bulk delete,
// a Finance re-price or a big change of an app's data, a full backup is saved
// first, and "Undo to before X" puts it back in one click. In the desktop app
// it is a .zip in the backup folder (life-system-<day>-<time>-before-<x>.zip);
// on the website, the newest 10 are kept in this browser (IndexedDB).
import { calendarDay } from '@core/dates'
import { slugOf } from '@core/backupPlan'

export interface RiskPoint {
  id: string
  /** What it was made before, in words. */
  label: string
  /** When (ISO), or the day and HH:MM for a file. */
  at: string
  where: 'file' | 'browser'
  /** The file name (desktop). */
  name?: string
  size?: number
}

const DB = 'life_risk_points'
const KEEP_BROWSER = 10

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('points', { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Browser storage is not available'))
  })
}
const tx = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await idb()
  return new Promise<T>((resolve, reject) => {
    const r = fn(db.transaction('points', mode).objectStore('points'))
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  }).finally(() => db.close())
}

/** Saves a "before" backup of `text` (the full backup JSON). Throws when it could not be saved: the risky step must not go ahead. */
export async function saveRiskPoint(label: string, text: string, now = new Date()): Promise<RiskPoint> {
  const p = await saveRiskPointOnly(label, text, now)
  try {
    localStorage.removeItem('life_risk_error')
  } catch {
    /* private window */
  }
  return p
}

async function saveRiskPointOnly(label: string, text: string, now: Date): Promise<RiskPoint> {
  const desk = typeof window !== 'undefined' ? window.desktop : undefined
  if (desk?.writeBackup) {
    const s = await desk.writeBackup(text, calendarDay(now), label)
    const f = s.local.files.find((x) => x.name === s.lastFile) ?? s.local.files.find((x) => x.kind === 'risk')
    return { id: s.lastFile ?? `file-${now.getTime()}`, label, at: now.toISOString(), where: 'file', name: s.lastFile ?? f?.name, size: f?.size }
  }
  const id = `${now.getTime()}-${slugOf(label)}`
  await tx('readwrite', (s) => s.put({ id, label, at: now.toISOString(), text }))
  const all = (await tx('readonly', (s) => s.getAll())) as { id: string; at: string }[]
  for (const old of all.sort((a, b) => b.at.localeCompare(a.at)).slice(KEEP_BROWSER)) await tx('readwrite', (s) => s.delete(old.id))
  return { id, label, at: now.toISOString(), where: 'browser', size: text.length }
}

/** The "before" backups, newest first. */
export async function listRiskPoints(): Promise<RiskPoint[]> {
  const desk = typeof window !== 'undefined' ? window.desktop : undefined
  if (desk?.backupStatus) {
    const s = await desk.backupStatus()
    return s.local.files
      .filter((f) => f.kind === 'risk')
      .map((f) => ({ id: f.name, label: f.before ?? 'a change', at: `${f.day} ${f.time ?? ''}`.trim(), where: 'file' as const, name: f.name, size: f.size }))
  }
  try {
    const all = (await tx('readonly', (s) => s.getAll())) as { id: string; label: string; at: string; text: string }[]
    return all.sort((a, b) => b.at.localeCompare(a.at)).map((p) => ({ id: p.id, label: p.label, at: p.at, where: 'browser' as const, size: p.text.length }))
  } catch {
    return []
  }
}

/** A "before" backup's bytes (file) or text (browser). */
export async function readRiskPoint(p: RiskPoint): Promise<Uint8Array | string> {
  if (p.where === 'file') {
    const desk = window.desktop
    if (!desk?.readBackup || !p.name) throw new Error('This backup is on the desktop app')
    return desk.readBackup('local', p.name)
  }
  const row = (await tx('readonly', (s) => s.get(p.id))) as { text: string } | undefined
  if (!row) throw new Error('That backup is gone from this browser')
  return row.text
}
