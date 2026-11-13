// Backup files in the app (2026-11-12): reading any backup file for "Restore
// from file" (a local backup .zip, its backup.json, an export, an old daily
// .json, or a .zip with only the database file), and "Export everything":
// every table and every app's data as CSV plus the full JSON, in one .zip.
import type { SqlJsStatic } from 'sql.js'
import { APP_BLOBS, BLOB_FIELDS, type Snapshot } from '@core/backupPlan'
import { backupDigest } from '@core/backupCheck'
import { listZip, looksLikeZip, makeZip, readZipEntry, utf8, fromUtf8, type ZipEntry } from '@core/zip'
import { rowsDbOf, snapshotOf } from '../web/restoreDrill'

const stream = async (u8: Uint8Array, t: TransformStream<Uint8Array, Uint8Array>) => new Uint8Array(await new Response(new Blob([u8 as BlobPart]).stream().pipeThrough(t)).arrayBuffer())
export const inflateRaw = (u8: Uint8Array) => stream(u8, new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>)
export const deflateRawAsync = (u8: Uint8Array) => stream(u8, new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>)
export const gzipAsync = (u8: Uint8Array) => stream(u8, new CompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>)
export const gunzipAsync = (u8: Uint8Array) => stream(u8, new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>)

/**
 * The backup JSON of a file the owner picked. A .zip: its backup.json, or
 * (a "before update" copy) its database file opened with sql.js. Anything
 * else must be backup JSON. Throws a plain message when it is not a backup.
 */
export async function backupTextOf(bytes: Uint8Array, loadSql?: () => Promise<SqlJsStatic>): Promise<string> {
  if (looksLikeZip(bytes)) {
    const items = listZip(bytes)
    const json = items.find((i) => i.name === 'backup.json' || i.name.endsWith('/backup.json') || i.name === 'life-system-backup.json')
    if (json) return fromUtf8(await readZipEntry(json, inflateRaw))
    const db = items.find((i) => i.name.endsWith('.sqlite'))
    if (db && loadSql) {
      const SQL = await loadSql()
      const raw = new SQL.Database(await readZipEntry(db, inflateRaw))
      try {
        return JSON.stringify(snapshotOf(rowsDbOf(raw), 'Database file in a backup'))
      } finally {
        raw.close()
      }
    }
    throw new Error('This zip has no Life System backup in it')
  }
  const text = fromUtf8(bytes)
  let snap: any
  try {
    snap = JSON.parse(text)
  } catch {
    throw new Error('This file is not a Life System backup')
  }
  if (!snap || typeof snap.tables !== 'object') throw new Error('This file is not a Life System backup')
  return text
}

/** One CSV cell: text quoted, lists and objects as JSON; a cell a spreadsheet would run as a formula starts with '. */
function cell(v: unknown): string {
  if (v == null) return ''
  let s = typeof v === 'object' ? JSON.stringify(v instanceof Uint8Array ? Array.from(v) : v) : String(v)
  if (typeof v === 'string' && /^[=+@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s
}

/** Rows (objects) as CSV: one column per key any row has. */
export function toCsv(rows: Record<string, unknown>[]): string {
  const cols: string[] = []
  for (const r of rows) for (const k of Object.keys(r ?? {})) if (!cols.includes(k)) cols.push(k)
  return [cols.map(cell).join(','), ...rows.map((r) => cols.map((c) => cell(r?.[c])).join(','))].join('\r\n') + '\r\n'
}

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const safeName = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 60) || 'data'

/** An app's data as CSV files: every list of records, and every map of records (day → record). */
export function appCsvs(data: unknown): { name: string; csv: string }[] {
  const out: { name: string; csv: string }[] = []
  if (!isRecord(data)) return out
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v) && v.length && v.every((x) => isRecord(x))) out.push({ name: safeName(k), csv: toCsv(v as Record<string, unknown>[]) })
    else if (isRecord(v) && Object.keys(v).length && Object.values(v).every((x) => isRecord(x))) out.push({ name: safeName(k), csv: toCsv(Object.entries(v).map(([key, x]) => ({ key, ...(x as Record<string, unknown>) }))) })
  }
  return out
}

const README = `Life System: everything you have
==================================
life-system-backup.json   The full backup (every table and every app's data). Settings ->
                          Data safety -> Restore from file takes this file or this whole zip.
tables/*.csv              Every table, one CSV each (open in Excel, Numbers, Google Sheets).
apps/<app>.json           Each app's own data (Finance, Sport Track, Waky, MAN), as JSON.
apps/<app>/*.csv          Each app's lists of records as CSV (Finance: tx = your records).
manifest.json             Row counts and checksums.
Your PIN, keys and tokens are never in an export.
`

/** "Export everything": one zip with the full JSON, each table as CSV and each app's data as JSON and CSV. */
export async function exportEverything(snap: Snapshot, now = new Date()): Promise<Uint8Array> {
  const json = JSON.stringify(snap, null, 2)
  const files: ZipEntry[] = [{ name: 'life-system-backup.json', data: utf8(json) }]
  for (const [t, rows] of Object.entries(snap.tables ?? {}).sort(([a], [b]) => a.localeCompare(b))) if (Array.isArray(rows)) files.push({ name: `tables/${safeName(t)}.csv`, data: utf8(toCsv(rows)) })
  for (const b of APP_BLOBS) {
    const v = snap[b.field]
    if (v == null) continue
    const app = safeName(b.field.replace(/State$|Enc$/, (m) => (m === 'Enc' ? '-locked' : '')))
    files.push({ name: `apps/${app}.json`, data: utf8(typeof v === 'string' ? v : JSON.stringify(v, null, 2)) })
    for (const c of appCsvs(v)) files.push({ name: `apps/${app}/${c.name}.csv`, data: utf8(c.csv) })
  }
  files.push({ name: 'manifest.json', data: utf8(JSON.stringify({ app: 'Life System', exportedAt: now.toISOString(), files: files.map((f) => ({ name: f.name, bytes: f.data.length })), digest: backupDigest(snap, BLOB_FIELDS) }, null, 2)) })
  files.push({ name: 'README.txt', data: utf8(README) })
  const packed = new Map<Uint8Array, Uint8Array>()
  if (typeof CompressionStream !== 'undefined') for (const f of files) packed.set(f.data, await deflateRawAsync(f.data))
  return makeZip(files, packed.size ? (u8) => packed.get(u8) ?? u8 : undefined, now)
}

/** Saves bytes as a download. */
export function download(bytes: Uint8Array | string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
