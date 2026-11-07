// LS3: Ben understands messy typing. Pure and tested (benNormalize.test.ts).
//
// Before a message is routed it is read three ways:
// - normalised: lower case, Romanian diacritics or their absence made the same
//   ("curăță" = "curata"), extra spaces and stray punctuation gone;
// - canonical: the command and time words of Romanian, Russian and English
//   slang turned into plain English ("fa-mi ziua" → "plan my day",
//   "завтра спортзал в 18" → "tomorrow gym at 18"), the rest kept as typed, so
//   the existing parsers (moves, renames, the router) can read it;
// - fuzzy: names of tasks, events and commands matched with typos allowed
//   ("labortor" → "Lab: Programming"), with a score, so Ben acts when one name
//   clearly fits and asks only when he is really unsure.
// Nothing here calls a model.

import { editDistance } from './benTalk'

/** Romanian (and other Latin) diacritics off: "curăță" → "curata", "ș"/"ş" → "s". Cyrillic stays. */
export function stripMarks(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/([A-Za-z])[\u0300-\u036f]+/g, '$1')
    .normalize('NFC')
    .replace(/[șş]/g, 's')
    .replace(/[ȘŞ]/g, 'S')
    .replace(/[țţ]/g, 't')
    .replace(/[ȚŢ]/g, 'T')
    .replace(/ё/g, 'е')
    .replace(/Ё/g, 'Е')
}

/** Lower case, no diacritics, quotes and stray symbols gone, spaces squeezed. Keeps ":", "-", "." and "," (times and lists). */
export function normalize(s: string): string {
  return stripMarks(s)
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/[“”«»"]/g, ' ')
    .replace(/[^\p{L}\p{N}\s:'.,;\-+/?!]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// A word edge that works for Cyrillic too (JS \b only knows ASCII letters).
const L = '(?<![\\p{L}\\p{N}])'
const R = '(?![\\p{L}\\p{N}])'
const w = (src: string) => new RegExp(`${L}(?:${src})${R}`, 'giu')

/**
 * Phrase → plain English, applied in order on the normalised text. Only words
 * that steer what Ben does (verbs, days, times, linking words); names and
 * objects stay as typed ("curata camera" stays, it's the task's name).
 */
const PHRASES: [RegExp, string][] = [
  // Plan my day (Romanian, Russian, slang).
  [w("fa-?mi ziua|fa-?mi planul( zilei)?|fa planul( zilei| pe azi)?|planifica-?mi ziua|planul zilei|planul pe azi|organizeaza-?mi ziua"), 'plan my day'],
  [w('спланируй( мой| мне)? день|составь( мне)? план( на (день|сегодня))?|план на (день|сегодня)|распланируй день'), 'plan my day'],
  [w('plan ma day|plan mah day|plan muh day|plan my dya|pln my day|plan teh day'), 'plan my day'],
  // Remind me (to).
  [w("aminteste-?mi( sa)?|adu-?mi aminte( sa)?|aminteste-?ma( sa)?"), 'remind me to'],
  [w('напомни( мне)?( чтобы)?'), 'remind me to'],
  // Verbs.
  [w('adauga|adaug|pune'), 'add'],
  [w('добавь|запиши'), 'add'],
  [w('muta|mut-?o|mut-?l|muta-?l|muta-?o'), 'move'],
  [w('перенеси|передвинь|сдвинь'), 'move'],
  [w('sterge|elimina'), 'delete'],
  [w('удали|убери'), 'delete'],
  [w('imparte|sparge'), 'break down'],
  [w('разбей|раздели'), 'break down'],
  // Days and times of day.
  [w('azi|astazi'), 'today'],
  [w('poimaine'), 'in 2 days'],
  [w('maine'), 'tomorrow'],
  [w('diseara|deseara|in seara asta|la noapte'), 'tonight'],
  [w('сегодня'), 'today'],
  [w('послезавтра'), 'in 2 days'],
  [w('завтра'), 'tomorrow'],
  [w('вечером|сегодня вечером'), 'tonight'],
  [w('tmrw|tmr|tmrrw|tomoz|2moro|2morrow|tomorow|tommorow|tomorroww|tomorro'), 'tomorrow'],
  [w('tonite|2nite|tn'), 'tonight'],
  [w('rn'), 'now'],
  // "la 18" / "в 18" / "к 18" → "at 18".
  [new RegExp(`${L}(?:la|в|во|к|ora|в час)\\s+(\\d{1,2}(?:[:.]\\d{2})?)${R}`, 'giu'), 'at $1'],
  [new RegExp(`${L}на\\s+(\\d{1,2}(?:[:.]\\d{2})?)${R}`, 'giu'), 'to $1'],
  // Linking words: "and", "then".
  [w('si|și|и'), 'and'],
  [w('apoi|dupa aceea|потом|затем'), 'then'],
  // English slang.
  [w('pls|plz|plez'), 'please'],
  [w('gonna'), 'going to'],
  [w('wanna'), 'want to'],
  [w('ur'), 'your'],
  [w('u'), 'you'],
  [w('w/'), 'with'],
  [w('hw'), 'homework']
]

/**
 * Built-in name aliases (a word he types for a thing Ben knows by another
 * name). His own aliases (LS6, "by sala I mean gym") come first.
 */
export const BUILTIN_ALIASES: Record<string, string> = {
  sala: 'gym',
  'sala de forta': 'gym',
  спортзал: 'gym',
  зал: 'gym',
  тренировка: 'workout',
  antrenament: 'workout',
  laborator: 'lab',
  лаба: 'lab',
  лабу: 'lab',
  лабораторная: 'lab',
  examen: 'exam',
  экзамен: 'exam',
  eseu: 'essay',
  эссе: 'essay'
}

export interface Canon {
  /** The message in plain English command words (names kept as typed, no diacritics). */
  text: string
  /** The language of the original (for Ben's short replies). */
  lang: 'en' | 'ro' | 'ru'
  /** True when the canonical text reads differently from the plain lower-cased message. */
  changed: boolean
}

const langOfRaw = (t: string): 'en' | 'ro' | 'ru' => (/[Ѐ-ӿ]/.test(t) ? 'ru' : /[ăâîșşțţ]/i.test(t) || w('fa-?mi|azi|maine|diseara|aminteste|adauga|muta|sterge|curata|vreau|te rog|si|la').test(stripMarks(t).toLowerCase()) ? 'ro' : 'en')

/** Aliases replaced as whole words ("sala" → "gym"), his own first. */
export function applyAliases(text: string, aliases: Record<string, string> = {}): string {
  const all = { ...BUILTIN_ALIASES, ...Object.fromEntries(Object.entries(aliases).map(([k, v]) => [normalize(k), v])) }
  let out = text
  for (const k of Object.keys(all).sort((a, b) => b.length - a.length)) {
    if (!k) continue
    out = out.replace(new RegExp(`${L}${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${R}`, 'giu'), all[k])
  }
  return out
}

/** The message read as plain English commands (see PHRASES). */
export function canon(text: string, aliases: Record<string, string> = {}): Canon {
  const raw = String(text ?? '')
  const base = normalize(raw)
  let t = base
  for (const [re, to] of PHRASES) t = t.replace(re, to)
  t = applyAliases(t, aliases).replace(/\s+/g, ' ').trim()
  return { text: t, lang: langOfRaw(raw), changed: t !== raw.toLowerCase().replace(/\s+/g, ' ').trim() }
}

// ---- Fuzzy names ---------------------------------------------------------------

const words = (s: string) => normalize(s).split(/[^\p{L}\p{N}]+/u).filter((x) => x.length >= 2)
const STOP = new Set(['the', 'my', 'a', 'an', 'to', 'at', 'of', 'for', 'and', 'in', 'on', 'la', 'de', 'cu', 'pe', 'si', 'и', 'в', 'на'])

/** How well one typed word fits one name word (0..1): exact, prefix, or a typo away. */
function wordFit(a: string, b: string): number {
  if (a === b) return 1
  if (a.length >= 3 && b.startsWith(a)) return 0.92
  if (b.length >= 3 && a.startsWith(b)) return 0.85
  const longer = Math.max(a.length, b.length)
  if (longer < 4) return 0
  const d = editDistance(a, b, 3)
  if (d > 3) return 0
  const allow = longer <= 5 ? 1 : longer <= 8 ? 2 : 3
  return d <= allow ? Math.max(0, 0.9 - (d / longer) * 1.2) : 0
}

/**
 * How well a typed name fits a real one, 0..1: every typed word must find a
 * word in the name (typos allowed); extra words in the name cost a little.
 */
export function similarity(query: string, name: string): number {
  const q = words(query).filter((x) => !STOP.has(x))
  const n = words(name).filter((x) => !STOP.has(x))
  if (!q.length || !n.length) return 0
  if (normalize(query) === normalize(name)) return 1
  let sum = 0
  for (const a of q) {
    let best = 0
    for (const b of n) best = Math.max(best, wordFit(a, b))
    if (best === 0) return 0
    sum += best
  }
  const cover = sum / q.length
  const extra = Math.max(0, n.length - q.length)
  return Math.max(0, Math.min(1, cover - extra * 0.04))
}

export interface Hit<T> {
  item: T
  score: number
}

/** The names a typed one can mean, best first (score ≥ `min`). */
export function fuzzyFind<T>(query: string, items: T[], name: (t: T) => string, min = 0.6): Hit<T>[] {
  return items
    .map((item) => ({ item, score: similarity(query, name(item)) }))
    .filter((h) => h.score >= min)
    .sort((a, b) => b.score - a.score)
}

/**
 * Sure, unsure or nothing: one clear best (≥ 0.8 and well ahead of the next)
 * acts; two close ones ask; none goes on (the model reads it).
 */
export function sureOf<T>(hits: Hit<T>[]): { kind: 'one'; hit: Hit<T> } | { kind: 'many'; hits: Hit<T>[] } | { kind: 'none' } {
  if (!hits.length) return { kind: 'none' }
  const [a, b] = hits
  if (a.score >= 0.8 && (!b || a.score - b.score >= 0.12)) return { kind: 'one', hit: a }
  const close = hits.filter((h) => a.score - h.score < 0.12).slice(0, 3)
  if (close.length >= 2) return { kind: 'many', hits: close }
  return a.score >= 0.7 ? { kind: 'one', hit: a } : { kind: 'none' }
}

// ---- Commands typed with typos ------------------------------------------------

const COMMANDS: { cmd: string; say: string[] }[] = [
  { cmd: 'plan my day', say: ['plan my day', 'plan today', 'make my plan', 'plan the day'] },
  { cmd: 'what now', say: ['what now', 'what should i do now', 'what next'] },
  { cmd: 'review yesterday', say: ['review yesterday', 'review my day', 'how did yesterday go'] },
  { cmd: 'show my tasks', say: ['show my tasks', 'my tasks', 'what are my tasks'] },
  { cmd: 'show my day', say: ['show my day', 'my day', 'show my calendar'] },
  { cmd: 'approve', say: ['approve the plan', 'approve', 'approve plan'] }
]

/** A short message that is a command typed badly ("pln my dya" → "plan my day"), else null. */
export function commandOf(text: string): string | null {
  const t = normalize(text).replace(/[?!.]+$/, '')
  if (!t || t.split(' ').length > 5) return null
  let best: { cmd: string; d: number } | null = null
  for (const c of COMMANDS) {
    for (const s of c.say) {
      if (t === s) return c.cmd
      if (Math.abs(t.length - s.length) > 3) continue
      const d = editDistance(t, s, 3)
      const allow = s.length <= 8 ? 1 : s.length <= 14 ? 2 : 3
      if (d <= allow && (!best || d < best.d)) best = { cmd: c.cmd, d }
    }
  }
  return best?.cmd ?? null
}
