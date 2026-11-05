// Settings → PC & automation, the desktop's own switches (kept in
// pc-extra.json on this PC, never synced). Every one is OFF until you turn it
// on. Pure and tested.

export interface PcExtraPrefs {
  /** AU1: pause the music when a focus block starts, play it again when it ends. */
  pauseMusic: boolean
  /** AU1: the island shows what's playing (title, artist) with play/pause/next. */
  islandMedia: boolean
  /** AU2: read ActivityWatch (localhost:5600) when it runs. */
  activityWatch: boolean
  /** AU2: Ben sees the last hour as a short summary (app names, sites, minutes). */
  shareLastHour: boolean
  /** AU7: Ben may ask to do things on this PC (each one needs your tap). */
  benActions: boolean
}

export const DEFAULT_PC_EXTRA: PcExtraPrefs = { pauseMusic: false, islandMedia: false, activityWatch: false, shareLastHour: false, benActions: false }

export function cleanPcExtra(v: unknown): PcExtraPrefs {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const out = { ...DEFAULT_PC_EXTRA }
  for (const k of Object.keys(DEFAULT_PC_EXTRA) as (keyof PcExtraPrefs)[]) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean
  return out
}

/** One line in the PC actions log (this PC only, the last 60). */
export interface PcActLogLine { at: number; what: string; result: 'done' | 'refused' | 'failed' | 'denied'; why?: string }

export function addActLog(list: PcActLogLine[], e: PcActLogLine): PcActLogLine[] {
  return [...(Array.isArray(list) ? list : []), { ...e, what: String(e.what).slice(0, 120), ...(e.why ? { why: String(e.why).slice(0, 120) } : {}) }].slice(-60)
}
