// Everything Settings → Data safety and Today's red dot need, gathered in one
// place (2026-11-12): the cloud backup and the off-site copy (from the server's
// notes), the local backup on this PC (desktop app), and the last restore tests.
import type { SqlJsStatic } from 'sql.js'
import { calendarDay } from '@core/dates'
import { anyRed, safetyRows, type SafetyRow } from '@core/dataSafety'
import type { DataSafetyCloud } from '@shared/api'
import type { BackupStatus } from '../../../desktop/localBackups'
import { life } from '../bridge'

let sqlP: Promise<SqlJsStatic> | null = null
/** sql.js, loaded once when a backup file has to be opened or tested. */
export const loadSql = (): Promise<SqlJsStatic> =>
  (sqlP ??= Promise.all([import('sql.js'), import('sql.js/dist/sql-wasm.wasm?url')]).then(([m, w]) => m.default({ locateFile: () => w.default })))

export interface DrillNote {
  at: string
  ok: boolean
  msg: string
  file?: string
}
const LOCAL_DRILL = 'life_local_drill'
export function readLocalDrill(): DrillNote | null {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_DRILL) || 'null')
  } catch {
    return null
  }
}
export function saveLocalDrill(n: DrillNote) {
  try {
    localStorage.setItem(LOCAL_DRILL, JSON.stringify(n))
  } catch {
    /* private window */
  }
}

/** A "before" backup that failed (set by the bridge's big-change guard, cleared by the next one that works). */
const riskError = (): string | null => {
  try {
    return localStorage.getItem('life_risk_error')
  } catch {
    return null
  }
}

export interface SafetyState {
  rows: SafetyRow[]
  red: boolean
  cloud: DataSafetyCloud | null
  local: BackupStatus | null
  at: number
}

let cache: SafetyState | null = null
const listeners = new Set<(s: SafetyState) => void>()
/** Called when a backup or restore just ran: everyone showing the state reloads it. */
export function safetyChanged() {
  cache = null
  void loadSafety(true).then((s) => listeners.forEach((l) => l(s)))
}
export const onSafety = (fn: (s: SafetyState) => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** The current lights; cached 10 minutes (Today asks once an hour at most). */
export async function loadSafety(fresh = false): Promise<SafetyState> {
  if (!fresh && cache && Date.now() - cache.at < 10 * 60_000) return cache
  const desk = typeof window !== 'undefined' ? window.desktop : undefined
  const [cloud, local] = await Promise.all([life.data.safety?.().catch(() => null) ?? Promise.resolve(null), desk?.backupStatus ? desk.backupStatus().catch(() => null) : Promise.resolve(null)])
  const now = new Date()
  const localDrill = readLocalDrill()
  const lastLocal = local?.local.files.find((f) => f.name === local.lastFile) ?? null
  const rows = safetyRows({
    now,
    today: calendarDay(now),
    cloud: { lastDay: cloud?.cloud.lastDay ?? null, error: cloud?.cloud.error ?? null, bytes: cloud?.cloud.bytes, biggest: cloud?.cloud.biggest },
    local: { available: !!desk?.backupStatus, lastAt: local?.lastAt ?? null, error: local?.lastError ?? riskError() ?? null, bytes: local?.lastSize ?? lastLocal?.size ?? null },
    offsite: cloud?.offsite ?? { okAt: null },
    drill: { cloud: cloud?.drill ?? null, local: localDrill }
  })
  // Offline: the cloud rows can't be checked, which is not a lost backup.
  if (!cloud || !cloud.reachable)
    for (const r of rows)
      if ((r.id === 'cloud' || r.id === 'offsite') && r.light !== 'green') {
        r.light = 'amber'
        r.text = 'Could not check right now (offline?)'
      }
  cache = { rows, red: anyRed(rows), cloud, local, at: Date.now() }
  return cache
}
