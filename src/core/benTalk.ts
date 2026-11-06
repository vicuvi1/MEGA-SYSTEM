// How Ben talks and understands (BQ: "Ben quality"). Pure helpers, no DOM:
// - the clock in words, so after midnight 07:00 is "this morning", not "tomorrow";
// - what he already said in his last replies, so he doesn't repeat himself;
// - a light tidy of his reply (no "Look, Victor," openers, at most one emoji);
// - typo-tolerant reading of fast, messy messages (en / ro / ru);
// - what the person wants to SEE (plan, day, tasks), so the reply shows a card;
// - block edits ("change the deep block to app dev"): one target → act, several → chips.
import { DAY_START_HOUR } from './defaults'
import { calendarDay } from './dates'

/** A regex with Unicode word edges: \\b only knows ASCII, so "arată" or "второй" would never match. */
const uw = (src: string, flags = '') => new RegExp(src.replace(/\\b/g, '(?:(?<![\\p{L}\\p{N}])(?=[\\p{L}\\p{N}])|(?<=[\\p{L}\\p{N}])(?![\\p{L}\\p{N}]))'), `${flags}u`)

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => calendarDay(d)
const hmOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const label = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')

// ---- Time --------------------------------------------------------------------

export interface TimeFrame {
  clock: string
  /** The app day (turns at 04:00). */
  appDay: string
  /** The calendar date (turns at midnight). */
  calDay: string
  /** 00:00–03:59: the app day is still yesterday's date. */
  afterMidnight: boolean
  /** The lines for Ben's prompt. */
  text: string
}

/** The clock and the words for "today", "tonight", "this morning", "tomorrow" right now. */
export function timeFrame(now = new Date(), startHour = DAY_START_HOUR): TimeFrame {
  const h = now.getHours()
  const afterMidnight = h < startHour
  const calDay = ymd(now)
  const app = new Date(now.getTime() - startHour * 3600_000)
  const appDay = ymd(app)
  const nextCal = new Date(now)
  nextCal.setDate(nextCal.getDate() + 1)
  const lines = [`== The time (read this before you say "today", "tonight" or "tomorrow") ==`, `Clock: ${hmOf(now)}, ${label(now)}. App day: ${label(app)} (the app's day turns at ${pad(startHour)}:00).`]
  if (afterMidnight) {
    const seven = new Date(now)
    seven.setHours(7, 0, 0, 0)
    lines.push(
      `It is AFTER MIDNIGHT. He has not slept yet: for him it is still the night of ${label(app)}.`,
      `- "tonight" = right now, until he sleeps.`,
      `- "this morning" / "in the morning" = ${label(now)} from ${pad(startHour)}:00 on, only a few hours away. Times like 07:00 are TODAY's calendar date (${label(now)}), so say it as "this morning" with how far it is (07:00 is ${whenWords(seven, now, startHour)}), never "tomorrow morning".`,
      `- "today" in the app (points, habits, focus) still means ${label(app)} until ${pad(startHour)}:00. If he says "tomorrow" he usually means after he sleeps (${label(now)}); ask with chips only if it really matters.`
    )
  } else if (h >= 18) {
    lines.push(`- "tonight" = this evening (${label(now)}). "tomorrow morning" = ${label(nextCal)}.`)
  } else if (h < 12) {
    lines.push(`- "this morning" = now (${label(now)}). "tonight" = this evening. "tomorrow" = ${label(nextCal)}.`)
  } else {
    lines.push(`- "this afternoon" = now. "tonight" = this evening (${label(now)}). "tomorrow" = ${label(nextCal)}.`)
  }
  lines.push('When you name a time, add how far it is ("in 40 min", "in 6 h, this morning").')
  return { clock: hmOf(now), appDay, calDay, afterMidnight, text: lines.join('\n') }
}

/** "in 40 min" / "in 6 h 29 min, this morning" / "tomorrow at 09:00" / "an hour ago". */
export function whenWords(at: Date | string, now = new Date(), startHour = DAY_START_HOUR): string {
  const t = typeof at === 'string' ? new Date(at) : at
  const diff = Math.round((t.getTime() - now.getTime()) / 60000)
  const span = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`)
  if (diff < 0) return diff > -60 ? `${-diff} min ago` : `${span(-diff)} ago`
  const sameCal = ymd(t) === ymd(now)
  const th = t.getHours()
  const nowAfterMidnight = now.getHours() < startHour
  let part = ''
  if (sameCal) part = th < 12 ? (nowAfterMidnight || now.getHours() < 12 ? 'this morning' : 'today') : th < 18 ? 'this afternoon' : 'tonight'
  else {
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    part = ymd(t) === ymd(tomorrow) ? (th < 4 ? 'tonight, after midnight' : `tomorrow ${th < 12 ? 'morning' : th < 18 ? 'afternoon' : 'evening'}`) : label(t)
  }
  if (diff === 0) return 'now'
  return diff < 120 && sameCal ? `in ${span(diff)}` : `in ${span(diff)}, ${part}`
}

// ---- Repetition ----------------------------------------------------------------

const THEMES: [string, RegExp][] = [
  ['sleep', /\b(sleep|slept|sleeping|bed ?time|go to bed|hours? of sleep|tired|rest(ed)?|nap|somn|dormi|сон|спать|выспа)/i],
  ['money', /\b(money|spend|spent|budget|lei|save|saving|bani|деньг)/i],
  ['focus and study', /\b(focus|study|studying|deep work|exam|homework|lab|învăț|учеб)/i],
  ['training', /\b(gym|workout|training|train|pushups?|run|sport|muscle)/i],
  ['phone and scrolling', /\b(phone|scroll|tiktok|youtube|instagram|reels|screen time)/i],
  ['discipline', /\b(discipline|clean streak|urge|relapse|oath)/i],
  ['water', /\b(water|hydrat|apă|вод)/i],
  ['the company / big goals', /\b(company|startup|business|empire|build (a|your) (company|business)|million)/i],
  ['promises', /\b(promise|you said you would|kept|broke)/i]
]

const EMOJI = /\p{Extended_Pictographic}/gu

export interface AlreadySaid {
  themes: { theme: string; times: number }[]
  openers: string[]
  emoji: string[]
}

/** What Ben's last replies (newest last) keep coming back to, minus what the new message brings up itself. */
export function alreadySaid(coachTexts: string[], message = '', last = 6): AlreadySaid {
  const recent = coachTexts.slice(-last).map((t) => t.split(' | ')[0])
  const counts = new Map<string, number>()
  for (const t of recent) for (const [name, re] of THEMES) if (re.test(t)) counts.set(name, (counts.get(name) ?? 0) + 1)
  const asked = new Set(THEMES.filter(([, re]) => re.test(message)).map(([n]) => n))
  const themes = [...counts.entries()].filter(([n]) => !asked.has(n)).map(([theme, times]) => ({ theme, times })).sort((a, b) => b.times - a.times)
  const openers = [...new Set(recent.map((t) => t.replace(EMOJI, '').trim().split(/\s+/).slice(0, 2).join(' ').replace(/[,.!?…]+$/, '')).filter((o) => o.length > 1))]
  const emoji = [...new Set(recent.flatMap((t) => t.match(EMOJI) ?? []))]
  return { themes, openers, emoji }
}

/** The "already said" block for the prompt (empty when there is nothing to warn about). */
export function alreadySaidText(a: AlreadySaid): string {
  const out: string[] = []
  if (a.themes.length) out.push(`- Points you already made: ${a.themes.map((t) => `${t.theme}${t.times > 1 ? ` (${t.times}×)` : ''}`).join(', ')}. Do NOT bring these up again unless he does. Answer what he asked.`)
  if (a.openers.length) out.push(`- How your last replies started: ${a.openers.slice(-6).map((o) => `"${o}"`).join(', ')}. Start differently.`)
  if (a.emoji.length) out.push(`- Emoji you used lately: ${a.emoji.slice(-6).join(' ')}. Use none of them this time (zero emoji is fine).`)
  return out.length ? `== Already said (your last replies) ==\n${out.join('\n')}` : ''
}

/** A short "no" / "not now" / "stop": Ben accepts it and stops pushing. */
export function saidNo(message: string): boolean {
  const t = message.trim().toLowerCase().replace(/[.!…]+$/, '')
  return t.length <= 40 && /^(no+|nope|nah|not now|not today|later|stop|leave it|drop it|i don'?t want( to)?|no thanks|nu|nu acum|lasă|lasa|нет|не сейчас|не хочу|отстань|хватит)( thanks| man| bro| ben)?[\s,!.]*$/u.test(t)
}

/**
 * The reply, tidied in code (the model sometimes ignores the rules):
 * no "Look, Victor," / "Listen bro," opener, at most one emoji, and none when
 * the last two replies already had one (emoji only sometimes).
 */
export function tidyReply(reply: string, prevCoachTexts: string[] = [], name = ''): string {
  let r = String(reply ?? '').trim()
  if (!r) return r
  const who = name ? `(?:${name.replace(/[^\p{L}]/gu, '')}|bro|man|dude|mate)` : '(?:bro|man|dude|mate|\\p{Lu}\\p{L}+)'
  const opener = new RegExp(`^(\\p{Extended_Pictographic}\\s*)?(look|listen|ok(?:ay)?(?: so)?|alright|so|bro)\\s*,?\\s+${who}\\s*[,.!:—-]+\\s*`, 'iu')
  const m = opener.exec(r)
  if (m) {
    const rest = r.slice(m[0].length)
    r = `${m[1] ?? ''}${rest.charAt(0).toUpperCase()}${rest.slice(1)}`
  }
  const recentHad = prevCoachTexts.slice(-2).filter((t) => /\p{Extended_Pictographic}/u.test(t.split(' | ')[0])).length
  let allowed = recentHad >= 2 ? 0 : 1
  r = r.replace(/\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu, (e) => (allowed-- > 0 ? e : ''))
  return r.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.!?])/g, '$1').trim()
}

// ---- Messy input -----------------------------------------------------------------

/** Words people type in commands to Ben; typos of these are fixed before the parsers run. */
const DICT = [
  'change', 'rename', 'move', 'approve', 'plan', 'show', 'delete', 'remove', 'block', 'blocks', 'deep', 'developing', 'development', 'develop',
  'tomorrow', 'today', 'tonight', 'morning', 'evening', 'afternoon', 'schedule', 'calendar', 'task', 'tasks', 'focus', 'remind', 'reminder',
  'finished', 'cancel', 'start', 'please', 'first', 'second', 'third', 'swap', 'replace', 'edit', 'update', 'workout', 'water', 'done',
  'study', 'studying', 'project', 'minutes', 'hours', 'push', 'later', 'earlier', 'session', 'meeting', 'what', 'where', 'again'
]
/** Real words that look like typos of the ones above: never "fixed". */
const KEEP = new Set(['black', 'clock', 'flock', 'block', 'blank', 'bloc', 'chance', 'charge', 'changed', 'changes', 'more', 'mode', 'love', 'live', 'shot', 'shop', 'slow', 'snow', 'shown', 'star', 'state', 'stay', 'store', 'story', 'start', 'smart', 'today', 'toady', 'what', 'when', 'that', 'than', 'then', 'plain', 'plant', 'planet', 'plans', 'play', 'place', 'plate', 'please', 'pleased', 'focused', 'remain', 'rename', 'reader', 'second', 'secondly', 'deep', 'deer', 'deeply', 'done', 'dome', 'gone', 'none', 'tone', 'move', 'mover', 'moved', 'moves', 'cancer', 'meting', 'swamp', 'swap', 'water', 'waiter', 'later', 'latter', 'eater', 'task', 'mask', 'tusk', 'tasks', 'edit', 'exit', 'sedan', 'session', 'where', 'there', 'here', 'were', 'again', 'agian', 'push', 'posh', 'bush', 'rush', 'study', 'sturdy', 'show', 'stow', 'flow', 'fast', 'first'])

/** Damerau-Levenshtein (optimal string alignment) distance, capped. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

const sameLetters = (a: string, b: string) => a.length === b.length && [...a].sort().join('') === [...b].sort().join('')

/** One word fixed when it is clearly a typo of a command word ("chagne" → "change"), else as it was. */
export function fixWord(w: string): string {
  const low = w.toLowerCase()
  if (low.length < 4 || !/^[a-z]+$/.test(low) || KEEP.has(low) || DICT.includes(low)) return w
  let best: string | null = null
  let bestD = 9
  for (const word of DICT) {
    if (word[0] !== low[0]) continue
    const allow = word.length <= 4 ? 1 : word.length <= 6 ? 1 : 2
    const dist = editDistance(low, word, 3)
    if (dist > allow) continue
    // Short words: only swapped letters ("paln" → "plan"), never another real word ("play").
    if (word.length <= 4 && !sameLetters(low, word)) continue
    if (dist < bestD) {
      best = word
      bestD = dist
    }
  }
  if (!best) return w
  return w[0] === w[0].toUpperCase() ? best[0].toUpperCase() + best.slice(1) : best
}

/** The whole message with typos of command words fixed ("aporve the paln" → "approve the plan"). */
export function fixTypos(text: string): string {
  return String(text ?? '').replace(/[A-Za-z]+/g, (w) => fixWord(w))
}

// ---- What he wants to see ---------------------------------------------------------

export type SeeCard = 'plan' | 'day' | 'tasks'

/** "how can I approve the plan if I don't see it" → the plan card. */
export function wantsToSee(text: string): SeeCard[] {
  const t = fixTypos(text).toLowerCase()
  const out: SeeCard[] = []
  const look = uw("\\b(show|see|view|look|display|where'?s|where is|what'?s|what is|what does|send|give me|let me see|approve|check|arată|arata|vezi|văd|покажи|посмотреть|вижу|где)\\b")
  if (uw('\\b(plan|planul|plan-ul|план|плана)\\b').test(t) && (look.test(t) || /\bplan\s*\?/.test(t))) out.push('plan')
  if (uw('\\b(my day|the day|today|schedule|calendar|agenda|ziua|programul|день|расписание)\\b').test(t) && look.test(t) && !out.includes('plan')) out.push('day')
  if (uw('\\b(tasks?|to-?dos?|todoist|sarcini|sarcinile|задачи)\\b').test(t) && uw("\\b(show|see|list|view|what are|what'?s left|what is left|which|arată|arata|покажи|какие)\\b").test(t)) out.push('tasks')
  return out.slice(0, 2)
}

// ---- Block edits -------------------------------------------------------------------

export interface BlockEdit {
  verb: 'rename' | 'move'
  /** The words naming the block ("deep", "gym", ""). */
  target: string
  /** 0-based pick from "first/second/1/2" in the request, when given. */
  nth?: number
  /** New title (rename) or "HH:MM" (move). */
  value: string
}

const ORD: [RegExp, number][] = [
  [uw('\\b(first|1st|one|primul|prima|первый|первую|первое)\\b'), 0],
  [uw('\\b(second|2nd|two|al doilea|a doua|второй|вторую|второе)\\b'), 1],
  [uw('\\b(third|3rd|three|al treilea|a treia|третий|третью)\\b'), 2],
  [uw('\\b(last|ultimul|ultima|последний|последнюю)\\b'), -1]
]

const timeOf = (s: string): string | null => {
  const m = /^(?:at\s+|la\s+|в\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i.exec(s.trim())
  if (!m) return null
  let h = Number(m[1])
  if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12
  if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0
  const mi = Number(m[2] ?? 0)
  return h < 24 && mi < 60 ? `${pad(h)}:${pad(mi)}` : null
}

const BLOCK = '(?:block|blocks|blocul|blocului|блок|блока)'

/**
 * "please change the deep block to developing my app" → rename "deep" → "Developing my app".
 * "move the first deep block to 11" → move. Only when a block is named (never "change my bedtime").
 */
export function readBlockEdit(text: string): BlockEdit | null {
  const t = fixTypos(text).trim().replace(/[.!?]+$/, '').replace(/\s+/g, ' ')
  const verbs = '(?:please\\s+|pls\\s+|can you\\s+|could you\\s+)?(change|rename|swap|switch|make|turn|replace|set|move|push|shift|put|schimbă|schimba|redenumește|redenumeste|mută|muta|поменяй|переименуй|измени|замени|перенеси|сделай)'
  const prep = '(?:to|into|for|with|in|în|на|в|la)'
  // "change the deep block (2) to X" and "schimbă blocul gym în X" / "переименуй блок gym в X".
  const named = new RegExp(`^${verbs}\\s+(?:the\\s+|my\\s+|that\\s+|this\\s+)?(.{0,40}?)\\s*${BLOCK}\\s*(\\d)?\\s+${prep}\\s+(.{1,60})$`, 'iu').exec(t)
  const after = named ? null : new RegExp(`^${verbs}\\s+(?:the\\s+|my\\s+)?${BLOCK}\\s+(.{1,40}?)\\s*(\\d)?\\s+${prep}\\s+(.{1,60})$`, 'iu').exec(t)
  const m = named ?? after
  if (!m) return null
  const verbWord = m[1].toLowerCase()
  let target = m[2].trim().toLowerCase()
  const num = m[3] ? Number(m[3]) - 1 : undefined
  const raw = m[4].trim().replace(/^(?:be\s+|be about\s+|about\s+)/i, '')
  let nth = num
  for (const [r, n] of ORD) {
    if (r.test(target)) {
      nth = n
      target = target.replace(r, '').trim()
    }
  }
  target = target.replace(/\b(the|my|a|an|blocul|focus)\b/g, '').replace(/\s+/g, ' ').trim()
  const when = timeOf(raw)
  const moving = /^(move|push|shift|put|mută|muta|перенеси)$/.test(verbWord)
  if (when && (moving || /^(at|la|в)\s/i.test(raw) || /^\d{1,2}([:.]\d{2})?$/.test(raw))) return { verb: 'move', target, ...(nth != null ? { nth } : {}), value: when }
  if (moving) return null
  const title = raw.replace(/\s+(please|pls|thanks|thank you|haha|lol)$/i, '').trim()
  if (!title) return null
  // "to 2 hours", "to tomorrow", "to later": a length or a day, not a new name (the model handles those).
  if (/^\d+\s*(h|hrs?|hours?|min|mins|minutes?|m)\b/i.test(title) || uw('\\b(tomorrow|today|tonight|later|earlier|longer|shorter|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|mâine|maine|azi|завтра|сегодня|позже)\\b', 'i').test(title)) return null
  return { verb: 'rename', target, ...(nth != null ? { nth } : {}), value: title.charAt(0).toUpperCase() + title.slice(1) }
}

export interface BlockOption {
  /** "E3" (calendar) or "B1" (a plan block waiting for approval). */
  ref: string
  title: string
  /** "HH:MM". */
  start: string
  end: string
}

/** The blocks a request can mean: title words match (prefix), upcoming first, by time. */
export function matchBlocks(edit: Pick<BlockEdit, 'target' | 'nth'>, blocks: BlockOption[]): BlockOption[] {
  const words = edit.target.split(/\s+/).filter((w) => w.length >= 3).map((w) => w.slice(0, 4))
  const hits = blocks
    .filter((b) => {
      const title = b.title.toLowerCase()
      return words.every((w) => title.split(/[^\p{L}\p{N}]+/u).some((x) => x.startsWith(w)))
    })
    .sort((a, b) => a.start.localeCompare(b.start))
  if (edit.nth == null) return hits
  const pick = edit.nth < 0 ? hits[hits.length - 1] : hits[edit.nth]
  return pick ? [pick] : hits
}

/** The chip for one option: "Deep block 1 · 07:00". */
export const optionLabel = (o: Pick<BlockOption, 'title' | 'start'>) => `${o.title.slice(0, 28)} · ${o.start}`

/** Which of the offered chips his answer picks ("first one", "2", "the 14:00 one", the chip itself); null when unclear. */
export function pickChoice(text: string, labels: string[]): number | null {
  const t = fixTypos(text).trim().toLowerCase().replace(/[.!?]+$/, '')
  if (!t || t.length > 60) return null
  const exact = labels.findIndex((l) => l.toLowerCase() === t)
  if (exact >= 0) return exact
  const time = /\b(\d{1,2})[:.](\d{2})\b/.exec(t) ?? /\b(?:at|la|в)\s+(\d{1,2})\b/.exec(t)
  if (time) {
    const hm = `${pad(Number(time[1]))}:${time[2] ?? '00'}`
    const k = labels.findIndex((l) => l.endsWith(hm))
    if (k >= 0) return k
  }
  for (const [r, n] of ORD) if (r.test(t)) return n < 0 ? labels.length - 1 : n < labels.length ? n : null
  const num = /^(?:#|nr\.?\s*|number\s+)?(\d)$/.exec(t)
  if (num) {
    const n = Number(num[1]) - 1
    return n >= 0 && n < labels.length ? n : null
  }
  // A word only one label has ("the lab one").
  const words = t.split(/\s+/).filter((w) => w.length >= 3 && !/^(the|one|block|that|this)$/.test(w))
  const only = labels.map((l, i) => (words.some((w) => l.toLowerCase().includes(w)) ? i : -1)).filter((i) => i >= 0)
  return only.length === 1 ? only[0] : null
}

/** The language a short message is in, for Ben's own one-liners: Cyrillic → ru, Romanian letters or words → ro. */
export function langOf(text: string): 'en' | 'ro' | 'ru' {
  const t = String(text ?? '')
  if (/[\u0400-\u04FF]/.test(t)) return 'ru'
  if (/[ăâîșşțţ]/i.test(t) || uw('\\b(schimba|muta|blocul|planul|azi|maine|vreau|te rog|primul|prima|doilea|doua|treilea|ultimul|cat|gata|nu)\\b', 'i').test(t)) return 'ro'
  return 'en'
}

/** Ben's own short lines (after a local edit) in his language. */
export function shortLine(kind: 'done' | 'failed' | 'which', lang: 'en' | 'ro' | 'ru', n = 2, what = ''): string {
  const L = {
    en: { done: 'Done.', failed: `That didn't work: ${what}.`, which: `${n} blocks fit. Which one${what ? ` ${what}` : ''}?` },
    ro: { done: 'Gata.', failed: `N-a mers: ${what}.`, which: `Se potrivesc ${n} blocuri. Care?` },
    ru: { done: 'Готово.', failed: `Не получилось: ${what}.`, which: `Подходят ${n} блока. Какой?` }
  }
  return L[lang][kind]
}

/** "I'll swap it", "renamed it", "done, moved": a reply that says something changed. */
export function claimsDone(reply: string): boolean {
  return /\b(i('ll| will|'ve| have)? ?(just )?(swap(ped)?|chang(e|ed)|renam(e|ed)|mov(e|ed)|book(ed)?|add(ed)?|delet(e|ed)|updat(e|ed)|replac(e|ed))\b|\b(renamed|swapped|moved|changed|updated|replaced) (it|that|the|your|deep)\b|\bdone[,.!]? (it'?s|i)\b)/i.test(String(reply ?? ''))
}

interface PlanLike {
  day: string
  briefing?: { status: 'proposed' | 'approved'; plan: { blocks: { title: string; start: string; minutes: number }[] } } & Record<string, any>
}

/** BQ3: one block of today's waiting plan gets a new title or start; the old one comes back for Undo. */
export function editPlanBlock<T extends PlanLike>(st: T, index: number, patch: { title?: string; start?: string }): { state: T | null; old: { title: string; start: string; minutes: number } | null; error?: string } {
  const b = st.briefing
  if (!b) return { state: null, old: null, error: 'There is no plan for today yet' }
  if (b.status !== 'proposed') return { state: null, old: null, error: 'The plan is already approved: its blocks are in your calendar now' }
  const old = b.plan.blocks[index]
  if (!old) return { state: null, old: null, error: 'That plan block is gone' }
  if (patch.start && !/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.start)) return { state: null, old: null, error: `${patch.start} isn't a time` }
  const blocks = b.plan.blocks.map((x, i) => (i === index ? { ...x, ...(patch.title ? { title: patch.title.slice(0, 80) } : {}), ...(patch.start ? { start: patch.start } : {}) } : x))
  if (patch.start) blocks.sort((x, y) => x.start.localeCompare(y.start))
  return { state: { ...st, briefing: { ...b, plan: { ...b.plan, blocks } } }, old: { ...old } }
}

/** A plain question with 2–3 chips when Ben isn't sure what a message meant. */
export function unsureChips(text: string): string[] {
  const t = fixTypos(text).toLowerCase()
  const out: string[] = []
  if (/\bplan\b/.test(t)) out.push('Show the plan')
  if (/\b(block|calendar|schedule)\b/.test(t)) out.push('Show my day')
  if (/\b(tasks?|todo)\b/.test(t)) out.push('Show my tasks')
  return out.slice(0, 3)
}
