// "Sync" on Tasks and Today → Now: pulls Todoist and Google Calendar now, then
// the lists and the day plan read again. A small spinner while it runs and
// "Synced 12:04" after. Every Sync button on screen shows the same time.
import { useEffect, useState } from 'react'
import { life } from '../bridge'
import { idleFor } from '../lastUse'
import { checkRemote } from './planStore'
import { autoSyncGap, autoSyncLine, syncErrorText, syncedLine } from '@core/syncLabel'
import './planEditor.css'

let syncedAt = 0
let lastCheckAt = 0
let fails = 0
let manualFailed = false
/** The last Sync failed because Todoist did not answer. */
let todoistDown = false
/** Changes made in Todoist itself that the last Sync took in. */
let lastChanges = 0
let running: Promise<number> | null = null
const subs = new Set<(at: number, busy: boolean) => void>()
const tell = () => subs.forEach((f) => f(syncedAt, !!running))

/** One sync at a time (a second tap waits for the first). */
export function syncAll(): Promise<number> {
  if (running) return running
  running = (async () => {
    const started = Date.now()
    try {
      lastCheckAt = started
      const at = await (life.syncNow?.() ?? Promise.resolve(Date.now()))
      // Todoist didn't answer the change check: say so plainly (the lists keep what they had).
      const info = life.todoist?.syncInfo?.()
      if (info?.error && info.failAt >= started) throw Object.assign(new Error(info.error), { todoist: true })
      // The day plan takes in what changed in Google and Todoist.
      await checkRemote(true).catch(() => {})
      syncedAt = at
      lastChanges = info?.lastSyncChanges ?? 0
      fails = 0
      manualFailed = false
      todoistDown = false
      return at
    } catch (e) {
      fails++
      manualFailed = true
      todoistDown = !!(e as { todoist?: boolean })?.todoist
      return syncedAt
    } finally {
      running = null
      tell()
    }
  })()
  tell()
  return running
}

/**
 * Background check while a plan card is on screen: about every minute while you use the page, slower while it sits
 * untouched (autoSyncGap: a tab left open overnight made about 400 calls an hour), and at once when you come back.
 */
let autoOn = 0
let autoTimer: ReturnType<typeof setInterval> | null = null
const auto = (minGap: number) => {
  if (document.visibilityState !== 'visible' || running || Date.now() - lastCheckAt < minGap) return
  void syncAll()
}
const onBack = () => auto(5_000)
const onTick = () => auto(autoSyncGap(idleFor()))
// Back after a while: check at once (lastUse.ts notes the touch just after this runs).
const onUse = () => {
  if (idleFor() >= 3 * 60_000) onBack()
}
const USE = ['pointerdown', 'keydown', 'touchstart'] as const
export function startAutoSync(): () => void {
  if (++autoOn === 1) {
    autoTimer = setInterval(onTick, 60_000)
    window.addEventListener('focus', onBack)
    document.addEventListener('visibilitychange', onBack)
    for (const e of USE) window.addEventListener(e, onUse, { passive: true, capture: true })
  }
  onBack()
  return () => {
    if (--autoOn === 0) {
      if (autoTimer) clearInterval(autoTimer)
      autoTimer = null
      window.removeEventListener('focus', onBack)
      document.removeEventListener('visibilitychange', onBack)
      for (const e of USE) window.removeEventListener(e, onUse, { capture: true })
    }
  }
}

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
          {syncErrorText(todoistDown)}{' '}
          <button type="button" className="sync-retry" onClick={() => void syncAll()}>
            Retry
          </button>
        </small>
      )}
      {at > 0 && !busy && !manualFailed && (
        <small className="sync-at" aria-live="polite">
          {syncedLine(at, lastChanges)}
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
  const line = autoSyncLine({ lastCheckAt, lastOkAt: syncedAt, fails, away: idleFor() >= 3 * 60_000 }, Date.now())
  return (
    <span className="plan-sync" data-sync-bar>
      <SyncButton />
      <small className={`plan-sync-auto ${line.tone}`} aria-live="polite">
        {line.text}
      </small>
    </span>
  )
}
