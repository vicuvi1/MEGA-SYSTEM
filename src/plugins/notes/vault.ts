// Notes from an Obsidian vault (and optionally Notion): pure helpers. Only a
// note's title, its headings and its first few lines are kept, as a
// read-only list in the Notebook that Ben can see.

export interface VaultNote {
  title: string
  folder: string
  headings: string[]
  lines: string[]
  edited: string // ISO
}

export interface VaultData {
  folder: string // the folder's name only, never the full path
  at: string
  count: number
  notes: VaultNote[]
}

export interface NotionPage {
  title: string
  edited: string
  url: string
}

export interface NotionData {
  at: string
  pages: NotionPage[]
}

const clean = (s: string) =>
  s
    .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** One markdown file → its title, headings and first lines. */
export function noteSummary(relPath: string, text: string, edited: Date): VaultNote {
  const parts = relPath.replace(/\\/g, '/').split('/')
  const file = parts.pop() ?? relPath
  let body = String(text ?? '').replace(/^﻿/, '')
  // Front matter (--- … ---) is settings, not content.
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3)
    if (end > 0) body = body.slice(end + 4)
  }
  const headings: string[] = []
  const lines: string[] = []
  let fence = false
  for (const raw of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence
      continue
    }
    if (fence) continue
    const h = /^(#{1,3})\s+(.+)$/.exec(raw.trim())
    if (h) {
      if (headings.length < 5) headings.push(clean(h[2]).slice(0, 60))
      continue
    }
    const line = clean(raw.replace(/^\s*([-*+]|\d+\.)\s+(\[.\]\s+)?/, '').replace(/^>\s?/, ''))
    if (line && lines.length < 3 && !/^%%|^\|/.test(line)) lines.push(line.slice(0, 120))
  }
  return { title: file.replace(/\.md$/i, '').slice(0, 80), folder: parts.join('/').slice(0, 60), headings: headings.filter(Boolean), lines, edited: edited.toISOString() }
}

/** Skip hidden folders (.obsidian, .trash, .git) and the vault's own templates. */
export const skipDir = (name: string) => name.startsWith('.') || /^(node_modules|templates?)$/i.test(name)

/** One line for what Ben knows (newest notes first, kept short). */
export function notesLine(vault: VaultData | null, notion: NotionData | null, max = 700): string | null {
  const bits: string[] = []
  for (const n of vault?.notes ?? []) bits.push(`${n.title}${n.headings.length ? ` (${n.headings.slice(0, 3).join(', ')})` : ''}${n.lines[0] ? `: ${n.lines[0].slice(0, 70)}` : ''}`)
  for (const p of notion?.pages ?? []) bits.push(`${p.title} (Notion)`)
  if (!bits.length) return null
  let out = ''
  for (const b of bits) {
    if (out.length + b.length > max) break
    out += (out ? '; ' : '') + b
  }
  const total = (vault?.count ?? 0) + (notion?.pages.length ?? 0)
  return `His own notes (read-only, ${total} notes, newest first; use them to plan, never edit them): ${out}.`
}

/** Notion's page → its title (the property of type "title"). */
export function notionTitle(page: any): string {
  const props = page?.properties ?? {}
  const t = Object.values(props).find((p: any) => p?.type === 'title') as any
  const text = (t?.title ?? []).map((x: any) => x?.plain_text ?? '').join('').trim()
  return (text || 'Untitled').slice(0, 80)
}
