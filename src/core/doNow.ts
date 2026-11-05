// "Do this now": the ONE next step, decided in one place (pure, tested), with
// the reason it was picked. Today's top row and the Now card both show this.
// Order: a running focus session, a promise Ben is waiting on, a focus block
// in your calendar right now, the evening close, Ben's plan to approve, then
// the day's own list (wake-up, plan, must-dos, late tasks, habits, goals). A
// focus block starting within the hour beats habits and "all done".
import type { NowAction } from './nextAction'

export interface DoNowBlock { id: string; title: string; start: string; end: string }
export interface DoNowInput {
  now: number
  hour: number
  running: { subject: string; title?: string | null } | null
  /** A promise Ben asked about (newest), if any. */
  awaiting?: string | null
  /** Ben proposed today's plan and it waits for your OK. */
  planProposed?: boolean
  /** A focus block in the calendar on right now (10+ minutes left). */
  blockNow?: DoNowBlock | null
  /** The next focus block today. */
  nextBlock?: DoNowBlock | null
  /** The day was closed already (evening review done). */
  dayClosed?: boolean
  /** The day's list, in order (nowActions). */
  actions: NowAction[]
  /** Keys you skipped today. */
  skipped?: string[]
}

export type DoNow =
  | { kind: 'running'; key: string; tag: string; title: string; why: string; button: string }
  | { kind: 'answer'; key: string; tag: string; title: string; why: string; button: string; promise: string }
  | { kind: 'block'; key: string; tag: string; title: string; why: string; button: string; block: DoNowBlock; minutes: number }
  | { kind: 'close-day'; key: string; tag: string; title: string; why: string; button: string }
  | { kind: 'approve'; key: string; tag: string; title: string; why: string; button: string }
  | { kind: 'action'; key: string; tag: string; title: string; why: string; button: string; action: NowAction }

const BUTTON: Record<NowAction['kind'], string> = {
  'stop-focus': 'Stop & log',
  'log-wake': "I'm up",
  plan: 'Plan my day',
  review: 'Close my day',
  mustdo: '▶ 50 min focus',
  'focus-goal': '▶ 50 min focus',
  todo: 'Mark done',
  habit: 'Do it now',
  done: 'See my week'
}

export const actionKey = (a: NowAction) => `${a.kind}:${a.title}`
const hm = (iso: string) => new Date(iso).toTimeString().slice(0, 5)

/** The one thing to do now, and why. */
export function decideNow(i: DoNowInput): DoNow {
  if (i.running) {
    const t = i.running.title || i.running.subject
    return { kind: 'running', key: `running:${t}`, tag: 'Focusing', title: t, why: 'Your timer is running: stay with it until it ends.', button: 'Stop & log' }
  }
  if (i.awaiting) return { kind: 'answer', key: `answer:${i.awaiting}`, tag: 'Ben asks', title: i.awaiting, why: 'You promised this. Ben is waiting to hear if you did it.', button: '✅ Done', promise: i.awaiting }
  const skipped = new Set(i.skipped ?? [])
  if (i.blockNow && !skipped.has(`block:${i.blockNow.id}`)) {
    const left = Math.round((Date.parse(i.blockNow.end) - i.now) / 60000)
    const minutes = Math.max(10, Math.min(180, left))
    return { kind: 'block', key: `block:${i.blockNow.id}`, tag: `Now · ${left} min left`, title: i.blockNow.title, why: `It's in your calendar until ${hm(i.blockNow.end)}. Start the timer so it counts.`, button: `▶ Start · ${minutes} min`, block: i.blockNow, minutes }
  }
  if (i.hour >= 19 && !i.dayClosed && !skipped.has('close-day')) return { kind: 'close-day', key: 'close-day', tag: 'Evening', title: 'Close your day · 2 minutes', why: "It's evening: tick what you finished and set up tomorrow.", button: 'Close my day' }
  if (i.planProposed && i.hour < 18 && !skipped.has('approve')) return { kind: 'approve', key: 'approve', tag: 'Ben planned your day', title: "Approve today's plan", why: 'Blocks go in your calendar, must-dos on Today.', button: '✓ Approve' }
  // The evening close above already covers the review.
  const list = i.actions.filter((a) => a.kind !== 'review' || i.hour < 19 || i.dayClosed)
  const first = list.find((a) => !skipped.has(actionKey(a))) ?? list[0]
  const soon = i.nextBlock && Date.parse(i.nextBlock.start) > i.now && Date.parse(i.nextBlock.start) - i.now < 60 * 60000 ? i.nextBlock : null
  if (soon && !skipped.has(`block:${soon.id}`) && (!first || first.kind === 'habit' || first.kind === 'done')) {
    const minutes = Math.max(10, Math.min(180, Math.round((Date.parse(soon.end) - i.now) / 60000)))
    return { kind: 'block', key: `block:${soon.id}`, tag: `Next · ${hm(soon.start)}`, title: soon.title, why: `Your focus block starts at ${hm(soon.start)}. Starting early counts too.`, button: '▶ Start early', block: soon, minutes }
  }
  const a = first ?? { kind: 'done' as const, title: 'All done for today 🎉', detail: 'You earned it.' }
  const tag = a.kind === 'done' ? 'Done' : a.kind === 'mustdo' ? 'Must-do' : a.kind === 'todo' ? 'Todoist' : a.kind === 'habit' ? 'Habit' : 'Now'
  return { kind: 'action', key: actionKey(a), tag, title: a.title, why: a.detail, button: BUTTON[a.kind], action: a }
}
