// What the island learns about your day, kept in the database (synced) so
// Ben can use it in the evening review: each focus session's quality (how
// much of it you were at the PC) and what you said when a block ended.
import { getSetting, setSetting } from '../../../main/settings'

export const DAY_LOG = 'island_day_log'

export interface DayLogDay {
  /** pct: the share of the session really spent on it; workMin/distractMin (MC10) only when you share PC totals. */
  focus: { at: string; subject: string; minutes: number; pct: number; workMin?: number; distractMin?: number }[]
  blocks: { at: string; title: string; result: 'done' | 'half' | 'no' }[]
  /** P8: the day's PC totals ("VS Code 3h10, YouTube 35m · work 3h, distracting 40m"), only if you share them. */
  pc?: string
  /** MC11: minutes on listed sites from the browser history ("2 h on YouTube yesterday"), only with that switch on. */
  web?: string
  /** SI8: the day by kind of doing ("coding 3h10, study 1h05, video 55m"), only if you share totals. */
  doing?: string
  /** SI22/SI25: minutes of each kind per hour, only if you share totals. */
  hours?: Record<string, Record<string, number>>
  /** Island eyes: the last short line of what's in front (120 chars), only if you share it with Ben. */
  eyes?: { at: number; line: string }
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

export function setPcLine(db: any, day: string, line: string): void {
  const all = read(db)
  const d = all[day] ?? empty()
  d.pc = line.slice(0, 300)
  all[day] = d
  write(db, all)
}

export function setWebLine(db: any, day: string, line: string): void {
  const all = read(db)
  const d = all[day] ?? empty()
  d.web = line.slice(0, 200)
  all[day] = d
  write(db, all)
}

export function setDoingLine(db: any, day: string, line: string, hours: Record<string, Record<string, number>>): void {
  const all = read(db)
  const d = all[day] ?? empty()
  d.doing = line.slice(0, 200)
  // Only small numbers per hour (kind → minutes), at most 24 hours.
  d.hours = Object.fromEntries(
    Object.entries(hours ?? {})
      .filter(([h]) => /^\d{1,2}$/.test(h) && Number(h) < 24)
      .map(([h, v]) => [h, Object.fromEntries(Object.entries(v ?? {}).filter(([k, n]) => /^[a-z]{2,10}$/.test(k) && Number.isFinite(n)).map(([k, n]) => [k, Math.round(Number(n))]))])
  )
  all[day] = d
  write(db, all)
}

/** Island eyes: what's in front now, one short line (only with "Tell Ben" on). An empty line clears it. */
export function setEyesLine(db: any, day: string, line: string, at: number): void {
  const all = read(db)
  const d = all[day] ?? empty()
  const clean = String(line ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (clean) d.eyes = { at: Number.isFinite(at) ? at : Date.now(), line: clean }
  else delete d.eyes
  all[day] = d
  write(db, all)
}

/** The last days of the log (oldest first), for the morning plan's facts (SI25). */
export function recentDayLogs(db: any, today: string, n = 7): { day: string; d: DayLogDay }[] {
  return Object.entries(read(db))
    .filter(([k]) => k < today)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-n)
    .map(([day, d]) => ({ day, d }))
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
    parts.push(`Focus quality ${pct}% over ${d.focus.length} session${d.focus.length === 1 ? '' : 's'} (share of the time he was really on it)`)
    const drift = d.focus.reduce((t, x) => t + (x.distractMin ?? 0), 0)
    if (d.focus.some((x) => x.distractMin != null)) parts.push(`During focus: ${d.focus.reduce((t, x) => t + (x.workMin ?? 0), 0)} min on work apps, ${drift} min on distracting ones`)
  }
  if (d.blocks.length) {
    const n = (r: string) => d.blocks.filter((x) => x.result === r).length
    parts.push(`Blocks he checked off: ${n('done')} done, ${n('half')} half, ${n('no')} not done${d.blocks.filter((x) => x.result !== 'done').length ? ` (${d.blocks.filter((x) => x.result !== 'done').map((x) => `${x.title}: ${x.result}`).join('; ')})` : ''}`)
  }
  if (d.pc) parts.push(`On his PC today (apps, from the desktop): ${d.pc}`)
  if (d.web) parts.push(`From his browser history: ${d.web}`)
  if (d.doing) parts.push(`His day on the PC by activity: ${d.doing}`)
  return parts.join('. ')
}
