// Ben writes so you understand him at once (Coach readability fix, pure, tested).
//
// Before: "Coffee in, room nearly done — good. Next real thing is the lab block at
// 15:00, 48 min away, and you've got 14:30–15:00 free before it." You had to work
// out what he meant. Now every answer, from the model or from code, follows the
// same rules:
// - the direct answer first, in plain words;
// - short, whole sentences (no "Coffee in", "Next real thing");
// - two or more points go on their own lines;
// - a time reads "at 15:00 (in 48 min)";
// - no app words ("block", "window", "v2");
// - one clear next step at the end (a button when there is an action).

/** The rules for the model's prompt (botBrain.ts). */
export const PLAIN_RULES = [
  'How to write (he must understand you at once, without effort):',
  '- Start with the direct answer to what he asked, in plain words. No warm-up.',
  '- Short, whole sentences (at most about 15 words each). Never note-style shorthand like "Coffee in", "Room done", "Next real thing", "Lab next" or "48 min away".',
  '- Two or more points: put each on its own line (a new line, or a tiny list with "• "). One point: one or two sentences.',
  '- Times: write "at 15:00 (in 48 min)", never "15:00, 48 min away".',
  '- No app words: never "block", "window", "slot" or version numbers like "v2". Say what it is: "the lab at 15:00", "free time from 14:30 to 15:00", "your plan".',
  '- End with ONE clear next step. When there is an action for it, add a button for it.'
].join('\n')

const toMin = (hm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}

/** "45 min", "1 h", "1 h 35 min". */
export function dur(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

/** "at 15:00 (in 48 min)"; a time that has passed or is now: "at 15:00". */
export function atIn(hm: string, now: Date): string {
  const t = toMin(hm)
  if (!Number.isFinite(t)) return `at ${hm}`
  const left = t - (now.getHours() * 60 + now.getMinutes())
  return left > 0 ? `at ${hm} (in ${dur(left)})` : `at ${hm}`
}

/** "1.2 L" from millilitres. */
const litres = (ml: number) => `${(Math.max(0, ml) / 1000).toFixed(1)} L`

// ---- Readability checks (golden tests and the model's reply tidy-up) ----------------------

/** Note-style shorthand that makes him stop and decode. */
const SHORTHAND: RegExp[] = [
  /(^|[.!?]\s+|\n)[A-Z][a-z]+ (in|done|logged|next|sorted|up),/, // "Coffee in, …", "Room done, …"
  /\bnext real thing\b/i,
  /\b\d+\s*min away\b/i,
  /(^|[.!?]\s+|\n)[A-Z][a-z]+ next\.(\s|$)/, // "Etica next."
  /\b(good|nice)\s*—/i // "… — good."
]
/** App words he shouldn't have to know. */
const JARGON: RegExp[] = [/\bblocks?\b/i, /\bwindows?\b/i, /\bslots?\b/i, /(^|[\s(])v\d+\b/i]

/** The sentences of a reply (lines and sentence ends). */
export function sentences(text: string): string[] {
  return String(text ?? '')
    .split(/\n+/)
    .flatMap((l) => l.replace(/^\s*[•\-–]\s*/, '').split(/(?<=[.!?])\s+(?=[A-Z0-9"“▶])/))
    .map((s) => s.trim())
    .filter(Boolean)
}

/** What makes a reply hard to read: the longest sentence (words), shorthand and jargon found. */
export function readability(text: string): { longest: number; shorthand: string[]; jargon: string[] } {
  const s = sentences(text)
  const words = (x: string) => x.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length
  const find = (list: RegExp[]) => list.map((r) => r.exec(text)?.[0]?.trim()).filter((x): x is string => !!x)
  return { longest: Math.max(0, ...s.map(words)), shorthand: find(SHORTHAND), jargon: find(JARGON) }
}

/**
 * The model's reply, made easier to read without changing what it says: app words
 * out ("the lab block" → "the lab", "free window" → "free time", "(v2)" gone), the
 * known shorthand spelled out, and three or more sentences on their own lines.
 * Plan titles the planner gave ("Deep block 1") are left alone.
 */
export function plainTidy(reply: string): string {
  let t = String(reply ?? '')
  if (!t.trim()) return t
  t = t
    .replace(/\s*\(v\d+\)/gi, '')
    .replace(/\b(?:a |the |your )?(?:free |open )window\b/gi, 'free time')
    .replace(/\b([Aa]|[Tt]he|[Yy]our|[Tt]his|[Tt]hat|[Nn]ext) ([a-z][a-z-]+) block\b(?!\s*\d)/g, '$1 $2')
    .replace(/\b(your|the|a) next block\b/g, '$1 next thing')
    .replace(/\bNext real thing is\b/g, 'Next up is')
    .replace(/\bnext real thing is\b/g, 'next up is')
    .replace(/\b(\d+) min away\b/g, 'in $1 min')
  // Three or more sentences in one paragraph: one per line.
  if (!t.includes('\n')) {
    const s = sentences(t)
    if (s.length >= 3) t = s.join('\n')
  }
  return t
}

// ---- "How is my day going?" in code ---------------------------------------------------------

export interface DayNumbers {
  /** Plan things done / planned today (0 planned = no plan). */
  planDone: number
  planTotal: number
  /** Plan things whose time is still ahead. */
  planAhead: number
  focusMin: number
  focusGoal: number
  waterMl: number
  waterTarget: number
  mustDone: number
  mustTotal: number
  /** The first open must-do. */
  nextMust: string | null
  /** What really comes next (plan or calendar), with its start "HH:MM". */
  next: { title: string; start: string } | null
  /** A timer running now. */
  running: { subject: string; leftMin: number } | null
}

export interface PlainReply {
  reply: string
  chips: string[]
  buttons: { label: string; do: string }[]
}

/** "How is my day going?": a verdict first, then one line per number, then what's next and one step. */
export function daySoFar(d: DayNumbers, now: Date): PlainReply {
  const h = now.getHours() + now.getMinutes() / 60
  // How far into the day he should be (08:00 → 0, 21:00 → 1), so 18:55 isn't judged like 09:00.
  const pace = Math.min(1, Math.max(0.15, (h - 8) / 13))
  const parts: number[] = []
  if (d.focusGoal > 0) parts.push(Math.min(1, d.focusMin / (d.focusGoal * pace)))
  if (d.mustTotal > 0) parts.push(Math.min(1, d.mustDone / Math.max(1, d.mustTotal * pace)))
  if (d.waterTarget > 0) parts.push(Math.min(1, d.waterMl / (d.waterTarget * pace)))
  if (d.planTotal > 0) parts.push(Math.min(1, d.planDone / Math.max(1, (d.planTotal - d.planAhead) || 1)))
  const score = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0
  const verdict = !parts.length ? "I don't have much logged today yet." : score >= 0.85 ? 'Your day is going well.' : score >= 0.55 ? 'Your day is going OK, with some catching up to do.' : 'Your day is behind so far, but there is still time.'
  const lines: string[] = []
  if (d.planTotal > 0) lines.push(`• Plan: ${d.planDone} of ${d.planTotal} done${d.planAhead ? `, ${d.planAhead} still ahead` : ''}.`)
  if (d.focusGoal > 0 || d.focusMin > 0) lines.push(`• Focus: ${dur(d.focusMin)}${d.focusGoal > 0 ? ` of your ${dur(d.focusGoal)} goal` : ''}.`)
  if (d.mustTotal > 0) lines.push(`• Must-dos: ${d.mustDone} of ${d.mustTotal} done.${d.nextMust && d.mustDone < d.mustTotal ? ` Still open: ${d.nextMust}.` : ''}`)
  if (d.waterTarget > 0) lines.push(`• Water: ${litres(d.waterMl)} of ${litres(d.waterTarget)}.`)
  let after = ''
  if (d.running) after = `Right now you are on ${d.running.subject} (${dur(d.running.leftMin)} left).`
  else if (d.next) after = `Next: ${d.next.title} ${atIn(d.next.start, now)}.`
  // One step, the biggest gap first.
  const focusGap = d.focusGoal > 0 && d.focusMin < d.focusGoal * pace
  const mustGap = d.mustTotal > 0 && d.mustDone < d.mustTotal
  const waterGap = d.waterTarget > 0 && d.waterMl < d.waterTarget * pace - 250
  const target = d.nextMust ?? null
  let step = ''
  let buttons: PlainReply['buttons'] = []
  let chips = ['What now?']
  if (d.running) step = 'Stay on it until the timer ends.'
  else if (mustGap && target) {
    step = `One step now: 25 min on ${target}.`
    buttons = [{ label: `▶ 25 min ${target}`.slice(0, 32), do: `focus:25:${target.slice(0, 40)}` }]
  } else if (focusGap) {
    step = 'One step now: a 25-min focus session.'
    buttons = [{ label: '▶ 25 min Focus', do: 'focus:25:Focus' }]
  } else if (waterGap) {
    step = 'One step now: drink a glass of water.'
    chips = ['Water 250', 'What now?']
  } else step = parts.length ? 'Keep it going like this.' : 'Tell me what you did so far, or plan the rest of the day.'
  if (!parts.length) chips = ['Plan my day', 'What now?']
  const reply = [verdict, ...lines, after, step].filter(Boolean).join('\n')
  return { reply, chips, buttons }
}

/** He asks how today is going (not a review of a finished day). */
export function asksDaySoFar(text: string): boolean {
  const t = String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?!.…]+$/g, '').trim()
  return /^(ok |so |hey |and )?(ben,? )?(how('s| is) (my|the) day( going| looking)?( so far)?( today)?|how am i doing( today| so far)*|how('s| is) today( going| looking)?( so far)?|how('s| is) it going today|how('m| am) i doing today|cum merge ziua|как (проходит )?(мой )?день)$/.test(t)
}

// ---- Coffee ------------------------------------------------------------------------------

/** The coffee log's reply in plain words (the caffeine view from sleepCare.ts). */
export function coffeePlain(v: { cups: number; curfew: string; left: number }, bed: string): string {
  const nth = v.cups === 1 ? 'first' : v.cups === 2 ? 'second' : v.cups === 3 ? 'third' : `${v.cups}th`
  if (v.left <= 0) return `☕ Logged your ${nth} coffee today.\nThat is past your caffeine cut-off (${v.curfew}).\nHalf of it is still in you at bedtime (${bed}), so drink water from here on.`
  return `☕ Logged your ${nth} coffee today.\nHave your last caffeine by ${v.curfew}, so it doesn't hurt your sleep (bed at ${bed}).`
}

