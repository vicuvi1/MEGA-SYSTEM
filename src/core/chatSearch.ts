// CH3: search your chats with Ben (pure, tested). Works on any list of
// messages: today the Coach page's chat log; a past-conversation store can
// plug in through `ChatSearchSource` (same hit shape), so the search box
// doesn't care where the messages live.
//
// - Every word must be found (in any order); "quoted words" must be found together.
// - Accents don't matter ("sedinta" finds "ședință"), case doesn't matter.
// - Newer messages first among equally good matches; a whole-word match beats a part.
// - Each hit has a short snippet and the ranges to highlight inside it.

export interface ChatDoc {
  /** Stable id to jump to (the message's `at`, or the store's id). */
  id: string
  at: string
  role: 'me' | 'coach'
  text: string
}

export interface ChatHit {
  id: string
  at: string
  role: 'me' | 'coach'
  snippet: string
  /** [start, end) ranges inside `snippet` to mark. */
  ranges: [number, number][]
  score: number
}

/** Where messages come from: the chat log here, a conversation store later. */
export interface ChatSearchSource {
  name: string
  search(query: string, limit: number): Promise<ChatHit[]>
}

/** Lower case, no accents: one letter for one letter, so offsets stay the same. */
export function fold(s: string): string {
  let out = ''
  for (const ch of String(s ?? '')) {
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
    // ș/ț (comma below) and ş/ţ (cedilla) fold to s/t; keep one char per char.
    out += (base.length === 1 ? base : ch).toLowerCase().slice(0, ch.length) || ch
  }
  return out
}

/** "plan \"deep work\" monday" → ['plan', 'deep work', 'monday']. */
export function queryTerms(q: string): string[] {
  const out: string[] = []
  const re = /"([^"]+)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(String(q ?? '')))) {
    const t = fold((m[1] ?? m[2] ?? '').trim())
    if (t && t.length <= 80) out.push(t)
  }
  return [...new Set(out)].slice(0, 8)
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c)

/** Search a list of messages. Empty or 1-letter queries find nothing. */
export function searchChat(docs: ChatDoc[], query: string, opts: { limit?: number; snippet?: number } = {}): ChatHit[] {
  const terms = queryTerms(query)
  if (!terms.length || terms.join('').length < 2) return []
  const limit = opts.limit ?? 50
  const width = opts.snippet ?? 110
  const hits: ChatHit[] = []
  docs.forEach((d, order) => {
    const text = String(d.text ?? '').replace(/\s+/g, ' ').trim()
    if (!text) return
    const f = fold(text)
    let score = 0
    const found: [number, number][] = []
    for (const t of terms) {
      let i = f.indexOf(t)
      if (i < 0) return
      let whole = false
      const first = i
      while (i >= 0) {
        found.push([i, i + t.length])
        if (!isWordChar(f[i - 1]) && !isWordChar(f[i + t.length])) whole = true
        i = f.indexOf(t, i + t.length)
      }
      score += whole ? 3 : 1
      if (first === 0) score += 0.5
    }
    // Newer first among equals (docs come oldest first): a small bonus by position.
    score += order / Math.max(1, docs.length) / 2
    found.sort((a, b) => a[0] - b[0])
    const at0 = found[0][0]
    const start = Math.max(0, Math.min(at0 - Math.floor(width / 3), text.length - width))
    const end = Math.min(text.length, start + width)
    const pre = start > 0 ? '…' : ''
    const snippet = `${pre}${text.slice(start, end)}${end < text.length ? '…' : ''}`
    const ranges = found.filter(([a, b]) => a >= start && b <= end).map(([a, b]) => [a - start + pre.length, b - start + pre.length] as [number, number])
    hits.push({ id: d.id, at: d.at, role: d.role, snippet, ranges: mergeRanges(ranges), score })
  })
  return hits.sort((a, b) => b.score - a.score || b.at.localeCompare(a.at)).slice(0, limit)
}

function mergeRanges(r: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const x of r) {
    const last = out[out.length - 1]
    if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1])
    else out.push([x[0], x[1]])
  }
  return out
}

/** Splits a snippet into plain and marked parts for drawing. */
export function markParts(snippet: string, ranges: [number, number][]): { t: string; hit: boolean }[] {
  const out: { t: string; hit: boolean }[] = []
  let i = 0
  for (const [a, b] of ranges) {
    if (a > i) out.push({ t: snippet.slice(i, a), hit: false })
    out.push({ t: snippet.slice(a, b), hit: true })
    i = b
  }
  if (i < snippet.length) out.push({ t: snippet.slice(i), hit: false })
  return out.filter((p) => p.t)
}

/** The chat log as a search source (what the page has until a store plugs in). */
export function logSource(read: () => ChatDoc[]): ChatSearchSource {
  return { name: 'chat log', search: async (q, limit) => searchChat(read(), q, { limit }) }
}

/** Several sources as one (a store's older messages plus today's log), no duplicates by id. */
export function joinSources(sources: ChatSearchSource[]): ChatSearchSource {
  return {
    name: sources.map((s) => s.name).join(' + '),
    search: async (q, limit) => {
      const all = (await Promise.all(sources.map((s) => s.search(q, limit).catch(() => [] as ChatHit[])))).flat()
      const seen = new Set<string>()
      return all
        .sort((a, b) => b.score - a.score || b.at.localeCompare(a.at))
        .filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)))
        .slice(0, limit)
    }
  }
}
