// Adding a clear goal in plain words (pure): "raise profit to 5000 lei by 31
// Dec", "lose 5 kg by March", "save 2000 € in 6 months", "finish 30 hours of
// Rust by 20 Dec", "reach 100 GitHub stars by June". The same parser serves
// the New goal sheet, Ben's "goal: …" and the island's command bar; each
// shows the draft to confirm, nothing is saved by the parser. Plus the
// templates the sheet and the empty Goals page offer.
import { addDays, daysBetween } from './dates'
import type { Cadence, GoalSource, GoalUnit, PaceCurve } from './goals'

export interface GoalDraft {
  /** 'hours': an hour goal planned backward into focus blocks (focus_goals as before). */
  kind: 'measure' | 'hours'
  title: string
  unit: GoalUnit
  unitLabel?: string
  target: number | null
  /** "lose 5 kg": the change, applied to your current number when it's known. */
  delta?: number
  start?: number | null
  deadline: string | null
  why?: string
  area: string
  cadence: Cadence
  source: GoalSource
  curve: PaceCurve
  /** Hour goals: the focus subject. */
  subject?: string
  template?: string
}

export interface GoalTemplate {
  id: string
  icon: string
  /** "Raise profit to __ by __" */
  label: string
  area: string
  unit: GoalUnit
  unitLabel?: string
  source: GoalSource
  cadence: Cadence
  curve: PaceCurve
  kind: 'measure' | 'hours'
  /** A made-up example for the field. */
  example: number
  /** Title from the target ("Profit 5,000 lei"). */
  title: (target: string, extra?: string) => string
  /** "lose": the target is a change down from where you are. */
  change?: 'down' | 'up'
  /** What the extra field asks for (subject, exercise, thing). */
  extra?: string
}

export const GOAL_TEMPLATES: GoalTemplate[] = [
  { id: 'profit', icon: '💰', label: 'Raise profit to __ by __', area: 'Money', unit: 'lei', source: { kind: 'money.profit' }, cadence: 'weekly', curve: 'line', kind: 'measure', example: 5000, title: (t) => `Profit ${t} a month` },
  { id: 'save', icon: '🏦', label: 'Save __ by __', area: 'Money', unit: 'lei', source: { kind: 'money.saved' }, cadence: 'weekly', curve: 'ramp', kind: 'measure', example: 3000, title: (t) => `Save ${t}` },
  { id: 'lose', icon: '⚖️', label: 'Lose __ kg by __', area: 'Body', unit: 'kg', source: { kind: 'body.weight' }, cadence: 'weekly', curve: 'front', kind: 'measure', example: 5, change: 'down', title: (t) => `Lose ${t}` },
  { id: 'hours', icon: '⏱️', label: 'Finish __ hours of __', area: 'Study', unit: 'hours', source: { kind: 'focus.hours' }, cadence: 'weekly', curve: 'line', kind: 'hours', example: 30, extra: 'Subject, e.g. Rust', title: (t, x) => `${t} of ${x || 'study'}` },
  { id: 'stars', icon: '⭐', label: 'Reach __ GitHub stars', area: 'Career', unit: 'custom', unitLabel: 'stars', source: { kind: 'manual' }, cadence: 'weekly', curve: 'ramp', kind: 'measure', example: 100, title: (t) => `${t} on GitHub` },
  { id: 'reps', icon: '💪', label: 'Do __ pushups in total', area: 'Body', unit: 'count', source: { kind: 'sport.reps', arg: 'Pushups' }, cadence: 'weekly', curve: 'line', kind: 'measure', example: 3000, extra: 'Exercise, e.g. Pushups', title: (t, x) => `${t} ${(x || 'pushups').toLowerCase()}` },
  { id: 'workouts', icon: '🏋️', label: 'Train __ times by __', area: 'Body', unit: 'count', source: { kind: 'body.workouts' }, cadence: 'weekly', curve: 'line', kind: 'measure', example: 40, title: (t) => `${t} workouts` },
  { id: 'custom', icon: '🎯', label: 'Something else', area: 'Life', unit: 'count', source: { kind: 'manual' }, cadence: 'weekly', curve: 'line', kind: 'measure', example: 10, extra: 'What, e.g. books read', title: (t, x) => `${t} ${x || ''}`.trim() }
]

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const monthOf = (w: string) => MONTHS.indexOf(w.slice(0, 3).toLowerCase())
const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= lastDay(y, m)

/** The first date in the text after today: "31 Dec", "Dec 31", "31.12", "2026-12-31", "end of month", "in 3 months", "by June". */
export function parseDeadline(text: string, today: string): { day: string; match: string } | null {
  const t = text.toLowerCase()
  const y0 = Number(today.slice(0, 4))
  const future = (y: number, m: number, d: number, yearGiven: boolean) => {
    if (!valid(y, m, d)) return null
    let day = `${y}-${pad(m)}-${pad(d)}`
    if (!yearGiven && day < today) day = `${y + 1}-${pad(m)}-${pad(Math.min(d, lastDay(y + 1, m)))}`
    return day
  }
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t)
  if (m) return valid(+m[1], +m[2], +m[3]) ? { day: `${m[1]}-${m[2]}-${m[3]}`, match: m[0] } : null
  m = /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/.exec(t)
  if (m && +m[2] <= 12) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : y0
    const day = future(y, +m[2], +m[1], !!m[3])
    if (day) return { day, match: m[0] }
  }
  m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)(?:\s+(\d{4}))?\b/.exec(t)
  if (m) {
    const day = future(m[3] ? +m[3] : y0, monthOf(m[2]) + 1, +m[1], !!m[3])
    if (day) return { day, match: m[0] }
  }
  m = /\b(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/.exec(t)
  if (m) {
    const day = future(m[3] ? +m[3] : y0, monthOf(m[1]) + 1, +m[2], !!m[3])
    if (day) return { day, match: m[0] }
  }
  m = /\bend of (?:the )?(month|year)\b/.exec(t)
  if (m) {
    const y = y0
    const mo = Number(today.slice(5, 7))
    return { day: m[1] === 'year' ? `${y}-12-31` : `${y}-${pad(mo)}-${pad(lastDay(y, mo))}`, match: m[0] }
  }
  m = /\bin\s+(\d{1,3}|a|one|two|three|six)\s+(day|week|month|year)s?\b/.exec(t)
  if (m) {
    const words: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, six: 6 }
    const n = words[m[1]] ?? Number(m[1])
    const days = m[2] === 'day' ? n : m[2] === 'week' ? n * 7 : m[2] === 'month' ? Math.round(n * 30.44) : n * 365
    return { day: addDays(today, days), match: m[0] }
  }
  // "by June" / "by the end of June": the month's last day.
  m = /\b(?:by|until|till|before)\s+(?:the\s+end\s+of\s+)?(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)(?:\s+(\d{4}))?\b/.exec(t)
  if (m) {
    const mo = monthOf(m[1]) + 1
    const day = future(m[2] ? +m[2] : y0, mo, lastDay(m[2] ? +m[2] : y0, mo), !!m[2])
    if (day) return { day, match: m[0] }
  }
  return null
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)\s*(k(?![a-z]))?`
const num = (n: string, k?: string) => Number(n.replace(',', '.')) * (k ? 1000 : 1)

/** The unit a word means. */
function unitOf(word: string): { unit: GoalUnit; label?: string } | null {
  const w = word.toLowerCase()
  if (/^(lei|leu|mdl|ron)$/.test(w)) return { unit: 'lei' }
  if (/^(€|eur|euro|euros)$/.test(w)) return { unit: 'eur' }
  if (/^(\$|usd|dollars?)$/.test(w)) return { unit: 'usd' }
  if (/^(kg|kilos?|kilograms?)$/.test(w)) return { unit: 'kg' }
  if (/^(km|kilometers?|kilometres?)$/.test(w)) return { unit: 'km' }
  if (/^(%|percent)$/.test(w)) return { unit: 'pct' }
  if (/^(h|hours?|hrs?)$/.test(w)) return { unit: 'hours' }
  return null
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * A goal draft from plain words, or null when there's no number to aim at.
 * The deadline may be missing (null): the sheet asks for it.
 */
export function parseGoalText(raw: string, today: string): GoalDraft | null {
  const text = String(raw ?? '').replace(/^\s*goal\s*:\s*/i, '').replace(/(\d),(\d{3})(?!\d)/g, '$1$2').replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!text) return null
  const dl = parseDeadline(text, today)
  // The rest without the date part ("by 31 Dec").
  let rest = dl ? text.replace(new RegExp(`\\s*(?:by|until|till|before|on|in)?\\s*(?:the\\s+end\\s+of\\s+)?${dl.match.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`, 'i'), '') : text
  rest = rest.replace(/[.!]+$/, '').trim()
  const lower = rest.toLowerCase()
  const deadline = dl && daysBetween(today, dl.day) >= 1 ? dl.day : null
  const base = { deadline, curve: 'line' as PaceCurve, cadence: 'weekly' as Cadence }

  // "finish 30 hours of Rust", "30h of math", "study 20 hours of Rust"
  let m = new RegExp(String.raw`(?:finish|do|study|put|log|spend)?\s*${NUM}\s*(?:h|hours?|hrs?)\s+(?:of|on|for)\s+(.{2,40})$`, 'i').exec(rest)
  if (m) {
    const subject = cap(m[3].trim())
    return { ...base, kind: 'hours', title: `${num(m[1], m[2])}h of ${subject}`, unit: 'hours', target: num(m[1], m[2]), area: 'Study', source: { kind: 'focus.hours', arg: subject }, subject, template: 'hours' }
  }
  // "lose 5 kg", "drop 4kg", "gain 3 kg"
  m = new RegExp(String.raw`\b(lose|drop|cut|gain|put on)\s+${NUM}\s*(kg|kilos?)\b`, 'i').exec(rest)
  if (m) {
    const n = num(m[2], m[3])
    const down = !/gain|put on/i.test(m[1])
    return { ...base, kind: 'measure', title: `${down ? 'Lose' : 'Gain'} ${n} kg`, unit: 'kg', target: null, delta: down ? -n : n, area: 'Body', source: { kind: 'body.weight' }, curve: down ? 'front' : 'line', template: 'lose' }
  }
  // "weigh 72 kg", "get to 72kg"
  m = new RegExp(String.raw`\b(?:weigh|weight(?: to)?|get (?:down )?to|reach)\s+${NUM}\s*(kg|kilos?)\b`, 'i').exec(rest)
  if (m) return { ...base, kind: 'measure', title: `Weigh ${num(m[1], m[2])} kg`, unit: 'kg', target: num(m[1], m[2]), area: 'Body', source: { kind: 'body.weight' }, curve: 'front', template: 'lose' }

  // A number with a unit: "5000 lei", "€2,000", "$300", "100 km", "40%".
  const money = new RegExp(String.raw`(?:(€|\$)\s*${NUM}|${NUM}\s*(lei|leu|mdl|ron|€|eur|euros?|\$|usd|dollars?|kg|km|%|percent))`, 'i').exec(rest)
  const what = /\b(profit|income|revenue|earn(?:ings)?|salary|savings?|save|saved)\b/i.exec(lower)?.[1]?.toLowerCase()
  if (money) {
    const n = money[1] ? num(money[2], money[3]) : num(money[4], money[5])
    const u = unitOf(money[1] ?? money[6] ?? '') ?? { unit: 'count' as GoalUnit }
    if (u.unit === 'lei' || u.unit === 'eur' || u.unit === 'usd') {
      const shown = u.unit === 'lei' ? `${n.toLocaleString('en-US')} lei` : `${u.unit === 'eur' ? '€' : '$'}${n.toLocaleString('en-US')}`
      if (what && /profit|revenue/.test(what)) return { ...base, kind: 'measure', title: `Profit ${shown} a month`, unit: u.unit, target: n, area: 'Money', source: { kind: 'money.profit' }, template: 'profit' }
      if (what && /income|earn|salary/.test(what)) return { ...base, kind: 'measure', title: `Earn ${shown} a month`, unit: u.unit, target: n, area: 'Money', source: { kind: 'money.income' }, template: 'profit' }
      return { ...base, kind: 'measure', title: `Save ${shown}`, unit: u.unit, target: n, area: 'Money', source: { kind: 'money.saved' }, curve: 'ramp', template: 'save' }
    }
    if (u.unit === 'km') return { ...base, kind: 'measure', title: `${/run|jog/.test(lower) ? 'Run' : 'Cover'} ${n} km`, unit: 'km', target: n, area: 'Body', source: { kind: 'manual' } }
    if (u.unit === 'kg') return { ...base, kind: 'measure', title: `Weigh ${n} kg`, unit: 'kg', target: n, area: 'Body', source: { kind: 'body.weight' }, curve: 'front', template: 'lose' }
    if (u.unit === 'pct') return { ...base, kind: 'measure', title: cap(rest.replace(/^(raise|get|reach|hit)\s+/i, '')).slice(0, 60), unit: 'pct', target: n, area: 'Life', source: { kind: 'manual' } }
  }
  // "100 GitHub stars", "12 books", "40 workouts", "3000 pushups", "50 CTF flags"
  m = new RegExp(String.raw`${NUM}\s+([\p{L}][\p{L}\s-]{1,30})$`, 'iu').exec(rest.replace(/\s+(in total|total)$/i, ''))
  if (m) {
    const n = num(m[1], m[2])
    const thing = m[3].trim().replace(/^(more|new)\s+/i, '')
    const t = thing.toLowerCase()
    if (/workouts?|trainings?|gym sessions?/.test(t)) return { ...base, kind: 'measure', title: `${n} workouts`, unit: 'count', target: n, area: 'Body', source: { kind: 'body.workouts' }, template: 'workouts' }
    if (/push-?ups?|pull-?ups?|squats?|dips?|sit-?ups?|burpees?/.test(t)) return { ...base, kind: 'measure', title: `${n} ${t}`, unit: 'count', target: n, area: 'Body', source: { kind: 'sport.reps', arg: cap(t.split(' ')[0]) }, template: 'reps' }
    if (/tasks?/.test(t)) return { ...base, kind: 'measure', title: `${n} tasks done`, unit: 'count', target: n, area: 'Work', source: { kind: 'tasks.done' } }
    if (/clean days?|days? clean/.test(t)) return { ...base, kind: 'measure', title: `${n} clean days`, unit: 'count', target: n, area: 'Discipline', source: { kind: 'habit.clean' } }
    const star = /stars?/.test(t)
    const label = star ? 'stars' : t.split(' ').slice(-1)[0]
    return { ...base, kind: 'measure', title: `${n} ${thing}`.slice(0, 60), unit: 'custom', unitLabel: label.slice(0, 16), target: n, area: star || /ctf|flags?|github|projects?/.test(t) ? 'Career' : /books?|pages?/.test(t) ? 'Study' : 'Life', source: { kind: 'manual' }, curve: star ? 'ramp' : 'line', template: star ? 'stars' : 'custom' }
  }
  // A bare number with "profit"/"save": "raise profit to 5k".
  m = new RegExp(String.raw`${NUM}`, 'i').exec(rest)
  if (m && what) {
    const n = num(m[1], m[2])
    if (/profit|revenue/.test(what)) return { ...base, kind: 'measure', title: `Profit ${n.toLocaleString('en-US')} lei a month`, unit: 'lei', target: n, area: 'Money', source: { kind: 'money.profit' }, template: 'profit' }
    if (/income|earn|salary/.test(what)) return { ...base, kind: 'measure', title: `Earn ${n.toLocaleString('en-US')} lei a month`, unit: 'lei', target: n, area: 'Money', source: { kind: 'money.income' }, template: 'profit' }
    return { ...base, kind: 'measure', title: `Save ${n.toLocaleString('en-US')} lei`, unit: 'lei', target: n, area: 'Money', source: { kind: 'money.saved' }, curve: 'ramp', template: 'save' }
  }
  return null
}

/** The check-in rhythm that fits the time you have: daily under 3 weeks, monthly over 6 months. */
export function suggestCadence(today: string, deadline: string | null): Cadence {
  if (!deadline) return 'weekly'
  const d = daysBetween(today, deadline)
  return d <= 21 ? 'daily' : d > 180 ? 'monthly' : 'weekly'
}

/** "Profit 5,000 lei a month · by 31 Dec · Finance Helper" for a confirm card. */
export function draftLine(d: GoalDraft): string {
  const date = d.deadline ? new Date(`${d.deadline}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'no deadline yet'
  return `${d.title} · by ${date}`
}
