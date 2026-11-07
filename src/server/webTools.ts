// TL4 + TL7 on the server: read a link you shared (a web page, or a YouTube
// video's transcript, else its title and description) and search the web
// (DuckDuckGo instant answers + Wikipedia, no keys). Short timeouts, a size cap
// on every download, no private addresses, plain text only. Runs inside the
// existing functions (/api/coach and the Telegram webhook): no new function.

import { LIMITS, captionUrl, clip, decodeEntities, htmlToPage, privateHost, transcriptFromXml, youtubeId, type PageText } from '@core/readLinks'
import { mergeResults, parseDuckDuckGo, parseWikipedia, searchUrls, type WebResult } from '@core/webSearch'

export interface WebTools {
  read(url: string): Promise<PageText>
  search(q: string): Promise<WebResult[]>
}

const UA = 'Mozilla/5.0 (compatible; LifeSystemBen/1.0; +https://github.com/vicuvi1/MEGA-SYSTEM)'

/** GET with a timeout and a byte cap; only http(s) to public hosts, at most 3 redirects. */
export async function getText(url: string, opts: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch; accept?: string } = {}): Promise<{ text: string; type: string; url: string }> {
  const f = opts.fetchImpl ?? fetch
  let u = url
  for (let hop = 0; hop < 4; hop++) {
    const p = new URL(u)
    if (!/^https?:$/.test(p.protocol) || privateHost(p.hostname)) throw new Error('That address is not a public web page')
    const r = await f(u, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: opts.accept ?? 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'Accept-Language': 'en,ro;q=0.8,ru;q=0.6' }, signal: AbortSignal.timeout(opts.timeoutMs ?? 6_000) })
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      u = new URL(r.headers.get('location')!, u).toString()
      continue
    }
    if (!r.ok) throw new Error(`The page answered ${r.status}`)
    const type = r.headers.get('content-type') ?? ''
    if (/^(image|video|audio)\/|application\/(octet-stream|zip|pdf)/i.test(type)) throw new Error(/pdf/i.test(type) ? 'That link is a PDF: download it and attach it with 📎 instead' : 'That link is not a page I can read')
    const max = opts.maxBytes ?? LIMITS.pageBytes
    const reader = r.body?.getReader()
    if (!reader) return { text: (await r.text()).slice(0, max), type, url: u }
    const chunks: Uint8Array[] = []
    let n = 0
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(value)
      n += value.length
      if (n >= max) {
        await reader.cancel().catch(() => null)
        break
      }
    }
    const all = new Uint8Array(Math.min(n, max))
    let o = 0
    for (const c of chunks) {
      const part = c.subarray(0, Math.min(c.length, all.length - o))
      all.set(part, o)
      o += part.length
      if (o >= all.length) break
    }
    return { text: new TextDecoder().decode(all), type, url: u }
  }
  throw new Error('Too many redirects')
}

/** A YouTube video: the transcript if YouTube gives one, else the title and description. */
async function readYoutube(id: string, url: string, f: typeof fetch): Promise<PageText> {
  const page = await getText(`https://www.youtube.com/watch?v=${id}&hl=en`, { fetchImpl: f, timeoutMs: 6_000 })
  const base = htmlToPage(page.text, url)
  const desc = /"shortDescription":"((?:[^"\\]|\\.)*)"/.exec(page.text)?.[1]
  const description = desc ? decodeEntities(JSON.parse(`"${desc}"`)).slice(0, 1200) : base.description
  const title = base.title.replace(/\s*-\s*YouTube$/, '')
  let text = ''
  const cap = captionUrl(page.text)
  if (cap) {
    try {
      const xml = await getText(cap, { fetchImpl: f, timeoutMs: 5_000, accept: 'text/xml,*/*' })
      text = transcriptFromXml(xml.text)
    } catch {
      /* no transcript: title and description only */
    }
  }
  return clip<PageText>({ url, title, description, text, kind: 'youtube', cut: false })
}

export function serverWeb(fetchImpl: typeof fetch = fetch): WebTools {
  return {
    async read(url) {
      const id = youtubeId(url)
      if (id) return readYoutube(id, url, fetchImpl)
      const r = await getText(url, { fetchImpl })
      if (/^text\/plain|json|csv|markdown/i.test(r.type)) return clip<PageText>({ url, title: url, description: '', text: r.text.trim(), kind: 'text', cut: false })
      return htmlToPage(r.text, url)
    },
    async search(q) {
      const u = searchUrls(q)
      const [d, w] = await Promise.all([
        getText(u.ddg, { fetchImpl, timeoutMs: 5_000, maxBytes: 400_000, accept: 'application/json' }).then((r) => parseDuckDuckGo(JSON.parse(r.text)), () => [] as WebResult[]),
        getText(u.wiki, { fetchImpl, timeoutMs: 5_000, maxBytes: 400_000, accept: 'application/json' }).then((r) => parseWikipedia(JSON.parse(r.text)), () => [] as WebResult[])
      ])
      return mergeResults(d, w)
    }
  }
}
