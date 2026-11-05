// The island's log (Settings → Island log), small on purpose: the island
// window imports it too, without the app's data layer. Two lists in this
// PC's storage (the app window and the island window share it):
// - taps: what the app window did for each tap, ✓ or why not;
// - island: what the island window itself saw (IS23): its view changing,
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
export const readIslandUiLog = () => read<IslandUiLogEntry>(ISLAND_UI_LOG)

export function logIsland(e: IslandLogEntry) {
  write(ISLAND_LOG, [...readIslandLog(), e].slice(-30))
}

/**
 * One line from the island window; the same line twice in a row is kept once.
 * It also goes to the desktop's island log (with its own lines), unless it
 * came from there (`local`).
 */
export function logIslandUi(kind: string, text: string, o: { local?: boolean; now?: number } = {}) {
  const list = readIslandUiLog()
  const last = list[list.length - 1]
  if (last && last.kind === kind && last.text === text) return
  const line = String(text).slice(0, 200)
  write(ISLAND_UI_LOG, [...list, { at: new Date(o.now ?? Date.now()).toISOString(), kind, text: line }].slice(-80))
  if (!o.local) {
    try {
      window.desktop?.islandLog?.(`${kind}: ${line}`)
    } catch {
      /* an older desktop */
    }
  }
}
