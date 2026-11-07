// The essay and assignment deadline planner (CR12). Pure and tested.
//
// Enter the due date and the word count; the work is split backward from the
// deadline: submit on the due day, edit the day before, draft sessions (about
// 450 words an hour, at most 50 minutes each, one a day) before that, and the
// outline first. When the days are too few, sessions double up from today
// and the plan says it's tight. A step whose day passed undone means you're
// behind, and Ben says so early.
import { addDays, daysBetween } from '../dates'

export type StepKind = 'outline' | 'draft' | 'edit' | 'submit'
export const STEP_LABEL: Record<StepKind, string> = { outline: 'Outline', draft: 'Draft', edit: 'Edit', submit: 'Submit' }

export interface EssayStep {
  id: string
  kind: StepKind
  /** "Draft 2/3". */
  label: string
  day: string
  minutes: number
  done: boolean
  /** The Todoist task it became, once sent to the planner. */
  taskId?: string
}

export interface Essay {
  id: string
  title: string
  due: string
  words: number
  added: string
  tight: boolean
  steps: EssayStep[]
}

export const WORDS_PER_HOUR = 450
export const MAX_SESSION = 50

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const round5 = (x: number) => Math.max(5, Math.round(x / 5) * 5)

/** The sizes of each step for a piece of this length. */
export function stepSizes(words: number): { outline: number; drafts: number[]; edit: number; submit: number } {
  const w = clamp(Math.round(words) || 0, 100, 20000)
  const draftMin = round5((w / WORDS_PER_HOUR) * 60)
  const n = Math.max(1, Math.ceil(draftMin / MAX_SESSION))
  const each = round5(draftMin / n)
  return { outline: round5(clamp(20 + w / 60, 25, 60)), drafts: Array.from({ length: n }, () => each), edit: round5(clamp((w / 1000) * 30, 25, 60)), submit: 15 }
}

/** The steps, placed backward from the due day (never before today). */
export function planEssay(input: { title: string; due: string; words: number }, today: string, id: string): Essay {
  const size = stepSizes(input.words)
  const due = input.due < today ? today : input.due
  const list: { kind: StepKind; label: string; minutes: number }[] = [
    { kind: 'outline', label: 'Outline', minutes: size.outline },
    ...size.drafts.map((m, i) => ({ kind: 'draft' as const, label: size.drafts.length > 1 ? `Draft ${i + 1}/${size.drafts.length}` : 'Draft', minutes: m })),
    { kind: 'edit', label: 'Edit', minutes: size.edit },
    { kind: 'submit', label: 'Submit', minutes: size.submit }
  ]
  // Ideal: one step a day, the last on the due day.
  const ideal = list.map((_, i) => addDays(due, -(list.length - 1 - i)))
  let days = ideal
  let tight = false
  if (ideal[0] < today) {
    // Not enough days: spread the steps over today..due, in order, a few a day.
    tight = true
    const span = daysBetween(today, due) + 1
    days = list.map((_, i) => addDays(today, Math.min(span - 1, Math.floor((i * span) / list.length))))
    days[days.length - 1] = due
  }
  return {
    id,
    title: input.title.trim().slice(0, 100) || 'Essay',
    due: input.due,
    words: clamp(Math.round(input.words) || 0, 100, 20000),
    added: today,
    tight,
    steps: list.map((s, i) => ({ id: `${id}-${i}`, kind: s.kind, label: s.label, day: days[i], minutes: s.minutes, done: false }))
  }
}

export type EssayState = 'done' | 'on track' | 'behind' | 'late'

export interface EssayStatus {
  state: EssayState
  next: EssayStep | null
  /** Steps whose day passed undone. */
  behind: EssayStep[]
  daysLeft: number
  pct: number
  minutesLeft: number
}

export function essayStatus(e: Essay, today: string): EssayStatus {
  const open = e.steps.filter((s) => !s.done)
  const behind = open.filter((s) => s.day < today)
  const total = e.steps.reduce((t, s) => t + s.minutes, 0)
  const done = e.steps.filter((s) => s.done).reduce((t, s) => t + s.minutes, 0)
  const state: EssayState = !open.length ? 'done' : today > e.due ? 'late' : behind.length ? 'behind' : 'on track'
  return { state, next: open[0] ?? null, behind, daysLeft: daysBetween(today, e.due), pct: total ? Math.round((done / total) * 100) : 0, minutesLeft: total - done }
}

export function tickStep(e: Essay, stepId: string, done: boolean): Essay {
  return { ...e, steps: e.steps.map((s) => (s.id === stepId ? { ...s, done } : s)) }
}

/** Behind? The open steps move up to start today, keeping their order and the due day. */
export function replan(e: Essay, today: string): Essay {
  const open = e.steps.filter((s) => !s.done)
  if (!open.length) return e
  const due = e.due < today ? today : e.due
  const span = daysBetween(today, due) + 1
  const days = open.map((_, i) => addDays(today, Math.min(span - 1, Math.floor((i * span) / open.length))))
  days[days.length - 1] = due
  const byId = new Map(open.map((s, i) => [s.id, days[i]]))
  return { ...e, tight: span < open.length, steps: e.steps.map((s) => (byId.has(s.id) ? { ...s, day: byId.get(s.id)!, taskId: undefined } : s)) }
}

/** The task text for the planner: "Outline: Climate essay (30 min)". */
export const stepTask = (e: Essay, s: EssayStep) => `${s.label}: ${e.title} (${s.minutes} min)`

/** Today's steps across all essays (and the ones you're behind on), for the planner and the study pack. */
export function stepsToday(list: Essay[], today: string): { essay: Essay; step: EssayStep }[] {
  return list.flatMap((e) => e.steps.filter((s) => !s.done && s.day <= today).map((step) => ({ essay: e, step }))).sort((a, b) => a.step.day.localeCompare(b.step.day))
}

/** The essays you're behind on: what Ben flags. */
export function behindFlags(list: Essay[], today: string): string[] {
  return list
    .map((e) => ({ e, st: essayStatus(e, today) }))
    .filter((x) => x.st.state === 'behind' || x.st.state === 'late')
    .map(({ e, st }) => `${e.title}: ${st.behind.length} step${st.behind.length === 1 ? '' : 's'} behind (${st.behind.map((s) => s.label).join(', ')}), due ${st.daysLeft < 0 ? `${-st.daysLeft} days ago` : st.daysLeft === 0 ? 'today' : `in ${st.daysLeft} day${st.daysLeft === 1 ? '' : 's'}`}`)
}

export function essaysLine(list: Essay[], today: string): string {
  const open = list.filter((e) => essayStatus(e, today).state !== 'done')
  if (!open.length) return ''
  return `Essays: ${open
    .slice(0, 3)
    .map((e) => {
      const st = essayStatus(e, today)
      return `${e.title} due ${e.due} (${st.state}${st.next ? `, next: ${st.next.label} ${st.next.day === today ? 'today' : st.next.day}` : ''})`
    })
    .join('; ')}`
}

export function cleanEssays(raw: unknown): Essay[] {
  const day = /^\d{4}-\d{2}-\d{2}$/
  const kinds: StepKind[] = ['outline', 'draft', 'edit', 'submit']
  return (Array.isArray(raw) ? raw : [])
    .filter((e: any) => e && typeof e.id === 'string' && day.test(e.due) && Array.isArray(e.steps))
    .map((e: any) => ({
      id: e.id.slice(0, 40),
      title: String(e.title ?? 'Essay').slice(0, 100),
      due: e.due,
      words: clamp(Number(e.words) || 0, 100, 20000),
      added: day.test(e.added) ? e.added : e.due,
      tight: e.tight === true,
      steps: e.steps
        .filter((s: any) => s && typeof s.id === 'string' && kinds.includes(s.kind) && day.test(s.day))
        .map((s: any) => ({ id: s.id.slice(0, 50), kind: s.kind, label: String(s.label ?? STEP_LABEL[s.kind as StepKind]).slice(0, 30), day: s.day, minutes: clamp(Math.round(Number(s.minutes) || 25), 5, 240), done: s.done === true, ...(typeof s.taskId === 'string' ? { taskId: s.taskId.slice(0, 40) } : {}) }))
    }))
    .slice(0, 60)
}
