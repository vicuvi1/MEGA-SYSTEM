// EY3: the caption model, downloaded only when you turn captions on, into
// this app's own folder (userData/eyes-models), with progress, Cancel and
// Delete. Nothing of it is in the installer. Three files of code (the
// Transformers.js library and its ONNX runtime, pinned and checked by
// SHA-256) and the Florence-2 base model (int8, onnx-community).
// The app window loads them from life-system://app/eyes-files/… (served
// below), so no outside site is ever asked while it runs.
//
// Licences: Florence-2 (Microsoft) MIT; the ONNX export by onnx-community
// keeps it; Transformers.js Apache-2.0; ONNX Runtime Web MIT.
import { net } from 'electron'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { EyesModelStatus } from '../../shared/eyes'

export const MODEL_ID = 'onnx-community/Florence-2-base-ft'
export const LIB_VERSION = '3.8.1'
const LIB = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${LIB_VERSION}/dist/`
const HF = `https://huggingface.co/${MODEL_ID}/resolve/main/`

export interface ModelFile {
  url: string
  /** Where it lives under the eyes folder (and its path after /eyes-files/). */
  path: string
  /** Pinned: the download must have exactly this hash (code files). */
  sha256?: string
  /** Bytes, when known before asking. */
  size?: number
}

/** What is downloaded. The code is pinned by hash; the model's files are data (ONNX weights and JSON). */
export const MODEL_FILES: ModelFile[] = [
  { url: `${LIB}transformers.min.js`, path: 'lib/transformers.min.js', sha256: 'aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa', size: 888_173 },
  { url: `${LIB}ort-wasm-simd-threaded.jsep.mjs`, path: 'lib/ort-wasm-simd-threaded.jsep.mjs', sha256: '08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9', size: 44_484 },
  { url: `${LIB}ort-wasm-simd-threaded.jsep.wasm`, path: 'lib/ort-wasm-simd-threaded.jsep.wasm', sha256: 'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39', size: 21_596_019 },
  ...['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json'].map((f) => ({ url: `${HF}${f}`, path: `models/${MODEL_ID}/${f}` })),
  ...['vision_encoder', 'embed_tokens', 'encoder_model', 'decoder_model_merged'].map((f) => ({ url: `${HF}onnx/${f}_quantized.onnx`, path: `models/${MODEL_ID}/onnx/${f}_quantized.onnx` }))
]

/** About how big it all is (shown before you download; the real size shows once it starts). */
export const MODEL_SIZE_ESTIMATE = 300 * 1024 * 1024

const TYPES: Record<string, string> = { js: 'text/javascript', mjs: 'text/javascript', wasm: 'application/wasm', json: 'application/json', onnx: 'application/octet-stream' }

export function createModels(o: { dir: string; onStatus: (s: EyesModelStatus) => void }) {
  const root = join(o.dir, 'eyes-models')
  let status: EyesModelStatus = { state: 'none', got: 0, total: 0, onDisk: 0 }
  let abort: AbortController | null = null
  const set = (s: Partial<EyesModelStatus>) => {
    status = { ...status, ...s }
    o.onStatus(status)
  }
  const sizeOnDisk = async (d = root): Promise<number> => {
    let n = 0
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = join(d, e.name)
      n += e.isDirectory() ? await sizeOnDisk(p) : await stat(p).then((s) => s.size, () => 0)
    }
    return n
  }
  const complete = async () => {
    for (const f of MODEL_FILES) if (!(await stat(join(root, f.path)).then((s) => s.size > 0, () => false))) return false
    return true
  }
  const check = async () => {
    const onDisk = await sizeOnDisk()
    if (status.state === 'downloading') return set({ onDisk })
    set({ state: (await complete()) ? 'ready' : 'none', onDisk, got: 0, total: 0, error: undefined })
  }
  void check()

  const fetchOne = async (f: ModelFile, signal: AbortSignal, onBytes: (n: number) => void) => {
    const target = join(root, f.path)
    await mkdir(dirname(target), { recursive: true })
    const r = await net.fetch(f.url, { signal } as RequestInit)
    if (!r.ok || !r.body) throw new Error(`${f.path.split('/').pop()}: the server said ${r.status}`)
    const hash = createHash('sha256')
    const out = createWriteStream(target + '.part')
    const reader = r.body.getReader()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        hash.update(value)
        if (!out.write(value)) await new Promise<void>((ok) => out.once('drain', () => ok()))
        onBytes(value.byteLength)
      }
      await new Promise<void>((ok, bad) => out.end((e?: Error | null) => (e ? bad(e) : ok())))
    } catch (e) {
      out.destroy()
      await rm(target + '.part', { force: true }).catch(() => {})
      throw e
    }
    if (f.sha256 && hash.digest('hex') !== f.sha256) {
      await rm(target + '.part', { force: true }).catch(() => {})
      throw new Error(`${f.path.split('/').pop()} did not match its checksum`)
    }
    await rename(target + '.part', target)
  }

  /** Download what's missing (a file already there is kept). */
  const download = async () => {
    if (status.state === 'downloading') return status
    abort = new AbortController()
    const signal = abort.signal
    set({ state: 'downloading', got: 0, total: MODEL_SIZE_ESTIMATE, error: undefined })
    try {
      const todo: ModelFile[] = []
      let have = 0
      for (const f of MODEL_FILES) {
        const s = await stat(join(root, f.path)).catch(() => null)
        if (s && s.size > 0) have += s.size
        else todo.push(f)
      }
      // The real total: the sizes we know, and the server's for the rest (HEAD; the estimate if it won't say).
      let total = have
      for (const f of todo) {
        if (f.size) total += f.size
        else {
          const h = await net.fetch(f.url, { method: 'HEAD', signal } as RequestInit).catch(() => null)
          const n = Number(h?.headers.get('x-linked-size') ?? h?.headers.get('content-length') ?? 0)
          total += n > 0 ? n : 1024 * 1024
        }
      }
      let got = have
      let lastSent = 0
      set({ total, got })
      for (const f of todo) {
        await fetchOne(f, signal, (n) => {
          got += n
          // A progress message at most 4 times a second.
          if (Date.now() - lastSent > 250) {
            lastSent = Date.now()
            set({ got, total: Math.max(total, got) })
          }
        })
      }
      abort = null
      set({ state: 'ready', got, total: Math.max(total, got), onDisk: await sizeOnDisk() })
    } catch (e) {
      const cancelled = signal.aborted
      abort = null
      set({ state: cancelled ? 'none' : 'error', error: cancelled ? undefined : plain(e), onDisk: await sizeOnDisk() })
    }
    return status
  }
  const cancel = () => {
    abort?.abort()
    return status
  }
  const remove = async () => {
    abort?.abort()
    await rm(root, { recursive: true, force: true }).catch(() => {})
    set({ state: 'none', got: 0, total: 0, onDisk: 0, error: undefined })
    return status
  }

  /** life-system://app/eyes-files/<path> → the file (only inside the eyes folder, only known types). */
  const serve = async (pathname: string): Promise<Response | null> => {
    if (!pathname.startsWith('/eyes-files/')) return null
    const rel = decodeURIComponent(pathname.slice('/eyes-files/'.length))
    const target = resolve(root, rel)
    const ext = rel.split('.').pop()?.toLowerCase() ?? ''
    if (!target.startsWith(root + sep) || !TYPES[ext]) return new Response('Not found', { status: 404 })
    if (!(await stat(target).then((s) => s.isFile(), () => false))) return new Response('Not found', { status: 404 })
    const r = await net.fetch(pathToFileURL(target).toString())
    return new Response(r.body, { status: 200, headers: { 'Content-Type': TYPES[ext], 'Cache-Control': 'no-store' } })
  }

  return { status: () => status, download, cancel, remove, serve, check, ready: () => status.state === 'ready' }
}

function plain(e: unknown): string {
  const m = (e as Error)?.message || String(e)
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ENOTFOUND|network/i.test(m)) return 'No internet: try again when you are online'
  if (/ENOSPC/i.test(m)) return 'Not enough free disk space'
  return m.slice(0, 160)
}
