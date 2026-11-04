// Ben acts instead of judging, pure and tested:
// - a plan still waiting at 10:00 is approved for you (change it any time);
// - a focus block you missed is moved into your next free time, once;
// - when you slip, he names one small step instead of an angry face
//   (angry faces only at tone 5, "drill sergeant").
import { freeGaps, overlapMin, type CalEvent } from './dayTime'
import { fromMin, toMin, quarter } from './rhythm'
import type { Mood } from './coachKit'

/** At 10:00–19:59 a proposed plan nobody approved gets approved. */
export function autoApproveDue(status: 'proposed' | 'approved' | undefined, time: string, already: boolean): boolean {
  return status === 'proposed' && !already && time >= '10:00' && time < '20:00'
}

export interface Missed {
  event: CalEvent
  minutes: number
}

/**
 * Blocks Ben made that ended in the last 40 minutes with under half of them
 * focused, not handled yet. Training blocks (💪) aren't moved.
 */
export function missedBlocks(events: CalEvent[], sessions: { startedAt: string | null; endedAt: string | null }[], now: Date, handled: string[]): Missed[] {
  const t = now.getTime()
  return events
    .filter((e) => e.ours && !e.allDay && !e.title.includes('💪') && !handled.includes(e.id))
    .filter((e) => Date.parse(e.end) <= t && Date.parse(e.end) > t - 40 * 60000)
    .map((e) => {
      const s = Date.parse(e.start)
      const en = Date.parse(e.end)
      const focused = sessions.reduce((sum, x) => sum + (x.startedAt ? overlapMin(s, en, Date.parse(x.startedAt), x.endedAt ? Date.parse(x.endedAt) : t) : 0), 0)
      return { event: e, minutes: Math.round((en - s) / 60000), focused }
    })
    .filter((x) => x.minutes >= 15 && x.focused < x.minutes / 2)
    .map(({ event, minutes }) => ({ event, minutes }))
}

/** The first free time today for a block (from the next quarter hour, before 22:00). */
export function nextSlot(events: CalEvent[], day: string, nowHm: string, minutes: number): { start: string; end: string } | null {
  const gap = freeGaps(events, day, { after: quarter(nowHm), to: '22:00', minMinutes: minutes })[0]
  if (!gap) return null
  return { start: gap.start, end: fromMin(toMin(gap.start) + minutes) }
}

export function movedText(title: string, slot: { start: string; end: string } | null): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return slot
    ? `🔁 <b>${esc(title)}</b> slipped, no problem. I moved it to <b>${slot.start}–${slot.end}</b>, your next free time.\nStart now instead, or drop it for today?`
    : `🔁 <b>${esc(title)}</b> slipped and there's no free time left today. Start a shorter one now, or drop it?`
}

export function autoApprovedText(headline: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `✅ <b>I locked in today's plan</b> so the day doesn't drift: ${esc(headline)}.\nChange anything, any time.`
}

// ---- Tone: angry faces only for the drill sergeant ----------------------

const HOT: Mood[] = ['annoyed', 'angry', 'furious']

/** What Ben shows: at tone 5 his real mood; below it a slipping day shows as focused. */
export function shownMood(m: Mood, tone: number): Mood {
  return tone >= 5 || !HOT.includes(m) ? m : 'focused'
}

/** One kind, useful line instead of "Ben is angry: …". */
export function helpLine(why: string): string {
  if (/no focus yet/.test(why)) return 'No focus yet today. One 25-minute block changes the day.'
  if (/nothing done/.test(why)) return "It's been a while. Pick the smallest step below and start."
  if (/promise/.test(why)) return "Let's keep the next promise small and do it now."
  if (/goal/.test(why)) return 'A goal is behind. One block today puts it back on track.'
  return 'One step at a time. Start with the one below.'
}

/** The "nothing done" nudge: one concrete small step, no anger below tone 5. */
export function nudgeText(n: number, idle: string, first: string | undefined, focusMin: number, tone: number): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  if (tone >= 5) {
    return n === 1
      ? `😤 Nothing done for ${idle}. ${first ? `Your must-do: <b>${esc(first)}</b>.` : `Focus today: ${focusMin} min.`} 25 minutes, starting now.`
      : n <= 3
        ? `😠 Still waiting. ${first ? `<b>${esc(first)}</b> won't do itself.` : 'One focus block.'} Just start the timer, the rest follows.`
        : `😡 Nudge ${n}: you said you want this. ${first ? `<b>${esc(first)}</b>,` : 'One block,'} 25 min. Tap and go.`
  }
  const step = first ? `Open <b>${esc(first)}</b> and do just the first 10 minutes.` : 'Pick anything on your list and give it 10 minutes.'
  return n === 1
    ? `🎯 ${idle === 'all day' ? 'Nothing logged yet today.' : `${idle} since your last thing.`} ${step}`
    : n <= 3
      ? `🎯 Smallest next step: ${step} If something's in the way, tell me and I'll move it.`
      : `🎯 Still here when you're ready. ${step} Or pause me for today.`
}
