// What the island learns about your day, kept in the database (synced) so
// Ben can use it in the evening review: each focus session's quality (how
// much of it you were at the PC) and what you said when a block ended.
import { getSetting, setSetting } from '../../../main/settings'

export const DAY_LOG = 'island_day_log'

export interface DayLogDay {
  focus: { at: string; subject: string; minutes: number; pct: number }[]
  blocks: { at: string; title: string; result: 'done' | 'half' | 'no' }[]
}
type All = Record<string, DayLogDay>

const read = (db: any): All => {
  try {
    const v = JSON.parse(getSetting(db, DAY_LOG) || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}
const write = (db: any, all: All) => {
  const keep = Object.keys(all).sort().slice(-45)
  setSetting(db, DAY_LOG, JSON.stringify(Object.fromEntries(keep.map((k) => [k, all[k]]))))
}
const empty = (): DayLogDay => ({ focus: [], blocks: [] })

export function addFocusQuality(db: any, day: string, e: DayLogDay['focus'][number]): void {
  const all = read(db)
  const d = all[day] ?? empty()
  d.focus = [...d.focus.filter((x) => x.at !== e.at), e]
  all[day] = d
  write(db, all)
}

export function addBlockResult(db: any, day: string, e: DayLogDay['blocks'][number]): void {
  const all = read(db)
  const d = all[day] ?? empty()
  d.blocks = [...d.blocks.filter((x) => x.title !== e.title), e]
  all[day] = d
  write(db, all)
}

export function dayLog(db: any, day: string): DayLogDay {
  return read(db)[day] ?? empty()
}

/** One line for Ben: "Focus quality 82% (3 sessions). Blocks: 2 done, 1 half, 1 not done." */
export function dayLogLine(d: DayLogDay): string {
  const parts: string[] = []
  if (d.focus.length) {
    const mins = d.focus.reduce((t, x) => t + x.minutes, 0) || 1
    const pct = Math.round(d.focus.reduce((t, x) => t + x.pct * x.minutes, 0) / mins)
    parts.push(`Focus quality ${pct}% over ${d.focus.length} session${d.focus.length === 1 ? '' : 's'} (share of the time he was really at the PC)`)
  }
  if (d.blocks.length) {
    const n = (r: string) => d.blocks.filter((x) => x.result === r).length
    parts.push(`Blocks he checked off: ${n('done')} done, ${n('half')} half, ${n('no')} not done${d.blocks.filter((x) => x.result !== 'done').length ? ` (${d.blocks.filter((x) => x.result !== 'done').map((x) => `${x.title}: ${x.result}`).join('; ')})` : ''}`)
  }
  return parts.join('. ')
}
