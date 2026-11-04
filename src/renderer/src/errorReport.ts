// Errors from this device go to the shared error log (Settings → System
// health; Ben's weekly report counts them). Repeats within 10 minutes are
// skipped, at most 20 an hour, and harmless browser noise is ignored.
import { life } from './bridge'

const NOISE = /ResizeObserver loop|Script error\.?$|AbortError|The user aborted|Load failed|NetworkError when attempting|Failed to fetch/i
let installed = false
const seen = new Map<string, number>()
let hour = { start: 0, n: 0 }

export function reportError(source: string, msg: string): void {
  const m = String(msg || '').trim()
  if (!m || NOISE.test(m) || !life.system) return
  const now = Date.now()
  if (now - (seen.get(m) ?? 0) < 10 * 60000) return
  if (now - hour.start > 3600000) hour = { start: now, n: 0 }
  if (++hour.n > 20) return
  seen.set(m, now)
  void life.system.logError(source, m).catch(() => {})
}

export function installErrorReport(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const source = window.desktop ? 'desktop' : 'web'
  window.addEventListener('error', (e) => reportError(source, `${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`))
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string } | string | undefined
    reportError(source, typeof r === 'string' ? r : r?.message ?? 'Unhandled promise rejection')
  })
}
