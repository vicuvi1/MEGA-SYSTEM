import { calendarDay } from './dates'
// Ben answers without the AI when he can (pure, tested):
// - B3: common short questions ("what now?", "water?", "my streak?", "spent
//   this week?", "focus this month?") come from your own data, instantly;
// - B9: a question about history ("how much did I study in October?") gets
//   its numbers looked up BEFORE the AI is asked, so it answers in one go;
// - B10: "undo that" and "that was water, not money" are fixed in code.

export type Topic = 'spending' | 'focus' | 'workouts' | 'sleep' | 'tasks' | 'points'

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => calendarDay(d)
const at = (day: string) => new Date(`${day}T12:00:00`)
const plus = (day: string, n: number) => {
  const d = at(day)
  d.setDate(d.getDate() + n)
  return ymd(d)
}
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MONTH_RE = new RegExp(`\\b(${MONTHS.map((m) => m.slice(0, 3)).join('|')})[a-z]*\\b`)

/** "today", "yesterday", "this/last week", "this/last month", "in October", "last 7 days" → a date range. */
export function rangeOf(text: string, today: string): { from: string; to: string; label: string } | null {
  const t = text.toLowerCase()
  const dow = (at(today).getDay() + 6) % 7 // Monday = 0
  const monday = plus(today, -dow)
  const first = `${today.slice(0, 8)}01`
  if (/\byesterday\b|\bieri\b/.test(t)) return { from: plus(today, -1), to: plus(today, -1), label: 'yesterday' }
  if (/\btoday\b|\bazi\b/.test(t)) return { from: today, to: today, label: 'today' }
  if (/\blast week\b|\bsaptamana trecuta\b|\bsăptămâna trecută\b/.test(t)) return { from: plus(monday, -7), to: plus(monday, -1), label: 'last week' }
  if (/\bthis week\b|\bweek\b|\bsaptamana\b|\bsăptămâna\b/.test(t)) return { from: monday, to: today, label: 'this week' }
  const lastN = /\b(?:last|past) (\d{1,3}) days\b/.exec(t)
  if (lastN) return { from: plus(today, -(Math.min(400, Number(lastN[1])) - 1)), to: today, label: `the last ${lastN[1]} days` }
  if (/\blast month\b|\bluna trecuta\b|\bluna trecută\b/.test(t)) {
    const d = at(first)
    d.setMonth(d.getMonth() - 1)
    const from = ymd(d)
    return { from, to: plus(first, -1), label: 'last month' }
  }
  if (/\bthis month\b|\bmonth\b|\bluna\b/.test(t)) return { from: first, to: today, label: 'this month' }
  const m = MONTH_RE.exec(t)
  if (m && /\b(in|during|for|from|of|on)\s+\w+/.test(t)) {
    const idx = MONTHS.findIndex((x) => x.startsWith(m[1]))
    let year = Number(today.slice(0, 4))
    if (idx > Number(today.slice(5, 7)) - 1) year -= 1 // "in December" in November = last December
    const from = `${year}-${pad(idx + 1)}-01`
    const end = new Date(year, idx + 1, 0)
    const to = ymd(end) > today ? today : ymd(end)
    return { from, to, label: MONTHS[idx][0].toUpperCase() + MONTHS[idx].slice(1) }
  }
  return null
}

/** What a question is about. */
export function topicOf(text: string): Topic | null {
  const t = text.toLowerCase()
  if (/\b(spen[td]|spending|spent|money|cheltuit|cheltuieli|bani|expenses?)\b/.test(t)) return 'spending'
  if (/\b(focus(ed)?|stud(y|ied|ying)|learn(ed|t)?|invatat|învățat)\b/.test(t)) return 'focus'
  if (/\b(workouts?|train(ed|ing)?|gym|exercis(e|ed)|antrenament)\b/.test(t)) return 'workouts'
  if (/\b(sleep|slept|wake[- ]?ups?|woke|somn|trezit)\b/.test(t)) return 'sleep'
  if (/\b(tasks?|must-?dos?|todos?|sarcini)\b/.test(t)) return 'tasks'
  if (/\b(points?|coins?|puncte)\b/.test(t)) return 'points'
  return null
}

/** B9: lookups to run before the first AI call (a question about a time range). */
export function preLookups(text: string, today: string): string[] {
  if (!/\?|\b(how much|how many|how often|did i|have i|cat|câ[tț]|cate|câte)\b/i.test(text)) return []
  if (/\b(left|remaining|open|due|upcoming|tomorrow|still to)\b/i.test(text)) return []
  const topic = topicOf(text)
  const r = rangeOf(text, today)
  if (topic === 'tasks' && !/\b(done|did|finished|completed|ticked)\b/i.test(text)) return []
  return topic && r ? [`${topic} ${r.from} ${r.to}`] : []
}

export type Quick = { kind: 'now' } | { kind: 'water' } | { kind: 'streak' } | { kind: 'wrong' } | { kind: 'lookup'; need: string; label: string; topic: Topic }

/**
 * B3: a short, plain question Ben can answer from the data. Anything with a
 * number in it is a log ("spent 50"), never a question; anything longer or
 * asking "why"/"should"/"plan" goes to the AI.
 */
export function quickKind(text: string, today: string): Quick | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ')
  // SI23: "what am I doing wrong (today)?": numbers first, one push.
  if (/^(what am i doing wrong|what('s| is) going wrong|where am i (slipping|failing)|what am i messing up)( today)?[?!. ]*$/.test(t)) return { kind: 'wrong' }
  // "What should I do now?" is answered from the data ("Do this now"): checked before the
  // words below ("should") send it to the thinking model (that took ~17 s).
  const q0 = t.replace(/[?!.…]+$/g, '').trim()
  if (/^(ok |so |and )?(what now|now what|what('s| is) next|next|what should i do( now| next)?|what do i do( now| next)?|ce fac( acum)?|ce urmeaza|что делать( сейчас)?)$/.test(q0)) return { kind: 'now' }
  // "What should I focus on right now?", "what should I be doing now?": the same, from the data
  // (the model once answered it with a made-up "meeting" at 19:50).
  if (/^(ok |so |and )?(what|which thing) (should|do|shall|must) i (focus on|work on|be doing|be working on|do)( (right )?now| at the moment| next)?$/.test(q0)) return { kind: 'now' }
  if (/^(what('s| is) (my|the) (focus|priority|one thing)( (right )?now)?|what am i (supposed|meant) to (be doing|do)( (right )?now)?)$/.test(q0)) return { kind: 'now' }
  if (!t || /\d/.test(t) || t.split(' ').length > 8 || /\b(why|should|plan|move|add|log|book|remind|help|but|because|and then)\b/.test(t)) return null
  const q = q0
  if (/^((how much )?water( today)?|how much water( have i (had|drunk))?( today)?|my water|apa( azi)?)$/.test(q)) return { kind: 'water' }
  if (/^((my |show my )?streaks?|how('s| is| are) my streaks?|seria( mea)?)$/.test(q)) return { kind: 'streak' }
  // History only: "left", "open", "due", "tomorrow" ask about what's ahead (the AI knows the open tasks).
  if (/\b(left|remaining|open|due|upcoming|next|tomorrow|still|to do|todo)\b/.test(q)) return null
  const topic = topicOf(q)
  const r = rangeOf(q, today)
  if (topic === 'tasks' && !/\b(done|did|finished|completed|ticked)\b/.test(q)) return null
  if (topic && r && /^(how much |how many |what did i |did i |my |show (me )?(my )?)?[a-z\- ]*$/.test(q)) return { kind: 'lookup', need: `${topic} ${r.from} ${r.to}`, label: r.label, topic }
  return null
}

const ICON: Record<Topic, string> = { spending: '💸', focus: '⏱', workouts: '💪', sleep: '😴', tasks: '✅', points: '🪙' }

/** A plan block or calendar event, in local "HH:MM" (what "now" answers from). */
export interface NowSlot {
  title: string
  start: string
  end: string
  kind: 'block' | 'event'
}

const hmOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const minOf = (hm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}

/**
 * Where he is now and what really comes next, from today's plan blocks and the calendar he
 * has (null = calendar not known). Only these real items are named; nothing is guessed.
 * `after` (ms): look for "next" after this moment (a running timer's end).
 */
export function nowSlots(
  blocks: { title: string; start: string; minutes: number }[],
  events: { title: string; start: string; end: string; allDay?: boolean }[] | null,
  now: Date,
  after?: number
): { current: NowSlot | null; next: NowSlot | null } {
  const day = ymd(now)
  const all: (NowSlot & { s: number; e: number })[] = []
  for (const b of blocks) {
    const s = minOf(b.start)
    if (!Number.isFinite(s)) continue
    const e = s + Math.max(5, b.minutes || 0)
    all.push({ title: b.title, start: b.start, end: `${pad(Math.floor(e / 60) % 24)}:${pad(e % 60)}`, kind: 'block', s, e })
  }
  for (const ev of events ?? []) {
    if (ev.allDay) continue
    const st = new Date(ev.start)
    const en = new Date(ev.end)
    if (!Number.isFinite(st.getTime()) || ymd(st) !== day) continue
    const s = st.getHours() * 60 + st.getMinutes()
    const e = Number.isFinite(en.getTime()) ? (ymd(en) === day ? en.getHours() * 60 + en.getMinutes() : 24 * 60) : s + 30
    // The plan's own block in the calendar is the same thing once.
    if (all.some((x) => x.s === s && x.title.toLowerCase() === ev.title.toLowerCase())) continue
    all.push({ title: ev.title, start: hmOf(st), end: hmOf(en), kind: 'event', s, e })
  }
  all.sort((a, b) => a.s - b.s || (a.kind === 'event' ? -1 : 1))
  const t = now.getHours() * 60 + now.getMinutes()
  const from = after != null ? Math.max(t, new Date(after).getHours() * 60 + new Date(after).getMinutes()) : t
  const current = all.find((x) => x.s <= t && x.e > t) ?? null
  const next = all.find((x) => x.s >= from && x !== current && x.s > t) ?? null
  const strip = (x: (typeof all)[number] | null): NowSlot | null => (x ? { title: x.title, start: x.start, end: x.end, kind: x.kind } : null)
  return { current: strip(current), next: strip(next) }
}

export interface QuickData {
  move?: { kind: string; title: string; sub: string; subject?: string; minutes?: number; endsAt?: number }
  /** "What now?": the plan block or event he is in, and the real next one (never guessed). */
  slots?: { current: NowSlot | null; next: NowSlot | null; calendarKnown: boolean }
  water?: { ml: number; target: number }
  streaks?: { training: number; clean: number; focusWeekMin: number; wakeOnTime?: string }
  /** The looked-up answer for a lookup (answerLocal). */
  found?: string | null
  /** SI23: today so far: focus vs goal, must-dos, and the day by activity (only when shared from the desktop). */
  wrong?: { focusMin: number; focusGoal: number; mustDone: number; mustTotal: number; nextMust: string | null; doing: string | null }
}

const mm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m}m`)
/** SI23: the biggest leak in "video 1h10, coding 35m" (video, gaming or chat & social). */
export function biggestLeak(doing: string | null): { kind: string; text: string; min: number } | null {
  if (!doing) return null
  const list = doing.split(/,\s*/).map((p) => {
    const m = /^([a-z/ &]+?)\s+(?:(\d+)h)?(\d+)?m?$/i.exec(p.trim())
    if (!m) return null
    const h = Number(m[2] ?? 0)
    const min = h * 60 + Number(m[3] ?? 0)
    return { kind: m[1].trim(), text: p.trim(), min }
  })
  return list.filter((x): x is NonNullable<typeof x> => !!x && ['video', 'gaming', 'social'].includes(x.kind) && x.min >= 15).sort((a, b) => b.min - a.min)[0] ?? null
}

/** SI23: numbers first, then the one thing to fix, then one push (a button). */
export function wrongReply(w: NonNullable<QuickData['wrong']>): QuickReply {
  const nums = [`⏱ focus ${mm(w.focusMin)} of ${mm(w.focusGoal)}`, `✅ must-dos ${w.mustDone}/${w.mustTotal}`, ...(w.doing ? [`🖥 ${w.doing}`] : [])].join(' · ')
  const leak = biggestLeak(w.doing)
  const behind = w.focusMin < w.focusGoal * 0.5
  const what = leak ? `Biggest leak: ${leak.text} of ${leak.kind}. That's your focus gap right there.` : behind ? `You're under half your focus goal.` : w.mustDone < w.mustTotal ? 'Focus is fine, but must-dos are open.' : "Honestly? Not much. Don't get cocky."
  const target = w.nextMust ?? null
  return {
    reply: `${nums}\n${what}${target ? ` One push: 25 min on “${target}”, now.` : ' One push: 25 minutes, now.'}`,
    chips: ['What now?'],
    buttons: [{ label: `▶ 25 min ${target ?? 'Focus'}`.slice(0, 32), do: `focus:25:${target ?? 'Focus'}` }]
  }
}

export interface QuickReply {
  reply: string
  chips: string[]
  buttons: { label: string; do: string }[]
}

/** The reply in Ben's voice, from templates. null when the data isn't there (then the AI answers). */
export function quickReply(q: Quick, d: QuickData, now = new Date()): QuickReply | null {
  if (q.kind === 'now') {
    const m = d.move
    if (!m) return null
    const sl = d.slots
    const nextLine = sl?.next ? ` Next: ${sl.next.title} at ${sl.next.start}.` : sl && sl.calendarKnown ? ' Nothing else on your calendar or plan today.' : ''
    // A running timer comes first: its real end time, then the real next item.
    if (m.kind === 'running') {
      const ends = m.endsAt ? hmOf(new Date(m.endsAt)) : null
      return { reply: `🎯 ${m.title}. ${m.sub.replace(/\.$/, '')}${ends && /min left/.test(m.sub) ? ` (until ${ends})` : ''}.${nextLine}`, chips: ['Give me 10 min', 'Something else?'], buttons: [] }
    }
    // In a plan block (or a calendar event) now: that is the answer, with its real times.
    const cur = sl?.current
    if (cur && m.kind !== 'answer' && m.kind !== 'approve') {
      const left = Math.max(5, minOf(cur.end) - (now.getHours() * 60 + now.getMinutes()))
      const subject = cur.title.replace(/\(.*?\)/g, '').trim().slice(0, 28) || 'Focus'
      return cur.kind === 'block'
        ? { reply: `🎯 Now: ${cur.title} (${cur.start}–${cur.end}), ${left} min left.${nextLine}`, chips: ['Something else?', 'Give me 10 min'], buttons: [{ label: `▶ ${Math.min(left, 90)} min ${subject}`.slice(0, 32), do: `focus:${Math.min(left, 90)}:${subject}` }] }
        : { reply: `🎯 You're in ${cur.title} until ${cur.end}.${nextLine}`, chips: ['Something else?'], buttons: [] }
    }
    // The next plan block IS the suggested work: say so once, with its real time.
    if (m.kind === 'focus' && sl?.next?.kind === 'block' && m.subject && sl.next.title.toLowerCase().includes(m.subject.toLowerCase().split(' ')[0])) {
      const minutes = m.minutes ?? 25
      return { reply: `🎯 ${sl.next.title} is next on your plan at ${sl.next.start}. Start it now: ${minutes} min?`, chips: ['Something else?', 'Give me 10 min'], buttons: [{ label: `▶ ${minutes} min ${m.subject}`.slice(0, 32), do: `focus:${minutes}:${m.subject}` }] }
    }
    const buttons =
      m.kind === 'focus' && m.subject && m.minutes
        ? [{ label: `▶ ${m.minutes} min ${m.subject}`.slice(0, 32), do: `focus:${m.minutes}:${m.subject}` }]
        : m.kind === 'approve'
          ? [{ label: '✅ Approve', do: 'approve' }]
          : m.kind === 'plan'
            ? [{ label: '🗓 Plan my day', do: 'plan' }]
            : []
    return { reply: `🎯 ${m.title}. ${m.sub}${nextLine}`, chips: m.kind === 'answer' ? ['Done ✅', 'Not yet'] : ['Something else?', 'Give me 10 min'], buttons }
  }
  if (q.kind === 'wrong') return d.wrong ? wrongReply(d.wrong) : null
  if (q.kind === 'water') {
    const w = d.water
    if (!w || !w.target) return null
    const h = now.getHours() + now.getMinutes() / 60
    const pace = Math.min(1, Math.max(0, (h - 8) / 13))
    const behind = w.ml < w.target * pace - 250
    const left = Math.max(0, w.target - w.ml)
    return {
      reply: `💧 ${(w.ml / 1000).toFixed(1)} of ${(w.target / 1000).toFixed(1)} L today.${left ? (behind ? ` You're behind: a glass now, and ${Math.ceil(left / 250)} more through the day.` : ` ${(left / 1000).toFixed(1)} L to go, you're on pace.`) : ' Goal done 🔥'}`,
      chips: left ? ['Water 250', 'Water 500'] : ['Nice'],
      buttons: []
    }
  }
  if (q.kind === 'streak') {
    const s = d.streaks
    if (!s) return null
    const fh = s.focusWeekMin >= 60 ? `${Math.floor(s.focusWeekMin / 60)}h${s.focusWeekMin % 60 ? ` ${s.focusWeekMin % 60}m` : ''}` : `${s.focusWeekMin} min`
    const best = s.training >= 3 || s.clean >= 7 ? ' 🔥 Keep it alive today.' : ' One good day starts the next streak.'
    return { reply: `🔥 Training ${s.training} day${s.training === 1 ? '' : 's'} · clean ${s.clean} day${s.clean === 1 ? '' : 's'} · focus this week ${fh}${s.wakeOnTime ? ` · wake-ups ${s.wakeOnTime}` : ''}.${best}`, chips: ['What now?', 'Plan my day'], buttons: [] }
  }
  if (!d.found || /not available|give dates/.test(d.found)) return null
  return { reply: `${ICON[q.topic]} ${d.found}`, chips: q.topic === 'spending' ? ['Where can I cut?', 'Last week?'] : ['Compare last week', 'What now?'], buttons: [] }
}

/** B10: corrections Ben can do himself. */
export function codeFix(text: string): 'undo' | 'water' | null {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, '')
  if (/^(undo( (that|it|the last( one)?))?|take (that|it) back|cancel (that|it)|anuleaz[aă]( asta)?|șterge asta|sterge asta)$/.test(t)) return 'undo'
  if (t.split(/\s+/).length <= 9 && (/\b(that|it|this) (was|is|'s) water\b|\bthat'?s water\b|\bwas water\b/.test(t) || (/\bnot money\b|\bnot an expense\b/.test(t) && /\bwater\b/.test(t)))) return 'water'
  return null
}

/** The amount on a "done" line ("💸 Water 250 lei · Food" → 250). */
export function amountIn(line: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)/.exec(line.replace(/\b\d{1,2}:\d{2}\b/g, ''))
  if (!m) return null
  const n = Math.round(Number(m[1].replace(',', '.')))
  return n >= 50 && n <= 3000 ? n : null
}
