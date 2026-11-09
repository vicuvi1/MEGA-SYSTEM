// The coach talks (step 2 of the AI coach): the evening check-in, the gentle
// nudges with ONE daily cap shared with the food pushes, and the chat's coach
// part (when a message is about food, training or the body: the compact
// context, the hard rules, a fast path for a missed session, a guard on the
// model's reply, and plan-change proposals that wait for "Apply").
// Pure and tested (coachTalk.test.ts). The safety rules are coachSafety.ts.
import { KCAL_FLOOR, addOnsFor, plain, safeText, sentenceOk } from './coachSafety'
import type { CoachLang } from './coachConfig'
import { channelFor, type PushButton, type PushLog, type PushOut } from './benPushes'
import { TYPE_NAME, WEEKDAYS, dowOf, todayPlan, validateWeek, type DayType, type DoneSession, type TrainWeek } from './trainWeek'
import { ITEMS_MAX, cleanQty, dayTotals, foodOf, itemLabel, type FoodSaved, type SavedItem } from './foodSaved'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
const isHm = (t: unknown): t is string => typeof t === 'string' && /^\d{1,2}:\d{2}$/.test(t)
/** Minutes into the app day (it turns at 04:00, so 00:30 is 24:30). */
export const appMinuteOf = (d: Date) => {
  const m = d.getHours() * 60 + d.getMinutes()
  return m < 240 ? m + 1440 : m
}
const bedMin = (bed: string | null | undefined) => {
  if (!isHm(bed)) return 23 * 60 + 30
  const m = toMin(bed.padStart(5, '0'))
  return m < 12 * 60 ? m + 1440 : m
}

// ---------- language ----------

const RO_WORDS = /\b(si|sa|ce|cum|nu|am|eu|azi|maine|pot|vreau|ratat|antrenament(ul)?|mananc|masa|proteine|calorii|ziua|dupa|trebuie|acum|ieri|sunt|mai|pentru|cat|unde|care|fac|facut)\b/g
/** Romanian when the message has its letters or several of its words; else English (or the fallback for a very short text). */
export function langOf(text: string, fallback: CoachLang = 'en'): CoachLang {
  const t = String(text ?? '')
  if (/[ăâîșşțţ]/i.test(t)) return 'ro'
  const hits = plain(t).match(RO_WORDS)?.length ?? 0
  if (hits >= 2) return 'ro'
  if (/[a-z]{3,}/i.test(t)) return 'en'
  return fallback
}

// ---------- the evening check-in ----------

export interface CheckinFacts {
  date: string
  kcal: number
  kcalGoal: number
  protein: number
  proteinGoal: number
  /** Today's training: done, planned and not done, or a rest day. */
  training: 'done' | 'missed' | 'rest'
  /** The session's name ("Upper body"), or null on a rest day. */
  session: string | null
  weighed: boolean
  weight: number | null
  /** Last night's sleep from the sleep log (hours), or null. */
  sleepH: number | null
  /** Under 1,600 kcal on 3+ of the last 7 logged days (the gentle note). */
  low: boolean
  tomorrow: { kind: 'session' | 'rest'; title: string } | null
  bed: string
  lang: CoachLang
}

export interface CheckinTaps {
  energy: number
  soreness: number
  /** Hours slept last night (from the log, or your tap). */
  sleep: number | null
}

const kg = (n: number) => (Math.round(n * 10) / 10).toFixed(1)
const hours = (n: number) => String(Math.round(n * 2) / 2)

/** The auto-filled part: food against the goal, the workout, the weigh-in, last night's sleep. */
export function checkinLines(f: CheckinFacts): string[] {
  const ro = f.lang === 'ro'
  const food = ro
    ? `Mâncare: ${fmt(f.kcal)} / ${fmt(f.kcalGoal)} kcal · ${fmt(f.protein)} / ${fmt(f.proteinGoal)} g proteine`
    : `Food: ${fmt(f.kcal)} / ${fmt(f.kcalGoal)} kcal · ${fmt(f.protein)} / ${fmt(f.proteinGoal)} g protein`
  const train =
    f.training === 'rest'
      ? ro
        ? 'Antrenament: zi de pauză'
        : 'Workout: rest day'
      : f.training === 'done'
        ? `${ro ? 'Antrenament' : 'Workout'}: ${f.session ?? (ro ? 'făcut' : 'done')} ✓`
        : `${ro ? 'Antrenament' : 'Workout'}: ${f.session ?? ''} ${ro ? 'nefăcut' : 'not done'}`.replace(/\s+/g, ' ')
  const weigh = f.weighed ? `${ro ? 'Cântărire' : 'Weigh-in'}: ${f.weight != null ? `${kg(f.weight)} kg ` : ''}✓` : `${ro ? 'Cântărire' : 'Weigh-in'}: ${ro ? 'nu azi' : 'not today'}`
  const out = [food, train, weigh]
  if (f.sleepH != null) out.push(ro ? `Somn azi-noapte: ${hours(f.sleepH)} h (din jurnal)` : `Sleep last night: ${hours(f.sleepH)} h (from your log)`)
  return out
}

/** The sleep buttons: the logged hours (if any) and 6–9 h. */
export function sleepChoices(pre: number | null): number[] {
  const out = new Set<number>([6, 7, 8, 9])
  if (pre != null && pre >= 3 && pre <= 14) out.add(Math.round(pre * 2) / 2)
  return [...out].sort((a, b) => a - b)
}

export const clampTap = (n: unknown) => {
  const v = Math.round(Number(n))
  return Number.isFinite(v) ? Math.max(1, Math.min(5, v)) : 3
}
export const cleanSleep = (n: unknown): number | null => {
  const v = Number(n)
  return n == null || n === '' || !Number.isFinite(v) ? null : Math.max(3, Math.min(14, Math.round(v * 2) / 2))
}

export interface CheckinReply {
  good: string
  next: string
  text: string
}

/**
 * The coach's 1–2 sentences after the taps, decided by rules from the logs
 * (what went well + one thing for tomorrow). Never body talk, never under the
 * floor, the gentle note when intake was low. The AI may only rephrase it.
 */
export function checkinReply(f: CheckinFacts, t: CheckinTaps): CheckinReply {
  const ro = f.lang === 'ro'
  const pPct = f.proteinGoal > 0 ? f.protein / f.proteinGoal : 0
  const kPct = f.kcalGoal > 0 ? f.kcal / f.kcalGoal : 0
  const goal = Math.max(KCAL_FLOOR, f.kcalGoal)
  let good: string
  if (f.training === 'done') good = ro ? `Ai făcut ${f.session ?? 'antrenamentul'} azi, bravo.` : `You did ${f.session ?? 'your workout'} today, nice work.`
  else if (pPct >= 0.9) good = ro ? `Proteinele au ieșit: ${fmt(f.protein)} g.` : `Protein hit: ${fmt(f.protein)} g.`
  else if (kPct >= 0.9) good = ro ? `Ai mâncat ${fmt(f.kcal)} kcal, aproape de ${fmt(goal)}.` : `You ate ${fmt(f.kcal)} kcal, close to your ${fmt(goal)}.`
  else if (f.weighed) good = ro ? 'Te-ai cântărit azi: media săptămânii rămâne corectă.' : 'You weighed in today: the weekly average stays honest.'
  else if (f.training === 'rest' && kPct >= 0.7) good = ro ? 'O zi de pauză adevărată, cu mâncare.' : 'A real rest day with food in.'
  else if (t.sleep != null && t.sleep >= 7.5) good = ro ? `Ai dormit bine: ${hours(t.sleep)} h.` : `Good sleep last night: ${hours(t.sleep)} h.`
  else good = ro ? 'Ai făcut check-in: așa rămâne săptămâna pe drum.' : 'You checked in: that keeps the week on track.'

  let next: string
  const gap = Math.round(goal - f.kcal)
  const adds = addOnsFor(Math.max(gap, f.low ? 300 : 0)).slice(0, 2)
  const addText = adds.map((a) => a.label.replace(/^\+/, '')).join(ro ? ' și ' : ' and ')
  if (f.low && adds.length) next = ro ? `Mâine adaugă ${addText} la mese: puțin câte puțin.` : `Tomorrow, add ${addText} to your meals: a little at a time.`
  else if (kPct < 0.8 && adds.length) next = ro ? `Mâine adaugă ${addText} ca să ajungi la ${fmt(goal)} kcal.` : `Tomorrow, add ${addText} to reach ${fmt(goal)} kcal.`
  else if (pPct < 0.8 && f.proteinGoal > 0) next = ro ? `Mâine pune proteină la fiecare masă: ținta e ${fmt(f.proteinGoal)} g.` : `Tomorrow, put protein in every meal: ${fmt(f.proteinGoal)} g is the aim.`
  else if ((t.sleep != null && t.sleep < 7) || t.energy <= 2) next = ro ? `Diseară stinge lumina la ${f.bed}: somnul face parte din antrenament.` : `Tonight, lights out by ${f.bed}: sleep is part of the training.`
  else if (t.soreness >= 4 && f.tomorrow?.kind === 'session') next = ro ? `Mâine ${f.tomorrow.title}: ritm ușor, oprește fiecare set cu 3 repetări în rezervă.` : `Tomorrow's ${f.tomorrow.title}: easy pace, stop each set 3 reps before failure.`
  else if (f.tomorrow?.kind === 'session') next = ro ? `Mâine ${f.tomorrow.title}: bate data trecută cu o repetare.` : `Tomorrow's ${f.tomorrow.title}: beat last time by one rep.`
  else next = ro ? 'Mâine e zi de pauză: mănâncă toate mesele și plimbă-te 20 min.' : 'Tomorrow is a rest day: eat every meal and walk 20 min.'
  return { good, next, text: `${good} ${next}` }
}

export const CHECKIN_WORDS = 50

/** The short prompt for the AI to phrase the reply (it may not add facts or numbers). */
export function checkinPrompt(r: CheckinReply, lang: CoachLang): string {
  return [
    `You are Ben, a friendly, short fitness coach. Rephrase this check-in reply in ${lang === 'ro' ? 'Romanian' : 'English'}: 2 sentences, at most ${CHECKIN_WORDS} words, warm and plain.`,
    'Keep the same meaning and the same numbers; add no new facts, numbers, foods or advice; nothing about his body or weight.',
    'Answer only JSON: {"reply": "<2 sentences>"}',
    `Reply: ${r.text}`
  ].join('\n')
}

const numsOf = (s: string) => (s.replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(\.\d+)?/g) ?? [])

/** The AI's phrasing, kept only when it is short, safe and uses only the reply's numbers. null: use the rule text. */
export function parseCheckinAi(text: string | null, r: CheckinReply): string | null {
  if (!text) return null
  const m = /\{[\s\S]*\}/.exec(String(text))
  if (!m) return null
  let reply: string
  try {
    reply = String(JSON.parse(m[0])?.reply ?? '')
  } catch {
    return null
  }
  reply = reply.replace(/\s+/g, ' ').trim()
  const safe = safeText(reply)
  if (!safe || safe !== reply) return null
  if (reply.split(/\s+/).length > CHECKIN_WORDS || (reply.match(/[.!?](\s|$)/g)?.length ?? 1) > 2) return null
  const ok = new Set(numsOf(r.text))
  for (const n of numsOf(reply)) if (!ok.has(n)) return null
  return reply
}

// ---------- gentle nudges: one cap for coach and food nudges ----------

export type CoachNudge = 'checkin' | 'protein' | 'morning'
/** At most this many coach + food nudges a day (coach nudges, meal reminders, the evening food push). */
export const NUDGE_CAP = 3
/**
 * Priority when they compete for the last places: the check-in, then protein,
 * then the morning nudge, then the meal reminders and food pushes.
 */
export const RANK: Record<CoachNudge | 'food', number> = { checkin: 0, protein: 1, morning: 2, food: 3 }
export const coachKey = (kind: CoachNudge, day: string) => `coach:${kind}:${day}`
export const COACH_PUSH_PREFIX = 'coach:'
/** Keys that count toward the one daily cap. */
export const countsToCap = (k: string) => k.startsWith('coach:') || k.startsWith('meal:') || k.startsWith('food:')
export const nudgesSent = (log: PushLog) => Object.keys(log.recs).filter(countsToCap).length

export const CHECKIN_FROM = 21 * 60
export const CHECKIN_TO = 23 * 60 + 30
export const PROTEIN_FROM = 14 * 60
export const PROTEIN_TO = 20 * 60
/** Protein counts as behind under this share of the goal. */
export const PROTEIN_BEHIND = 0.4

export interface NudgePrefs {
  morning: boolean
  protein: boolean
  checkin: boolean
}

export interface CapState {
  /** Minutes into the app day. */
  minute: number
  day: string
  prefs: NudgePrefs
  log: PushLog
  checkinDone: boolean
  protein: number
  proteinGoal: number
  bed?: string | null
}

/** The check-in's window: 21:00 (earlier for an early bed, not before 20:00) until 23:30 or 10 min before bed. */
export function checkinWindow(bed: string | null | undefined): [number, number] {
  const b = bedMin(bed)
  return [Math.max(20 * 60, Math.min(CHECKIN_FROM, b - 90)), Math.min(CHECKIN_TO, b - 10)]
}

/** Places kept for higher-priority nudges still to come today. */
export function reservedFor(rank: number, s: CapState): number {
  let r = 0
  if (rank > RANK.checkin && s.prefs.checkin && !s.checkinDone && !s.log.recs[coachKey('checkin', s.day)] && s.minute < checkinWindow(s.bed)[1]) r++
  // Protein keeps its place from 11:00 while it is behind (before that it is unknown).
  if (rank > RANK.protein && s.prefs.protein && !s.log.recs[coachKey('protein', s.day)] && s.minute >= 11 * 60 && s.minute < PROTEIN_TO && s.proteinGoal > 0 && s.protein < s.proteinGoal * PROTEIN_BEHIND) r++
  return r
}

/** True when a nudge of this priority may go now without passing the daily cap. */
export function capAllows(kind: CoachNudge | 'food', s: CapState): boolean {
  return nudgesSent(s.log) + reservedFor(RANK[kind], s) < NUDGE_CAP
}

export interface CoachNudgeIn extends CapState {
  here: boolean
  meeting: boolean
  /** Quiet hours, a paused day, or bed already logged. */
  quiet: boolean
  wake: string | null
  training: { kind: 'session' | 'rest' | 'done'; title: string }
  /** The morning routine's first two steps ("Banana + a glass of milk", "Wait 20–30 min"). */
  snack: string | null
  wait: string | null
  /** Your saved foods richest in protein (names, best first). */
  proteinFoods: string[]
  /** The check-in's auto-filled lines. */
  checkinLines: string[]
  lang: CoachLang
}

const lc = (s: string) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`

/** The coach nudge due now (the check-in, then protein, then the morning one), inside the cap, or null. */
export function decideCoachNudge(i: CoachNudgeIn): PushOut | null {
  if (i.meeting || i.quiet) return null
  const m = i.minute
  const ro = i.lang === 'ro'
  const channel = channelFor(i.here)
  const sent = (k: CoachNudge) => !!i.log.recs[coachKey(k, i.day)]
  const base = { area: 'body' as const, level: 'soft' as const, channel }
  const ok: PushButton = { label: '👍 OK', op: 'ok', primary: true }
  // The evening check-in: 3 taps (Telegram: the taps right there; the island opens Today's card).
  const [cFrom, cTo] = checkinWindow(i.bed)
  if (i.prefs.checkin && !i.checkinDone && !sent('checkin') && m >= cFrom && m < cTo && capAllows('checkin', i)) {
    const ask = ro ? 'Energia azi? (1 slabă … 5 super)' : 'Energy today? (1 low … 5 great)'
    const buttons: PushButton[] = i.here
      ? [{ label: ro ? '✍️ Check-in' : '✍️ Check in', op: 'ok', primary: true, arg: 'open' }, { label: ro ? 'Nu azi' : 'Not tonight', op: 'skip' }]
      : [1, 2, 3, 4, 5].map((n) => ({ label: String(n), op: 'ok' as const, arg: `ck|e|${n}` }))
    return { ...base, key: coachKey('checkin', i.day), type: 'coach', title: ro ? 'Check-in de seară' : 'Evening check-in', text: [...i.checkinLines, i.here ? (ro ? '3 atingeri: energie, febră musculară, somn.' : '3 taps: energy, soreness, sleep.') : ask].join('\n'), face: '📝', buttons }
  }
  // Midday protein: under 40% of the goal from 14:00, with your own foods.
  if (i.prefs.protein && !sent('protein') && m >= PROTEIN_FROM && m < PROTEIN_TO && i.proteinGoal > 0 && i.protein < i.proteinGoal * PROTEIN_BEHIND && capAllows('protein', i)) {
    const foods = i.proteinFoods.slice(0, 2)
    const fix = foods.length ? foods.join(ro ? ' sau ' : ' or ') : ro ? 'ouă sau brânză de vaci' : 'eggs or brânză de vaci'
    const text = ro ? `Proteinele rămân în urmă (${fmt(i.protein)} / ${fmt(i.proteinGoal)} g): ${fix} la masa următoare.` : `Protein's behind (${fmt(i.protein)} / ${fmt(i.proteinGoal)} g): ${fix} with your next meal.`
    return { ...base, key: coachKey('protein', i.day), type: 'coach', title: ro ? 'Proteine' : 'Protein', text, face: '🍗', buttons: [ok] }
  }
  // Morning: today's training and the snack before it, at your wake time.
  const w = Math.max(5 * 60, Math.min(10 * 60 + 30, isHm(i.wake) ? toMin(i.wake.padStart(5, '0')) : 7 * 60))
  if (i.prefs.morning && !sent('morning') && i.training.kind !== 'done' && m >= w && m < w + 120 && capAllows('morning', i)) {
    const snack = i.training.kind === 'session' && i.snack ? (ro ? ` Întâi ${lc(i.snack)}, apoi ${lc(i.wait ?? 'așteaptă 20–30 min')}.` : ` ${i.snack} first, then ${lc(i.wait ?? 'wait 20–30 min')}.`) : ''
    const text = i.training.kind === 'session' ? `${ro ? `Azi: ${i.training.title}` : `${i.training.title} today`} 💪${snack}` : ro ? 'Azi e zi de pauză: mănâncă toate mesele și plimbă-te 20 min.' : 'Rest day today: eat every meal and walk 20 min.'
    return { ...base, key: coachKey('morning', i.day), type: 'coach', title: ro ? 'Dimineața' : 'Good morning', text, face: '💪', buttons: [ok] }
  }
  return null
}

/** Your saved foods richest in protein per portion (at least 10 g), best first. */
export function proteinFoods(saved: FoodSaved, max = 2): string[] {
  return [...saved.foods]
    .filter((f) => f.protein >= 10)
    .sort((a, b) => b.protein - a.protein)
    .slice(0, max)
    .map((f) => f.name)
}

// ---------- Telegram's check-in taps: ck|e|<energy> → ck|s|<e><soreness> → ck|h|<e><s>|<half hours> ----------

export type CkTap = { step: 'e'; energy: number } | { step: 's'; energy: number; soreness: number } | { step: 'h'; energy: number; soreness: number; sleep: number | null }
export function readCkTap(data: string): CkTap | null {
  const m = /^ck\|([esh])\|([1-5])([1-5])?(?:\|(\d{1,2}|x))?$/.exec(String(data ?? ''))
  if (!m) return null
  const e = Number(m[2])
  if (m[1] === 'e') return m[3] || m[4] ? null : { step: 'e', energy: e }
  if (!m[3]) return null
  const s = Number(m[3])
  if (m[1] === 's') return m[4] ? null : { step: 's', energy: e, soreness: s }
  if (!m[4]) return null
  return { step: 'h', energy: e, soreness: s, sleep: m[4] === 'x' ? null : cleanSleep(Number(m[4]) / 2) }
}

/** The next Telegram step's buttons. */
export function ckKeyboard(t: CkTap, pre: number | null, lang: CoachLang): { inline_keyboard: { text: string; callback_data: string }[][] } {
  if (t.step === 'e') return { inline_keyboard: [[1, 2, 3, 4, 5].map((n) => ({ text: String(n), callback_data: `ck|s|${t.energy}${n}` }))] }
  if (t.step === 's') {
    const row = sleepChoices(pre).map((h) => ({ text: `${h === pre ? '✓ ' : ''}${hours(h)} h`, callback_data: `ck|h|${t.energy}${t.soreness}|${Math.round(h * 2)}` }))
    return { inline_keyboard: [row, [{ text: lang === 'ro' ? 'Nu știu' : "Don't know", callback_data: `ck|h|${t.energy}${t.soreness}|x` }]] }
  }
  return { inline_keyboard: [] }
}
export const ckAsk = (t: CkTap, lang: CoachLang) =>
  t.step === 'e' ? (lang === 'ro' ? 'Febră musculară? (1 deloc … 5 foarte)' : 'Soreness? (1 none … 5 very sore)') : t.step === 's' ? (lang === 'ro' ? 'Cât ai dormit azi-noapte?' : 'Sleep last night?') : ''

// ---------- the chat: coach questions ----------

const COACH_ASK = /\b(eat|ate|eating|food|meals?|breakfast|lunch|dinner|snacks?|protein|kcal|calories?|bulk|gain(ing)?|weight|weigh|kg|workouts?|train(ing)?|sessions?|gym|exercises?|push-?ups?|pull-?ups?|squats?|reps?|sets?|muscles?|sore(ness)?|ramp(-?up)?|creatine|shake|supplements?|upper (day|body)|legs? day|rest day|coach|mananc|mancare|masa|mese|proteine|calorii|greutate|antrenament(ul|e)?|sala|exercitii|muschi|febra|ingras|repetari|seturi|suplimente|creatina)\b/
/** A message about food, training or the body: the coach's context and rules go with it. */
export const isCoachAsk = (text: string) => COACH_ASK.test(plain(text))

/** The hard rules, in the prompt (the same rules are checked again in code). */
export const COACH_RULES = [
  'Coach rules (hard, checked in code): reply in the language of his message (English or Romanian); at most 80 words unless he asks for detail; one concrete action.',
  `Never suggest under ${fmt(KCAL_FLOOR)} kcal a day, eating less, a cut or a deficit while his weekly-average weight is not rising. Nothing about how his body looks.`,
  'Supplements: only an optional protein shake or creatine 3–5 g a day; never fat burners or pills. Dizziness, chest pain, fainting, sharp or joint pain, breathing trouble: only "stop training and see a doctor".',
  'Use only numbers from the coach data below or his message.'
].join('\n')

/** The proposal help: what he can be offered (nothing changes until he taps Apply). */
export const PROPOSE_HELP =
  'To PROPOSE a plan change (shown with Apply / Not now; nothing changes until he taps Apply), add one "propose" object: ' +
  '{"kind":"swap","slot":"<standard-day slot>","from":"<food in it>","to":"<saved food>"} · {"kind":"meal","slot":"<slot>","foods":["2 Egg","Rye bread"]} · ' +
  '{"kind":"move","from":"<weekday>","to":"<weekday>"} (moves that training day in his week) · {"kind":"ramp","baseline":<kcal he used to eat>} or {"kind":"ramp","stop":true}. Use only saved foods and slots listed.'

/** The coach part of the prompt: the rules, the compact context and what can be proposed. */
export function coachNote(o: { context: string; saved: FoodSaved | null; rising: boolean }): string {
  const foods = o.saved ? o.saved.foods.slice(0, 20).map((f) => `${f.name} (${f.portionLabel}, ${fmt(f.kcal)} kcal, ${Math.round(f.protein)} g)`).join('; ') : ''
  const slots = o.saved ? o.saved.day.slots.map((s) => `${s.label}: ${s.items.map((x) => itemLabel(foodOf(o.saved!, x.foodId)?.name ?? '?', x.qty)).join(' + ')}`).join('; ') : ''
  return [
    COACH_RULES,
    `Weekly-average weight ${o.rising ? 'is rising' : 'is NOT rising: no cuts'}.`,
    `Coach data:\n${o.context}`,
    foods ? `Saved foods: ${foods}.` : '',
    slots ? `Standard day: ${slots}.` : '',
    PROPOSE_HELP
  ]
    .filter(Boolean)
    .join('\n')
}

const DEFICIT = /\b(deficit|lose weight|losing weight|cut phase|go on a cut|slabes?ti|slabire|deficit caloric)\b/
const PILLS = /\b(pills?|tablets?|pastile)\b/
/**
 * The model's reply, checked: sentences that break a rule go (under the floor,
 * a cut or deficit while the weight isn't rising, body put-downs, fat burners,
 * pills). Empty when nothing safe was left (use the fallback).
 */
export function guardReply(reply: string, o: { rising: boolean }): { text: string; dropped: string[] } {
  const parts = String(reply ?? '').split(/(?<=[.!?])\s+|\n+/)
  const keep: string[] = []
  const dropped: string[] = []
  for (const s of parts) {
    if (!s.trim()) continue
    const t = plain(s)
    const bad = !sentenceOk(s, { cutAllowed: o.rising }) || (!o.rising && DEFICIT.test(t)) || (PILLS.test(t) && !/\bcreatine|creatina\b/.test(t))
    if (bad) dropped.push(s.trim())
    else keep.push(s.trim())
  }
  return { text: keep.join(' ').trim(), dropped }
}

// ---------- fast path: "I missed Tuesday, what now?" ----------

const DAYS_EN = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const DAYS_RO = ['luni', 'marti', 'miercuri', 'joi', 'vineri', 'sambata', 'duminica']
export const WEEKDAYS_RO = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică']

/** "I missed Tuesday", "skipped my workout yesterday", "am ratat antrenamentul de marți": the weekday (0 = Monday) or 'any'. */
export function missedAsk(text: string): number | 'any' | null {
  const t = plain(text)
  const en = /\b(missed|skipped|didn'?t do|did not do|couldn'?t (do|train)|no time for)\b/.test(t) && /\b(workout|training|session|gym|train|upper|legs?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|yesterday)\b/.test(t)
  const ro = /\b(am ratat|am sarit|n-am facut|nu am facut|n-am putut)\b/.test(t) && /\b(antrenament(ul)?|sala|luni|marti|miercuri|joi|vineri|sambata|duminica|ieri)\b/.test(t)
  if (!en && !ro) return null
  for (let k = 0; k < 7; k++) if (new RegExp(`\\b(${DAYS_EN[k]}|${DAYS_RO[k]})\\b`).test(t)) return k
  return 'any'
}

/** The missed-session answer from the week and the log (no model). */
export function missedAnswer(o: { week: TrainWeek; done: DoneSession[]; today: string; day: number | 'any'; lang: CoachLang }): { reply: string; chips: string[] } {
  const ro = o.lang === 'ro'
  const names = ro ? WEEKDAYS_RO : WEEKDAYS
  const p = todayPlan(o.week, o.done, o.today)
  const label = (t: DayType) => (ro ? (t === 'upper' ? 'Partea de sus' : t === 'legs' ? 'Picioare + abdomen' : 'Pauză') : TYPE_NAME[t])
  const said = o.day === 'any' ? null : names[o.day]
  const next = p.next ? `${label(p.next.type)} ${ro ? '' : 'on '}${names[dowOf(p.next.day)]}`.replace(/\s+/g, ' ') : null
  const chips = ro ? ['Ce mănânc acum?'] : ['What should I eat now?']
  if (p.why === 'catch-up') {
    // Name the day only when it is the session that moves (the week may catch up a later one).
    const same = o.day !== 'any' && o.week.days[o.day] === p.type
    return { reply: ro ? `Sesiunea ratată (${label(p.type)}) se poate face azi: mușchii au avut 48 de ore. Fă-o când ești gata.` : `${same ? `${said}'s` : 'The missed'} ${label(p.type)} fits today: those muscles have had 48 hours. Do it when you're ready.`, chips }
  }
  if (p.why === 'done') return { reply: ro ? `Azi e gata deja. ${said ?? 'Ziua ratată'} rămâne sărită${next ? `; următoarea: ${next}` : ''}. O sesiune ratată nu schimbă nimic.` : `Today is done already. ${said ?? 'That day'} is simply skipped${next ? `; next: ${next}` : ''}. One missed session changes nothing.`, chips }
  if (p.type !== 'rest')
    return { reply: ro ? `Nu dubla: fă azi ${label(p.type)} cum e planificat. ${said ?? 'Ziua ratată'} rămâne sărită, săptămâna tot contează.` : `No need to double up: do today's ${label(p.type)} as planned. ${said ?? 'The missed day'} is skipped and the week still counts.`, chips }
  return { reply: ro ? `Azi pauză, apoi mergi mai departe${next ? ` cu ${next}` : ''}. O sesiune ratată nu schimbă nimic: mănâncă toate mesele.` : `Rest today, then carry on${next ? ` with ${next}` : ''}. One missed session changes nothing: eat all your meals.`, chips }
}

// ---------- proposals (Apply / Not now / Undo) ----------

export type Proposal =
  | { kind: 'swap'; slotId: string; fromId: string; toId: string }
  | { kind: 'meal'; slotId: string; items: SavedItem[] }
  | { kind: 'move'; from: number; to: number }
  | { kind: 'ramp'; baseline: number | null; stop?: boolean }

export type PropState = 'open' | 'applied' | 'skipped' | 'undone'
export interface PropRec {
  id: string
  at: number
  p: Proposal
  text: string
  state: PropState
  /** What Apply replaced (for Undo). */
  undo?: unknown
}
export interface CoachProps {
  v: 1
  list: PropRec[]
}
export const COACH_PROPS = 'coach_props'
export const PROPS_KEEP = 12
export const PROPS_DAYS = 7

const STATES: PropState[] = ['open', 'applied', 'skipped', 'undone']
export function cleanProps(raw: unknown, now = Date.now()): CoachProps {
  const o = (raw && typeof raw === 'object' ? raw : {}) as any
  const list = (Array.isArray(o.list) ? o.list : [])
    .filter((r: any) => r && typeof r.id === 'string' && /^[\w-]{1,24}$/.test(r.id) && r.p && typeof r.p.kind === 'string' && Number(r.at) > now - PROPS_DAYS * 86400_000)
    .map((r: any): PropRec => ({ id: r.id, at: Number(r.at), p: r.p, text: String(r.text ?? '').slice(0, 200), state: STATES.includes(r.state) ? r.state : 'open', ...(r.undo !== undefined ? { undo: r.undo } : {}) }))
    .slice(-PROPS_KEEP)
  return { v: 1, list }
}

const norm = (s: string) => plain(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
function findFood(saved: FoodSaved, name: unknown): string | null {
  const n = norm(String(name ?? '')).replace(/^\d+(\.\d+)?\s*(x\s*)?/, '')
  if (!n) return null
  const exact = saved.foods.find((f) => norm(f.name) === n)
  if (exact) return exact.id
  const part = saved.foods.filter((f) => norm(f.name).startsWith(n) || n.startsWith(norm(f.name)) || norm(f.name).split(' ')[0] === n.split(' ')[0])
  return part.length === 1 ? part[0].id : null
}
function findSlot(saved: FoodSaved, name: unknown): string | null {
  const n = norm(String(name ?? ''))
  if (!n) return null
  const alias: Record<string, string[]> = { breakfast: ['morning', 'breakfast', 'dimineata', 'mic dejun'], lunch: ['lunch', 'pranz'], dinner: ['evening', 'dinner', 'cina', 'seara'], snack: ['afternoon', 'snack', 'gustare'] }
  const s = saved.day.slots.find((x) => norm(x.label) === n) ?? saved.day.slots.find((x) => (alias[x.slot] ?? []).includes(n) && (alias[x.slot] ?? []).includes(norm(x.label)))
  return s?.id ?? null
}
const dayIndex = (name: unknown): number | null => {
  const n = norm(String(name ?? ''))
  for (let k = 0; k < 7; k++) if (n === DAYS_EN[k] || n === DAYS_RO[k] || n === DAYS_EN[k].slice(0, 3)) return k
  return null
}

/**
 * The model's "propose" object made concrete and checked against his data:
 * known foods and slots only, a real training day to move, and never a food
 * change that takes the standard day down while the weight isn't rising, or
 * under 2,200 kcal. null: nothing to offer.
 */
export function readProposal(raw: unknown, ctx: { saved: FoodSaved; week: TrainWeek; rising: boolean }): Proposal | null {
  const o = raw as any
  if (!o || typeof o !== 'object') return null
  let p: Proposal | null = null
  if (o.kind === 'swap') {
    const slotId = findSlot(ctx.saved, o.slot)
    const slot = ctx.saved.day.slots.find((s) => s.id === slotId)
    const fromId = slot ? findFood({ ...ctx.saved, foods: ctx.saved.foods.filter((f) => slot.items.some((x) => x.foodId === f.id)) }, o.from) : null
    const toId = findFood(ctx.saved, o.to)
    if (slotId && fromId && toId && fromId !== toId) p = { kind: 'swap', slotId, fromId, toId }
  } else if (o.kind === 'meal') {
    const slotId = findSlot(ctx.saved, o.slot)
    const items: SavedItem[] = []
    for (const f of Array.isArray(o.foods) ? o.foods.slice(0, ITEMS_MAX) : []) {
      const q = /^\s*(\d+(?:\.\d+)?)\s*(?:x|×)?\s+/i.exec(String(f))
      const id = findFood(ctx.saved, String(f))
      if (!id) return null
      items.push({ foodId: id, qty: cleanQty(q ? Number(q[1]) : 1) })
    }
    if (slotId && items.length) p = { kind: 'meal', slotId, items }
  } else if (o.kind === 'move') {
    const from = dayIndex(o.from)
    const to = dayIndex(o.to)
    if (from != null && to != null && from !== to && ctx.week.days[from] !== 'rest') p = { kind: 'move', from, to }
  } else if (o.kind === 'ramp') {
    if (o.stop === true) p = { kind: 'ramp', baseline: null, stop: true }
    else {
      const b = Math.round(Number(o.baseline))
      if (Number.isFinite(b) && b >= 500 && b <= 5000) p = { kind: 'ramp', baseline: Math.round(b / 50) * 50 }
    }
  }
  if (!p) return null
  if (p.kind === 'swap' || p.kind === 'meal') {
    const before = dayTotals(ctx.saved).kcal
    const after = dayTotals(applyFood(ctx.saved, p)).kcal
    if (after < before && (!ctx.rising || after < KCAL_FLOOR)) return null
  }
  return p
}

/** The standard day with a swap or a new meal in one slot. */
export function applyFood(saved: FoodSaved, p: Extract<Proposal, { kind: 'swap' | 'meal' }>): FoodSaved {
  return {
    ...saved,
    day: {
      slots: saved.day.slots.map((s) => {
        if (s.id !== p.slotId) return s
        if (p.kind === 'meal') return { ...s, items: p.items.map((x) => ({ ...x })) }
        return { ...s, items: s.items.map((x) => (x.foodId === p.fromId ? { ...x, foodId: p.toId } : x)) }
      })
    }
  }
}

/** The week with one training day moved (the 48-hour rule fixes any clash). */
export function applyMove(week: TrainWeek, p: Extract<Proposal, { kind: 'move' }>): { days: DayType[]; note: string | null } {
  const days = [...week.days]
  const t = days[p.from]
  days[p.from] = days[p.to]
  days[p.to] = t
  const r = validateWeek(days, p.to)
  return { days: r.days, note: r.message }
}

/** The proposal in one plain line. */
export function proposalText(p: Proposal, saved: FoodSaved | null, lang: CoachLang = 'en'): string {
  const ro = lang === 'ro'
  const food = (id: string) => (saved ? foodOf(saved, id)?.name : null) ?? id
  const slot = (id: string) => saved?.day.slots.find((s) => s.id === id)?.label ?? id
  if (p.kind === 'swap') return ro ? `${slot(p.slotId)}: ${food(p.toId)} în loc de ${food(p.fromId)}` : `${slot(p.slotId)}: ${food(p.toId)} instead of ${food(p.fromId)}`
  if (p.kind === 'meal') return `${slot(p.slotId)}${ro ? ' devine' : ' becomes'}: ${p.items.map((x) => itemLabel(food(x.foodId), x.qty)).join(' + ')}`
  if (p.kind === 'move') return ro ? `Mută antrenamentul de ${WEEKDAYS_RO[p.from]} pe ${WEEKDAYS_RO[p.to]}` : `Move ${WEEKDAYS[p.from]}'s training to ${WEEKDAYS[p.to]}`
  if (p.stop) return ro ? 'Oprește creșterea treptată (ramp-up)' : 'Stop the ramp-up'
  return ro ? `Începe creșterea treptată de 2 săptămâni de la ${fmt(p.baseline ?? 0)} kcal` : `Start the 2-week ramp-up from ${fmt(p.baseline ?? 0)} kcal`
}

/** "✅ Apply" / "Not now" for a proposal (the app's buttons; Telegram: cp|a|<id>, cp|n|<id>). */
export const proposalButtons = (id: string, lang: CoachLang = 'en') => [
  { label: lang === 'ro' ? '✅ Aplică' : '✅ Apply', do: `coach:apply:${id}` },
  { label: lang === 'ro' ? 'Nu acum' : 'Not now', do: `coach:skip:${id}` }
]

/** A new proposal's record (open). */
export function addProposal(props: CoachProps, rec: Omit<PropRec, 'state'>): CoachProps {
  return { v: 1, list: [...props.list.filter((r) => r.id !== rec.id), { ...rec, state: 'open' as const }].slice(-PROPS_KEEP) }
}
