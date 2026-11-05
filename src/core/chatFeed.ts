// Night 7: how Ben's chat is laid out. The log is a list of messages; the feed
// is what the Coach page shows:
// - Ben's automatic messages (nudges) are told apart from the conversation (CN1),
// - a nudge about something already on screen updates it instead of
//   repeating it ("reminded twice", CN3),
// - time-bound nudges settle once their time is past (CN4),
// - messages in a row are grouped (CN6), with parts of the day (CN7),
// - and a "New since 11:45" line where unread messages start (CN8).
// Pure: no DOM, no React.

export interface FeedEntry {
  role: 'me' | 'coach'
  text: string
  at: string
  proactive?: boolean
  pending?: boolean
  done?: string[]
}

export type NudgeKind = 'plan' | 'water' | 'block' | 'calendar' | 'mood' | 'idle' | 'slip' | 'reminder' | 'other'
/** 'raw' = every message, nothing folded or replaced (while searching). */
export type Filter = 'all' | 'talk' | 'nudges' | 'logged' | 'raw'

export interface NudgeInfo {
  title?: string
  /** "14:00" */
  time?: string
  /** "15:40" */
  end?: string
  minutes?: number
}

export type FeedItem =
  | { t: 'divider'; key: string; label: string }
  | { t: 'new'; key: string; since: string }
  | { t: 'fold'; key: string; entries: number[]; label: string }
  | { t: 'msg'; key: string; i: number; kind: NudgeKind | 'talk'; grouped: boolean; repeats: number; settled: boolean; info: NudgeInfo }

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '')

/** What kind of automatic message this is, from its words. */
export function nudgeKind(text: string): NudgeKind {
  const t = stripTags(text).trim()
  if (/^(📅|🚶)/u.test(t)) return 'calendar'
  if (/(starts at \d{1,2}:\d{2}|is on now)/i.test(t) && /start the timer/i.test(t)) return 'block'
  if (/how do you feel right now|how was today, really/i.test(t)) return 'mood'
  if (/^💧/u.test(t) || /\bwater\b.*\b(of|\/)\s*\d/i.test(t)) return 'water'
  if (/your plan for today|^\W*your day\b|must-dos\b[\s\S]*approve/i.test(t)) return 'plan'
  if (/since your last thing|pick anything on your list/i.test(t)) return 'idle'
  if (/yesterday slipped|never miss twice/i.test(t)) return 'slip'
  if (/^(🔔|⏰)/u.test(t)) return 'reminder'
  return 'other'
}

/** The title, time and length in a block or calendar nudge. */
export function nudgeInfo(text: string, kind: NudgeKind): NudgeInfo {
  const t = stripTags(text).replace(/^[\p{Extended_Pictographic}️‍\s]+/u, '').trim()
  if (kind === 'block') {
    const m = t.match(/^(.*?)\s+(?:starts at (\d{1,2}:\d{2})|is on now)/i)
    const min = t.match(/(\d+)\s*min/)
    return { title: m?.[1]?.trim(), time: m?.[2], minutes: min ? Number(min[1]) : undefined }
  }
  if (kind === 'calendar') {
    const first = t.split('\n')[0]
    const title = first.replace(/\s+(in \d+\s*min|now|starts?.*)$/i, '').trim()
    const range = t.match(/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/)
    const inMin = first.match(/in (\d+)\s*min/i)
    return { title, time: range?.[1], end: range?.[2], minutes: inMin ? Number(inMin[1]) : undefined }
  }
  return {}
}

/** CL5: the message without its leading emoji (the card or label carries one icon). */
export function tidyText(text: string): { icon: string | null; text: string } {
  const m = text.match(/^\s*((?:[\p{Extended_Pictographic}️‍]+\s*)+)/u)
  if (!m) return { icon: null, text: text.trim() }
  const icon = m[1].trim().match(/[\p{Extended_Pictographic}](?:️|‍[\p{Extended_Pictographic}])*/u)?.[0] ?? null
  return { icon, text: text.slice(m[0].length).trim() }
}

const PARTS: [number, string][] = [
  [5, 'Night'],
  [12, 'Morning'],
  [17, 'Afternoon'],
  [22, 'Evening'],
  [24, 'Night']
]
/** CN7: the part of the day for a local hour. */
export function partOfDay(hour: number): string {
  return PARTS.find(([to]) => hour < to)![1]
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

function dayName(d: Date, now: Date): string {
  const t = localDay(now)
  const y = localDay(new Date(now.getTime() - 86400000))
  const k = localDay(d)
  if (k === t) return 'Today'
  if (k === y) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

/** A time-bound nudge whose time is past (CN4). */
export function isSettled(e: FeedEntry, kind: NudgeKind, info: NudgeInfo, now: Date): boolean {
  if (kind !== 'block' && kind !== 'calendar') return false
  const at = new Date(e.at)
  let start: number | null = null
  if (info.time) {
    const [h, m] = info.time.split(':').map(Number)
    const d = new Date(at)
    d.setHours(h, m, 0, 0)
    start = d.getTime()
  } else if (kind === 'calendar' && info.minutes != null) start = at.getTime() + info.minutes * 60000
  else if (kind === 'block') start = at.getTime()
  if (start == null) return false
  // A block counts as past 10 minutes after it starts (time to start the timer).
  return now.getTime() > start + (kind === 'block' ? 10 : 0) * 60000
}

/** Same thing on the same day (a later one replaces an earlier one). */
function sameKey(e: FeedEntry, kind: NudgeKind, info: NudgeInfo): string | null {
  const day = localDay(new Date(e.at))
  if (kind === 'plan' || kind === 'water' || kind === 'mood' || kind === 'idle' || kind === 'slip') return `${day}|${kind}`
  if ((kind === 'block' || kind === 'calendar') && info.title) return `${day}|event|${info.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`
  return null
}

const FOLD_NAMES: Partial<Record<NudgeKind, string>> = { plan: 'plan', water: 'water', block: 'focus block', calendar: 'calendar', mood: 'mood', idle: 'nudge', slip: 'nudge', reminder: 'reminder' }

/**
 * The feed for the Coach page. `seenAt` is when you last had the chat open
 * (for the "new" line); `filter` narrows it (CM5).
 */
export function buildFeed(log: FeedEntry[], opts: { now?: Date; seenAt?: string | null; filter?: Filter } = {}): FeedItem[] {
  const now = opts.now ?? new Date()
  const filter = opts.filter ?? 'all'
  const meta = log.map((e) => {
    const kind: NudgeKind | 'talk' = e.role === 'coach' && e.proactive ? nudgeKind(e.text) : 'talk'
    const info = kind === 'talk' ? {} : nudgeInfo(e.text, kind)
    return { kind, info, key: kind === 'talk' ? null : sameKey(e, kind, info) }
  })
  // CN3: a later nudge about the same thing replaces the earlier ones.
  const repeats = new Map<number, number>()
  const hidden = new Set<number>()
  if (filter === 'all') {
    const lastOf = new Map<string, number>()
    meta.forEach((m, i) => m.key && lastOf.set(m.key, i))
    meta.forEach((m, i) => {
      if (!m.key) return
      const last = lastOf.get(m.key)!
      if (last !== i) {
        hidden.add(i)
        repeats.set(last, (repeats.get(last) ?? 0) + 1)
      }
    })
  }
  const keep = (i: number) => {
    const e = log[i]
    if (hidden.has(i)) return false
    if (filter === 'talk') return meta[i].kind === 'talk'
    if (filter === 'nudges') return meta[i].kind !== 'talk'
    if (filter === 'logged') return !!e.done?.length
    return true
  }
  const idx = log.map((_, i) => i).filter(keep)

  // CN1: in a run of automatic messages, the older ones fold into one line; the latest shows.
  const fold = new Map<number, number[]>() // first index of a run → the folded indexes
  const folded = new Set<number>()
  if (filter === 'all') {
    let run: number[] = []
    const flush = () => {
      if (run.length >= 2) {
        const older = run.slice(0, -1)
        fold.set(older[0], older)
        older.forEach((k) => folded.add(k))
      }
      run = []
    }
    for (const i of idx) {
      const e = log[i]
      if (e.role === 'coach' && e.proactive && !e.pending) run.push(i)
      else flush()
    }
    flush()
  }

  const seen = opts.seenAt ? Date.parse(opts.seenAt) : NaN
  let newShown = !Number.isFinite(seen)
  const out: FeedItem[] = []
  let prevDay = ''
  let prevPart = ''
  let prev: { role: string; at: number; proactive: boolean } | null = null
  for (const i of idx) {
    const e = log[i]
    // BG15: an entry hidden inside a fold (not the fold's first) adds nothing,
    // so no divider or "new" line is drawn for it.
    if (folded.has(i) && !fold.get(i)) continue
    const d = new Date(e.at)
    const day = localDay(d)
    const part = partOfDay(d.getHours())
    if (day !== prevDay || part !== prevPart) {
      out.push({ t: 'divider', key: `d${i}`, label: day !== prevDay ? `${dayName(d, now)} · ${part}` : part })
      prevDay = day
      prevPart = part
      prev = null
    }
    if (!newShown && e.role === 'coach' && Date.parse(e.at) > seen) {
      out.push({ t: 'new', key: `n${i}`, since: hm(new Date(seen)) })
      newShown = true
      prev = null
    }
    if (folded.has(i)) {
      const group = fold.get(i)
      if (group) {
        const kinds = [...new Set(group.map((k) => FOLD_NAMES[meta[k].kind as NudgeKind] ?? 'update'))]
        out.push({ t: 'fold', key: `f${i}`, entries: group, label: `${group.length} earlier update${group.length > 1 ? 's' : ''} from Ben${kinds.length <= 3 ? ` (${kinds.join(', ')})` : ''}` })
        prev = null
      }
      continue
    }
    const at = Date.parse(e.at)
    const grouped = !!prev && prev.role === e.role && prev.proactive === !!e.proactive && at - prev.at < 10 * 60000
    const m = meta[i]
    out.push({ t: 'msg', key: `m${i}`, i, kind: m.kind, grouped, repeats: repeats.get(i) ?? 0, settled: m.kind !== 'talk' && isSettled(e, m.kind, m.info, now), info: m.info })
    prev = { role: e.role, at, proactive: !!e.proactive }
  }
  return out
}

/** CM3: the / shortcuts in the message box. */
export const SLASH: { cmd: string; hint: string; say: string }[] = [
  { cmd: '/plan', hint: "Today's plan", say: 'Plan my day around my calendar.' },
  { cmd: '/water', hint: 'Log water, e.g. /water 250', say: 'water 250' },
  { cmd: '/focus', hint: 'Start focus, e.g. /focus 25', say: 'Start a 25 minute focus block on my most important task.' },
  { cmd: '/rescue', hint: 'Shrink the rest of today', say: 'Rescue my day: shrink the rest of today to fit what I can still do.' },
  { cmd: '/left', hint: "What's left today", say: "What's left today?" },
  { cmd: '/week', hint: 'How was my week', say: 'How was my week, honestly?' },
  { cmd: '/tired', hint: "I'm tired", say: "I'm tired. What's the smallest useful thing I can do now?" }
]

/** What a slash line means: the message to send, or null if it isn't one. */
export function readSlash(line: string): string | null {
  const m = line.trim().match(/^\/(\w+)(?:\s+(.*))?$/)
  if (!m) return null
  const cmd = `/${m[1].toLowerCase()}`
  const arg = (m[2] ?? '').trim()
  if (cmd === '/water') return `water ${/^\d{2,4}$/.test(arg) ? arg : '250'}`
  if (cmd === '/focus') {
    const n = Number(arg.match(/\d+/)?.[0] ?? 25)
    const what = arg.replace(/\d+\s*(min)?/, '').trim()
    return `Start a ${Math.max(5, Math.min(180, n))} minute focus block${what ? ` on ${what}` : ' on my most important task'}.`
  }
  const hit = SLASH.find((s) => s.cmd === cmd)
  if (!hit) return null
  return arg ? `${hit.say} ${arg}` : hit.say
}

/** CM2: up to 3 suggestions that fit the moment. */
export function momentChips(x: { hour: number; planStatus: 'none' | 'proposed' | 'approved'; blockSoon?: string | null; mustLeft: number; replyChips?: string[] }): string[] {
  const out: string[] = []
  if (x.blockSoon) out.push(`Start ${x.blockSoon}`)
  if (x.planStatus === 'none' && x.hour < 15) out.push('Plan my day')
  if (x.replyChips?.length) out.push(...x.replyChips)
  if (x.hour >= 15 && x.mustLeft > 1) out.push('Rescue my day')
  if (x.mustLeft > 0) out.push("What's left today?")
  if (x.hour >= 13 && x.hour < 18) out.push("I'm tired")
  if (x.hour >= 21) out.push('Review my day')
  if (!out.length) out.push('What should I focus on right now?')
  return [...new Set(out)].slice(0, 3)
}
