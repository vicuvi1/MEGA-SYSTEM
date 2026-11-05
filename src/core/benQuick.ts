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

export type Quick = { kind: 'now' } | { kind: 'water' } | { kind: 'streak' } | { kind: 'lookup'; need: string; label: string; topic: Topic }

/**
 * B3: a short, plain question Ben can answer from the data. Anything with a
 * number in it is a log ("spent 50"), never a question; anything longer or
 * asking "why"/"should"/"plan" goes to the AI.
 */
export function quickKind(text: string, today: string): Quick | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!t || /\d/.test(t) || t.split(' ').length > 8 || /\b(why|should|plan|move|add|log|book|remind|help|but|because|and then)\b/.test(t)) return null
  const q = t.replace(/[?!.…]+$/g, '').trim()
  if (/^(what now|now what|what('s| is) next|next|what should i do( now)?|what do i do( now)?|ce fac( acum)?|ce urmeaza)$/.test(q)) return { kind: 'now' }
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

export interface QuickData {
  move?: { kind: string; title: string; sub: string; subject?: string; minutes?: number }
  water?: { ml: number; target: number }
  streaks?: { training: number; clean: number; focusWeekMin: number; wakeOnTime?: string }
  /** The looked-up answer for a lookup (answerLocal). */
  found?: string | null
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
    const buttons =
      m.kind === 'focus' && m.subject && m.minutes
        ? [{ label: `▶ ${m.minutes} min ${m.subject}`.slice(0, 32), do: `focus:${m.minutes}:${m.subject}` }]
        : m.kind === 'approve'
          ? [{ label: '✅ Approve', do: 'approve' }]
          : m.kind === 'plan'
            ? [{ label: '🗓 Plan my day', do: 'plan' }]
            : []
    return { reply: `🎯 ${m.title}. ${m.sub}`, chips: m.kind === 'answer' ? ['Done ✅', 'Not yet'] : ['Something else?', 'Give me 10 min'], buttons }
  }
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
