// Adding a clear goal in plain words (pure): "raise profit to 5000 lei by 31
// Dec", "lose 5 kg by March", "save 2000 € in 6 months", "finish 30 hours of
// Rust by 20 Dec", "reach 100 GitHub stars by June". The same parser serves
// the New goal sheet, Ben's "goal: …" and the island's command bar; each
// shows the draft to confirm, nothing is saved by the parser. Plus the
// templates the sheet and the empty Goals page offer.
import { addDays, daysBetween } from './dates'
import type { Cadence, GoalSource, GoalUnit, PaceCurve } from './goals'
import { stepsFromText, type GoalType, type Per } from './goalKinds'

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
  /** The kind of goal (missing: a number by a date). */
  type?: GoalType
  /** Habits, limits, repeats: per week or month (the target is per period). */
  per?: Per
  /** Habits from data: what makes a day count (2,000 ml, 1 h). */
  dayMin?: number
  /** Projects: the steps. */
  steps?: { text: string; weight: number }[]
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
  const kinds = parseKinds(rest, deadline)
  if (kinds) return kinds

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

const PER = String.raw`(?:a|per|each|every|\/|in a)\s*(week|month|day)`
const timeOf = (t: string) => {
  if (/midnight/i.test(t)) return '00:00'
  const m = /(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i.exec(t)
  if (!m) return null
  let h = Number(m[1])
  if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12
  if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0
  return h > 23 ? null : `${pad(h)}:${m[2] ?? '00'}`
}
const PC_KIND: [RegExp, string][] = [
  [/gam(e|es|ing)|steam|valorant|cs2|lol\b/i, 'gaming'],
  [/youtube|video|netflix|series|movies?|twitch/i, 'video'],
  [/social|instagram|tiktok|reddit|twitter|scroll/i, 'social']
]

/**
 * The newer kinds of goal from words: steps ("Security+: domain 1..5, 3
 * practice exams, book it"), do less ("at most 5h of gaming a week"), habits
 * ("work out 4 times a week", "in bed by 00:00 5 nights a week") and repeats
 * ("save 2000 lei every month"). null: a number goal (the parser goes on).
 */
export function parseKinds(rest: string, deadline: string | null): GoalDraft | null {
  const lower = rest.toLowerCase()
  const base = { deadline, curve: 'line' as PaceCurve, cadence: 'weekly' as Cadence }
  // Steps: "Get Security+: learn domain 1..5, 3 practice exams, book exam"
  let m = /^(.{2,60}?)\s*:\s*(.+)$/.exec(rest)
  if (m && !/\d$/.test(m[1]) && /,|;|\.\.|\bthen\b/.test(m[2])) {
    const steps = stepsFromText(m[2])
    if (steps.length >= 2) return { ...base, kind: 'measure', type: 'project', title: cap(m[1].replace(/^(goal|project)\s+/i, '')).slice(0, 60), unit: 'pct', target: 100, area: /sec|cert|exam|ctf|course|learn|study/i.test(rest) ? 'Study' : 'Life', source: { kind: 'manual' }, steps }
  }
  // Do less: "at most 5h of gaming a week", "max 1 hour of youtube a day", "spend less than 3000 lei a month"
  m = new RegExp(String.raw`(?:at most|max(?:imum)?|no more than|less than|under|up to|≤|<=|limit\s+\w+\s+to)\s*${NUM}\s*(hours?|hrs?|h|minutes?|mins?|m\b|lei|mdl|€|eur|\$|usd)?\s*(?:of|on)?\s*([\p{L}\s]{0,30}?)\s*${PER}`, 'iu').exec(rest)
  if (m) {
    let n = num(m[1], m[2])
    const u = (m[3] ?? '').toLowerCase()
    const what = `${m[4] ?? ''} ${lower}`
    const per = m[5].toLowerCase()
    const money = /lei|mdl|€|eur|\$|usd/.test(u) || /\bspend|spending\b/.test(lower)
    if (/^min|^m$/.test(u)) n = Math.round((n / 60) * 100) / 100
    if (per === 'day') n = Math.round(n * 7 * 100) / 100
    const per2: Per = per === 'month' ? 'month' : 'week'
    if (money) {
      const unit: GoalUnit = /€|eur/.test(u) ? 'eur' : /\$|usd/.test(u) ? 'usd' : 'lei'
      return { ...base, kind: 'measure', type: 'limit', per: per2, title: `Spend at most ${n.toLocaleString('en-US')} ${unit === 'lei' ? 'lei' : unit === 'eur' ? '€' : '$'} a ${per2}`, unit, target: n, area: 'Money', source: { kind: 'money.spent' } }
    }
    const kind = PC_KIND.find(([re]) => re.test(what))?.[1]
    const thing = (m[4] ?? '').trim() || kind || 'it'
    return { ...base, kind: 'measure', type: 'limit', per: per2, title: `${cap(thing)}: at most ${n}h a ${per2}`, unit: 'hours', target: n, area: 'Discipline', source: kind ? { kind: 'pc.kind', arg: kind } : { kind: 'manual' } }
  }
  // Habits: "work out 4 times a week", "sleep before 00:00 5 nights a week", "drink 2l of water 6 days a week"
  m = new RegExp(String.raw`(\d{1,2})\s*(?:×|x|times?|nights?|days?|sessions?)\s*${PER}`, 'i').exec(rest)
  const daily = /\b(every ?day|daily|each day)\b/i.test(rest)
  const weekdays = /\bweekdays\b/i.test(rest)
  if ((m && m[2].toLowerCase() !== 'day') || daily || weekdays) {
    const per: Per = m?.[2].toLowerCase() === 'month' ? 'month' : 'week'
    const n = m ? Number(m[1]) : weekdays ? 5 : per === 'month' ? 30 : 7
    const times = `${n}× a ${per}`
    const lead = (m ? rest.slice(0, m.index) + rest.slice(m.index + m[0].length) : rest).replace(/\b(every ?day|daily|each day|on weekdays|weekdays)\b/gi, '').trim()
    if (/work ?out|train|gym|exercise|lift/i.test(lower)) return { ...base, kind: 'measure', type: 'habit', per, title: `Work out ${times}`, unit: 'count', target: n, area: 'Body', source: { kind: 'body.workouts' } }
    if (/sleep|bed/i.test(lower)) {
      const t = timeOf(/(?:before|by|until|at)\s+(midnight|\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)/i.exec(rest)?.[1] ?? 'midnight') ?? '00:00'
      return { ...base, kind: 'measure', type: 'habit', per, title: `In bed by ${t}, ${n} nights a ${per}`, unit: 'count', target: n, area: 'Body', source: { kind: 'sleep.bed', arg: t } }
    }
    const water = /water/i.test(lower) ? /(\d+(?:[.,]\d+)?)\s*(l|liters?|litres?|ml)\b/i.exec(rest) : null
    if (/water/i.test(lower)) {
      const ml = water ? Math.round(Number(water[1].replace(',', '.')) * (/^ml$/i.test(water[2]) ? 1 : 1000)) : 2000
      return { ...base, kind: 'measure', type: 'habit', per, title: `Drink ${ml.toLocaleString('en-US')} ml of water, ${times}`, unit: 'count', target: n, area: 'Body', source: { kind: 'water' }, dayMin: ml }
    }
    const hours = /(\d+(?:[.,]\d+)?)\s*(h|hours?|hrs?|min(?:utes?)?)\b(?:\s+(?:of|on)\s+([\p{L}\d+#.\s-]{2,30}?))?(?=\s*$|\s+\d|\s+(?:a|per|each|every))/iu.exec(lead)
    if (hours) {
      const h = /^min/i.test(hours[2]) ? Number(hours[1]) / 60 : Number(hours[1].replace(',', '.'))
      const subject = hours[3] ? cap(hours[3].trim()) : /\b(rust|ctf|python|math|study|code|coding)\b/i.exec(lead)?.[1]
      const subj = subject && !/^(study|code|coding)$/i.test(subject) ? cap(subject) : undefined
      return { ...base, kind: 'measure', type: 'habit', per, title: `${h >= 1 ? `${h}h` : `${Math.round(h * 60)} min`} of ${subj ?? 'focus'}, ${times}`, unit: 'count', target: n, area: 'Study', source: { kind: 'focus.hours', ...(subj ? { arg: subj } : {}) }, dayMin: Math.round(h * 100) / 100 }
    }
    const reps = /(\d+)\s*(push-?ups?|pull-?ups?|squats?|dips?|sit-?ups?|burpees?)/i.exec(lead)
    if (reps) return { ...base, kind: 'measure', type: 'habit', per, title: `${reps[1]} ${reps[2].toLowerCase()}, ${times}`, unit: 'count', target: n, area: 'Body', source: { kind: 'sport.reps', arg: cap(reps[2].toLowerCase().split(' ')[0]) }, dayMin: Number(reps[1]) }
    const title = cap(lead.replace(/^(i want to|i will|to)\s+/i, '').replace(/\s+/g, ' ').trim()) || 'My habit'
    return { ...base, kind: 'measure', type: 'habit', per, title: `${title} ${times}`.slice(0, 60), unit: 'count', target: n, area: /read|study|learn|ctf|code/i.test(lower) ? 'Study' : 'Life', source: { kind: 'manual' } }
  }
  // Repeats: "save 2000 lei every month", "read 2 books a month"
  m = new RegExp(String.raw`(?:(€|\$)\s*${NUM}|${NUM}\s*([\p{L}€$]+(?:\s[\p{L}]+)?))\s*${PER}`, 'iu').exec(rest)
  if (m && /\b(save|saving|put aside|set aside|invest|read|write|publish|solve|ship|post|do|finish)\b/i.test(lower)) {
    if (m[7].toLowerCase() === 'day') return null
    const per: Per = m[7].toLowerCase() === 'week' ? 'week' : 'month'
    const n = m[1] ? num(m[2], m[3]) : num(m[4], m[5])
    const label = (m[1] ?? m[6] ?? '').toLowerCase().trim()
    const u = unitOf(label) ?? (m[1] ? unitOf(m[1]) : null)
    if (u && (u.unit === 'lei' || u.unit === 'eur' || u.unit === 'usd')) {
      const shown = u.unit === 'lei' ? `${n.toLocaleString('en-US')} lei` : `${u.unit === 'eur' ? '€' : '$'}${n.toLocaleString('en-US')}`
      return { ...base, kind: 'measure', type: 'repeat', per, title: `Save ${shown} every ${per}`, unit: u.unit, target: n, area: 'Money', source: { kind: 'money.saved' } }
    }
    if (u?.unit === 'hours') return { ...base, kind: 'measure', type: 'repeat', per, title: `${n}h of focus every ${per}`, unit: 'hours', target: n, area: 'Study', source: { kind: 'focus.hours' } }
    const thing = label.replace(/^(new|more)\s+/, '')
    return { ...base, kind: 'measure', type: 'repeat', per, title: `${n} ${thing} every ${per}`.slice(0, 60), unit: 'custom', unitLabel: thing.split(' ').slice(-1)[0].slice(0, 16), target: n, area: /books?|pages?|ctf|flags?|writeups?/.test(thing) ? 'Study' : 'Life', source: { kind: 'manual' } }
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
