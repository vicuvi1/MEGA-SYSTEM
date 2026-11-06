// Coach UI v3: the day's plan as a timeline for Ben's plan card. Pure: the
// blocks (and the training slot) sorted, with their place on a bar from the
// first start to the last end, a colour by what they are, and where "now" is.
import { fromMin, toMin, type DayProposal } from './rhythm'

export type PlanTone = 'build' | 'study' | 'train' | 'read' | 'life'

export interface PlanItem {
  title: string
  start: string
  end: string
  minutes: number
  tone: PlanTone
  train: boolean
  /** Place on the bar, 0–1. */
  left: number
  width: number
  state: 'past' | 'now' | 'next' | 'later'
}

export interface PlanTimeline {
  items: PlanItem[]
  from: string
  to: string
  /** Where now is on the bar (0–1), or null when outside it. */
  now: number | null
  totalMin: number
}

export function planTone(title: string, train = false): PlanTone {
  const t = title.toLowerCase()
  if (train || /\b(gym|train|run|workout|sport|push-?ups?|walk|swim)\b/.test(t)) return 'train'
  if (/\b(read|book|pages?)\b/.test(t)) return 'read'
  if (/\b(dev|code|coding|app|build|ship|rust|ctf|project|write|thesis|design)\b/.test(t)) return 'build'
  if (/\b(study|learn|exam|course|lecture|revise|homework|algebra|maths?|deep)\b/.test(t)) return 'study'
  return 'life'
}

export function planTimeline(plan: Pick<DayProposal, 'blocks' | 'training'>, nowMin: number): PlanTimeline {
  const raw = [
    ...plan.blocks.map((b) => ({ title: b.title, s: toMin(b.start), m: Math.max(5, b.minutes), train: false })),
    ...(plan.training ? [{ title: plan.training.what, s: toMin(plan.training.time), m: 60, train: true }] : [])
  ]
    .filter((x) => Number.isFinite(x.s))
    .sort((a, b) => a.s - b.s)
  if (!raw.length) return { items: [], from: '', to: '', now: null, totalMin: 0 }
  const from = raw[0].s
  const to = Math.max(...raw.map((x) => x.s + x.m))
  const span = Math.max(30, to - from)
  let nextSeen = false
  const items = raw.map((x): PlanItem => {
    const end = x.s + x.m
    let state: PlanItem['state'] = 'later'
    if (end <= nowMin) state = 'past'
    else if (x.s <= nowMin) state = 'now'
    else if (!nextSeen) state = 'next'
    if (state === 'next') nextSeen = true
    return { title: x.title, start: fromMin(x.s), end: fromMin(end), minutes: x.m, tone: planTone(x.title, x.train), train: x.train, left: (x.s - from) / span, width: x.m / span, state }
  })
  return {
    items,
    from: fromMin(from),
    to: fromMin(to),
    now: nowMin >= from && nowMin <= to ? (nowMin - from) / span : null,
    totalMin: raw.filter((x) => !x.train).reduce((t, x) => t + x.m, 0)
  }
}

/** "4h 10m", "45 min". */
export const fmtMinutes = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ''}` : `${n} min`)
