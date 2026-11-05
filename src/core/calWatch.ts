// Calendar watch (pure): what changed in today's and tomorrow's calendar
// since Ben last looked: a class added or cancelled. Ben's own focus blocks
// and all-day events don't count, nor anything already over.
export interface SeenEvent { title: string; start: string; end: string }
export type Seen = Record<string, SeenEvent>
export interface CalChange { kind: 'added' | 'cancelled'; ev: SeenEvent; text: string; freeMin?: number }

const hm = (iso: string) => new Date(iso).toTimeString().slice(0, 5)
const day = (iso: string, now: Date) => {
  const d = new Date(iso)
  const t = new Date(now)
  return d.toDateString() === t.toDateString() ? 'today' : 'tomorrow'
}

export function calendarChanges(prev: Seen | null, now: Seen, at: Date, firstMustDo?: string | null): CalChange[] {
  if (!prev) return [] // the first look only remembers
  const out: CalChange[] = []
  const live = (e: SeenEvent) => Date.parse(e.end) > at.getTime()
  for (const [id, e] of Object.entries(now)) {
    if (!prev[id] && live(e)) out.push({ kind: 'added', ev: e, text: `📅 New in your calendar: <b>${e.title}</b> ${day(e.start, at)} at ${hm(e.start)}. I'll plan around it.` })
  }
  for (const [id, e] of Object.entries(prev)) {
    if (!now[id] && live(e) && Date.parse(e.start) > at.getTime()) {
      const freeMin = Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60000)
      out.push({ kind: 'cancelled', ev: e, freeMin, text: `❌ <b>${e.title}</b> ${day(e.start, at)} at ${hm(e.start)} is gone from your calendar: ${freeMin} free minutes.${firstMustDo ? ` Use them for “${firstMustDo}”?` : ' Use them for a focus block?'}` })
    }
  }
  return out.slice(0, 3)
}
