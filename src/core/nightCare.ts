// Quiet care at night (CL5, CL9): when to install a desktop update and when a
// long-open window starts fresh. Pure: the desktop shell and the website
// pass in the hour, how long the PC has been idle and the memory in use.

const MB = 1024 * 1024

/** CL9 (website): a hidden tab reloads quietly at 04:00 after 3+ days open, or any time it holds 250+ MB. */
export function quietReloadDue(i: { hidden: boolean; hour: number; ageMs: number; heapBytes?: number | null }): boolean {
  if (!i.hidden) return false
  if ((i.heapBytes ?? 0) > 250 * MB) return true
  return i.hour === 4 && i.ageMs > 3 * 86400_000
}

/** CL9 (desktop): at 04:00, nobody at the PC for 20+ minutes and a window over 300 MB: reload the windows. */
export function memoryReloadDue(i: { hour: number; idleSec: number; memBytes: number }): boolean {
  return i.hour === 4 && i.idleSec > 20 * 60 && i.memBytes > 300 * MB
}

export type UpdateState = 'idle' | 'dev' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'ready' | 'installing' | 'error'

/**
 * CL5: install a downloaded update now? At the quiet hour (04:00–04:59) with
 * nobody at the PC for 30+ minutes and no focus timer running; or at once when
 * the website said this app is too old for the database (it can't save).
 */
export function installNow(i: { state: UpdateState | string; hour: number; idleSec: number; focusRunning: boolean; schemaOld?: boolean }): boolean {
  if (i.state !== 'ready') return false
  if (i.schemaOld) return true
  return i.hour === 4 && i.idleSec > 30 * 60 && !i.focusRunning
}
