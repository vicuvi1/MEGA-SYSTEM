// Data center: the controls (2026-11-18). Every clean-up says what it frees,
// keeps what it removed so it can be put back (Undo), and saves a backup first
// when what it removes is not in a backup already. Nothing here touches how
// the apps merge or sync.
import { historyPrunePlan } from '@core/dataCenter'
import { life } from '../bridge'
import { hostStore } from '../web/bigStore'
import { backupNow } from '../DesktopBackups'
import { download } from '../safety/backupFiles'
import { saveRiskPoint } from '../safety/riskPoints'
import { safetyChanged } from '../safety/safetyState'
import { DATA_APPS, historyList, keepCache, readHistoryRaw, writeHistoryRaw } from './usage'

/** "Back up now": the file on this PC (desktop) and today's cloud backup. */
export async function backUpEverywhere(): Promise<string> {
  const desk = window.desktop
  try {
    if (desk?.writeBackup) await backupNow()
    if (!(await life.data.saveDailySnapshot?.()) && !desk?.writeBackup) throw new Error('The cloud backup did not save: see the Backups tab')
    return desk?.writeBackup ? 'Backed up on this PC and in the cloud' : 'Backed up in the cloud'
  } finally {
    safetyChanged()
  }
}

/** "Sync now": Life's tables, then every app compares with the cloud copy; Money says what it sent. */
export async function syncEverything(): Promise<string> {
  await life.sync.pull()
  window.dispatchEvent(new CustomEvent('life-apps-check'))
  const money = life.sync.moneyNow ? await life.sync.moneyNow().catch((e: Error) => ({ ok: false, text: `Money: ${e.message}` })) : null
  // The other apps answer within a moment of the check; their lines are in the Sync tab.
  await new Promise((r) => setTimeout(r, 1500))
  const h = await life.sync.health?.().catch(() => null)
  const bad = (h?.apps ?? []).filter((a) => a.state === 'error')
  if (h?.error) throw new Error(h.error)
  if (bad.length) throw new Error(`${bad.map((a) => a.label).join(', ')} did not sync: ${bad[0].error ?? 'see the Sync tab'}`)
  return `Synced${money ? ` · Money: ${money.text}` : ''}`
}

// ---------- Money's change history ----------

export interface HistoryUndo {
  dropped: unknown[]
  freed: number
}
/** What pruning the change history to `days` would remove (nothing is changed). */
export async function historyPlan(days: number, now = Date.now()) {
  const list = historyList(await readHistoryRaw())
  if (!list) throw new Error('Money is locked with its PIN: open Money and unlock it to manage its history')
  return historyPrunePlan(list, days, now)
}
/** Removes history entries older than `days`. The removed entries come back with `undoHistory`. */
export async function pruneHistory(days: number, now = Date.now()): Promise<HistoryUndo> {
  const raw = await readHistoryRaw()
  const list = historyList(raw)
  if (!list) throw new Error('Money is locked with its PIN: open Money and unlock it to manage its history')
  const plan = historyPrunePlan(list, days, now)
  if (!plan.drop.length) return { dropped: [], freed: 0 }
  // Kept in the same shape it was stored in (text or list).
  await writeHistoryRaw(typeof raw === 'string' ? JSON.stringify(plan.keep) : plan.keep)
  return { dropped: plan.drop, freed: plan.freed }
}
/** Puts pruned entries back (newest first, as the history is kept). */
export async function undoHistory(u: HistoryUndo): Promise<void> {
  const raw = await readHistoryRaw()
  const list = historyList(raw)
  if (!list) throw new Error('Money is locked with its PIN')
  const all = [...list, ...(u.dropped as { at?: number }[])].sort((a, b) => Number(b?.at ?? 0) - Number(a?.at ?? 0))
  await writeHistoryRaw(typeof raw === 'string' ? JSON.stringify(all) : all)
}

// ---------- the copy from before a restore ----------

export interface KeysUndo {
  values: Record<string, string>
  chars: number
  backup: string
}
/**
 * Clears the copies kept from before a restore. A full backup with these
 * copies inside is saved first (it throws, and nothing is removed, when that
 * backup can't be saved); Undo puts them back as they were.
 */
export async function clearBeforeRestore(keys: string[]): Promise<KeysUndo> {
  const values: Record<string, string> = {}
  const s = hostStore() ?? localStorage
  for (const k of keys) {
    const v = s.getItem(k)
    if (v != null && k.endsWith('_before_restore')) values[k] = v
  }
  if (!Object.keys(values).length) return { values, chars: 0, backup: '' }
  const snap = JSON.parse(await life.data.exportJson())
  snap.beforeRestoreCopies = values
  const point = await saveRiskPoint('clearing the copy from before a restore', JSON.stringify(snap))
  let chars = 0
  for (const [k, v] of Object.entries(values)) {
    s.removeItem(k)
    chars += k.length + v.length
  }
  await s.flush?.()
  safetyChanged()
  return { values, chars, backup: point.name ?? point.id }
}
export function undoKeys(u: KeysUndo): void {
  for (const [k, v] of Object.entries(u.values)) (hostStore() ?? localStorage).setItem(k, v)
}

// ---------- app caches ----------

/** Clears the app's file caches (they download again when needed). Voice models you downloaded stay. */
export async function clearCaches(): Promise<number> {
  if (typeof caches === 'undefined') return 0
  let n = 0
  for (const name of await caches.keys()) if (!keepCache(name) && (await caches.delete(name))) n++
  return n
}

// ---------- downloads ----------

const day = () => new Date().toISOString().slice(0, 10)
/** Saves one app's data from this device as a JSON file. */
export function downloadApp(setting: string): string {
  const app = DATA_APPS.find((a) => a.setting === setting)
  if (!app) throw new Error('Unknown app')
  const plain = localStorage.getItem(app.localKey)
  const locked = app.setting === 'app_sync_finance' ? localStorage.getItem('finance-helper.enc') : null
  if (plain == null && locked == null) throw new Error(`${app.label} has no data on this device yet`)
  const name = `life-system-${app.file}${plain == null ? '-locked' : ''}-${day()}.json`
  download(plain ?? locked!, name, 'application/json')
  return plain == null ? `${app.label} saved as ${name} (locked with the Money PIN)` : `${app.label} saved as ${name}`
}
/** Saves Life's tables (everything outside the apps) as the full backup JSON. */
export async function downloadLife(): Promise<string> {
  const name = `life-system-tables-${day()}.json`
  download(await life.data.exportJson(), name, 'application/json')
  return `Life tables saved as ${name}`
}
