// "Sync" on Tasks and Today → Now: pulls Todoist and Google Calendar now, then
// the lists and the day plan read again. A small spinner while it runs and
// "Synced 12:04" after. Every Sync button on screen shows the same time.
import { useEffect, useState } from 'react'
import { life } from '../bridge'
import { checkRemote } from './planStore'
import './planEditor.css'

let syncedAt = 0
let running: Promise<number> | null = null
const subs = new Set<(at: number, busy: boolean) => void>()
const tell = () => subs.forEach((f) => f(syncedAt, !!running))

/** One sync at a time (a second tap waits for the first). */
export function syncAll(): Promise<number> {
  if (running) return running
  running = (async () => {
    try {
      const at = await (life.syncNow?.() ?? Promise.resolve(Date.now()))
      // The day plan takes in what changed in Google and Todoist.
      await checkRemote(true).catch(() => {})
      syncedAt = at
      return at
    } finally {
      running = null
      tell()
    }
  })()
  tell()
  return running
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
      {at > 0 && !busy && (
        <small className="sync-at" aria-live="polite">
          Synced {hhmm(at)}
        </small>
      )}
    </span>
  )
}
