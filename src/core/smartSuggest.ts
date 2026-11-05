// Smart island: the moments worth a suggestion (SI3, SI4, SI13–SI16, SI18,
// SI20) and the fix-it picker (SI1). Each returns a Suggestion for the queue
// (suggest.ts), or null. Pure and tested. They only ever offer to start a
// timer or open something: logging stays your tap (honest points).
import type { IslandBlock } from './islandModel'
import type { ContextKind } from './activityContext'
import { CONTEXT_ICON, CONTEXT_LABEL } from './activityContext'
import type { Suggestion } from './suggest'
import { blockDrift, callNow, workNow, type DoingSpan } from './islandSmart'
import { nextFreeSlot } from './islandActions'
import { bedFromAway } from './bedSense'

const hm = (t: number) => new Date(t).toTimeString().slice(0, 5)
const ago = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60000))
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min ` : ''}ago` : `${m} min ago`
}
/** Minutes in a row (from now back) in these kinds; a 90-s look elsewhere is already folded in by sessionize. */
export function streakIn(spans: DoingSpan[], kinds: string[], now: number): number {
  let t = 0
  for (let i = spans.length - 1; i >= 0; i--) {
    if (!kinds.includes(spans[i].context)) break
    t += (Math.min(now, spans[i].end) - spans[i].start) / 60000
  }
  return Math.round(t * 10) / 10
}

export interface MomentInput {
  now: number
  blocks: IslandBlock[]
  running: boolean
  spans: DoingSpan[]
  /** What you're doing now (the last app event) and how sure. */
  doing: { ctx: ContextKind; detail?: string; conf: number } | null
}

/** SI3: back to your block (video/gaming 3 min during a planned block, no timer). */
export function backToBlock(o: MomentInput): Suggestion | null {
  const d = blockDrift({ now: o.now, blocks: o.blocks, running: o.running, spans: o.spans })
  if (!d) return null
  const b = d.block
  return {
    id: d.id,
    sk: 'back',
    title: `${b.title} block · ${d.left} min left`,
    text: `${d.minutes} min of ${o.doing?.ctx === 'gaming' ? 'gaming' : 'video'}. Back to it?`,
    face: '↩️',
    accept: { label: '↩ Back', action: { kind: 'start', subject: b.title, minutes: Math.min(180, d.left) } },
    ...(b.id && b.calendarId ? { extra: { label: 'Push 15', action: { kind: 'push', block: b, minutes: 15 } } } : {}),
    laterMin: 15
  }
}

/** SI4: you opened a lecture / course (matched to your goals), no timer and no block on: start one? */
export function startFromOpened(o: MomentInput & { goals: string[] }): Suggestion | null {
  if (o.running || !o.doing || callNow(o.blocks, o.now) || workNow(o.blocks, o.now)) return null
  if (!['study', 'coding', 'writing', 'ctf'].includes(o.doing.ctx) || o.doing.conf < 0.6) return null
  const subject = o.doing.detail && o.goals.some((g) => g.toLowerCase() === o.doing!.detail!.toLowerCase() || g.toLowerCase().includes(o.doing!.detail!.toLowerCase())) ? o.doing.detail : null
  if (!subject) return null
  if (streakIn(o.spans, [o.doing.ctx], o.now) < 2) return null
  // As long as the time until your next thing allows (45 min at most, 15 at least).
  const nextStart = o.blocks.filter((b) => b.start > o.now && !b.maybe).sort((a, b) => a.start - b.start)[0]?.start ?? Infinity
  const room = Math.floor((nextStart - o.now) / 60000)
  const slot = nextFreeSlot(o.blocks, o.now - 5 * 60_000, 45)
  const minutes = Math.max(15, Math.min(45, Number.isFinite(room) ? room - 5 : 45))
  if (room < 20) return null
  const hour = Math.floor(new Date(o.now).getHours())
  return {
    id: `start:${subject.toLowerCase()}:${new Date(o.now).toDateString()}:${hour}`,
    sk: 'startBlock',
    title: `Start ${minutes} min · ${subject}?`,
    text: `You opened ${subject}${slot ? `; you're free until ${Number.isFinite(nextStart) ? hm(nextStart) : 'tonight'}` : ''}. A timer makes it count.`,
    face: '📚',
    accept: { label: `▶ ${minutes} min`, action: { kind: 'start', subject, minutes } },
    laterMin: 30
  }
}

/** SI13: gaming in the hour before bed: one more match, then stop? (the bed countdown shows on the pill). */
export function gamingBedtime(o: MomentInput & { windDown: { bedAt: string; minutesLeft: number } | null }): Suggestion | null {
  if (!o.windDown || o.doing?.ctx !== 'gaming' || o.windDown.minutesLeft > 60) return null
  const m = o.windDown.minutesLeft
  return {
    id: `bedgame:${new Date(o.now).toDateString()}`,
    sk: 'bedGaming',
    title: `Bed in ${m} min`,
    text: 'One more match, then stop? The countdown is on the island.',
    face: '🎮',
    accept: { label: '✓ One more, then stop', action: { kind: 'dismiss', id: `bedgame:${new Date(o.now).toDateString()}`, snoozeMin: 25 } },
    extra: { label: '🌙 Close my day', action: { kind: 'closeDay' } },
    laterMin: 20
  }
}

/** SI14: you just left your bank's site: log what you spent? (never reads amounts). */
export function spendAfterBank(o: { now: number; bankLeftAt: number | null }): Suggestion | null {
  if (!o.bankLeftAt || o.now - o.bankLeftAt > 5 * 60_000) return null
  return {
    id: `spend:${o.bankLeftAt}`,
    sk: 'spend',
    title: 'Spent something?',
    text: 'You were just on your bank. Log it in Money while you remember.',
    face: '🧾',
    accept: { label: '＋ Log spending', action: { kind: 'open', page: 'money' } },
    laterMin: 60
  }
}

/** SI15: 10 min of browsing/video/chat with no block, timer or meeting: your next must-do? */
export function nextMustdo(o: MomentInput & { mustdos: { text: string; done: boolean }[] }): Suggestion | null {
  if (o.running || workNow(o.blocks, o.now) || callNow(o.blocks, o.now)) return null
  const next = o.mustdos.find((m) => !m.done)
  if (!next) return null
  const min = streakIn(o.spans, ['browsing', 'video', 'social', 'gaming', 'other'], o.now)
  if (min < 10) return null
  return {
    id: `mustdo:${next.text}:${new Date(o.now).toDateString()}:${Math.floor(new Date(o.now).getHours() / 2)}`,
    sk: 'nextMustdo',
    title: `Next must-do: ${next.text}`,
    text: `${Math.round(min)} min drifting. 25 minutes on it?`,
    face: '🎯',
    accept: { label: '▶ 25 min', action: { kind: 'start', subject: next.text, minutes: 25 } },
    laterMin: 45
  }
}

/** SI16: 15+ min in email outside a block: box it to 10 min? */
export function emailBox(o: MomentInput): Suggestion | null {
  if (o.running || workNow(o.blocks, o.now) || callNow(o.blocks, o.now)) return null
  const min = streakIn(o.spans, ['email'], o.now)
  if (min < 15) return null
  return {
    id: `email:${new Date(o.now).toDateString()}:${Math.floor(new Date(o.now).getHours() / 3)}`,
    sk: 'emailBox',
    title: 'Box email to 10 min?',
    text: `${Math.round(min)} min in mail so far. A 10-minute timer, then out.`,
    face: '✉️',
    accept: { label: '▶ 10 min', action: { kind: 'start', subject: 'Email', minutes: 10 } },
    laterMin: 30
  }
}

/** SI18: 20+ min of video in work hours: back to what you were doing last? */
export function comeBack(o: MomentInput & { last: { subject: string; endedAt: number } | null }): Suggestion | null {
  if (o.running || !o.last || callNow(o.blocks, o.now)) return null
  const d = new Date(o.now)
  const h = d.getHours()
  if (h < 9 || h >= 19 || o.now - o.last.endedAt > 4 * 3600_000) return null
  const min = streakIn(o.spans, ['video'], o.now)
  if (min < 20) return null
  return {
    id: `resume:${o.last.endedAt}`,
    sk: 'resume',
    title: `Last: ${o.last.subject} (${ago(o.now - o.last.endedAt)})`,
    text: `${Math.round(min)} min of video. Pick it back up?`,
    face: '↩️',
    accept: { label: '▶ Resume · 25 min', action: { kind: 'start', subject: o.last.subject, minutes: 25 } },
    laterMin: 30
  }
}

/**
 * SI20: the laptop was closed (locked, asleep) late and opened hours later:
 * that was bedtime? Nothing is logged until you confirm (points only then).
 */
export function bedtimeFromClose(o: { now: number; away: { from: number; to: number } | null; bedLogged: boolean }): Suggestion | null {
  if (!o.away || o.now - o.away.to > 6 * 3600_000) return null
  const time = bedFromAway(new Date(o.away.from), new Date(o.away.to), o.bedLogged)
  if (!time) return null
  return {
    id: `bedclose:${o.away.from}`,
    sk: 'bedtime',
    title: `Bed at ${time}?`,
    text: 'You closed the laptop then. Log it as your bedtime?',
    face: '🌙',
    accept: { label: `✓ Bed at ${time}`, action: { kind: 'bed', time } },
    extra: { label: 'Fix the time', action: { kind: 'open', page: 'sleep' } },
    laterMin: 60,
    own: true
  }
}

/** A meeting just ended (a recipe asked for it): a note while it's fresh? */
export function meetingNote(o: { now: number; endedAt: number; title: string }): Suggestion {
  return {
    id: `note:${o.endedAt}`,
    sk: 'note',
    title: `${o.title} is over`,
    text: 'Two lines while it’s fresh: what was decided, what you do next.',
    face: '📝',
    accept: { label: '📓 Open the notebook', action: { kind: 'open', page: 'notebook' } },
    laterMin: 30,
    own: true
  }
}

/** SI1: "that's not right": pick what you're really doing (it's remembered for this app). */
export function contextPicker(app: string, now: ContextKind): { title: string; text: string; options: { label: string; ctx: ContextKind }[] } {
  const order: ContextKind[] = ['coding', 'study', 'writing', 'ctf', 'email', 'meeting', 'video', 'gaming', 'social', 'browsing']
  const options = order.filter((k) => k !== now).map((k) => ({ label: `${CONTEXT_ICON[k]} ${CONTEXT_LABEL[k]}`, ctx: k }))
  return { title: `What is ${app} for?`, text: `I thought: ${CONTEXT_LABEL[now].toLowerCase()}. Pick the right one: I'll remember it for ${app}.`, options }
}
