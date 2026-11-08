// "Ask Ben anything about training" ("why am I not growing?", "is 4×8 archer
// enough?", "how long should I rest?"): answered in code from his data and the
// rules (sportCoachRules.ts), in plain words, with real numbers only. Pure and
// tested. Anything that is not about training returns null.
import { matchMove } from './sportMoves'
import { RULES, BODY_PART, bodyLines, coachCard, deloadCheck, muscleLoad, restFor, restText, type CoachCtx } from './sportCoachRules'
import { stallsOf } from './sportInsight'
import { muscleOf } from './sportSets'

const TRAIN = /\b(train(?:ing)?|grow(?:ing|th)?|muscle|stronger|strength|sets?|reps?|rest|deload|plateau|stall(?:ed)?|progress(?:ion)?|volume|hypertrophy|push-?ups?|pull-?ups?|squats?|sit-?ups?|rows?|plank|archer|pistol|planche|dragon|protein|sport)\b/i
const QUESTION = /\?|^(?:why|how|what|should|is|are|do|does|can|when|which)\b/i

/** A question about training (not a log, not a command). */
export function isTrainingQuestion(text: string): boolean {
  const t = String(text ?? '').trim()
  if (!t || t.startsWith('/') || t.length > 200) return false
  return TRAIN.test(t) && QUESTION.test(t) && !/\b(spent|spend|euro|lei|todo|remind|meeting)\b/i.test(t)
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The answer, or null when it is not a training question. */
export function answerTraining(text: string, ctx: CoachCtx): string | null {
  if (!isTrainingQuestion(text)) return null
  const t = text.toLowerCase()
  const load = muscleLoad(ctx)
  const body = bodyLines(ctx.body)
  const stalled = stallsOf(ctx.sets, ctx.exercises, ctx.today)
  const dl = deloadCheck(ctx)
  const any = load.some((l) => l.sets > 0)

  // "Is 4×8 archer enough?"
  const m = /(\d{1,2})\s*[x×]\s*(\d{1,3})/.exec(t)
  if (m && /enough|ok(?:ay)?|good|too (?:easy|little)|worth/.test(t)) {
    const sets = Number(m[1])
    const reps = Number(m[2])
    const mv = matchMove(t.replace(m[0], ' ').replace(/\b(is|enough|ok|okay|good|worth|it|for|me|a|the|\?)\b/g, ' ').trim())
    const mu = muscleOf(mv?.group)
    const l = mu ? load.find((x) => x.id === mu) : null
    const parts: string[] = []
    parts.push(`${sets}×${reps}${mv ? ` ${mv.name.toLowerCase()}` : ''} is ${sets * reps} reps; what grows muscle is hard sets.`)
    if (reps > 12 && mv?.unit === 'reps') parts.push(`${reps} reps is above the 5–12 range where a set is hard: move to a harder variation instead of adding reps.`)
    else if (reps < 5) parts.push('Under 5 reps is more strength than size: go up to 5–8 on a variation you can hold for 4 sets.')
    else parts.push(`${reps} reps is a good range if you stop ${RULES.rir}. If you could do 3 or more extra, it is too easy: go to the next variation.`)
    if (l) parts.push(l.sets >= RULES.setsLo ? `Your ${BODY_PART[l.id].part} has ${l.sets} hard sets in the last 7 days, which is in the 10–20 zone.` : `Your ${BODY_PART[l.id].part} has ${l.sets} hard sets in the last 7 days; one session of ${sets} sets is not enough. Aim for 10–20 a week on 2 or more days.`)
    return parts.join(' ')
  }

  if (/rest|between sets/.test(t)) {
    const mv = matchMove(t.replace(/\b(how|long|much|should|i|rest|between|sets?|the|for|do|a|\?)\b/g, ' ').trim())
    const lines = [`Rest suits the reps: 5–8 reps need 2.5–3 min, 9–12 reps about 1.75 min, 13–20 reps about 1.25 min, and holds 1 min.`]
    if (mv) lines.push(`For ${mv.name.toLowerCase()} at ${mv.set} reps: ${restText(restFor(mv, mv.set))}.`)
    return lines.join(' ')
  }

  if (/protein|eat|sleep/.test(t) && !/why/.test(t)) {
    return [`Muscle needs protein of about ${RULES.protein.lo}–${RULES.protein.hi} g per kg of body weight and ${RULES.sleepHours}+ hours of sleep.`, ...(body.lines.length ? body.lines : ['Nothing is low in your Body data right now.'])].join(' ')
  }

  if (/deload|easy week|recover/.test(t)) {
    return dl.due ? `Yes: ${dl.why} Cut one set from every exercise and stop 3 reps short for a week.` : `Not yet. A deload comes every ${RULES.deloadWeeks.lo}–${RULES.deloadWeeks.hi} weeks, or sooner when progress stalls. You have trained ${dl.weeks} ${dl.weeks === 1 ? 'week' : 'weeks'} in a row.`
  }

  if (/how many sets|how much volume|how often/.test(t)) {
    return `Each muscle group needs ${RULES.setsLo}–${RULES.setsHi} hard sets a week, spread over at least ${RULES.minDays} days. ${load.map((l) => `${l.short}: ${l.sets} in the last 7 days`).join(', ')}.`
  }

  // "Why am I not growing?" and the general case: the likely causes, in order.
  if (!any) return 'I have no sets from you in the last 7 days, so there is nothing to grow from yet. Log today’s session set by set and I will tell you exactly what to change.'
  const causes: string[] = []
  const low = load.filter((l) => l.status === 'low')
  if (low.length) causes.push(`Volume is low: ${low.map((l) => `${BODY_PART[l.id].part} ${l.sets}`).join(', ')} hard sets in the last 7 days (the goal is ${RULES.setsLo}–${RULES.setsHi} for each).`)
  for (const l of load) if (l.freqLow) causes.push(`${cap(BODY_PART[l.id].part)} was trained on ${l.days} day: split it over ${RULES.minDays} days.`)
  if (stalled.length) causes.push(`${stalled.map((s) => s.name).slice(0, 2).join(' and ')} stopped improving: ${ctx.exercises.length ? 'try a slower 3-1-1 tempo or the next variation' : 'change the move'}.`)
  causes.push(...body.lines)
  if (dl.due) causes.push(dl.why)
  const card = coachCard(ctx)
  if (!causes.length) return `Nothing looks wrong: your sets, protein and sleep are in the zone. Keep adding one rep or one harder variation each session, and stop ${RULES.rir}. This week's focus: ${card.focus.text}`
  return `${causes.slice(0, 4).join(' ')} First fix: ${card.focus.text}`
}

/** Today's session in plain words, for "what should I train today?". */
export function sessionText(ctx: CoachCtx): string {
  const card = coachCard(ctx)
  if (!card.session.length) return 'There is no active exercise yet. Open Sport Track and answer the best-set questions so I can build your session.'
  return `Today: ${card.session.map((s) => s.line).join('; ')}. ${card.why} Most important this week: ${card.focus.text}`
}
