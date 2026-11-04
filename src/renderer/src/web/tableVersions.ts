// Download only what changed. Every tracked change also writes, in the same
// transaction, which tables it touched (sys_table_versions: table → version),
// so a device catches up by reloading just those tables instead of the whole
// database. The row '*' follows settings.data_version only while every change
// is tracked: a change made by something that doesn't track (an older app
// version, a restore) breaks that chain, and devices then download everything
// once, as before, and repair it.
import type { Change } from './browserDb'

export type TableVersions = Record<string, string>

const ENSURE: Change = { sql: 'CREATE TABLE IF NOT EXISTS sys_table_versions (name TEXT PRIMARY KEY, v TEXT NOT NULL)', args: [] }
const DV = "COALESCE((SELECT value FROM settings WHERE key = 'data_version'), '')"
const put = (name: string, v: string): Change => ({ sql: 'INSERT INTO sys_table_versions (name, v) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET v = excluded.v', args: [name, v] })

/** Read with data_version: what a device compares with its own copy. */
export const READ_VERSIONS: Change[] = [
  { sql: "SELECT value FROM settings WHERE key = 'data_version'", args: [] },
  { sql: 'SELECT name, v FROM sys_table_versions', args: [] }
]

/**
 * What a tracked change adds to its transaction, BEFORE it sets data_version:
 * the chain moves on only when the change before was tracked too.
 */
export function trackStatements(tables: string[], version: string): Change[] {
  return [
    ENSURE,
    {
      sql: `INSERT INTO sys_table_versions (name, v) SELECT '*', ? WHERE ${DV} = COALESCE((SELECT v FROM sys_table_versions WHERE name = '*'), '') ON CONFLICT(name) DO UPDATE SET v = excluded.v`,
      args: [version]
    },
    ...tables.map((t) => put(t, version))
  ]
}

/**
 * After a full download at data_version `version`: mark every table changed
 * (devices with an older list then reload everything too) and join the chain
 * again. Only if nothing changed meanwhile.
 */
export function repairStatements(tables: string[], version: string, marker: string): Change[] {
  const when = (name: string, v: string): Change => ({
    sql: `INSERT INTO sys_table_versions (name, v) SELECT ?, ? WHERE ${DV} = ? ON CONFLICT(name) DO UPDATE SET v = excluded.v`,
    args: [name, v, version]
  })
  return [ENSURE, ...tables.map((t) => when(t, marker)), when('*', version)]
}

export function parseVersions(rows: unknown[][] | null): TableVersions | null {
  if (!rows) return null
  const out: TableVersions = {}
  for (const [name, v] of rows) out[String(name)] = String(v)
  return out
}

/**
 * What a device does: nothing (same version), reload some tables, or
 * download everything (no list yet, the chain is broken, a table it
 * doesn't know).
 */
export function catchUpPlan(remoteVersion: string, remote: TableVersions | null, localVersion: string | null, local: TableVersions | null, localTables: Set<string>): { kind: 'same' } | { kind: 'full' } | { kind: 'tables'; tables: string[] } {
  if (localVersion !== null && remoteVersion === localVersion) return { kind: 'same' }
  if (!remote || !local || (remote['*'] ?? '') !== remoteVersion) return { kind: 'full' }
  const tables = Object.keys(remote).filter((t) => t !== '*' && remote[t] !== local[t])
  if (tables.some((t) => !localTables.has(t))) return { kind: 'full' }
  return { kind: 'tables', tables: tables.sort() }
}
