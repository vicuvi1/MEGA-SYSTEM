// The island's log (Settings → Island log), small on purpose: the island
// window imports it too, without the app's data layer. Two lists:
// - taps: what the app window did for each tap, ✓ or why not;
// - island (in the island window's memory and the desktop's log): what the island window itself saw (IS23): its view changing,
//   the pointer coming and going, the click area it reported, the zoom,
//   why it's hidden or dimmed, and the desktop's own lines (island:diag).
export const ISLAND_LOG = 'ls.islandLog'
export const ISLAND_UI_LOG = 'ls.islandUiLog'
export interface IslandLogEntry { at: string; kind: string; ok: boolean; error?: string }
export interface IslandUiLogEntry { at: string; kind: string; text: string }

const read = <T,>(k: string): T[] => {
  try {
    const v = JSON.parse(localStorage.getItem(k) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* fine */
  }
}

export const readIslandLog = () => read<IslandLogEntry>(ISLAND_LOG)

// ---- SI7: what your recipes did, with a 10-minute Undo ----
export const AUTO_LOG = 'ls.islandAutoLog'
export const UNDO_MS = 10 * 60_000
export type UndoOp = { op: 'stopFocus'; startedAt: number } | { op: 'pcPrefs'; patch: Record<string, unknown> } | { op: 'quietOff' } | { op: 'deleteNote'; id: string }
export interface AutoLogEntry { id: string; at: number; why: string; did: string[]; undo: UndoOp[]; undone?: boolean }
export const readAutoLog = () => read<AutoLogEntry>(AUTO_LOG)
export function logAutomation(e: AutoLogEntry) {
  write(AUTO_LOG, [...readAutoLog().filter((x) => x.id !== e.id), e].slice(-30))
}
export function markUndone(id: string) {
  write(AUTO_LOG, readAutoLog().map((x) => (x.id === id ? { ...x, undone: true } : x)))
}
/** Can it still be undone (10 minutes, not undone yet, something to undo)? */
export const canUndo = (e: AutoLogEntry, now = Date.now()) => !e.undone && e.undo.length > 0 && now - e.at < UNDO_MS
/**
 * What the island window saw: kept in its memory and in the desktop's island
 * log (island:log → Settings → Diagnostics reads it with islandGetLog), never
 * in this PC's storage: every write there woke the app window up (IC7).
 * In the app window this is only an older desktop's leftovers.
 */
const uiLog: IslandUiLogEntry[] = []
export const readIslandUiLog = (): IslandUiLogEntry[] => (uiLog.length ? uiLog.slice() : read<IslandUiLogEntry>(ISLAND_UI_LOG))

export function logIsland(e: IslandLogEntry) {
  write(ISLAND_LOG, [...readIslandLog(), e].slice(-30))
}

/**
 * One line from the island window; the same line twice in a row is kept once.
 * It also goes to the desktop's island log (with its own lines), unless it
 * came from there (`local`).
 */
export function logIslandUi(kind: string, text: string, o: { local?: boolean; now?: number } = {}) {
  const last = uiLog[uiLog.length - 1]
  if (last && last.kind === kind && last.text === text) return
  const line = String(text).slice(0, 200)
  uiLog.push({ at: new Date(o.now ?? Date.now()).toISOString(), kind, text: line })
  if (uiLog.length > 80) uiLog.splice(0, uiLog.length - 80)
  if (!o.local) {
    try {
      window.desktop?.islandLog?.(`${kind}: ${line}`)
    } catch {
      /* an older desktop */
    }
  }
}

/** The island window's old copy in this PC's storage (from before IC7): removed once. */
export function dropOldIslandUiLog() {
  try {
    if (localStorage.getItem(ISLAND_UI_LOG) != null) localStorage.removeItem(ISLAND_UI_LOG)
  } catch {
    /* fine */
  }
}

/**
 * Does a change in this PC's storage (made by another window: the island,
 * an embedded app) mean the app should reload its data? Not for the island's
 * own logs and the app's own small settings ("ls." keys); yes for the apps'
 * data and when everything was cleared (key null).
 */
export const storageWakesApp = (key: string | null) => key == null || !key.startsWith('ls.')
