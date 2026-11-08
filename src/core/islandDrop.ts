// Island v2: the drop zone. Drag a link, some text or a file onto the island
// and it opens two targets: Task (left) and Note (right). Let go over one and
// it is saved there through the usual paths (a task goes to Todoist, a note
// to Notebook → Inbox: the `clipSave` action). Files are saved by name only;
// their contents never leave the PC. Pure and tested (islandDrop.test.ts).

export type DropTo = 'task' | 'note'

export type DropPlan =
  | {
      kind: 'link' | 'text' | 'file'
      /** Where it goes when you let go in the middle (or press Enter). */
      best: DropTo
      /** The text each target would save. */
      task: string
      note: string
      /** A short preview for the drop zone. */
      preview: string
    }
  /** A Todoist task link: it already is a task (the island focuses on it, as before). */
  | { kind: 'todoist'; url: string; preview: string }
  | { kind: 'refuse'; why: string }

export interface DropData {
  uris?: string[]
  text?: string
  /** text/html: a dragged link carries its words here. */
  html?: string
  files?: { name: string; size: number; type?: string }[]
}

const TODOIST = /^https:\/\/(?:app\.)?todoist\.com\/(?:app\/)?(?:task\/|showTask\?id=)/i
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()

/** The words of the first link in some HTML (a dragged link from a browser), if any. */
export function linkWords(html: string | undefined): string {
  if (!html) return ''
  const m = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(html)
  if (!m) return ''
  return clean(m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')).slice(0, 120)
}

/** "example.com/some/page" for a link (no https://, no www., no long query). */
export function shortLink(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/$/, '')
    return `${u.hostname.replace(/^www\./, '')}${path}`.slice(0, 60)
  } catch {
    return url.slice(0, 60)
  }
}

function sizeText(n: number): string {
  if (!(n > 0)) return ''
  if (n < 1000) return `${n} B`
  if (n < 1_000_000) return `${Math.round(n / 1000)} KB`
  return `${Math.round(n / 100_000) / 10} MB`
}

/** What was dropped and what each target would save. */
export function parseDrop(d: DropData): DropPlan {
  const f = d.files?.find((x) => x && x.name)
  if (f) {
    const name = clean(f.name).replace(/[\\/]/g, '_').slice(0, 80) || 'file'
    const size = sizeText(f.size)
    return { kind: 'file', best: 'note', task: `Look at ${name}`, note: `📎 ${name}${size ? ` (${size})` : ''}`, preview: name }
  }
  const text = (d.text ?? '').trim()
  const uri = (d.uris ?? []).map((u) => u.trim()).find((u) => u && !u.startsWith('#')) ?? (/^\S+:\/\/\S+$/.test(text) ? text : '')
  if (uri) {
    if (!/^https?:\/\//i.test(uri)) return { kind: 'refuse', why: 'Only web links can be saved' }
    const url = uri.slice(0, 500)
    if (TODOIST.test(url)) return { kind: 'todoist', url, preview: 'Todoist task' }
    const words = linkWords(d.html) || (text && text !== uri && !/^\S+:\/\//.test(text) ? clean(text).slice(0, 120) : '')
    const name = words || shortLink(url)
    return { kind: 'link', best: 'note', task: `Read: ${name} ${url}`, note: words ? `${words} ${url}` : url, preview: name }
  }
  if (text) {
    const one = clean(text.split(/\r?\n/).find((l) => l.trim()) ?? '')
    const long = text.length > 80 || /\r?\n\s*\S/.test(text.trim())
    return { kind: 'text', best: long ? 'note' : 'task', task: one.slice(0, 120), note: clean(text).slice(0, 1000), preview: one.slice(0, 60) }
  }
  return { kind: 'refuse', why: 'Nothing to drop' }
}

/** Which target the pointer is over: the left half is Task, the right half Note. */
export function dropTarget(x: number, left: number, width: number): DropTo {
  return x - left < width / 2 ? 'task' : 'note'
}
