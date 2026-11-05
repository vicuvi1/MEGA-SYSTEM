// Errors from this device go to the shared error log (Settings → System
// health; Ben's weekly report counts them), each with its stack trace, the
// build it came from and the screen it happened on. They wait in a small
// queue and go out together (every 20 s, at 10 waiting, or when the tab is
// hidden), in one write to a server-only table that devices never sync.
// Repeats within 10 minutes are skipped, at most 20 an hour, and harmless
// browser noise is ignored.
import type { ErrorReport } from './web/systemHealth'
import { life } from './bridge'

declare const __APP_VERSION__: string
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'

const NOISE = /ResizeObserver loop|Script error\.?$|AbortError|The user aborted|Load failed|NetworkError when attempting|Failed to fetch/i
const FLUSH_MS = 20_000
const BATCH = 10
let installed = false
const seen = new Map<string, number>()
let hour = { start: 0, n: 0 }
let queue: ErrorReport[] = []
let timer: ReturnType<typeof setTimeout> | null = null

/** Short stack: the first 8 frames, file names without the long origin. */
export function trimStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined
  const lines = String(stack)
    .split('\n')
    .map((l) => l.trim().replace(/https?:\/\/[^/\s)]+\//g, '/'))
    .filter(Boolean)
  return lines.slice(0, 9).join('\n').slice(0, 2000) || undefined
}

const place = () => (typeof location === 'undefined' ? undefined : `${location.pathname}${location.hash}`.slice(0, 80))

/** Send what is waiting now (one write). */
export async function flushErrors(): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  if (!queue.length || !life.system) return
  const batch = queue
  queue = []
  if (life.system.logErrors) await life.system.logErrors(batch).catch(() => {})
  else for (const e of batch) await life.system.logError(e.source, e.msg).catch(() => {})
}

export function reportError(source: string, msg: string, stack?: string): void {
  const m = String(msg || '').trim()
  if (!m || NOISE.test(m) || !life.system) return
  const now = Date.now()
  if (now - (seen.get(m) ?? 0) < 10 * 60000) return
  if (now - hour.start > 3600000) hour = { start: now, n: 0 }
  if (++hour.n > 20) return
  seen.set(m, now)
  queue.push({ at: new Date(now).toISOString(), source, msg: m, stack: trimStack(stack), version: APP_VERSION, place: place() })
  if (queue.length >= BATCH) void flushErrors()
  else timer ??= setTimeout(() => void flushErrors(), FLUSH_MS)
}

/** For tests: forget the queue and the repeat filter. */
export function resetErrorReport(): void {
  queue = []
  seen.clear()
  hour = { start: 0, n: 0 }
  if (timer) clearTimeout(timer)
  timer = null
}

export const pendingErrors = () => queue.length

export function installErrorReport(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const source = window.desktop ? 'desktop' : 'web'
  window.desktop?.onCrashes?.((list) => list.forEach((c) => reportError('desktop', `Crash ${c.at}: ${c.why}`)))
  window.addEventListener('error', (e) =>
    reportError(source, `${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`, (e.error as Error | undefined)?.stack)
  )
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; stack?: string } | string | undefined
    reportError(source, typeof r === 'string' ? r : r?.message ?? 'Unhandled promise rejection', typeof r === 'string' ? undefined : r?.stack)
  })
  // Don't lose the queue when the tab closes or goes to the background.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushErrors()
  })
  window.addEventListener('pagehide', () => void flushErrors())
}
