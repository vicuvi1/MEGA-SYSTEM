// Ben's chat tools, run before he thinks (shared by the server and the page):
// - TL4 a link in your message is read (page or YouTube transcript), an
//   attached file's text is unpacked; Ben summarises it or makes tasks/events;
// - TL6 "can I afford X?" is answered in code from your real money numbers;
// - TL7 "search the web for X" searches (DuckDuckGo + Wikipedia), with sources;
// - TL8 "write an email to …" tells Ben the draft's shape (never sent).
// Kept out of webBots.ts on purpose: think() calls prepareTools() once and
// webNeed() for a "web <query>" lookup, and that's all it knows about them.

import { fileForBen, fileLine, findLinks, pageForBen, readNote, splitFile } from '@core/readLinks'
import { NO_SEARCH, resultsForBen, sourcesLine, wantsWebSearch, WEB_LOOKUP_HELP, type WebResult } from '@core/webSearch'
import { affordAnswer, affordReply, readAfford, type MoneyFacts } from '@core/moneyCoach'
import { draftNote, draftText, readDraftAsk, templateDraft } from '@core/emailDraft'
import type { PageText } from '@core/readLinks'

export interface WebLike {
  read(url: string): Promise<PageText>
  search(q: string): Promise<WebResult[]>
}

export interface ToolPrep {
  /** Your words without a packed file. */
  text: string
  /** What the chat log keeps for your message (a file becomes "📎 name"). */
  logText: string
  /** Answered in code (no model call). */
  preset: { reply: string; chips?: string[] } | null
  /** Data for Ben's prompt (pages, files, search results). */
  found: string[]
  /** One extra instruction for this answer. */
  note: string
  /** Listed under Ben's reply. */
  sources: WebResult[]
  /** Live steps for the screen. */
  steps: string[]
}

export interface ToolDeps {
  web: WebLike | null
  /** Your money numbers (Finance Helper + fun budget), read only when asked about money. */
  money: () => Promise<MoneyFacts | null>
  /** An AI model is there (else a draft is a plain template). */
  hasAi: boolean
  onStep?: (s: string) => void
}

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> => Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error('took too long')), ms))])

export async function prepareTools(message: string, d: ToolDeps): Promise<ToolPrep> {
  const { text, file } = splitFile(message ?? '')
  const out: ToolPrep = { text, logText: file ? `${text ? `${text}\n` : ''}${fileLine(file)}` : text, preset: null, found: [], note: '', sources: [], steps: [] }
  const step = (s: string) => {
    out.steps.push(s)
    try {
      d.onStep?.(s)
    } catch {
      /* the screen's problem */
    }
  }
  const t = text.trim()
  // An attached file: its text is data, Ben summarises or makes tasks.
  if (file) {
    step(`Read ${file.name}`)
    out.found.push(fileForBen(file))
    out.note = readNote(t || 'summarise')
    return out
  }
  if (!t) return out
  // "Can I afford headphones this month?": the money coach, from real numbers.
  const afford = readAfford(t)
  if (afford) {
    const f = await d.money().catch(() => null)
    if (f) {
      step('Checked your money')
      const a = affordAnswer(afford, f)
      out.preset = { reply: affordReply(a), chips: a.chips }
      return out
    }
  }
  // "Write an email to my teacher about …": the draft's shape (Ben writes it; nothing is sent).
  const draft = readDraftAsk(t)
  if (draft) {
    if (!d.hasAi) {
      out.preset = { reply: draftText(templateDraft(draft)), chips: ['More formal', 'Shorter'] }
      return out
    }
    out.note = draftNote(draft)
    step('Writing a draft')
    return out
  }
  // "Search the web for …": results with sources, never made up.
  const q = wantsWebSearch(t)
  if (q) {
    if (!d.web) {
      out.preset = { reply: NO_SEARCH }
      return out
    }
    step('Searching the web')
    const rs = await withTimeout(d.web.search(q), 8_000).catch(() => [] as WebResult[])
    out.found.push(resultsForBen(q, rs))
    out.sources = rs
    if (!rs.length) out.preset = { reply: `I searched the web for "${q}" (DuckDuckGo and Wikipedia) and found nothing I can trust. I won't guess.` }
    else out.note = 'Answer his question from the web results in 1–4 sentences, citing [1], [2]. Say when a result may be out of date.'
    return out
  }
  // A link: read it (page text, or a YouTube transcript / title and description).
  const links = findLinks(t)
  if (links.length) {
    for (const url of links) {
      if (!d.web) {
        out.found.push(`He shared ${url}, but links can't be read from here. Tell him plainly and ask him to paste the text.`)
        continue
      }
      step(/youtu/.test(url) ? 'Reading the video' : 'Reading the link')
      try {
        const p = await withTimeout(d.web.read(url), 9_000)
        out.found.push(pageForBen(p))
      } catch (e) {
        out.found.push(`He shared ${url}, but it could not be read (${String((e as Error)?.message ?? e).slice(0, 100)}). Say so plainly; don't guess what it says.`)
      }
    }
    out.note = readNote(t)
  }
  return out
}

/** A "web <query>" lookup Ben asked for himself: results (with sources kept for the reply). */
export async function webNeed(need: string, web: WebLike | null): Promise<{ found: string; sources: WebResult[] } | null> {
  const m = /^\s*web\s+(.+)$/i.exec(need ?? '')
  if (!m) return null
  const q = m[1].trim().slice(0, 200)
  if (!web) return { found: `Web search for "${q}": not available here. Tell him you can't look it up right now; do not guess.`, sources: [] }
  const rs = await withTimeout(web.search(q), 8_000).catch(() => [] as WebResult[])
  return { found: resultsForBen(q, rs), sources: rs }
}

/** The sources list under the reply (only the ones Ben got). */
export function withSources(reply: string, sources: WebResult[]): string {
  if (!sources.length || /\nSources:\n/.test(reply)) return reply
  return `${reply.trim()}\n\n${sourcesLine(sources)}`
}

/** Extra line for the lookups help, only when a web source is there. */
export const webLookupHelp = (web: WebLike | null) => (web ? `\n- ${WEB_LOOKUP_HELP}` : '')
