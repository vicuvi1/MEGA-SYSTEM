// A short night told to Ben ("I went to sleep at 2 am and got up at 7:30, spent
// too much time with gf"): read in code, logged, and today's draft plan REALLY
// gets lighter, so what Ben says and what the plan card shows agree.
//
// - readSleepSay: bed and wake time in one message (EN, a little RO), the hours
//   slept and the reason he gave, if any.
// - shortNightPlan: under SHORT_NIGHT_MIN of sleep, the draft blocks are cut to
//   about 60% of the focus (50% under 5 h), each at most 60 min, the must-dos
//   kept; nothing starts before now; the hardest block goes into his best
//   window (his learned best hours, else 2–5 h after waking); one 30-minute nap
//   block before 15:00 when there is room; training at the dose the readiness
//   rule gives (never full after a short night). Pinned, approved and calendar
//   blocks never move. What no longer fits stays on today's list.
// - nightReply: the reply, led by one line on what changed, the sleep, and one
//   kind line about the reason with a bedtime target for tonight.
// Pure and tested (shortNight.test.ts). No points here: the sleep goes through
// the usual sleep action, which keeps its own honest rules.
import { freeWindows, planStartAt, relinkAlso } from './dayPacker'
import { blockStarted, type Span } from './planShift'
import { fromMin, toMin, type AlsoItem, type DayProposal, type PlanBlock } from './rhythm'
import { DOSE_LABEL, doseMinutes, trainReadiness, type DoseMode } from './trainReadiness'
import type { CalEvent } from './dayTime'

/** Under this much sleep the day gets lighter (6 h 30 min). */
export const SHORT_NIGHT_MIN = 390
/** Under this much, focus is cut to half instead of 60%. */
const VERY_SHORT_MIN = 300
/** The nap block (a 20-minute nap plus falling asleep). */
export const NAP_MIN = 30
export const NAP_TITLE = 'Nap: 20 min, alarm on'
/** The plan change's label (its Undo finds it by this prefix). */
export const LIGHTER_LABEL = 'Lighter day after a short night'

export type ReasonKind = 'partner' | 'people' | 'screen' | 'work' | 'other'

export interface SleepSay {
  bed: string
  wake: string
  sleptMin: number
  /** What he said about why ("spent too much time with gf"), or null. */
  reason: string | null
  kind: ReasonKind | null
  /** Partner words, for the kind line ("girlfriend"). */
  who: string | null
}

const TIME = String.raw`(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?`
const BED = new RegExp(String.raw`\b(?:went\s+to\s+(?:sleep|bed)|fell\s+asleep|got\s+to\s+(?:sleep|bed)|slept|sleep|bed|asleep|m-?am\s+culcat|am\s+adormit)\s*(?:at|around|about|by|la|pe\s+la|~)?\s*${TIME}`, 'i')
const WAKE = new RegExp(String.raw`\b(?:got\s+up|woke(?:\s+up)?|wake\s+up|waking\s+up|i\s+was\s+up|up|awake|m-?am\s+trezit|m-?am\s+sculat)\s*(?:at|around|about|la|pe\s+la|~)?\s*${TIME}`, 'i')
const RANGE = new RegExp(String.raw`\bslept\s+(?:from\s+)?${TIME}\s*(?:-|–|to|till|until)\s*${TIME}`, 'i')

function clock(h: string, m: string | undefined, ap: string | undefined, isBed: boolean): number | null {
  let hh = Number(h)
  const mm = Number(m ?? 0)
  if (hh > 23 || mm > 59) return null
  const a = (ap ?? '').toLowerCase().replace(/\./g, '')
  if (a === 'pm' && hh < 12) hh += 12
  else if (a === 'am' && hh === 12) hh = 0
  else if (!a && isBed && hh >= 7 && hh <= 11) hh += 12
  else if (!a && isBed && hh === 12) hh = 0
  return hh * 60 + mm
}

function reasonOf(rest: string): { reason: string | null; kind: ReasonKind | null; who: string | null } {
  const r = rest
    .replace(/^[\s,.;:!-]+|[\s,.;:!]+$/g, '')
    .replace(/^(?:and|but|because|cause|cuz|coz|bc|since|so|i|was|cos)\b[\s,]*/gi, '')
    .replace(/\b(?:eh|lol|haha+|hah|ugh|tbh|ngl|lmao)\b[\s.!]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (r.split(' ').filter((w) => /[a-z]{2,}/i.test(w)).length < 2) return { reason: null, kind: null, who: null }
  const t = r.toLowerCase()
  const who = /\b(gf|girlfriend|my girl)\b/.test(t) ? 'girlfriend' : /\b(bf|boyfriend)\b/.test(t) ? 'boyfriend' : /\b(wife)\b/.test(t) ? 'wife' : /\b(husband)\b/.test(t) ? 'husband' : /\b(partner)\b/.test(t) ? 'partner' : null
  const kind: ReasonKind = who
    ? 'partner'
    : /\b(friends?|mates?|party|date|family|guests?|talking|call)\b/.test(t)
      ? 'people'
      : /\b(gam(?:e|es|ing)|played|youtube|tiktok|phone|scroll\w*|netflix|series|shows?|anime|reels|instagram|movie)\b/.test(t)
        ? 'screen'
        : /\b(stud\w*|homework|exam|deadline|work\w*|shift|project|assignment|coding|lab)\b/.test(t)
          ? 'work'
          : 'other'
  return { reason: r.slice(0, 80), kind, who }
}

/**
 * "I went to sleep at 2 am and got up at 7:30 am, spent too much time with gf":
 * bed 02:00, up 07:30, 330 min, and the reason. Null unless both times are there,
 * the night is 1–15 h, and the wake-up is not later than now.
 */
export function readSleepSay(text: string, now: Date): SleepSay | null {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!s || s.length > 240 || /\?\s*$/.test(s)) return null
  let bed: number | null = null
  let wake: number | null = null
  let rest = s
  const range = RANGE.exec(s)
  if (range) {
    bed = clock(range[1], range[2], range[3], true)
    wake = clock(range[4], range[5], range[6], false)
    rest = s.replace(range[0], ' ')
  } else {
    const b = BED.exec(s)
    const w = WAKE.exec(s)
    if (!b || !w) return null
    bed = clock(b[1], b[2], b[3], true)
    wake = clock(w[1], w[2], w[3], false)
    rest = s.replace(b[0], ' ').replace(w[0], ' ')
  }
  if (bed == null || wake == null) return null
  const slept = (wake - bed + 1440) % 1440
  if (slept < 60 || slept > 900) return null
  const nowMin = now.getHours() * 60 + now.getMinutes()
  if (wake > nowMin + 10) return null
  rest = rest.replace(/\b(?:i|and|then|at|la)\b(?=\s*(?:,|$))/gi, ' ')
  return { bed: fromMin(bed), wake: fromMin(wake), sleptMin: slept, ...reasonOf(rest) }
}

/** "5h30", "45 min". */
export const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min} min`)

export interface ShortNightInput {
  sleptMin: number
  /** Now, "HH:MM". */
  now: string
  /** When he got up, "HH:MM". */
  wake: string
  /** The calendar's fixed events (the plan's own blocks left out). */
  events: CalEvent[]
  /** The plan ends by then. */
  endBy: string
  /** His learned best hours for hard work (e.g. [10, 11]), if any. */
  best?: number[]
  /** Today's focus sessions (a block with one was started and stays). */
  sessions?: Span[]
  /** Sleep need in minutes (Sleep care), for the training dose. */
  needMin?: number
}

export interface ShortNightResult {
  plan: DayProposal
  focusBefore: number
  focusAfter: number
  nap: { start: string; end: string } | null
  training: { mode: DoseMode; pct: number; minutes: number; time: string } | null
  /** Draft blocks that left the plan (their tasks stay on today's list). */
  moved: string[]
  /** The one line on what changed ("Lighter day: 3h25 focus instead of 5h45, nap 13:30–14:00, training at 70%"). */
  lead: string
}

const low = (x: string) => x.trim().toLowerCase()
const focusOf = (blocks: PlanBlock[]) => blocks.filter((b) => !b.rest).reduce((t, b) => t + Math.max(5, b.minutes || 0), 0)
const r5 = (n: number) => Math.round(n / 5) * 5
const trainMin = (t: NonNullable<DayProposal['training']>) => t.minutes ?? (Number(/(\d+)\s*min/.exec(t.what)?.[1]) || 30)

type Win = { s: number; e: number }
/** Takes `minutes` from the first window that has them at or after `from` (10 min breaks around). */
function take(wins: Win[], from: number, minutes: number): number | null {
  const i = wins.findIndex((w) => Math.ceil(Math.max(w.s, from) / 5) * 5 + minutes <= w.e)
  if (i < 0) return null
  const w = wins[i]
  const start = Math.ceil(Math.max(w.s, from) / 5) * 5
  const parts = [{ s: w.s, e: start - 10 }, { s: start + minutes + 10, e: w.e }].filter((x) => x.e - x.s >= 20)
  wins.splice(i, 1, ...parts)
  return start
}
/** Takes exactly [start, start + minutes) when it is free. */
function takeAt(wins: Win[], start: number, minutes: number): boolean {
  const i = wins.findIndex((w) => w.s <= start && start + minutes <= w.e)
  if (i < 0) return false
  const w = wins[i]
  wins.splice(i, 1, ...[{ s: w.s, e: start - 10 }, { s: start + minutes + 10, e: w.e }].filter((x) => x.e - x.s >= 20))
  return true
}

/**
 * Today's plan after a short night (null: not short, or nothing to change).
 * Only draft blocks change; pinned, approved, started and calendar blocks stay.
 */
export function shortNightPlan(plan: DayProposal, o: ShortNightInput): ShortNightResult | null {
  if (!(o.sleptMin < SHORT_NIGHT_MIN) || plan.shortNight != null) return null
  const startAt = planStartAt(o.now)
  const s0 = toMin(startAt)
  const sessions = o.sessions ?? []
  const fixed = (b: PlanBlock) => !!(b.locked || b.ok || b.sync?.eventId || b.rest || blockStarted(b, plan.day, sessions))
  const kept = plan.blocks.filter(fixed)
  const drafts = plan.blocks.filter((b) => !fixed(b))
  const focusBefore = focusOf(plan.blocks)
  if (!drafts.length && !plan.training) return null

  // The focus budget: about 60% of the day's focus (half under 5 h), never under an hour.
  const share = o.sleptMin < VERY_SHORT_MIN ? 0.5 : 0.6
  const budget = Math.max(60, r5(focusBefore * share))
  const must = new Set(plan.mustdos.map(low))
  const isMust = (b: PlanBlock) => [b.title, ...(b.tasks ?? [])].some((t) => must.has(low(t)))
  const rank = (b: PlanBlock) => (isMust(b) ? 0 : b.kind === 'goal' ? 1 : b.kind === 'quick' ? 3 : 2)
  const order = [...drafts].sort((a, b) => rank(a) - rank(b) || b.minutes - a.minutes || a.start.localeCompare(b.start))
  let used = focusOf(kept)
  const chosen: PlanBlock[] = []
  const left: PlanBlock[] = []
  for (const b of order) {
    const m = Math.min(60, b.minutes)
    if (isMust(b)) (chosen.push({ ...b, minutes: m }), (used += m))
    else if (used + m <= budget) (chosen.push({ ...b, minutes: m }), (used += m))
    else if (budget - used >= 25) {
      chosen.push({ ...b, minutes: r5(budget - used) })
      used = budget
    } else left.push(b)
  }

  // Free time from now: around the calendar, the blocks that stay and training.
  const iso = (hhmm: string, plus = 0) => new Date(new Date(`${plan.day}T${hhmm}:00`).getTime() + plus * 60000).toISOString()
  const asEvent = (start: string, minutes: number, id: string): CalEvent => ({ id, calendarId: 'plan', title: id, start: iso(start), end: iso(start, minutes), allDay: false })
  const busy: CalEvent[] = [...o.events, ...kept.filter((b) => toMin(b.start) + b.minutes > s0).map((b, i) => asEvent(b.start, b.minutes, `keep${i}`))]

  // Training: the readiness dose (never full after a short night), moved out of the past.
  let training = plan.training
  let trainOut: ShortNightResult['training'] = null
  if (training) {
    const rd = trainReadiness({ sleptMin: o.sleptMin, soreness: null, needMin: o.needMin })
    const mode: DoseMode = rd.mode === 'full' ? 'light' : rd.mode
    const base = trainMin(training)
    const minutes = training.locked || training.ok || training.sync?.eventId ? base : doseMinutes(base, mode)
    const what = `${DOSE_LABEL[mode]}: ${training.what.replace(/^(easy|lighter 70%|short 50%|full)\s*:\s*/i, '')}`
    training = { ...training, what, minutes }
    trainOut = { mode, pct: rd.pct === 100 ? 70 : rd.pct, minutes, time: training.time }
  }
  let wins = freeWindows(busy, plan.day, startAt, o.endBy)
  if (training && !training.locked && !training.ok && !training.sync?.eventId) {
    const tStart = toMin(training.time)
    if (tStart < s0 || !takeAt(wins, tStart, training.minutes ?? 30)) {
      const at = take(wins, Math.max(s0, toMin('17:00')), training.minutes ?? 30) ?? take(wins, s0, training.minutes ?? 30)
      if (at != null) training = { ...training, time: fromMin(at) }
    }
    trainOut = trainOut && { ...trainOut, time: training.time }
  } else if (training && toMin(training.time) >= s0) {
    busy.push(asEvent(training.time, training.minutes ?? 30, 'training'))
    wins = freeWindows(busy, plan.day, startAt, o.endBy)
  }

  // The hardest block first, in his best window (learned best hours, else 2–5 h after waking).
  const wakeMin = toMin(o.wake)
  const bestFrom = (() => {
    const hrs = (o.best ?? []).map((h) => h * 60).filter((m) => m + 30 >= s0).sort((a, b) => a - b)
    return Math.max(s0, hrs[0] ?? wakeMin + 120)
  })()
  const placed: PlanBlock[] = []
  const unplaced: PlanBlock[] = []
  const place = (b: PlanBlock, from: number) => {
    let at = take(wins, from, b.minutes)
    if (at == null && from > s0) at = take(wins, s0, b.minutes)
    let minutes = b.minutes
    if (at == null && b.minutes > 25) {
      minutes = 25
      at = take(wins, s0, 25)
    }
    if (at == null) unplaced.push(b)
    else placed.push({ ...b, start: fromMin(at), minutes })
  }
  if (chosen.length) place(chosen[0], bestFrom)

  // One nap before 15:00 when there is room (13:30 first, never within the next half hour).
  let nap: ShortNightResult['nap'] = null
  if (s0 <= toMin('14:30')) {
    for (const c of ['13:30', '13:00', '14:00', '12:30', '14:30'].map(toMin)) {
      if (c < s0 + 30) continue
      if (takeAt(wins, c, NAP_MIN)) {
        nap = { start: fromMin(c), end: fromMin(c + NAP_MIN) }
        break
      }
    }
  }
  for (const b of chosen.slice(1)) place(b, s0)

  // Tasks of blocks that left stay on today's list (no time), never tomorrow without asking.
  const gone = [...left, ...unplaced]
  const also: AlsoItem[] = [...(plan.also ?? [])]
  const lightMoved: string[] = []
  for (const b of gone)
    for (const t of b.tasks?.length ? b.tasks : [b.title]) {
      if (must.has(low(t))) continue
      lightMoved.push(t)
      const id = b.sync?.tasks?.find((x) => low(x.title) === low(t))?.id
      if (!also.some((a) => low(a.title) === low(t))) also.push({ title: t, minutes: Math.max(10, Math.round(b.minutes / Math.max(1, b.tasks?.length ?? 1))), priority: 1, ...(id ? { id } : {}) })
    }
  const napBlock: PlanBlock[] = nap ? [{ id: `nap-${plan.day}`, title: NAP_TITLE, start: nap.start, minutes: NAP_MIN, rest: true }] : []
  const blocks = [...kept, ...placed, ...napBlock].sort((a, b) => a.start.localeCompare(b.start))
  const focusAfter = focusOf(blocks)
  if (focusAfter === focusBefore && !nap && JSON.stringify(training) === JSON.stringify(plan.training) && blocks.every((b, i) => b.start === plan.blocks[i]?.start)) return null

  const parts = [`${hm(focusAfter)} focus instead of ${hm(focusBefore)}`, nap ? `nap ${nap.start}–${nap.end}` : '', trainOut ? `training ${trainOut.pct}% (${trainOut.minutes} min at ${trainOut.time})` : '']
  const lead = `Lighter day: ${parts.filter(Boolean).join(', ')}.`
  const hard = placed[0]
  const why = [
    `Short night (${hm(o.sleptMin)}):`,
    plan.mustdos.length ? `your ${plan.mustdos.length} must-do${plan.mustdos.length === 1 ? '' : 's'} stay,` : '',
    hard ? `the hardest work at ${hard.start},` : '',
    lightMoved.length ? `${lightMoved.length} smaller task${lightMoved.length === 1 ? '' : 's'} wait on today's list,` : '',
    nap ? 'a 20-minute nap before 15:00,' : '',
    trainOut ? `training at ${trainOut.pct}% with the same reps as last time.` : ''
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/,$/, '.')
  const out: DayProposal = relinkAlso({
    ...plan,
    blocks,
    training,
    also,
    light: true,
    shortNight: o.sleptMin,
    ...(lightMoved.length ? { lightMoved } : {}),
    headline: `Short night (${hm(o.sleptMin)}): a lighter day · ${hm(focusAfter)} focus${nap ? ` · nap ${nap.start}` : ''}`.slice(0, 160),
    why
  })
  return { plan: out, focusBefore, focusAfter, nap, training: trainOut, moved: gone.map((b) => b.title), lead }
}

/**
 * Tonight's bedtime: the earlier of the bedtime target and the wake target minus
 * the sleep need, rounded down to 15 min, never before 21:30.
 */
export function bedTonight(o: { target: string; wakeTomorrow: string; needMin: number }): string {
  const late = (m: number) => (m < 12 * 60 ? m + 1440 : m)
  const fromNeed = late((toMin(o.wakeTomorrow) - o.needMin + 1440) % 1440)
  const pick = Math.max(late(21 * 60 + 30), Math.min(late(toMin(o.target)), fromNeed))
  return fromMin((Math.floor(pick / 15) * 15) % 1440)
}

/** One short, kind line about why, with one tiny thing for tonight (null: no reason given). */
export function reasonLine(say: Pick<SleepSay, 'kind' | 'who'>, bed: string): string | null {
  if (!say.kind) return null
  const before = (m: number) => fromMin((toMin(bed) - m + 1440) % 1440)
  switch (say.kind) {
    case 'partner':
      return `Time with your ${say.who} counts too, no guilt. Tonight: say goodnight by ${before(15)}, lights out by ${bed}.`
    case 'people':
      return `Time with people you like counts too, no guilt. Tonight: head home or hang up by ${before(30)}, lights out by ${bed}.`
    case 'screen':
      return `It happens, no guilt. Tonight: phone on the charger away from the bed at ${before(30)}, lights out by ${bed}.`
    case 'work':
      return `Late work happens. Tonight: stop working at ${before(60)}, lights out by ${bed}.`
    default:
      return `Noted, no guilt. Tonight: lights out by ${bed}.`
  }
}

/** The reply: what changed first, then the sleep, then the kind line. */
export function nightReply(say: SleepSay, r: ShortNightResult | null, o: { bed: string; hasPlan: boolean; approved: boolean }): { reply: string; chips: string[] } {
  const slept = `Slept ${hm(say.sleptMin)} (${say.bed}–${say.wake}), logged.`
  const kind = say.sleptMin < SHORT_NIGHT_MIN ? reasonLine(say, o.bed) : null
  if (say.sleptMin >= SHORT_NIGHT_MIN) return { reply: [slept, 'A good night: today\'s plan stays as it is.'].join('\n'), chips: ['What now?'] }
  if (r) {
    const keep = r.plan.mustdos.length ? `Kept your ${r.plan.mustdos.length} must-do${r.plan.mustdos.length === 1 ? '' : 's'}.` : ''
    const wait = r.plan.lightMoved?.length ? ` ${r.plan.lightMoved.length} smaller task${r.plan.lightMoved.length === 1 ? '' : 's'} wait on today's list.` : ''
    return {
      reply: [r.lead, `${slept} ${keep}${wait}`.trim(), kind].filter(Boolean).join('\n'),
      chips: [...(r.plan.lightMoved?.length ? ['Move the rest to tomorrow'] : []), 'Keep the full plan', 'What now?']
    }
  }
  const why = !o.hasPlan ? 'Short night: plan a light day with a 20-minute nap before 15:00.' : o.approved ? "Short night. Today's plan is approved and in your calendar, so I left it: use Too much today on the plan card to lighten it." : "Short night. Today's plan is already the lighter one."
  return { reply: [slept, why, kind].filter(Boolean).join('\n'), chips: !o.hasPlan ? ['Plan my day', 'What now?'] : ['What now?'] }
}

/** The chips under that reply, said back. */
export function lighterAnswer(text: string): 'rest' | 'keep' | null {
  const t = String(text ?? '').trim().toLowerCase().replace(/[.!]+$/, '')
  if (t === 'move the rest to tomorrow') return 'rest'
  if (t === 'keep the full plan') return 'keep'
  return null
}
