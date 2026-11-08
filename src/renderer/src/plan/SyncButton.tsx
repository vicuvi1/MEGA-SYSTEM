// "Sync" on Tasks and Today → Now: pulls Todoist and Google Calendar now, then
// the lists and the day plan read again. A small spinner while it runs and
// "Synced 12:04" after. Every Sync button on screen shows the same time.
import { useEffect, useState } from 'react'
import { life } from '../bridge'
import { checkRemote } from './planStore'
import { autoSyncLine, syncErrorText } from '@core/syncLabel'
import './planEditor.css'

let syncedAt = 0
let lastCheckAt = 0
let fails = 0
let manualFailed = false
let running: Promise<number> | null = null
const subs = new Set<(at: number, busy: boolean) => void>()
const tell = () => subs.forEach((f) => f(syncedAt, !!running))

/** One sync at a time (a second tap waits for the first). */
export function syncAll(): Promise<number> {
  if (running) return running
  running = (async () => {
    try {
      lastCheckAt = Date.now()
      const at = await (life.syncNow?.() ?? Promise.resolve(Date.now()))
      // The day plan takes in what changed in Google and Todoist.
      await checkRemote(true).catch(() => {})
      syncedAt = at
      fails = 0
      manualFailed = false
      return at
    } catch {
      fails++
      manualFailed = true
      return syncedAt
    } finally {
      running = null
      tell()
    }
  })()
  tell()
  return running
}

/** Background check while a plan card is on screen: every 60 s while visible, and as soon as you come back. */
let autoOn = 0
let autoTimer: ReturnType<typeof setInterval> | null = null
const auto = (minGap: number) => {
  if (document.visibilityState !== 'visible' || running || Date.now() - lastCheckAt < minGap) return
  void syncAll()
}
const onBack = () => auto(5_000)
const onTick = () => auto(55_000)
export function startAutoSync(): () => void {
  if (++autoOn === 1) {
    autoTimer = setInterval(onTick, 60_000)
    window.addEventListener('focus', onBack)
    document.addEventListener('visibilitychange', onBack)
  }
  onBack()
  return () => {
    if (--autoOn === 0) {
      if (autoTimer) clearInterval(autoTimer)
      autoTimer = null
      window.removeEventListener('focus', onBack)
      document.removeEventListener('visibilitychange', onBack)
    }
  }
}

const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

export function SyncButton({ className = '' }: { className?: string }) {
  const [at, setAt] = useState(syncedAt)
  const [busy, setBusy] = useState(!!running)
  useEffect(() => {
    const f = (a: number, b: boolean) => {
      setAt(a)
      setBusy(b)
    }
    subs.add(f)
    return () => {
      subs.delete(f)
    }
  }, [])
  return (
    <span className={`sync-btn ${className}`}>
      <button type="button" className="btn small ghost" onClick={() => void syncAll()} disabled={busy} aria-busy={busy} title="Get the latest from Todoist and Google Calendar">
        {busy ? <span className="sync-spin" aria-hidden /> : '⟳'} {busy ? 'Syncing…' : 'Sync'}
      </button>
      {manualFailed && !busy && (
        <small className="sync-err" role="alert">
          {syncErrorText()}{' '}
          <button type="button" className="sync-retry" onClick={() => void syncAll()}>
            Retry
          </button>
        </small>
      )}
      {at > 0 && !busy && !manualFailed && (
        <small className="sync-at" aria-live="polite">
          Synced {hhmm(at)}
        </small>
      )}
    </span>
  )
}

/** The plan card's header line: the Sync button plus "Auto-sync on · last checked 12:04". */
export function PlanSync() {
  const [, force] = useState(0)
  useEffect(() => {
    const f = () => force((n) => n + 1)
    subs.add(f)
    const stop = startAutoSync()
    const t = setInterval(f, 30_000)
    return () => {
      subs.delete(f)
      stop()
      clearInterval(t)
    }
  }, [])
  const line = autoSyncLine({ lastCheckAt, lastOkAt: syncedAt, fails }, Date.now())
  return (
    <span className="plan-sync" data-sync-bar>
      <SyncButton />
      <small className={`plan-sync-auto ${line.tone}`} aria-live="polite">
        {line.text}
      </small>
    </span>
  )
}
