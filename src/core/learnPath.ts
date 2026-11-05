// The cyber security learning path (pure, FT8): a ladder per track, like the
// calisthenics skill paths. You log what you did (a CTF solved, a Rust
// chapter, a crypto topic) with a tag and an optional link; each track climbs
// a step at set counts. Ben reads it to pick the next block's subject. The
// tracker itself pays no points (focus time already does).
import { addDays, daysBetween } from './dates'

export const LEARN_LOG = 'learn_log'

export type LearnTrack = 'ctf' | 'rust' | 'crypto'

export interface LearnEntry {
  id: string
  track: LearnTrack
  title: string
  tag: string
  link: string | null
  day: string
}

export interface LearnStep {
  at: number
  name: string
}
export interface TrackDef {
  label: string
  /** What one entry is ("CTF solved", "chapter"). */
  unit: string
  /** The focus subject a block for it gets. */
  subject: string
  placeholder: string
  steps: LearnStep[]
}

export const TRACKS: Record<LearnTrack, TrackDef> = {
  ctf: {
    label: 'CTFs',
    unit: 'challenge',
    subject: 'CTF',
    placeholder: 'e.g. picoCTF: Buffer overflow 1',
    steps: [
      { at: 1, name: 'First flag' },
      { at: 5, name: 'Warm-up solver' },
      { at: 15, name: 'Regular' },
      { at: 30, name: 'Team-ready' },
      { at: 60, name: 'Hunter' },
      { at: 100, name: 'Veteran' }
    ]
  },
  rust: {
    label: 'Rust',
    unit: 'chapter',
    subject: 'Rust',
    placeholder: 'e.g. Ch 4: Ownership',
    steps: [
      { at: 1, name: 'Hello, Rust' },
      { at: 4, name: 'Ownership' },
      { at: 8, name: 'Structs, enums, errors' },
      { at: 12, name: 'Traits and generics' },
      { at: 16, name: 'Concurrency' },
      { at: 20, name: 'The whole book' }
    ]
  },
  crypto: {
    label: 'Crypto',
    unit: 'topic',
    subject: 'Crypto',
    placeholder: 'e.g. RSA basics',
    steps: [
      { at: 1, name: 'Basics' },
      { at: 3, name: 'Classic ciphers' },
      { at: 6, name: 'Symmetric crypto' },
      { at: 10, name: 'Public key' },
      { at: 15, name: 'Attacks' },
      { at: 20, name: 'Protocols' }
    ]
  }
}
export const TRACK_IDS = Object.keys(TRACKS) as LearnTrack[]

const DAY = /^\d{4}-\d{2}-\d{2}$/
const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const cleanLink = (s: unknown) => {
  const t = clip(s, 300)
  return /^https?:\/\/\S+$/i.test(t) ? t : null
}

export function cleanLearn(v: any): LearnEntry[] {
  return (Array.isArray(v) ? v : [])
    .filter((e: any) => e && TRACK_IDS.includes(e.track) && clip(e.title, 120) && DAY.test(e.day))
    .map((e: any) => ({ id: clip(e.id, 40) || `l${e.day}`, track: e.track, title: clip(e.title, 120), tag: clip(e.tag, 30).toLowerCase(), link: cleanLink(e.link), day: e.day }))
    .slice(-500)
}

export function addLearn(list: LearnEntry[], e: { track: LearnTrack; title: string; tag?: string; link?: string | null }, today: string, now = new Date()): LearnEntry[] {
  if (!TRACK_IDS.includes(e.track)) throw new Error('Pick CTFs, Rust or Crypto')
  const title = clip(e.title, 120)
  if (!title) throw new Error(`Say what you did, ${TRACKS[e.track].placeholder}`)
  const link = e.link ? cleanLink(e.link) : null
  if (e.link && String(e.link).trim() && !link) throw new Error('A link starts with https://')
  return [...list, { id: `l${now.getTime().toString(36)}${list.length % 100}`, track: e.track, title, tag: clip(e.tag, 30).toLowerCase().replace(/^#/, ''), link, day: today }].slice(-500)
}

export const removeLearn = (list: LearnEntry[], id: string) => list.filter((e) => e.id !== id)

export interface TrackView {
  track: LearnTrack
  label: string
  unit: string
  count: number
  /** Steps reached. */
  level: number
  total: number
  current: string | null
  next: LearnStep | null
  lastDay: string | null
  recent: LearnEntry[]
  tags: string[]
}

export function learnLadders(list: LearnEntry[]): TrackView[] {
  return TRACK_IDS.map((track) => {
    const def = TRACKS[track]
    const mine = list.filter((e) => e.track === track)
    const count = mine.length
    const level = def.steps.filter((s) => count >= s.at).length
    const tagCount = new Map<string, number>()
    for (const e of mine) if (e.tag) tagCount.set(e.tag, (tagCount.get(e.tag) ?? 0) + 1)
    return {
      track,
      label: def.label,
      unit: def.unit,
      count,
      level,
      total: def.steps.length,
      current: level ? def.steps[level - 1].name : null,
      next: def.steps[level] ?? null,
      lastDay: mine.length ? mine.map((e) => e.day).sort().slice(-1)[0] : null,
      recent: [...mine].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 4),
      tags: [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t)
    }
  })
}

/** The next block's subject: the track left alone the longest (never started counts as longest). */
export function nextSubject(list: LearnEntry[], today: string): { track: LearnTrack; subject: string; why: string } | null {
  if (!list.length) return null
  const v = [...learnLadders(list)].sort((a, b) => (a.lastDay ?? '').localeCompare(b.lastDay ?? ''))[0]
  const ago = v.lastDay ? daysBetween(v.lastDay, today) : null
  const toNext = v.next ? `${v.next.at - v.count} more to "${v.next.name}"` : 'ladder complete'
  return { track: v.track, subject: TRACKS[v.track].subject, why: ago == null ? `not started yet; ${toNext}` : `last ${ago === 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago} days ago`}; ${toNext}` }
}

/** Ben's one line about the path (or ''). */
export function learnLine(list: LearnEntry[], today: string): string {
  if (!list.length) return ''
  const views = learnLadders(list)
  const week = list.filter((e) => e.day >= addDays(today, -6)).length
  const n = nextSubject(list, today)
  return `Cyber security path: ${views.map((v) => `${v.label} ${v.count} (${v.current ?? 'not started'}${v.next ? `, next "${v.next.name}" at ${v.next.at}` : ''})`).join('; ')}. ${week} logged this week.${n ? ` Suggest the next study block's subject: ${n.subject} (${n.why}).` : ''}`
}
