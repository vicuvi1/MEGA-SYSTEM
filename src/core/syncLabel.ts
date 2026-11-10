// Words for the plan card's sync line. Pure, so the wording is easy to test.
const hhmm = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** `away`: nothing touched for a while, so the checks are slower (see autoSyncGap). */
export type SyncView = { lastCheckAt: number; lastOkAt: number; fails: number; away?: boolean }

/**
 * How long the plan card's auto-sync waits between checks, by how long the page has gone untouched: about every
 * minute while you use it, every 3 minutes after 3 idle minutes, every 30 minutes after 15 (the app's own quiet
 * Todoist check still runs, and a change found there refreshes the lists). A tab left open overnight no longer pulls
 * Todoist and Google every minute; touching the page or coming back checks at once.
 */
export function autoSyncGap(idleMs: number): number {
  if (idleMs < 3 * 60_000) return 55_000
  if (idleMs < 15 * 60_000) return 3 * 60_000
  return 30 * 60_000
}

/** "Auto-sync on · last checked 12:04", or a plain warning when checks keep failing. */
export function autoSyncLine(v: SyncView, now: number): { text: string; tone: 'ok' | 'warn' } {
  if (v.fails >= 2) return { text: "Can't reach Todoist, retrying" + (v.lastOkAt ? ` · last synced ${hhmm(v.lastOkAt)}` : ''), tone: 'warn' }
  if (!v.lastCheckAt) return { text: 'Auto-sync on · checking…', tone: 'ok' }
  // Checks run about every minute while you use the page; much longer than that means it was hidden (or you are away).
  const stale = now - v.lastCheckAt > 3 * 60_000
  const why = v.away ? ' (slower while you are away)' : ' (paused while hidden)'
  return { text: `Auto-sync on · last checked ${hhmm(v.lastCheckAt)}${stale ? why : ''}`, tone: 'ok' }
}

/** The error shown next to Retry after a manual Sync fails (Todoist not answering has its own words). */
export function syncErrorText(todoistDown = false): string {
  return todoistDown ? "Can't reach Todoist right now." : "Couldn't sync. Check your connection."
}

/** "Synced 12:04 · 2 changes from Todoist" (the count only when Todoist itself changed something). */
export function syncedLine(at: number, changes: number): string {
  return `Synced ${hhmm(at)}${changes > 0 ? ` · ${changes} change${changes === 1 ? '' : 's'} from Todoist` : ''}`
}
