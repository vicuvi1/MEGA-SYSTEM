// LS6 + ME1: what Ben knows about you, as things you can see and change.
// Pure and tested (benFacts.test.ts).
//
// - Corrections you say ("no, curata camera takes 40 min", "gym is always at
//   18", "by sala I mean gym") become preferences: durations, default times
//   and aliases. The day planner and the router read them next time. You said
//   them, so they are saved at once (with Undo).
// - Things Ben only guesses from a chat ("my shift is 17–24") become offers:
//   "Remember that your shift is 17–24?" Yes / No. Nothing is saved until Yes.
// - "Forget everything about X" takes X out of every place he keeps notes.
// - Only the memories that fit the message go into his prompt.
// Stored in the synced `settings` table (key `ben_know`), never in the repo.

import { normalize, similarity } from './benNormalize'

export const BEN_KNOW = 'ben_know'

export type PrefKind = 'duration' | 'time' | 'alias'
export type Source = 'app' | 'telegram' | 'you' | 'ben' | 'learned'

export interface Pref {
  id: string
  kind: PrefKind
  /** The name it is about, normalised ("curata camera", "gym", "sala"). */
  key: string
  /** Minutes (duration), "HH:MM" (time) or the real name (alias). */
  value: number | string
  /** How he said the name. */
  label: string
  src: Source
  at: string
}

export type OfferKind = 'fact' | 'person' | 'habit' | 'goal' | 'work'

export interface Offer {
  id: string
  /** What would be remembered, in plain words ("Your shift is 17:00–24:00"). */
  text: string
  kind: OfferKind
  /** A work shift also updates My life (Settings → Ben) when he says yes. */
  work?: { from: string; to: string; days?: number[] }
  src: Source
  at: string
}

export interface Know {
  prefs: Pref[]
  offers: Offer[]
}

export const EMPTY_KNOW: Know = { prefs: [], offers: [] }
export const PREFS_MAX = 120
export const OFFERS_MAX = 12

let seq = 0
export const knowId = (now: Date, p = 'k') => `${p}${now.getTime().toString(36)}${(seq++ % 1296).toString(36).padStart(2, '0')}`

const HM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/

export function cleanKnow(raw: unknown): Know {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Know>
  const prefs = (Array.isArray(o.prefs) ? o.prefs : []).filter(
    (p): p is Pref => !!p && typeof p.id === 'string' && (p.kind === 'duration' || p.kind === 'time' || p.kind === 'alias') && typeof p.key === 'string' && !!p.key && (p.kind === 'duration' ? typeof p.value === 'number' && p.value > 0 && p.value <= 600 : typeof p.value === 'string' && (p.kind !== 'time' || HM.test(p.value)))
  )
  const offers = (Array.isArray(o.offers) ? o.offers : []).filter((x): x is Offer => !!x && typeof x.id === 'string' && typeof x.text === 'string' && !!x.text.trim())
  return { prefs: prefs.slice(-PREFS_MAX), offers: offers.slice(-OFFERS_MAX) }
}

// ---- Reading a correction ---------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0')
/** "18", "18:30", "6pm", "6.30" → "HH:MM". */
export function clock(s: string): string | null {
  const m = /^(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm)?$/i.exec(String(s ?? '').trim())
  if (!m) return null
  let h = Number(m[1])
  if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12
  if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0
  const mi = Number(m[2] ?? 0)
  if (h === 24 && mi === 0) return '24:00'
  return h < 24 && mi < 60 ? `${pad(h)}:${pad(mi)}` : null
}
const minutesOf = (n: string, unit: string) => {
  const v = Number(n.replace(',', '.'))
  const mins = /^(h|hr|hrs|hour|hours|ore|ora|час|часа|часов)$/i.test(unit) ? v * 60 : v
  return Number.isFinite(mins) && mins >= 5 && mins <= 600 ? Math.round(mins) : null
}
const nameOf = (s: string) =>
  normalize(s)
    .replace(/^(no|nu|нет|actually|de fapt|на самом деле)[,.]?\s+/i, '')
    .replace(/^(the|my|a|an)\s+/i, '')
    .replace(/[.,!?]+$/, '')
    .trim()

export interface Correction {
  kind: PrefKind
  key: string
  label: string
  value: number | string
}

/**
 * A correction he states as a rule: a duration, a default time or an alias.
 * "no, curata camera takes 40 min" · "gym is always at 18" · "by sala I mean gym"
 * · "curata camera dureaza 40 min" · "спортзал всегда в 18".
 */
export function readCorrection(text: string): Correction | null {
  const raw = String(text ?? '').trim()
  if (!raw || raw.length > 120 || /\?\s*$/.test(raw)) return null
  const t = normalize(raw).replace(/[.!]+$/, '')
  let m: RegExpExecArray | null
  const UNIT = '(min|mins|minute|minutes|minute|m|h|hr|hrs|hour|hours|ore|ora|минут|мин|минуты|час|часа|часов)'
  if ((m = new RegExp(`^(?:no[,.]?\\s+|nu[,.]?\\s+|нет[,.]?\\s+|actually[,.]?\\s+)?(.{2,40}?)\\s+(?:takes|lasts|is|needs|takes me|dureaza|tine|ia|занимает|длится)\\s+(?:about\\s+|around\\s+|cam\\s+|около\\s+)?(\\d{1,3}(?:[.,]5)?)\\s*${UNIT}(?:\\s+(?:not|nu|а не)\\s+.*)?$`, 'iu').exec(t))) {
    const key = nameOf(m[1])
    const minutes = minutesOf(m[2], m[3])
    if (key && minutes && !/\b(it|that|this|asta|это)\b/.test(key)) return { kind: 'duration', key, label: m[1].trim(), value: minutes }
  }
  if ((m = /^(?:no[,.]?\s+|nu[,.]?\s+|нет[,.]?\s+)?(.{2,40}?)\s+(?:is\s+)?(?:always|usually|every day|e mereu|este mereu|mereu|e intotdeauna|всегда|обычно)\s+(?:at|la|в)\s+(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)$/iu.exec(t))) {
    const key = nameOf(m[1])
    const time = clock(m[2])
    if (key && time && time !== '24:00') return { kind: 'time', key, label: m[1].trim(), value: time }
  }
  if ((m = /^(?:by|when i say)\s+['"]?(.{2,30}?)['"]?\s+i mean\s+['"]?(.{2,40}?)['"]?$/i.exec(t)) || (m = /^['"]?(.{2,30}?)['"]?\s+(?:means|=|inseamna|значит)\s+['"]?(.{2,40}?)['"]?$/iu.exec(t)) || (m = /^call\s+['"]?(.{2,40}?)['"]?\s+['"]?(.{2,30}?)['"]?\s+from now on$/i.exec(t))) {
    const [a, b] = /^call/i.test(t) ? [m[2], m[1]] : [m[1], m[2]]
    const key = nameOf(a)
    if (key && b.trim() && key !== normalize(b)) return { kind: 'alias', key, label: a.trim(), value: b.trim() }
  }
  return null
}

/** Saves a preference (the same kind and name is replaced); `prev` is what it replaced, for Undo. */
export function addPref(k: Know, c: Correction, src: Source, now = new Date()): { know: Know; pref: Pref; prev: Pref | null } {
  const prev = k.prefs.find((p) => p.kind === c.kind && p.key === c.key) ?? null
  const pref: Pref = { id: knowId(now, 'p'), kind: c.kind, key: c.key, label: c.label, value: c.value, src, at: now.toISOString() }
  return { know: { ...k, prefs: [...k.prefs.filter((p) => p !== prev), pref].slice(-PREFS_MAX) }, pref, prev }
}

/** One line for the result list ("📌 Remembered: curata camera takes 40 min"). */
export function prefText(p: Pick<Pref, 'kind' | 'label' | 'value'>): string {
  if (p.kind === 'duration') return `${p.label} takes ${p.value} min`
  if (p.kind === 'time') return `${p.label} is at ${p.value}`
  return `"${p.label}" means ${p.value}`
}

const best = (k: Know, kind: PrefKind, name: string, min = 0.8): Pref | null => {
  let top: { p: Pref; s: number } | null = null
  for (const p of k.prefs) {
    if (p.kind !== kind) continue
    const s = similarity(p.key, name)
    if (s >= min && (!top || s > top.s || (s === top.s && p.at > top.p.at))) top = { p, s }
  }
  return top?.p ?? null
}

/** How long he said this takes (minutes), or null. */
export function prefDuration(k: Know, title: string): number | null {
  const p = best(k, 'duration', title)
  return p ? Number(p.value) : null
}

/** The time he said this is always at ("HH:MM"), or null. */
export function prefTime(k: Know, what: string): string | null {
  const p = best(k, 'time', what, 0.85)
  return p ? String(p.value) : null
}

/** His aliases as a map ("sala" → "gym"). */
export function aliasMap(k: Know): Record<string, string> {
  return Object.fromEntries(k.prefs.filter((p) => p.kind === 'alias').map((p) => [p.key, String(p.value)]))
}

// ---- Offers: Ben asks before he remembers ------------------------------------

const DAYS: Record<string, number[]> = {
  weekdays: [1, 2, 3, 4, 5],
  'mon-fri': [1, 2, 3, 4, 5],
  'monday to friday': [1, 2, 3, 4, 5],
  'every day': [0, 1, 2, 3, 4, 5, 6],
  daily: [0, 1, 2, 3, 4, 5, 6],
  weekends: [0, 6]
}

/**
 * Something lasting he said about himself that Ben could remember. Only
 * clear statements, never a question.
 * "my shift is 17-24" · "I work 17–24 on weekdays" · "lucrez 17-24" ·
 * "my sister is Ana" · "I live in Chisinau" · "I'm allergic to nuts".
 */
export function readOffer(text: string): Pick<Offer, 'text' | 'kind' | 'work'> | null {
  const raw = String(text ?? '').trim()
  if (!raw || raw.length > 160 || /\?\s*$/.test(raw)) return null
  const t = normalize(raw).replace(/[.!]+$/, '')
  let m: RegExpExecArray | null
  const span = '(\\d{1,2}(?::\\d{2})?)\\s*(?:-|–|—|to|till|until|pana la|до)\\s*(\\d{1,2}(?::\\d{2})?)'
  if ((m = new RegExp(`(?:my (?:shift|work|job) is|i work|i'?m at work|i have work|lucrez|tura mea e|tura e|работаю|моя смена)\\s+(?:from\\s+|de la\\s+|с\\s+)?${span}(?:\\s+(?:on\\s+)?(weekdays|mon-fri|monday to friday|every day|daily|weekends))?`, 'i').exec(t))) {
    const from = clock(m[1])
    const to = clock(m[2])
    if (from && to && from !== to) {
      const days = m[3] ? DAYS[m[3].toLowerCase()] : undefined
      return { kind: 'work', text: `Your shift is ${from}–${to}${m[3] ? ` (${m[3]})` : ''}`, work: { from, to, ...(days ? { days } : {}) } }
    }
  }
  if ((m = /^my (sister|brother|mom|mother|dad|father|girlfriend|boyfriend|wife|husband|best friend|friend|roommate|teacher|boss|partner)(?:'s name)? is ([a-z][a-z\- ]{1,30})$/i.exec(t))) return { kind: 'person', text: `Your ${m[1]} is ${m[2].replace(/\b\w/g, (c) => c.toUpperCase())}` }
  if ((m = /^i live in ([a-z][a-z\- ]{1,30})$/i.exec(t))) return { kind: 'fact', text: `You live in ${m[1].replace(/\b\w/g, (c) => c.toUpperCase())}` }
  if ((m = /^i'?m allergic to ([a-z][a-z\- ,]{1,40})$/i.exec(t))) return { kind: 'fact', text: `You're allergic to ${m[1]}` }
  if ((m = /^my goal is (?:to )?(.{4,80})$/i.exec(t))) return { kind: 'goal', text: `Your goal: ${m[1]}` }
  if ((m = /^i (?:always|usually) (wake up|go to bed|train|go to the gym|study|work out|eat) (?:at|around) (\d{1,2}(?::\d{2})?(?:\s*[ap]m)?)$/i.exec(t))) {
    const at = clock(m[2])
    if (at) return { kind: 'habit', text: `You usually ${m[1]} at ${at}` }
  }
  return null
}

/** Queues an offer (the same words never twice). */
export function addOffer(k: Know, o: Pick<Offer, 'text' | 'kind' | 'work'>, src: Source, now = new Date()): { know: Know; offer: Offer | null } {
  if (k.offers.some((x) => normalize(x.text) === normalize(o.text))) return { know: k, offer: null }
  const offer: Offer = { id: knowId(now, 'o'), ...o, src, at: now.toISOString() }
  return { know: { ...k, offers: [...k.offers, offer].slice(-OFFERS_MAX) }, offer }
}

/** The two buttons under an offer: Yes saves, No forgets it. */
export function offerButtons(o: Pick<Offer, 'id'>): { label: string; do: string }[] {
  return [
    { label: '✅ Yes, remember', do: `say:Yes, remember it (${o.id})` },
    { label: 'No', do: `say:No, don't remember it (${o.id})` }
  ]
}

/** The question Ben asks ("Remember that your shift is 17:00–24:00?"). */
export function offerQuestion(o: Pick<Offer, 'text'>): string {
  const t = o.text.replace(/^Your /, 'your ').replace(/^You /, 'you ')
  return `Remember that ${t}?`
}

/** "Yes, remember it (o12ab)" / "No, don't remember it (o12ab)" → the answer, or null. */
export function readOfferAnswer(text: string): { id: string; yes: boolean } | null {
  const m = /^\s*(yes|no)\b[^()]*\((o[a-z0-9]{3,16})\)\s*$/i.exec(String(text ?? ''))
  return m ? { id: m[2], yes: m[1].toLowerCase() === 'yes' } : null
}

/** Takes an offer out of the queue (and gives it back when found). */
export function takeOffer(k: Know, id: string): { know: Know; offer: Offer | null } {
  const offer = k.offers.find((o) => o.id === id) ?? null
  return { know: { ...k, offers: k.offers.filter((o) => o.id !== id) }, offer }
}

// ---- Forget everything about X ----------------------------------------------

/** Does this text mention X (a word or name, typos ignored)? */
export function mentions(text: string, about: string): boolean {
  const a = normalize(about)
  if (a.length < 2) return false
  const t = normalize(text)
  if (new RegExp(`(?<![\\p{L}\\p{N}])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(t)) return true
  return a.length >= 4 && similarity(a, t) >= 0.9
}

/** "forget everything about Ana" / "uita tot despre Ana" / "забудь всё про Ану" → "Ana". */
export function readForget(text: string): string | null {
  const m = /^\s*(?:please\s+)?(?:forget (?:everything|all|anything) (?:about|on|regarding)|forget about|uita tot (?:despre|legat de)|uită tot (?:despre|legat de)|забудь (?:всё|все) (?:про|о|об))\s+(.{2,40}?)[.!]?\s*$/iu.exec(String(text ?? ''))
  return m ? m[1].trim() : null
}

export interface ForgetIn {
  facts: { t: string; pin?: boolean }[]
  prefs: Pref[]
  offers: Offer[]
  people: { name: string; who?: string }[]
  goals: { text: string }[]
  /** Lines of his notes about you (not pinned blocks). */
  blockLines: { block: string; line: string }[]
}

/** What "forget everything about X" takes out (pinned facts stay; he pinned them). */
export function forgetPlan(s: ForgetIn, about: string): { facts: string[]; prefs: string[]; offers: string[]; people: string[]; goals: string[]; blockLines: { block: string; line: string }[]; total: number } {
  const facts = s.facts.filter((f) => !f.pin && mentions(f.t, about)).map((f) => f.t)
  const prefs = s.prefs.filter((p) => mentions(`${p.label} ${p.value}`, about)).map((p) => p.id)
  const offers = s.offers.filter((o) => mentions(o.text, about)).map((o) => o.id)
  const people = s.people.filter((p) => mentions(`${p.name} ${p.who ?? ''}`, about)).map((p) => p.name)
  const goals = s.goals.filter((g) => mentions(g.text, about)).map((g) => g.text)
  const blockLines = s.blockLines.filter((b) => mentions(b.line, about))
  return { facts, prefs, offers, people, goals, blockLines, total: facts.length + prefs.length + offers.length + people.length + goals.length + blockLines.length }
}

// ---- What goes into his prompt ----------------------------------------------

/**
 * The preferences that fit this message (names it mentions, or all durations
 * when he asks for a plan), as short lines; empty when none fit.
 */
export function prefsForPrompt(k: Know, text: string, intent = 'chat', max = 6): string {
  const t = normalize(text)
  const planning = intent === 'plan' || intent === 'multi' || /\b(plan|add|schedule|book|move)\b/.test(t)
  const hit = k.prefs.filter((p) => mentions(t, p.key) || (planning && p.kind !== 'alias'))
  if (!hit.length) return ''
  return `What he told you (use it): ${hit
    .slice(-max)
    .map((p) => prefText(p))
    .join('; ')}.`
}
