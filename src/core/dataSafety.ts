// Settings → Data safety (2026-11-12): is every copy of your data fresh?
// One light per copy (the cloud backup, the local backup on this PC, the
// off-site copy) and per restore test. Today shows a small red dot only when
// one is red. Pure and tested.
import { CHUNK_WARN } from './backupPack'

export type Light = 'green' | 'amber' | 'red'
export interface SafetyRow {
  id: 'cloud' | 'local' | 'offsite' | 'drill'
  label: string
  light: Light
  /** One plain line: when, and what to do if it isn't green. */
  text: string
}

export interface SafetyInput {
  now: Date
  /** Your calendar day (YYYY-MM-DD). */
  today: string
  cloud: { lastDay: string | null; error?: string | null; bytes?: number | null; biggest?: number | null }
  /** `available` false: not the desktop app (local backups are a desktop feature). */
  local: { available: boolean; lastAt: string | null; error?: string | null; bytes?: number | null }
  offsite: { okAt: string | null; day?: string | null; errAt?: string | null; err?: string | null }
  drill: { cloud?: { at: string; ok: boolean; msg: string } | null; local?: { at: string; ok: boolean; msg: string } | null }
}

const hours = (now: Date, iso: string) => (now.getTime() - Date.parse(iso)) / 3600_000
const minusDay = (day: string) => new Date(Date.parse(day + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10)
export const sizeText = (b: number | null | undefined) => (b == null ? '' : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)
function ago(now: Date, iso: string): string {
  const h = hours(now, iso)
  if (h < 1) return 'less than an hour ago'
  if (h < 48) return `${Math.round(h)} h ago`
  return `${Math.round(h / 24)} days ago`
}

export function safetyRows(i: SafetyInput): SafetyRow[] {
  const rows: SafetyRow[] = []
  // The cloud backup: Ben's server makes one every day (and the app, when open).
  {
    const c = i.cloud
    const size = c.bytes ? ` (${sizeText(c.bytes)})` : ''
    if (c.lastDay === i.today) {
      const big = (c.biggest ?? 0) >= CHUNK_WARN
      rows.push({ id: 'cloud', label: 'Cloud backup', light: big ? 'amber' : 'green', text: big ? `Today's is saved, but one piece is ${sizeText(c.biggest)} (should stay under ${sizeText(CHUNK_WARN)})` : `Today's is saved${size}` })
    } else if (c.error) rows.push({ id: 'cloud', label: 'Cloud backup', light: 'red', text: c.error })
    else if (c.lastDay === minusDay(i.today)) rows.push({ id: 'cloud', label: 'Cloud backup', light: 'amber', text: `Yesterday's is saved${size}; today's comes during the day` })
    else rows.push({ id: 'cloud', label: 'Cloud backup', light: 'red', text: c.lastDay ? `The last one is from ${c.lastDay}: back up now` : 'No cloud backup yet: back up now' })
  }
  // The local backup on this PC.
  {
    const l = i.local
    if (!l.available) rows.push({ id: 'local', label: 'Backup on this PC', light: 'amber', text: 'Only in the desktop app (Windows): open it once a day' })
    else if (l.error) rows.push({ id: 'local', label: 'Backup on this PC', light: 'red', text: `Failed: ${l.error}` })
    else if (!l.lastAt) rows.push({ id: 'local', label: 'Backup on this PC', light: 'red', text: 'None yet: back up now' })
    else {
      const h = hours(i.now, l.lastAt)
      const size = l.bytes ? ` (${sizeText(l.bytes)})` : ''
      rows.push({ id: 'local', label: 'Backup on this PC', light: h < 26 ? 'green' : h < 72 ? 'amber' : 'red', text: `Last ${ago(i.now, l.lastAt)}${size}` })
    }
  }
  // The weekly encrypted off-site copy (GitHub, Mondays).
  {
    const o = i.offsite
    const errNewer = !!o.errAt && (!o.okAt || Date.parse(o.errAt) > Date.parse(o.okAt))
    if (errNewer) rows.push({ id: 'offsite', label: 'Off-site copy', light: 'red', text: `The last weekly copy failed: ${String(o.err ?? '').slice(0, 120)}` })
    else if (!o.okAt) rows.push({ id: 'offsite', label: 'Off-site copy', light: 'amber', text: 'No weekly copy reported yet (it runs on Mondays)' })
    else {
      const d = hours(i.now, o.okAt) / 24
      rows.push({ id: 'offsite', label: 'Off-site copy', light: d <= 8 ? 'green' : d <= 15 ? 'amber' : 'red', text: `Last weekly copy ${ago(i.now, o.okAt)}${o.day ? ` (backup of ${o.day})` : ''}` })
    }
  }
  // The last restore test: the server's weekly drill, or this PC's on its newest local backup.
  {
    const tests = [i.drill.cloud, i.drill.local].filter((x): x is { at: string; ok: boolean; msg: string } => !!x?.at)
    const failed = tests.find((t) => !t.ok)
    const newest = tests.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
    // Each holds only its latest result: a failed one (cloud or this PC) is red until it passes again.
    if (failed) rows.push({ id: 'drill', label: 'Restore test', light: 'red', text: `Failed ${ago(i.now, failed.at)}: ${failed.msg}` })
    else if (!newest) rows.push({ id: 'drill', label: 'Restore test', light: 'amber', text: 'Not run yet (weekly on the server, daily on this PC)' })
    else {
      const d = hours(i.now, newest.at) / 24
      rows.push({ id: 'drill', label: 'Restore test', light: d <= 8 ? 'green' : 'amber', text: `Passed ${ago(i.now, newest.at)}: ${newest.msg}` })
    }
  }
  return rows
}

export const anyRed = (rows: SafetyRow[]) => rows.some((r) => r.light === 'red')
