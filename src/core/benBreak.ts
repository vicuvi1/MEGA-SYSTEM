// TL2: break a big task into steps. Pure and tested (benBreak.test.ts).
//
// "Break down 'harder sport system implement'" → 3–6 steps with estimates,
// added as Todoist tasks ("<task> · <step> (25 min)"). The model writes the
// steps when it can; otherwise a plan by kind of task (study, code, write…)
// is used. A big task pushed back more than 2 days gets a "Break it down"
// chip under the day plan by itself.

import { normalize } from './benNormalize'
import { kindOf } from './benLearn'
import { estimateMinutes } from './dayPacker'

export interface Step {
  title: string
  minutes: number
}

/** "break down X", "split X into steps", "imparte X in pasi", "разбей X" → X, or null. */
export function readBreakdown(text: string): string | null {
  const t = String(text ?? '').trim().replace(/[.!?]+$/, '')
  const m =
    /^(?:please\s+|can you\s+)?(?:break(?:\s+down)?|split|chunk)\s+(?:down\s+)?['"“]?(.{3,100}?)['"”]?(?:\s+(?:down|into (?:small )?(?:steps|parts|pieces|subtasks)))?$/i.exec(t) ??
    /^(?:imparte|împarte|sparge)\s+['"“]?(.{3,100}?)['"”]?(?:\s+in (?:pasi|pași|bucati|bucăți))?$/i.exec(t) ??
    /^(?:разбей|раздели)\s+['"“]?(.{3,100}?)['"”]?(?:\s+на (?:шаги|части|этапы))?$/iu.exec(t)
  if (!m) return null
  const x = m[1].replace(/^(?:the task|task|my task|the|my)\s+/i, '').trim()
  return x.length >= 3 && !/^(it|that|this|asta|это)$/i.test(x) ? x : null
}

const PLANS: Record<string, [string, number][]> = {
  code: [
    ['Write down what "done" means (3 bullet points)', 10],
    ['Sketch the parts and the order to build them', 20],
    ['Build the smallest working piece', 45],
    ['Add the next piece and test it', 45],
    ['Clean up and write a short note on what changed', 20]
  ],
  write: [
    ['Collect sources and notes', 25],
    ['Outline: 3–5 headings', 15],
    ['Write the rough first draft', 50],
    ['Edit for clarity and length', 30],
    ['Final read and submit', 15]
  ],
  study: [
    ['List the topics and what is asked', 10],
    ['Read / watch the first topic and take notes', 40],
    ['Do practice problems', 40],
    ['Review mistakes and weak spots', 25],
    ['Quick self-test from memory', 15]
  ],
  read: [
    ['Skim the chapter headings', 10],
    ['Read the first half with notes', 30],
    ['Read the second half with notes', 30],
    ['Write a 5-line summary', 10]
  ],
  chores: [
    ['Clear the surfaces', 10],
    ['Sort what goes where', 15],
    ['Clean / wash', 20],
    ['Take out the trash', 5]
  ],
  other: [
    ['Decide what "done" looks like', 10],
    ['Do the first small part', 25],
    ['Do the main part', 45],
    ['Check it and wrap up', 15]
  ]
}

/** Steps without the model: a plan by kind of task. */
export function templateSteps(task: string): Step[] {
  const k = kindOf(task)
  const plan = PLANS[k] ?? PLANS[k === 'sport' ? 'other' : k === 'admin' ? 'other' : 'other']
  return plan.map(([title, minutes]) => ({ title, minutes }))
}

/** The prompt for the model (asks for JSON only). */
export function breakdownPrompt(task: string, lang: 'en' | 'ro' | 'ru' = 'en'): string {
  return [
    `Break this task into 3 to 6 concrete steps a student can start right away: "${task.slice(0, 120)}".`,
    'Each step: a short title (max 8 words, starts with a verb) and honest minutes (5–90).',
    `Write the titles in ${lang === 'ro' ? 'Romanian' : lang === 'ru' ? 'Russian' : 'English'}.`,
    'Answer with JSON only: {"steps":[{"title":"...","minutes":25}]}'
  ].join('\n')
}

/** The model's steps, cleaned (3–6, minutes 5–90), or null when unusable. */
export function parseSteps(raw: string): Step[] | null {
  try {
    const json = String(raw ?? '').match(/\{[\s\S]*\}/)?.[0]
    const j = json ? JSON.parse(json) : null
    const steps = (Array.isArray(j?.steps) ? j.steps : [])
      .map((s: any) => ({ title: String(s?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 70), minutes: Math.max(5, Math.min(90, Math.round(Number(s?.minutes) || 25))) }))
      .filter((s: Step) => s.title.length >= 3)
      .slice(0, 6)
    return steps.length >= 3 ? steps : null
  } catch {
    return null
  }
}

/** The Todoist line for one step ("Essay · Outline: 3–5 headings (15 min)"). */
export function stepTask(task: string, s: Step, due?: string): string {
  const base = task.length > 40 ? `${task.slice(0, 39)}…` : task
  return `${base} · ${s.title} (${s.minutes} min)${due ? ` ${due}` : ''}`
}

// ---- Pushed back: big tasks that keep moving ------------------------------------

export const BEN_PUSHBACKS = 'ben_pushbacks'
/** Task key → the first day it was seen still open and due (or overdue). */
export type Pushbacks = Record<string, string>

export function cleanPushbacks(raw: unknown): Pushbacks {
  if (!raw || typeof raw !== 'object') return {}
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v as string))) as Pushbacks
}

const keyOf = (t: { id?: string; content: string }) => (t.id ? `#${t.id}` : normalize(t.content))

/** Keeps the first day each open task was due; tasks no longer open are forgotten. */
export function notePushbacks(p: Pushbacks, open: { id?: string; content: string }[], today: string): Pushbacks {
  const out: Pushbacks = {}
  for (const t of open) out[keyOf(t)] = p[keyOf(t)] ?? today
  return out
}

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}

/** Big tasks (45 minutes or more) still open more than 2 days after they were first due: worth breaking down. */
export function staleBig(p: Pushbacks, open: { id?: string; content: string; duration?: number | null; priority?: number }[], today: string): string[] {
  return open.filter((t) => (p[keyOf(t)] ?? today) < addDays(today, -2) && estimateMinutes(t) >= 45 && !/ · /.test(t.content)).map((t) => t.content)
}
