// Voice, the text part (pure, tested): what you said made tidy for the
// command parser (number words, fillers, the wake phrase), what Ben wrote made
// speakable (no emoji, links or markup), Ben's streamed reply cut into
// sentences as they arrive (so speaking starts after the first one), and the
// wake phrase spelled in the wake-word model's own pieces.

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
}
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

/**
 * "twenty five" → "25", "a hundred and fifty" → "150", "half an hour" → "30
 * minutes", "an hour and a half" → "90 minutes". Lone "a"/"an" stay words
 * unless a hundred/thousand follows them.
 */
export function wordsToNumbers(text: string): string {
  let t = ` ${text.toLowerCase()} `
  t = t.replace(/\b(?:an|one) hour and a half\b/g, '90 minutes').replace(/\bhalf an hour\b/g, '30 minutes').replace(/\ba quarter of an hour\b/g, '15 minutes')
  t = t.replace(/\b(?:an|one) hour\b/g, '60 minutes').replace(/\btwo hours\b/g, '120 minutes')
  const words = t.trim().split(/\s+/)
  const out: string[] = []
  let i = 0
  while (i < words.length) {
    const w = words[i]
    const isNum = (x: string | undefined) => x != null && (x in UNITS || x in TENS || x === 'hundred' || x === 'thousand')
    // "a"/"an" count only before hundred/thousand ("a hundred ml").
    if ((w === 'a' || w === 'an' || w === 'oh') && !(words[i + 1] === 'hundred' || words[i + 1] === 'thousand')) {
      out.push(w)
      i++
      continue
    }
    if (!isNum(w)) {
      out.push(w)
      i++
      continue
    }
    let total = 0
    let cur = 0
    let used = 0
    while (i < words.length) {
      const x = words[i]
      if (x in TENS) {
        // "two fifty" (ml) is 250.
        if (used && cur > 0 && cur < 10) cur = cur * 100 + TENS[x]
        else cur += TENS[x]
        const nx = words[i + 1]
        if (nx && nx in UNITS && UNITS[nx] > 0 && UNITS[nx] < 10 && nx !== 'a' && nx !== 'an' && nx !== 'oh') {
          cur += UNITS[nx]
          i++
        }
      } else if (x === 'hundred') cur = (cur || 1) * 100
      else if (x === 'thousand') {
        total += (cur || 1) * 1000
        cur = 0
      } else if (x in UNITS && (x !== 'a' && x !== 'an' && x !== 'oh' ? true : words[i + 1] === 'hundred' || words[i + 1] === 'thousand')) cur += UNITS[x]
      else if (x === 'and' && used && isNum(words[i + 1]) && words[i + 1] !== 'a' && words[i + 1] !== 'an') {
        i++
        continue
      } else break
      used++
      i++
    }
    out.push(String(total + cur))
  }
  return out.join(' ')
}

/** Words that carry nothing for a command ("please", "um", "can you"). */
const FILLERS = /\b(?:please|um+|uh+|erm|hmm+|like|just|okay so|so|can you|could you|would you|will you|i want to|i wanna|i'd like to|let's|lets|for me|now|right now)\b/g

/** What you said, made tidy for the command parser: lower case, numbers as digits, no fillers or end marks. */
export function tidySpeech(text: string): string {
  const t = wordsToNumbers(
    text
      .toLowerCase()
      .replace(/[“”"]/g, '')
      .replace(/[’]/g, "'")
      .replace(/[.,!?;:]+(?=\s|$)/g, ' ')
  )
  return t
    .replace(FILLERS, ' ')
    .replace(/(\d+)\s*(?:mins?|minutes?)\b/g, '$1 min')
    .replace(/(\d+)\s*(?:milliliters?|millilitres?|mls?)\b/g, '$1 ml')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The ways speech-to-text writes "Hey Ben" (the model hears names loosely). */
const WAKE = /^(?:(?:hey|hi|hay|hei|a|okay|ok|yo)[\s,]+)?(?:ben|benn|been|ban|bend|bent|ben's|then)\b[\s,.!?]*/i

const COMMANDISH = /^(?:start|stop|end|add|log|what|what's|how|open|show|pause|play|resume|set|remind|tell|when|where|who|is|are|can|could|do|did|give|go|i|i'm|my|plan|focus|water|next|skip|mute|cancel|help)\b/i

/** "Hey Ben, start focus 25" → woke, the rest is "start focus 25". "Hey, been there" is not the wake phrase. */
export function stripWake(text: string): { woke: boolean; rest: string } {
  const t = text.trim().replace(/^[\s,.!?]+/, '')
  const m = WAKE.exec(t)
  // A bare "ben"/"been" at the start needs a greeting in front, or nothing after it.
  if (!m) return { woke: false, rest: t }
  const greeted = /^(?:hey|hi|hay|hei|a|okay|ok|yo)\b/i.test(t)
  const name = /^(?:(?:hey|hi|hay|hei|a|okay|ok|yo)[\s,]+)?(\S+)/i.exec(t)?.[1]?.toLowerCase().replace(/[^a-z']/g, '') ?? ''
  if (!greeted && name !== 'ben' && name !== 'benn') return { woke: false, rest: t }
  if (greeted && !/^(?:ben|benn|been|ban|bend|bent|ben's)$/.test(name)) return { woke: false, rest: t }
  const rest = t.slice(m[0].length).trim()
  // A misheard name ("hey been…") counts only before a command, a question or nothing.
  if (name !== 'ben' && name !== 'benn' && rest && !/[,.!?]\s*$/.test(m[0]) && !COMMANDISH.test(rest)) return { woke: false, rest: t }
  return { woke: true, rest }
}

/** Ben's words, made speakable: no emoji, links, markup, tags or code; arrows and symbols as words. */
export function speakable(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'the link')
    .replace(/[*_~#>|]+/g, ' ')
    .replace(/→|->/g, ' to ')
    .replace(/·|•/g, ', ')
    .replace(/&/g, ' and ')
    .replace(/(\d)\s*%/g, '$1 percent')
    .replace(/\bmin\b/g, 'minutes')
    .replace(/\bml\b/g, 'millilitres')
    .replace(/\bMDL\b/g, 'lei')
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️/gu, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/([,.!?]){2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Cuts Ben's reply into sentences while it streams: give it the reply so far
 * (it only grows), get the sentences that are now complete. `end()` gives the
 * rest. Very long sentences are cut at a comma so speaking still starts fast.
 */
export class SentenceStream {
  private taken = 0
  private last = ''
  constructor(private maxLen = 220) {}
  /** The reply so far; returns the new whole sentences in it. */
  push(soFar: string): string[] {
    // The stream restarted (a retry): start over.
    if (!soFar.startsWith(this.last.slice(0, this.taken))) this.taken = 0
    this.last = soFar
    const out: string[] = []
    for (;;) {
      const rest = soFar.slice(this.taken)
      const cut = sentenceEnd(rest, this.maxLen)
      if (cut < 0) break
      const s = rest.slice(0, cut).trim()
      this.taken += cut
      if (hasWords(s)) out.push(s)
    }
    return out
  }
  /** The whole reply arrived: whatever is left. */
  end(full?: string): string[] {
    const text = full ?? this.last
    const out = full != null ? this.push(full) : []
    const rest = text.slice(this.taken).trim()
    this.taken = text.length
    if (hasWords(rest)) out.push(rest)
    return out
  }
}

const hasWords = (s: string) => /[\p{L}\p{N}]/u.test(speakable(s))

/** Where the first sentence in `t` ends (the index after it), or -1 when it isn't finished yet. */
function sentenceEnd(t: string, maxLen: number): number {
  const re = /[.!?…]+["')\]]*(?=\s)|\n+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const end = m.index + m[0].length
    const before = t.slice(0, m.index)
    // "e.g." / "Dr." / "3.5": not the end.
    if (m[0] === '.' && /(?:\b[A-Za-z]|\bDr|\bMr|\bMrs|\bMs|\bvs|\betc|\d)$/.test(before) && !/\n/.test(m[0])) continue
    if (before.trim().length < 2) continue
    return end
  }
  if (t.length > maxLen) {
    const c = t.lastIndexOf(', ', maxLen)
    if (c > 40) return c + 1
    const sp = t.lastIndexOf(' ', maxLen)
    if (sp > 40) return sp
  }
  return -1
}

/**
 * The wake phrase in the wake-word model's own pieces (its tokens.txt), the
 * fewest pieces that spell it: "HEY BEN" → "▁HE Y ▁BEN". Null when a word
 * can't be spelled with these pieces.
 */
export function spellWithPieces(phrase: string, pieces: Set<string>): string[] | null {
  const words = phrase.toUpperCase().replace(/[^A-Z' ]/g, ' ').split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (const w of words) {
    const s = `▁${w}`
    // Fewest pieces: best[i] = the shortest spelling of s[0..i).
    const best: (string[] | null)[] = Array(s.length + 1).fill(null)
    best[0] = []
    for (let i = 0; i < s.length; i++) {
      const b = best[i]
      if (!b) continue
      for (let j = s.length; j > i; j--) {
        const p = s.slice(i, j)
        if (!pieces.has(p)) continue
        if (!best[j] || best[j]!.length > b.length + 1) best[j] = [...b, p]
      }
    }
    if (!best[s.length]) return null
    out.push(...best[s.length]!)
  }
  return out.length ? out : null
}

/** The pieces in a tokens.txt ("▁HE 23" per line). */
export function readPieces(tokensTxt: string): Set<string> {
  const set = new Set<string>()
  for (const line of tokensTxt.split(/\r?\n/)) {
    const p = line.trim().split(/\s+/)[0]
    if (p) set.add(p)
  }
  return set
}

/**
 * The keywords file for the wake-word model: each phrase spelled in pieces,
 * with its boost and threshold ("▁HE Y ▁BEN :1.5 #0.25 @HEY_BEN"). Phrases
 * that can't be spelled are left out.
 */
export function keywordsFile(phrases: string[], pieces: Set<string>, o: { boost?: number; threshold?: number } = {}): string {
  const lines: string[] = []
  for (const ph of phrases) {
    const sp = spellWithPieces(ph, pieces)
    if (!sp) continue
    const tag = ph.toUpperCase().replace(/[^A-Z]+/g, '_')
    lines.push(`${sp.join(' ')}${o.boost ? ` :${o.boost}` : ''}${o.threshold ? ` #${o.threshold}` : ''} @${tag}`)
  }
  return [...new Set(lines)].join('\n')
}
