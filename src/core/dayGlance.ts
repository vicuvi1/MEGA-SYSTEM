// Today at a glance (pure, T1, T3, T4): what's next with a countdown, one
// summary line ("3 events · 2 blocks · 4h free · done at 18:30 · bed 23:30"),
// and whether you're in a class or meeting right now.
import { isFocusBlock, type CalEvent } from './dayTime'
import { canBeNow, takesTime } from './calResponse'

const hm = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
/** Counts in your day: timed, not declined, not "free", not an invite you haven't answered (IS6). */
const counts = (e: CalEvent) => !e.allDay && !e.free && takesTime(e) && e.eventType !== 'outOfOffice'

/** A class or meeting (not one of your own focus blocks), accepted: a "maybe" is never "now" (IS6). */
export const isMeeting = (e: CalEvent) => counts(e) && canBeNow(e) && !isFocusBlock(e)

/** The class/meeting going on now, if any. */
export function meetingNow(events: CalEvent[], now: number): CalEvent | null {
  return events.filter(isMeeting).find((e) => Date.parse(e.start) <= now && Date.parse(e.end) > now) ?? null
}

/** The next timed thing today (class, meeting or block). */
export function nextUp(events: CalEvent[], now: number): CalEvent | null {
  return events.filter(counts).filter((e) => Date.parse(e.start) > now).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0] ?? null
}

/** "in 23 min", "in 1h 05m", "in 4:59" (under 10 minutes, to the second). */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 600) return `in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const m = Math.round(s / 60)
  return m >= 60 ? `in ${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `in ${m} min`
}

/** One line for the day: events, blocks, free time left (07:00–23:00, from now), when you're done, bedtime. */
export function daySummary(events: CalEvent[], now: number, bedTarget: string | null): { text: string; free: number; events: number; blocks: number; doneAt: string | null } {
  const today = events.filter(counts)
  const meetings = today.filter((e) => !isFocusBlock(e)).length
  const blocks = today.length - meetings
  const d = new Date(now)
  const dayEnd = new Date(d)
  dayEnd.setHours(23, 0, 0, 0)
  const dayStart = new Date(d)
  dayStart.setHours(7, 0, 0, 0)
  const from = Math.max(now, dayStart.getTime())
  // Free minutes: from now to 23:00, minus what's booked (overlaps merged).
  const busy = today.map((e) => [Math.max(from, Date.parse(e.start)), Math.min(dayEnd.getTime(), Date.parse(e.end))] as [number, number]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  let booked = 0
  let cur: [number, number] | null = null
  for (const iv of busy) {
    if (cur && iv[0] <= cur[1]) cur[1] = Math.max(cur[1], iv[1])
    else {
      if (cur) booked += cur[1] - cur[0]
      cur = [...iv]
    }
  }
  if (cur) booked += cur[1] - cur[0]
  const free = Math.max(0, Math.round((dayEnd.getTime() - from - booked) / 60_000))
  const last = today.map((e) => e.end).sort().pop() ?? null
  const freeText = free >= 60 ? `${Math.floor(free / 60)}h${free % 60 >= 30 ? '½' : ''} free` : `${free} min free`
  const parts = [`${meetings} event${meetings === 1 ? '' : 's'}`, `${blocks} block${blocks === 1 ? '' : 's'}`, freeText, ...(last ? [`done at ${hm(last)}`] : []), ...(bedTarget ? [`bed ${bedTarget}`] : [])]
  return { text: parts.join(' · '), free, events: meetings, blocks, doneAt: last ? hm(last) : null }
}
