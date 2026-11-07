// TL4 on the page: a file you attach in the Coach page becomes text before it
// goes to Ben. PDFs are read here with pdf.js (pinned, loaded from jsdelivr on
// first use only, allowed by exact URL in the CSP); text files as text;
// pictures go the photo way. Nothing is uploaded except the text Ben needs.
import { LIMITS, fileKind, fileProblem, type FileKind } from '@core/readLinks'

export const PDFJS_VERSION = '4.10.38'
export const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`
export const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`

let pdfjs: Promise<any> | null = null
/** pdf.js, once per page. Its worker runs from a blob (the CSP allows blob workers). */
function loadPdfJs(): Promise<any> {
  pdfjs ??= (async () => {
    const lib = await import(/* @vite-ignore */ PDFJS_URL)
    const src = await (await fetch(PDFJS_WORKER_URL)).text()
    lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
    return lib
  })().catch((e) => {
    pdfjs = null
    throw e
  })
  return pdfjs
}

export interface ReadFile {
  name: string
  kind: FileKind
  text: string
  pages?: number
}

/** The text of a PDF (first LIMITS.pdfPages pages). */
export async function pdfText(data: ArrayBuffer): Promise<{ text: string; pages: number }> {
  const lib = await loadPdfJs()
  const doc = await lib.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise
  const pages = doc.numPages as number
  const out: string[] = []
  let size = 0
  for (let i = 1; i <= Math.min(pages, LIMITS.pdfPages) && size < LIMITS.textChars * 1.2; i++) {
    const page = await doc.getPage(i)
    const c = await page.getTextContent()
    const line = (c.items as { str?: string; hasEOL?: boolean }[]).map((it) => `${it.str ?? ''}${it.hasEOL ? '\n' : ''}`).join(' ').replace(/[ \t]+/g, ' ').trim()
    out.push(line)
    size += line.length
  }
  void doc.destroy?.()
  return { text: out.join('\n\n'), pages }
}

/** A file → its text for Ben, or a plain reason it can't be read. Pictures return kind 'image' (sent as a photo). */
export async function readAttachment(f: File): Promise<ReadFile> {
  const problem = fileProblem(f.name, f.type, f.size)
  if (problem) throw new Error(problem)
  const kind = fileKind(f.name, f.type)
  if (kind === 'image') return { name: f.name, kind, text: '' }
  if (kind === 'pdf') {
    const r = await pdfText(await f.arrayBuffer()).catch((e) => {
      throw new Error(`I couldn't read that PDF here (${String((e as Error)?.message ?? e).slice(0, 80)}). Copy its text in instead.`)
    })
    if (!r.text.trim()) throw new Error("That PDF has no text I can read (it's probably a scan). Send a photo of the page instead.")
    return { name: f.name, kind, text: r.text, pages: r.pages }
  }
  return { name: f.name, kind, text: (await f.text()).slice(0, LIMITS.textChars * 2) }
}
