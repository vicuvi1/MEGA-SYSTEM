// B17: which Todoist area a task belongs to, learned from earlier picks, so
// the AI is only asked about tasks with words it hasn't seen ("lab report"
// → University after the first time). Pure, tested.

export const AREA_WORDS = 'area_words'
export type AreaWords = Record<string, Record<string, number>>

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'today', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'next', 'week', 'call', 'buy', 'get', 'make', 'do', 'fix', 'check', 'send', 'pay', 'some', 'new'])
/** The words that say something about a task (4+ letters, not dates or filler). */
export function taskWords(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[\p{L}]{4,}/gu) ?? []).filter((w) => !STOP.has(w)).map((w) => w.slice(0, 8)))]
}

/** An area most of the task's known words point to (seen at least twice, nothing against it), else null. */
export function areaFromWords(map: AreaWords, text: string, names: string[]): string | null {
  const score = new Map<string, number>()
  for (const w of taskWords(text)) {
    const votes = map[w]
    if (!votes) continue
    const entries = Object.entries(votes).filter(([a]) => names.includes(a))
    const total = entries.reduce((t, [, n]) => t + n, 0)
    for (const [a, n] of entries) if (n >= 2 && n / total >= 0.8) score.set(a, (score.get(a) ?? 0) + n)
  }
  const best = [...score].sort((a, b) => b[1] - a[1])
  if (!best.length || (best[1] && best[1][1] >= best[0][1] * 0.7)) return null
  return best[0][0]
}

/** Remembers the pick (your own moves count too). At most 400 words kept. */
export function learnAreaWords(map: AreaWords, text: string, area: string): AreaWords {
  const next: AreaWords = { ...map }
  for (const w of taskWords(text)) next[w] = { ...(next[w] ?? {}), [area]: ((next[w] ?? {})[area] ?? 0) + 1 }
  const keys = Object.keys(next)
  if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete next[k]
  return next
}
