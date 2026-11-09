// Words for the plan card's sync line. Pure, so the wording is easy to test.
const hhmm = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export type SyncView = { lastCheckAt: number; lastOkAt: number; fails: number }

/** "Auto-sync on · last checked 12:04", or a plain warning when checks keep failing. */
export function autoSyncLine(v: SyncView, now: number): { text: string; tone: 'ok' | 'warn' } {
  if (v.fails >= 2) return { text: "Can't reach Todoist, retrying" + (v.lastOkAt ? ` · last synced ${hhmm(v.lastOkAt)}` : ''), tone: 'warn' }
  if (!v.lastCheckAt) return { text: 'Auto-sync on · checking…', tone: 'ok' }
  // Checks run about every minute while the page is visible; much longer than that means it was hidden.
  const stale = now - v.lastCheckAt > 3 * 60_000
  return { text: `Auto-sync on · last checked ${hhmm(v.lastCheckAt)}${stale ? ' (paused while hidden)' : ''}`, tone: 'ok' }
}

/** The error shown next to Retry after a manual Sync fails (Todoist not answering has its own words). */
export function syncErrorText(todoistDown = false): string {
  return todoistDown ? "Can't reach Todoist right now." : "Couldn't sync. Check your connection."
}

/** "Synced 12:04 · 2 changes from Todoist" (the count only when Todoist itself changed something). */
export function syncedLine(at: number, changes: number): string {
  return `Synced ${hhmm(at)}${changes > 0 ? ` · ${changes} change${changes === 1 ? '' : 's'} from Todoist` : ''}`
}
