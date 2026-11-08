// Coach chat fix (2026-11-08): what the chat shows about how Ben got to an answer
// (pure, tested). How long it took ("3.2 s"), the steps in plain English ("Read
// your sleep log (7 nights)"; the live line turns them into "Reading your sleep
// log…" with coachLooks.doingNow), and a short readable summary of a thinking
// model's reasoning.
import { secs } from './answerCost'

/** "0.4 s", "3.2 s", "12 s", "1 min 5 s"; empty when unknown. */
export function timeText(ms: number | null | undefined): string {
  return ms == null || !Number.isFinite(ms) || ms < 0 ? '' : secs(ms)
}

const LOOKUP_WORDS: Record<string, string> = {
  spending: 'Read your spending',
  money: 'Read your spending',
  focus: 'Read your focus log',
  workouts: 'Read your workouts',
  sleep: 'Read your sleep log',
  sleep7: 'Read your sleep log (7 nights)',
  tasks: 'Read your finished tasks',
  points: 'Read your points',
  goals: 'Read your goals',
  day: 'Read one day in numbers',
  water: 'Read your water log',
  web: 'Searched the web',
  tool: 'Asked one of your tools',
  todoist: 'Read Todoist',
  recall: 'Searched my memory'
}

/** A step as the chat shows it: plain English, no code words. Empty = not worth showing. */
export function plainStep(step: string): string {
  const s = String(step ?? '').trim()
  if (!s || s.startsWith('\u0001')) return ''
  if (/^Reading your day$/i.test(s)) return 'Read your day'
  if (/^Reading your calendar and tasks$/i.test(s)) return 'Read your calendar and Todoist'
  if (/^Logged in code$/i.test(s)) return 'Logged it (no AI needed)'
  if (/^Answered from your data$/i.test(s)) return 'Answered from your data (no AI needed)'
  if (/^Thinking it through$/i.test(s)) return 'Thought it through (thinking model)'
  if (/^Answering faster$/i.test(s)) return 'The thinking model was slow, so the quick model answered'
  if (/^Trying once more$/i.test(s)) return 'The first try failed, so I tried once more'
  const checked = /^Checked (\S+)/i.exec(s)
  if (checked) return LOOKUP_WORDS[checked[1].toLowerCase()] ?? `Looked up ${checked[1]}`
  return s
}

/** The steps for the "N steps" list: plain, in order, no repeats. */
export function plainSteps(steps: readonly string[] | null | undefined): string[] {
  const out: string[] = []
  for (const s of steps ?? []) {
    const p = plainStep(s)
    if (p && !out.includes(p)) out.push(p)
  }
  // "Read your day" says nothing when a real step follows.
  return out.length > 1 ? out.filter((x) => x !== 'Read your day') : out
}

/**
 * A thinking model's reasoning cut to a short readable summary: markdown and
 * scratch work (JSON, code, long lists of numbers) out, the first few whole
 * sentences kept, at most `max` characters. Empty when nothing readable is left.
 */
export function reasoningSummary(raw: string | null | undefined, max = 360): string {
  let t = String(raw ?? '')
  if (!t.trim()) return ''
  t = t
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\{[\s\S]*?\}/g, ' ')
    .replace(/[*_#>`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const sentences = t.split(/(?<=[.!?])\s+/)
  const out: string[] = []
  let len = 0
  for (const s0 of sentences) {
    const s = s0.trim()
    if (!s || s.length < 8) continue
    if (len + s.length > max) {
      if (!out.length) out.push(`${s.slice(0, max - 1).trimEnd()}…`)
      break
    }
    out.push(s)
    len += s.length + 1
    if (out.length >= 4) break
  }
  return out.join(' ')
}
