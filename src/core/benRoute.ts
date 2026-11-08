// Ben's routing (Coach fix + power): what kind of message this is, which model
// answers it, how much of his day goes into the prompt, and how long each try
// may take, so a review or a plan always answers inside the server's time.
// Pure and tested (benRoute.test.ts).

export type Intent = 'review' | 'plan' | 'goals' | 'multi' | 'log' | 'advice' | 'chat'

/** Which slice of his day the prompt gets (see trimContext). */
export type Trim = 'review' | 'plan' | 'goals' | 'light' | 'full'

export interface Route {
  intent: Intent
  /** The strong (thinking) model first, the quick one as the fallback. */
  strong: boolean
  think: boolean
  /** The most the strong model may think before the quick model takes over. */
  capMs: number
  trim: Trim
  /** Every action group in the prompt (several things in one message). */
  allActions: boolean
}

const EDIT_VERB = /\b(move|add|book|schedule|rename|delete|remove|cancel|log|remind|set|start|drop|push|shift|put)\b/gi

/** What kind of message it is. Order matters: a review beats a plan ("review my day and plan tomorrow"). */
export function intentOf(text: string): Intent {
  const t = String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!t) return 'chat'
  if (/\b(review (yesterday|my day|today|the day|my week|last night)|recap|how did (yesterday|today|my day) go|how was (my )?(day|yesterday)|what went well|what slipped)\b/.test(t)) return 'review'
  if (/\b(goals?)\b/.test(t) && /\b(how|status|doing|progress|on track|behind|where am i|check)\b/.test(t)) return 'goals'
  const verbs = (t.match(EDIT_VERB) ?? []).length
  if (verbs >= 2 && /\b(and|then|also|plus)\b|,|;/.test(t)) return 'multi'
  if (/\b(plan (my|the|to)?\s*day|plan today|make (today'?s|my|a|the) plan|new plan|replan|re-plan|plan for today)\b/.test(t) && !/\bplan to\b/.test(t)) return 'plan'
  if (/\d/.test(t) && t.split(' ').length <= 8 && !/\b(why|should|how|what)\b/.test(t)) return 'log'
  if (t.length > 160 || /\b(plan|schedule|reschedule|organi[sz]e|review|analy[sz]|why|strategy|week|month|budget|prioriti[sz]e|what should i|help me (decide|figure)|advice|advise)\b/.test(t)) return 'advice'
  return 'chat'
}

/** Quick logs go to the quick model; reviews, plans and advice get the strong one with a trimmed day. */
export function routeFor(text: string, opts: { correcting?: boolean; media?: boolean } = {}): Route {
  const intent = intentOf(text)
  if (opts.media) return { intent, strong: true, think: false, capMs: 20_000, trim: 'full', allActions: true }
  if (opts.correcting) return { intent, strong: true, think: true, capMs: 16_000, trim: 'light', allActions: true }
  switch (intent) {
    case 'review':
      return { intent, strong: true, think: true, capMs: 20_000, trim: 'review', allActions: false }
    case 'plan':
      return { intent, strong: false, think: false, capMs: 0, trim: 'plan', allActions: false }
    case 'goals':
      return { intent, strong: true, think: false, capMs: 16_000, trim: 'goals', allActions: false }
    case 'multi':
      return { intent, strong: false, think: false, capMs: 0, trim: 'light', allActions: true }
    case 'log':
      return { intent, strong: false, think: false, capMs: 0, trim: 'light', allActions: false }
    case 'advice':
      return { intent, strong: true, think: true, capMs: 22_000, trim: 'full', allActions: true }
    default:
      return { intent, strong: false, think: false, capMs: 0, trim: 'full', allActions: false }
  }
}

// ---- Time: one budget for the whole answer ---------------------------------

/**
 * One reply must fit the server's 60 s (Vercel). Ben's think() gets 44 s from
 * the moment it starts: the strong model may use what is left minus the quick
 * model's reserve, so the quick model can always still answer (and a silent
 * retry still fits). The page waits for the server, never less.
 */
export const THINK_BUDGET_MS = 44_000
export const QUICK_RESERVE_MS = 14_000
/** Less than this left for thinking: skip the strong model, ask the quick one. */
export const MIN_THINK_MS = 6_000

/** How long the strong model may take now (0 = go straight to the quick model). */
export function strongSlot(now: number, deadline: number, capMs: number, reserveMs = QUICK_RESERVE_MS, minMs = MIN_THINK_MS): number {
  const left = deadline - now - reserveMs
  if (capMs <= 0 || left < minMs) return 0
  return Math.min(capMs, left)
}

/** A silent second try is worth it only with this much time left. */
export function canRetry(now: number, deadline: number, minMs = MIN_THINK_MS): boolean {
  return deadline - now >= minMs
}

/** What the chat shows when Ben could not answer in time (never the raw error). */
export const FRIENDLY_FAIL = "Sorry, I couldn't finish that answer in time. Tap Try again and I'll answer."

// ---- The prompt diet: only the part of his day this message needs ----------

const KEEP: Record<Exclude<Trim, 'full'>, RegExp> = {
  review: /^(Now:|Coins:|Focus timer|Focus today|Today's must-dos|Goals planned|Goals now|Measurable goals|Week score|Last 7 days|Sleep:|Discipline:|Training:|Money|Water today|Habits today|RIGHT NOW|This week's chosen focus|Focus by subject)/,
  plan: /^(Now:|Focus timer|Focus today|Today's must-dos|Goals planned|Goals now|Measurable goals|Sleep:|Training:|Water today|Calendar|Free time|Todoist today|Deadlines soon|RIGHT NOW|This week's chosen focus)/,
  goals: /^(Now:|Focus timer|Focus today|Goals planned|Goals now|Measurable goals|Week score|Last 7 days|This week's chosen focus|Focus by subject|Deadlines soon)/,
  light: /^(Now:|Coins:|Focus timer|Focus today|Today's must-dos|Water today|Habits today|RIGHT NOW|HIS DAY SO FAR|Money \(MDL\))/
}

/**
 * His day cut down for one kind of message: a review needs yesterday's numbers
 * and the week, not the calendar of the next 7 days, plugins or his PC. Lines
 * under a kept heading ("- …") stay with it.
 */
export function trimContext(context: string, trim: Trim): string {
  if (trim === 'full') return context
  return keepLines(context, KEEP[trim])
}

/** Only the context sections whose heading matches `keep` (with their "- " lines). */
export function keepLines(context: string, keep: RegExp): string {
  const out: string[] = []
  let on = false
  for (const line of String(context ?? '').split('\n')) {
    if (/^\s*-\s/.test(line)) {
      if (on) out.push(line)
      continue
    }
    on = keep.test(line.trim())
    if (on) out.push(line)
  }
  return out.join('\n')
}

// ---- Yesterday in numbers (the review's facts, looked up before the call) ----

export interface DayDigest {
  day: string
  /** The day score 0–100 from the evening review, when there was one. */
  score: number | null
  mustdos: { done: number; total: number; open: string[] } | null
  focusMin: number
  focusBy: { subject: string; minutes: number }[]
  plannedFocusMin: number | null
  sleep: { bed: string | null; wake: string | null; onTime: boolean | null; hours: number | null; quality: number | null } | null
  water: { met: boolean | null; ml: number | null; target: number | null }
  workouts: string[]
  money: { spent: number; top: string[] } | null
  goals: string[]
  promises: { kept: number; broken: number } | null
  points: number | null
}

const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m` : `${Math.round(min)} min`)

/** Yesterday as lines for the prompt (every number from the data). */
export function digestText(d: DayDigest): string {
  const lines = [
    `Yesterday (${d.day}) from his data:`,
    d.score != null ? `- Day score: ${d.score}/100.` : '- Day score: no evening review that day.',
    d.mustdos ? `- Must-dos: ${d.mustdos.done}/${d.mustdos.total} done${d.mustdos.open.length ? `; left open: ${d.mustdos.open.slice(0, 3).join('; ')}` : ''}.` : '- Must-dos: none written.',
    `- Focus: ${hm(d.focusMin)}${d.plannedFocusMin ? ` of ${hm(d.plannedFocusMin)} planned` : ''}${d.focusBy.length ? ` (${d.focusBy.slice(0, 4).map((x) => `${x.subject} ${hm(x.minutes)}`).join(', ')})` : ''}.`,
    d.sleep ? `- Sleep: ${d.sleep.bed ? `bed ${d.sleep.bed}` : 'bedtime not logged'}, ${d.sleep.wake ? `up ${d.sleep.wake}${d.sleep.onTime === false ? ' (late)' : d.sleep.onTime ? ' (on time)' : ''}` : 'wake-up not logged'}${d.sleep.hours != null ? `, ${d.sleep.hours.toFixed(1)} h` : ''}${d.sleep.quality ? `, felt ${d.sleep.quality}/5` : ''}.` : '- Sleep: not logged.',
    d.water.ml != null && d.water.target ? `- Water: ${(d.water.ml / 1000).toFixed(1)} of ${(d.water.target / 1000).toFixed(1)} L.` : d.water.met != null ? `- Water goal: ${d.water.met ? 'met' : 'not met'}.` : '- Water: not logged.',
    `- Workouts: ${d.workouts.length ? d.workouts.join(', ') : 'none'}.`,
    d.money ? `- Money: spent ${Math.round(d.money.spent)} lei${d.money.top.length ? ` (${d.money.top.slice(0, 3).join(', ')})` : ''}.` : '',
    d.promises ? `- Promises: ${d.promises.kept} kept, ${d.promises.broken} broken.` : '',
    d.points != null ? `- Points earned: ${d.points}.` : '',
    d.goals.length ? `- Goals now:\n${d.goals.slice(0, 4).map((g) => `  ${g}`).join('\n')}` : ''
  ]
  return lines.filter(Boolean).join('\n')
}

export interface ReviewChange {
  /** The button's label. */
  label: string
  /** A button action Ben's chat understands ("say:…", "focus:25:…", "plan"). */
  do: string
  /** One plain line: why this change. */
  why: string
}

/** The one change for today, from yesterday's weakest spot (a button he can tap). */
export function reviewChange(d: DayDigest): ReviewChange {
  const open = d.mustdos?.open[0]
  if (d.mustdos && d.mustdos.total > 0 && d.mustdos.done / d.mustdos.total < 0.5 && open) return { label: `▶ 25 min: ${open}`.slice(0, 40), do: `focus:25:${open.slice(0, 60)}`, why: `Start with the must-do that slipped (${open}) before anything else.` }
  if (d.sleep?.hours != null && d.sleep.hours < 6.5) return { label: '⏰ Wind down at 22:30', do: 'say:remind me at 22:30 to start winding down for bed', why: `Only ${d.sleep.hours.toFixed(1)} h of sleep: wind down earlier tonight.` }
  if (d.focusMin < 30) return { label: '▶ 25 min focus now', do: `focus:25:${(open ?? 'most important task').slice(0, 60)}`, why: 'Almost no focus yesterday: one 25-minute block first.' }
  if (d.water.met === false || (d.water.ml != null && d.water.target && d.water.ml < d.water.target * 0.7)) return { label: '💧 Water reminder 14:00', do: 'say:remind me at 14:00 to drink 500 ml of water', why: 'Water fell short: a reminder after lunch.' }
  if (!d.workouts.length) return { label: '💪 Book a workout', do: 'say:book a 45 minute workout today in my free time', why: 'No workout yesterday: book one today.' }
  return { label: "☀️ Plan today", do: 'plan', why: 'A solid day: keep it going with a plan for today.' }
}

/** A short honest review from the numbers alone (when the model can't answer in time). */
export function reviewFromData(d: DayDigest): string {
  const good: string[] = []
  const bad: string[] = []
  if (d.mustdos?.total) (d.mustdos.done === d.mustdos.total ? good : bad).push(`must-dos ${d.mustdos.done}/${d.mustdos.total}`)
  if (d.focusMin >= 50) good.push(`${hm(d.focusMin)} of focus`)
  else bad.push(`only ${hm(d.focusMin)} of focus`)
  if (d.sleep?.hours != null) (d.sleep.hours >= 7 ? good : bad).push(`${d.sleep.hours.toFixed(1)} h of sleep`)
  if (d.workouts.length) good.push('a workout')
  if (d.water.met != null || d.water.ml != null) (d.water.met || (d.water.ml != null && d.water.target && d.water.ml >= d.water.target) ? good : bad).push('water')
  const change = reviewChange(d)
  return [
    d.score != null ? `Yesterday scored ${d.score}/100.` : 'Here is yesterday from your numbers.',
    good.length ? `Went well: ${good.join(', ')}.` : '',
    bad.length ? `Slipped: ${bad.join(', ')}.` : '',
    `One change for today: ${change.why}`
  ]
    .filter(Boolean)
    .join(' ')
}

// ---- What this kind of message must end with (one line in the prompt) -----

export const REVIEW_TASK =
  'THIS MESSAGE IS A REVIEW OF YESTERDAY. Use "Yesterday … from his data" below (every number from it): 1) what went well (1 line, with numbers), 2) what slipped (1 line, with numbers), 3) ONE concrete change for today. Put that change as exactly one button he can tap ("focus:25:<task>", "say:remind me at 22:30 to …", "say:book …", or "plan"). No lookups needed: leave "need" empty.'
export const MULTI_TASK =
  'HE ASKED FOR SEVERAL THINGS IN ONE MESSAGE. Do ALL of them now, one action line per thing (e.g. a move AND a new block), then confirm in one short line. Never do only the first one.'
export const GOALS_TASK =
  'HE ASKS HOW HIS GOALS ARE GOING. Answer from "Goals with status" below: one short line per goal that matters (number, on track or behind), the one behind first with the next step. Put "goals" in "show".'
