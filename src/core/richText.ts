// Ben's replies with a little markdown: **bold**, *italic* / _italic_,
// `code`, bullet lists ("- ", "• ", "* ") and numbered lists ("1. ").
// Pure: the chat turns these blocks into elements. Anything it doesn't know
// stays plain text, and a lone * or _ is never eaten.

export type Inline = { k: 'text' | 'b' | 'i' | 'code'; s: string }
export type RichBlock = { k: 'p'; lines: Inline[][] } | { k: 'ul' | 'ol'; items: Inline[][]; start?: number }

const INLINE = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+?`|(?<![\w*])\*(?![\s*])[^*\n]+?(?<!\s)\*(?![\w*])|(?<![\w_])_(?![\s_])[^_\n]+?(?<!\s)_(?![\w_]))/g

/** One line's emphasis. */
export function parseInline(line: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of line.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push({ k: 'text', s: line.slice(last, at) })
    const t = m[0]
    if (t.startsWith('**') || t.startsWith('__')) out.push({ k: 'b', s: t.slice(2, -2) })
    else if (t.startsWith('`')) out.push({ k: 'code', s: t.slice(1, -1) })
    else out.push({ k: 'i', s: t.slice(1, -1) })
    last = at + t.length
  }
  if (last < line.length) out.push({ k: 'text', s: line.slice(last) })
  return out
}

const BULLET = /^\s*(?:[-•*]|–)\s+(.*)$/
const NUMBERED = /^\s*(\d{1,2})[.)]\s+(.*)$/

/** Paragraphs (blank-line separated) and lists. */
export function parseRich(text: string): RichBlock[] {
  const blocks: RichBlock[] = []
  let para: Inline[][] | null = null
  let list: Extract<RichBlock, { k: 'ul' | 'ol' }> | null = null
  const close = () => {
    if (para) blocks.push({ k: 'p', lines: para })
    if (list) blocks.push(list)
    para = null
    list = null
  }
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) {
      close()
      continue
    }
    const b = BULLET.exec(line)
    const n = b ? null : NUMBERED.exec(line)
    if (b || n) {
      const kind = b ? 'ul' : 'ol'
      if (para) {
        blocks.push({ k: 'p', lines: para })
        para = null
      }
      if (!list || list.k !== kind) {
        if (list) blocks.push(list)
        list = kind === 'ol' ? { k: 'ol', items: [], start: Number(n![1]) } : { k: 'ul', items: [] }
      }
      list.items.push(parseInline(b ? b[1] : n![2]))
      continue
    }
    if (list) {
      blocks.push(list)
      list = null
    }
    ;(para ??= []).push(parseInline(line))
  }
  close()
  return blocks
}

/** The text without the markdown marks (for streaming and read-aloud). */
export function plainRich(text: string): string {
  return text.replace(/\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|`([^`\n]+?)`/g, (_, a, b, c) => a ?? b ?? c)
}
