/// <reference lib="webworker" />
// The big models (JV2, JV3), loaded only when used: speech to text
// (Moonshine for English, Whisper for other languages) and Kokoro, Ben's
// natural voice. All through Transformers.js on ONNX Runtime's WebAssembly
// (one thread, no GPU). The page ends this worker after 2 minutes without use,
// which gives all its memory back.
import { AutoTokenizer, StyleTextToSpeech2Model, Tensor, env, pipeline } from '@huggingface/transformers'
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import { KOKORO, ORT_FILE, PHONEMIZER_URL, STT_MODELS, kokoroVoiceUrl, type SttModelId } from '@core/voiceModels'
import { MODEL_CACHE, getFile } from './voiceStore'

const post = (m: unknown, t: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, t)
const progress = (p: any) => {
  if (p?.status === 'progress' && p.total) post({ type: 'progress', file: String(p.file ?? ''), loaded: Number(p.loaded) || 0, total: Number(p.total) || 0 })
}

let runtime: Promise<void> | null = null
function ready(): Promise<void> {
  runtime ??= (async () => {
    env.allowLocalModels = false
    env.useBrowserCache = true
    env.cacheKey = MODEL_CACHE
    ;(env as any).useWasmCache = false
    const wasm = (env.backends.onnx as any).wasm
    wasm.wasmBinary = await getFile(ORT_FILE, (p) => post({ type: 'progress', ...p }))
    wasm.wasmPaths = { mjs: new URL(ortMjs, self.location.href).href }
    wasm.numThreads = 1
    wasm.proxy = false
  })()
  return runtime
}

let asr: { id: SttModelId; run: any } | null = null
async function stt(model: SttModelId, audio: Float32Array, lang: string): Promise<string> {
  await ready()
  const m = STT_MODELS[model] ?? STT_MODELS['moonshine-tiny']
  if (!asr || asr.id !== model) {
    asr = { id: model, run: await pipeline('automatic-speech-recognition', m.repo, { dtype: m.dtype as any, device: 'wasm', progress_callback: progress }) }
  }
  if (!audio.length) return ''
  const out = await asr.run(audio, m.multilingual ? { task: 'transcribe', ...(lang ? { language: lang } : {}) } : {})
  return String((Array.isArray(out) ? out[0]?.text : out?.text) ?? '').trim()
}

// ---- Kokoro (Apache-2.0), the same steps as kokoro-js, with its phonemizer
// (eSpeak NG, GPL-3.0) fetched from the public CDN at run time, never bundled.
let tts: { model: any; tok: any; phon: (t: string, lang: string) => Promise<string[]> } | null = null
const voices = new Map<string, Float32Array>()
async function kokoro(): Promise<NonNullable<typeof tts>> {
  if (tts) return tts
  await ready()
  const [model, tok, ph] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained(KOKORO.repo, { dtype: KOKORO.dtype as any, device: 'wasm', progress_callback: progress }),
    AutoTokenizer.from_pretrained(KOKORO.repo, { progress_callback: progress }),
    import(/* @vite-ignore */ PHONEMIZER_URL)
  ])
  tts = { model, tok, phon: ph.phonemize }
  return tts
}

async function voice(id: string): Promise<Float32Array> {
  const v = voices.get(id)
  if (v) return v
  const bytes = await getFile({ name: `kokoro-${id}.bin`, urls: [kokoroVoiceUrl(id)], bytes: KOKORO.voiceBytes })
  const f = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  voices.set(id, f)
  return f
}

async function speak(text: string, voiceId: string, speed: number): Promise<Float32Array> {
  const k = await kokoro()
  const lang = voiceId.startsWith('b') ? 'en' : 'en-us'
  // The phonemizer works on plain words; punctuation is kept as it is.
  const parts = text.split(/(\s*[;:,.!?¡¿—…"«»“”()]+\s*)/)
  const done = await Promise.all(parts.map(async (p, i) => (i % 2 ? p : p.trim() ? (await k.phon(p, lang)).join(' ') : p)))
  let ph = done.join('').replace(/ʲ/g, 'j').replace(/r/g, 'ɹ').replace(/x/g, 'k').replace(/ɬ/g, 'l').trim()
  if (lang === 'en-us') ph = ph.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di')
  const { input_ids } = k.tok(ph, { truncation: true })
  const n = input_ids.dims.at(-1) ?? 0
  const all = await voice(voiceId)
  const at = 256 * Math.min(Math.max(n - 2, 0), 509)
  const style = all.slice(at, at + 256)
  const { waveform } = await k.model({ input_ids, style: new Tensor('float32', style, [1, 256]), speed: new Tensor('float32', [speed], [1]) })
  return new Float32Array(waveform.data)
}

/** A cancelled reply's sentences are skipped (barge-in). */
let cancelledBefore = 0

self.onmessage = async (e: MessageEvent) => {
  const m = e.data
  try {
    if (m.type === 'load') {
      if (m.what === 'stt') await stt(m.model, new Float32Array(0), '')
      else await kokoro().then(() => voice(m.voice))
      post({ type: 'loaded', what: m.what })
    } else if (m.type === 'stt') {
      const text = await stt(m.model, m.audio, m.lang ?? '')
      post({ type: 'text', id: m.id, text })
    } else if (m.type === 'tts') {
      if (m.id <= cancelledBefore) return post({ type: 'audio', id: m.id, pcm: new Float32Array(0), sr: 24000 })
      const pcm = await speak(m.text, m.voice, m.speed ?? 1)
      post({ type: 'audio', id: m.id, pcm, sr: 24000 }, [pcm.buffer])
    } else if (m.type === 'cancel') cancelledBefore = Math.max(cancelledBefore, m.upTo ?? 0)
  } catch (err) {
    post({ type: 'error', id: m.id, what: m.type === 'load' ? m.what : m.type, text: (err as Error)?.message || String(err) })
  }
}
