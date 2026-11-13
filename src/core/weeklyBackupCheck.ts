// Weekly backup check (desktop, 2026-11-13): once a week the app opens the newest backup file on
// this PC, test-restores it into a throwaway database (never the real one) and checks it loads and
// has sane row counts. Pure and tested (weeklyBackupCheck.test.ts); the app wiring is
// renderer/safety/weeklyCheck.ts. Nothing secret is read or written here: only counts and a short reason.
import { APP_BLOBS } from './backupPlan'

export const CHECK_EVERY_DAYS = 7

export type CheckState = 'ok' | 'failed' | 'encrypted' | 'none'

export interface CheckNote {
  /** When the check ran (ISO). */
  at: string
  state: CheckState
  /** Short reason or summary, never data. */
  msg: string
  /** The backup file that was checked. */
  file?: string
  /** That backup's day (YYYY-MM-DD). */
  backupDay?: string
  rows?: number
}

/** True when 7 or more days have passed since the last check (or there was none, or its date is unreadable). */
export function checkDue(last: CheckNote | null, now: Date): boolean {
  const t = last ? Date.parse(last.at) : NaN
  if (!Number.isFinite(t)) return true
  return now.getTime() - t >= CHECK_EVERY_DAYS * 864e5
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-11-09" -> "9 Nov". */
export function shortDay(day: string | null | undefined): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(day ?? '')
  return m && MONTHS[+m[1] - 1] ? `${+m[2]} ${MONTHS[+m[1] - 1]}` : ''
}
const num = (n: number) => n.toLocaleString('en-US')

/** The line Settings → Backups shows. `day` is the calendar day the check ran (the caller's local day). */
export function checkLine(n: CheckNote | null, day?: string): string {
  if (!n) return 'Last backup check: not yet'
  const head = `Last backup check: ${shortDay(day ?? n.at.slice(0, 10))}`
  if (n.state === 'ok') return `${head} · OK (backup from ${shortDay(n.backupDay)}, ${num(n.rows ?? 0)} rows)`
  if (n.state === 'encrypted') return `${head} · Can't check: backup is encrypted`
  if (n.state === 'none') return `${head} · Can't check: no backup file on this PC yet`
  return `${head} · Failed: ${n.msg}`
}

/** A backup that is locked with a passphrase (a "LSENC" header, JSON marked encrypted, or an .enc file inside a zip). */
export function isEncryptedBackup(bytes: Uint8Array, entryNames: string[] = []): boolean {
  if (entryNames.some((n) => /\.(enc|age|gpg)$/i.test(n))) return true
  if (new TextDecoder().decode(bytes.subarray(0, 5)) === 'LSENC') return true
  if (bytes[0] === 0x7b) {
    try {
      const j = JSON.parse(new TextDecoder().decode(bytes))
      return j?.encrypted === true && !j.tables
    } catch {
      return false
    }
  }
  return false
}

/** Plain problems found in the backup's main tables and app copies (empty list: sane). */
export function sanityProblems(snap: any, rows: number): string[] {
  const out: string[] = []
  if (!snap || typeof snap.tables !== 'object') return ['the backup has no tables']
  for (const [t, list] of Object.entries(snap.tables)) if (!Array.isArray(list)) out.push(`table ${t} is not a list`)
  if (rows <= 0) out.push('the backup has no rows at all')
  for (const b of APP_BLOBS) {
    const v = snap[b.field]
    if (v == null || b.field === 'financeEnc') continue
    if (typeof v === 'string') {
      try {
        JSON.parse(v)
      } catch {
        out.push(`${b.label} copy does not read`)
      }
    } else if (typeof v !== 'object') out.push(`${b.label} copy does not read`)
  }
  return out
}

export interface CheckFile {
  name: string
  day: string
}
export interface CheckDeps {
  /** Backups on this PC, newest first. */
  files: CheckFile[]
  read: (name: string) => Promise<Uint8Array>
  /** The backup JSON text of a file; throws a plain message when it can't be opened. */
  textOf: (bytes: Uint8Array) => Promise<string>
  /** Test restore into a throwaway database. */
  drill: (text: string) => { ok: boolean; msg: string; rows: number }
  /** Names inside a zip (for the encrypted check); may throw on a broken zip. */
  entryNames?: (bytes: Uint8Array) => string[]
  /** Is a passphrase saved on this PC? (Never today; explicit so a future one is a one-line change.) */
  hasPassphrase?: () => boolean
  now?: Date
}

const short = (s: string) => s.replace(/\s+/g, ' ').slice(0, 120)

/** Opens the newest backup, test-restores it, and returns the note to store. Never throws. */
export async function runBackupCheck(d: CheckDeps): Promise<CheckNote> {
  const at = (d.now ?? new Date()).toISOString()
  const f = d.files[0]
  if (!f) return { at, state: 'none', msg: 'no backup file yet' }
  const base = { at, file: f.name, backupDay: f.day }
  try {
    const bytes = await d.read(f.name)
    let names: string[] = []
    try {
      names = d.entryNames?.(bytes) ?? []
    } catch {
      /* a broken zip is reported by textOf below */
    }
    if (isEncryptedBackup(bytes, names) && !d.hasPassphrase?.()) return { ...base, state: 'encrypted', msg: 'backup is encrypted' }
    const text = await d.textOf(bytes)
    const r = d.drill(text)
    if (!r.ok) return { ...base, state: 'failed', msg: short(r.msg) }
    const bad = sanityProblems(JSON.parse(text), r.rows)
    if (bad.length) return { ...base, state: 'failed', msg: short(bad[0]) }
    return { ...base, state: 'ok', msg: r.msg, rows: r.rows }
  } catch (e) {
    return { ...base, state: 'failed', msg: short((e as Error).message || 'the backup could not be opened') }
  }
}
