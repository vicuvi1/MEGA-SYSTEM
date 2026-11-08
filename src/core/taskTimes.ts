// Learned task times (pure and tested, taskTimes.test.ts): how long a kind of
// task really takes you, from the end-of-day check (core/planReview.ts).
//
// A kind is named by the task's words ("lab report", "reading", "gym": the
// first two words that mean something, then the first one), its Todoist
// labels and its Todoist project. Each Done block with a real number (the
// focus timer, or minutes you typed) is one sample: real minutes divided by
// the planner's own plain guess for that title. Comparing with the plain
// guess (not with the block's length, which may already be learned) keeps
// the learning from chasing itself.
//
// Robust on purpose: the median of the last 9 samples of a kind, used only
// with at least 3, and never below 0.5x or above 2.5x the plain guess. Your
// own numbers win over it: a duration on the Todoist task or one you told Ben.
import type { ReviewStore } from './planReview'

export const LAST_N = 9
export const MIN_SAMPLES = 3
export const LOW = 0.5
export const HIGH = 2.5

export interface KindTime {
  /** Median of real ÷ guessed minutes (not yet bounded). */
  ratio: number
  /** Samples behind it (at most LAST_N). */
  n: number
}
/** Kind key → what was learned. Keys: "w:lab report", "w:lab", "l:<label>", "p:<project>". */
export type TaskTimes = Record<string, KindTime>

const STOP = new Set(
  'the a an and or to for of on in at by with from my your his her our this that these those do does did make get go some more today tomorrow tonight morning evening min mins minute minutes hour hours part chapter ch page pages pp task tasks todo work start finish continue'.split(' ')
)

/** Light stemming so "reading" and "read", "reports" and "report" are one kind. */
const stem = (w: string) => (w.length > 5 && w.endsWith('ing') ? w.slice(0, -3) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)

/** The words that name a kind of task: lower case, no emoji, numbers, lengths or filler. */
export function titleWords(title: string): string[] {
  return String(title ?? '')
    .toLowerCase()
    .replace(/\d+\s*(h|hr|hrs|m|min|mins)\b/g, ' ')
    .replace(/[^a-zÀ-ɏЀ-ӿ\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map(stem)
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** The kind keys of a task, most specific first: its first two words, its first word, its labels, its project. */
export function taskKeys(t: { title: string; project?: string | null; labels?: string[] | null }): string[] {
  const w = titleWords(t.title)
  const keys: string[] = []
  if (w.length >= 2) keys.push(`w:${w[0]} ${w[1]}`)
  if (w.length >= 1) keys.push(`w:${w[0]}`)
  for (const l of t.labels ?? []) if (norm(l) && norm(l) !== 'today') keys.push(`l:${norm(l)}`)
  if (t.project && norm(t.project)) keys.push(`p:${norm(t.project)}`)
  return [...new Set(keys)]
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * What the checks teach, newest first per kind. A sample is a Done block of one task (or a block
 * named by its own task) with a real number: the focus timer or minutes you typed.
 */
export function learnTimes(store: ReviewStore, o: { n?: number; before?: string } = {}): TaskTimes {
  const n = o.n ?? LAST_N
  const per = new Map<string, number[]>()
  const days = Object.keys(store.days)
    .filter((d) => !o.before || d < o.before)
    .sort()
    .reverse()
  for (const day of days) {
    const items = Object.values(store.days[day].items).sort((a, b) => b.start.localeCompare(a.start))
    for (const it of items) {
      if (it.outcome !== 'done' || it.src === 'plan' || it.actual == null || it.actual < 5 || it.guess < 5) continue
      if ((it.tasks?.length ?? 0) > 1) continue
      const title = it.tasks?.[0] ?? it.title
      for (const k of taskKeys({ title, project: it.project, labels: it.labels })) {
        const xs = per.get(k) ?? []
        if (xs.length < n) xs.push(it.actual / it.guess)
        per.set(k, xs)
      }
    }
  }
  const out: TaskTimes = {}
  for (const [k, xs] of per) out[k] = { ratio: Math.round(median(xs) * 100) / 100, n: xs.length }
  return out
}

export interface Learned {
  minutes: number
  /** The bounded ratio used. */
  ratio: number
  key: string
  n: number
  /** The plan's why line: "usually takes you 1h40". */
  why: string
}

export const fmtTime = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`)

/**
 * How long this task really takes you, from the most specific kind with enough samples
 * (null: not enough known). `base` is the planner's plain guess for it.
 */
export function learnedTime(t: { content: string; project?: string | null; labels?: string[] | null }, base: number, times: TaskTimes | null | undefined): Learned | null {
  if (!times || !(base > 0)) return null
  for (const key of taskKeys({ title: t.content, project: t.project, labels: t.labels })) {
    const k = times[key]
    if (!k || k.n < MIN_SAMPLES) continue
    const ratio = Math.max(LOW, Math.min(HIGH, k.ratio))
    const minutes = Math.max(10, Math.min(240, Math.round((base * ratio) / 5) * 5))
    return { minutes, ratio, key, n: k.n, why: `usually takes you ${fmtTime(minutes)}` }
  }
  return null
}
