// Error log and crash guards. Problems are written to a log file and kept in a
// short list for Settings > Diagnostics, instead of Electron's raw error dialog.
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'error' | 'warn' | 'info'

export interface LogEntry {
  at: string
  level: LogLevel
  source: string
  message: string
  detail?: string
}

const MAX_BYTES = 1_000_000
const KEEP = 60

export class ErrorLog {
  private recent: LogEntry[] = []
  private file: string

  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'life-system.log')
  }

  get folder(): string {
    return this.dir
  }

  write(level: LogLevel, source: string, err: unknown, extra?: string): LogEntry {
    const e = err instanceof Error ? err : new Error(String(err))
    const entry: LogEntry = { at: new Date().toISOString(), level, source, message: e.message.split('\n')[0].slice(0, 300), detail: [extra, e.stack].filter(Boolean).join('\n') }
    this.recent = [entry, ...this.recent].slice(0, KEEP)
    try {
      // One old file is kept, so the log never grows without limit.
      if (existsSync(this.file) && statSync(this.file).size > MAX_BYTES) renameSync(this.file, `${this.file}.1`)
      appendFileSync(this.file, `${entry.at} ${level.toUpperCase()} [${source}] ${entry.message}\n${entry.detail ? `${entry.detail}\n` : ''}`)
    } catch {
      // Logging must never be the thing that breaks the app.
    }
    return entry
  }

  list(): LogEntry[] {
    return this.recent
  }
}

/** Errors users cause on purpose (wrong PIN, limits) are normal answers, not problems. */
export function isExpected(err: unknown): boolean {
  return err instanceof Error && (err.name === 'LedgerError' || err.constructor?.name === 'LedgerError' || /^(Locked|Wrong PIN|Too many tries)/.test(err.message))
}

/**
 * Catches anything that slips through in the main process. `notify` is told
 * about real problems, at most once a minute, so a loop can't flood you.
 */
export function installCrashGuards(log: ErrorLog, notify: (e: LogEntry) => void): void {
  let lastNotice = 0
  const report = (source: string, err: unknown) => {
    const entry = log.write('error', source, err)
    if (Date.now() - lastNotice > 60_000) {
      lastNotice = Date.now()
      try {
        notify(entry)
      } catch {
        // nothing more to do
      }
    }
  }
  process.on('uncaughtException', (err) => report('main', err))
  process.on('unhandledRejection', (reason) => report('main (promise)', reason))
}
