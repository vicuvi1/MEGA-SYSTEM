// The small cloud chip in the top bar (website and desktop): what it may say.
// It never says "Backed up" while this device is offline or holds changes the
// server does not have yet (offline audit, 2026-11-18).

export interface SaveChipInput {
  /** The browser says there is a connection. */
  online: boolean
  /** Changes made here and not sent yet (the website's queue plus the desktop's). */
  waiting: number
  /** Why today's cloud backup is missing, if it is. */
  backupError: string | null
  /** When the last cloud backup was saved (shown in the hint). */
  backupAt?: string | null
}

export interface SaveChip {
  tone: 'ok' | 'warn'
  text: string
  /** The longer sentence (hint and screen reader). */
  title: string
}

export function saveChip(i: SaveChipInput): SaveChip {
  const n = Math.max(0, Math.round(i.waiting) || 0)
  if (n > 0) {
    const s = n === 1 ? '' : 's'
    return {
      tone: 'warn',
      text: `${n} waiting`,
      title: `${n} change${s} saved on this device, not sent yet. ${i.online ? 'Sending again shortly.' : 'They go out when you are back online.'} Click to open the Data center.`
    }
  }
  if (!i.online) return { tone: 'warn', text: 'Offline', title: 'No internet. What you change is saved on this device and sent when you are back online. Click to open the Data center.' }
  if (i.backupError) return { tone: 'warn', text: 'Backup missed', title: `Today’s cloud backup didn’t save.\n${i.backupError}\nYour data is safe; only today’s copy is missing. It is tried again by itself. Click to open the Data center.` }
  return { tone: 'ok', text: 'Backed up', title: `Cloud backup saved${i.backupAt ? ` (${i.backupAt})` : ''}. Click to open the Data center.` }
}

/** How long to wait before trying today's cloud backup again: 30 s, 1 min, 2 min … at most 30 min. */
export const backupRetryMs = (fails: number): number => Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, Math.min(10, Math.floor(fails))))
