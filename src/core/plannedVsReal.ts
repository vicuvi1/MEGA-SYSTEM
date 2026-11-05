// Planned vs real time, each week (pure, FT10): per subject, the focus blocks
// you planned (calendar focus blocks, minus the ones you marked skipped)
// against the focus minutes you really did (focus sessions), plus the PC's
// "work" time when you share the PC totals.
export interface PlannedBlock {
  day: string
  subject: string
  minutes: number
  /** Marked on Today: done or skipped (skipped still counts as planned). */
  mark?: 'done' | 'skip' | null
}
export interface RealSession {
  day: string
  subject: string
  minutes: number
}
export interface SubjectTime {
  subject: string
  plannedMin: number
  realMin: number
  /** Blocks you marked skipped. */
  skipped: number
}
export interface WeekTime {
  from: string
  to: string
  rows: SubjectTime[]
  plannedMin: number
  realMin: number
  /** PC "work" minutes for the week, null when the PC doesn't share its totals. */
  pcWorkMin: number | null
  line: string
}

/** "… · work 4h20, distracting 1h" → 260. Null when the line has no work total. */
export function pcWorkMinutes(line: string | null | undefined): number | null {
  const m = /work (\d+)(h|m)(\d{2})?/.exec(String(line ?? ''))
  if (!m) return null
  return m[2] === 'h' ? Number(m[1]) * 60 + Number(m[3] ?? 0) : Number(m[1])
}

const key = (s: string) => s.trim().toLowerCase()
const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? String(Math.round(min % 60)).padStart(2, '0') : ''}` : `${Math.round(min)}m`)

export function weekTime(i: { from: string; to: string; blocks: PlannedBlock[]; sessions: RealSession[]; pcLines?: { day: string; line: string }[] }): WeekTime {
  const inWeek = (d: string) => d >= i.from && d <= i.to
  const rows = new Map<string, SubjectTime>()
  const row = (subject: string) => {
    const k = key(subject) || 'focus'
    if (!rows.has(k)) rows.set(k, { subject: subject.trim() || 'Focus', plannedMin: 0, realMin: 0, skipped: 0 })
    return rows.get(k)!
  }
  for (const b of i.blocks.filter((x) => inWeek(x.day))) {
    const r = row(b.subject)
    r.plannedMin += Math.max(0, Math.round(b.minutes))
    if (b.mark === 'skip') r.skipped++
  }
  for (const s of i.sessions.filter((x) => inWeek(x.day))) row(s.subject).realMin += Math.max(0, Math.round(s.minutes))
  const list = [...rows.values()].filter((r) => r.plannedMin || r.realMin).sort((a, b) => b.plannedMin + b.realMin - (a.plannedMin + a.realMin))
  const plannedMin = list.reduce((t, r) => t + r.plannedMin, 0)
  const realMin = list.reduce((t, r) => t + r.realMin, 0)
  const pcDays = (i.pcLines ?? []).filter((x) => inWeek(x.day)).map((x) => pcWorkMinutes(x.line)).filter((x): x is number => x != null)
  const pcWorkMin = pcDays.length ? pcDays.reduce((t, x) => t + x, 0) : null
  const worst = list.filter((r) => r.plannedMin >= 30).sort((a, b) => a.realMin / a.plannedMin - b.realMin / b.plannedMin)[0]
  const line = !list.length
    ? ''
    : `⏱ Planned vs real: ${hm(plannedMin)} planned, ${hm(realMin)} done${plannedMin ? ` (${Math.round((realMin / plannedMin) * 100)}%)` : ''}${pcWorkMin != null ? `, PC work ${hm(pcWorkMin)}` : ''}. ${list.slice(0, 4).map((r) => `${r.subject} ${hm(r.realMin)}/${hm(r.plannedMin)}`).join(', ')}${worst && worst.realMin < worst.plannedMin * 0.6 ? `. Biggest gap: ${worst.subject}.` : '.'}`
  return { from: i.from, to: i.to, rows: list, plannedMin, realMin, pcWorkMin, line }
}
