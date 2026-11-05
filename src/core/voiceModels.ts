// Voice, the downloads (pure, tested): every model and engine the voice
// features can use, where it comes from, how big it is and under what licence.
// Nothing here is in the installer or the web app's files: each is downloaded
// the first time you turn its part on, kept in this device's browser cache, and
// can be deleted in Settings → Voice.
//
// Licences: sherpa-onnx (wake word + speech detector engine) Apache-2.0; the
// wake word model (Zipformer, GigaSpeech) Apache-2.0; Silero VAD MIT; ONNX
// Runtime Web MIT; Transformers.js Apache-2.0; Moonshine (English) MIT;
// Whisper MIT; Kokoro-82M Apache-2.0. Kokoro's phonemizer (phonemizer.js with
// eSpeak NG) is GPL-3.0: it is never bundled, the browser downloads it from the
// public CDN only when you pick a Kokoro voice. The light voice (Windows'
// own voices) needs no download.

export type VoicePart = 'ear' | 'stt' | 'tts'
export type SttModelId = 'moonshine-tiny' | 'moonshine-base' | 'whisper-tiny' | 'whisper-base'
export type TtsEngine = 'system' | 'kokoro'

export interface VoiceFile {
  /** Where it is kept (also the key in the cache). */
  name: string
  /** Mirrors, tried in order. */
  urls: string[]
  /** About this many bytes (for the progress bar before the size is known). */
  bytes: number
}

export interface VoicePack {
  id: string
  part: VoicePart
  label: string
  licence: string
  /** Plain files this app downloads itself. */
  files: VoiceFile[]
  /** A Transformers.js model (downloaded through it, into its cache). */
  hf?: { repo: string; dtype: string; bytes: number }
}

export const SHERPA_VERSION = '2.0.1'
/** Must match the onnxruntime-web version Transformers.js runs (package-lock). */
export const ORT_VERSION = '1.31.0-dev.20260914-8d85527a0'
export const PHONEMIZER_URL = 'https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/dist/phonemizer.js'
const JSD = 'https://cdn.jsdelivr.net/npm'
const KWS = 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01'
const KWS_MIRRORS = ['csukuangfj', 'k2-fsa', 'pkufool'].map((o) => `https://huggingface.co/${o}/${KWS}/resolve/main/`)
/** Each mirror, the small (int8) model first, then the full one. */
const kwsUrls = (f: string) => KWS_MIRRORS.flatMap((m) => (f.endsWith('.onnx') ? [`${m}${f.replace(/\.onnx$/, '.int8.onnx')}`, `${m}${f}`] : [`${m}${f}`]))
const KWS_NAME = 'epoch-12-avg-2-chunk-16-left-64'

/** The wake word ("Hey Ben") and the speech detector: one small engine, always the same. */
export const EAR_PACK: VoicePack = {
  id: 'ear',
  part: 'ear',
  label: 'Wake word + speech detector',
  licence: 'sherpa-onnx Apache-2.0 · Zipformer KWS Apache-2.0 · Silero VAD MIT',
  files: [
    { name: 'sherpa.wasm', urls: [`${JSD}/sherpa-onnx@${SHERPA_VERSION}/sherpa-onnx-wasm-nodejs.wasm`], bytes: 15_203_446 },
    { name: 'silero_vad.onnx', urls: [`${JSD}/@ricky0123/vad-web@0.0.31/dist/silero_vad_legacy.onnx`], bytes: 1_807_524 },
    { name: 'kws-encoder.onnx', urls: kwsUrls(`encoder-${KWS_NAME}.onnx`), bytes: 4_800_000 },
    { name: 'kws-decoder.onnx', urls: kwsUrls(`decoder-${KWS_NAME}.onnx`), bytes: 300_000 },
    { name: 'kws-joiner.onnx', urls: kwsUrls(`joiner-${KWS_NAME}.onnx`), bytes: 200_000 },
    { name: 'kws-tokens.txt', urls: kwsUrls('tokens.txt'), bytes: 5_000 }
  ]
}

/** The AI runtime the speech-to-text and Kokoro models run on (one copy for both). */
export const ORT_FILE: VoiceFile = { name: 'ort.wasm', urls: [`${JSD}/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.wasm`], bytes: 14_264_838 }

export const STT_MODELS: Record<SttModelId, { label: string; hint: string; repo: string; dtype: string; bytes: number; multilingual: boolean; licence: string }> = {
  'moonshine-tiny': { label: 'Moonshine Tiny', hint: 'English, fastest', repo: 'onnx-community/moonshine-tiny-ONNX', dtype: 'q8', bytes: 31_000_000, multilingual: false, licence: 'MIT' },
  'moonshine-base': { label: 'Moonshine Base', hint: 'English, more accurate', repo: 'onnx-community/moonshine-base-ONNX', dtype: 'q8', bytes: 65_000_000, multilingual: false, licence: 'MIT' },
  'whisper-tiny': { label: 'Whisper Tiny', hint: 'Many languages, fast', repo: 'onnx-community/whisper-tiny', dtype: 'q8', bytes: 41_000_000, multilingual: true, licence: 'MIT' },
  'whisper-base': { label: 'Whisper Base', hint: 'Many languages, better', repo: 'onnx-community/whisper-base', dtype: 'q8', bytes: 80_000_000, multilingual: true, licence: 'MIT' }
}

export const KOKORO = { repo: 'onnx-community/Kokoro-82M-v1.0-ONNX', dtype: 'q8', bytes: 92_000_000, voiceBytes: 522_240, licence: 'Apache-2.0 (phonemizer GPL-3.0, downloaded at runtime)' }
/** The Kokoro voices offered (English; the A grades first). */
export const KOKORO_VOICES: { id: string; label: string }[] = [
  { id: 'am_michael', label: 'Michael (US, male)' },
  { id: 'am_fenrir', label: 'Fenrir (US, male)' },
  { id: 'am_puck', label: 'Puck (US, male)' },
  { id: 'bm_george', label: 'George (UK, male)' },
  { id: 'bm_fable', label: 'Fable (UK, male)' },
  { id: 'af_heart', label: 'Heart (US, female)' },
  { id: 'af_bella', label: 'Bella (US, female)' },
  { id: 'bf_emma', label: 'Emma (UK, female)' }
]
export const kokoroVoiceUrl = (id: string) => `https://huggingface.co/${KOKORO.repo}/resolve/main/voices/${id}.bin`

/** What the chosen settings will download, part by part (bytes, about). */
export function downloadPlan(p: { wake: boolean; stt: SttModelId; tts: TtsEngine }): { part: VoicePart; label: string; bytes: number }[] {
  const out: { part: VoicePart; label: string; bytes: number }[] = []
  if (p.wake) out.push({ part: 'ear', label: EAR_PACK.label, bytes: EAR_PACK.files.reduce((n, f) => n + f.bytes, 0) })
  const m = STT_MODELS[p.stt]
  out.push({ part: 'stt', label: `${m.label} (speech to text) + runtime`, bytes: m.bytes + ORT_FILE.bytes })
  if (p.tts === 'kokoro') out.push({ part: 'tts', label: 'Kokoro voice + phonemizer', bytes: KOKORO.bytes + KOKORO.voiceBytes + 1_322_380 + (out.some((x) => x.part === 'stt') ? 0 : ORT_FILE.bytes) })
  return out
}

/** "31 MB", "1.8 MB", "300 KB". */
export function sizeText(bytes: number): string {
  if (bytes >= 10e6) return `${Math.round(bytes / 1e6)} MB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`
}

/**
 * The wake-word engine asks the browser for 512 MB of memory up front (its
 * build's default); it grows by itself when it needs more. This sets the
 * starting size in the .wasm file (32 MB is plenty for the wake word and the
 * speech detector). Returns the same bytes when the file isn't as expected.
 */
export function shrinkWasmMemory(bytes: Uint8Array, pages = 512): Uint8Array {
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) return bytes
  let p = 8
  const leb = (): number => {
    let r = 0
    let s = 0
    let x: number
    do {
      x = bytes[p++]
      r += (x & 0x7f) * 2 ** s
      s += 7
    } while (x & 0x80 && p < bytes.length)
    return r
  }
  while (p < bytes.length) {
    const id = bytes[p++]
    const size = leb()
    const start = p
    if (id === 5) {
      const count = leb()
      if (count !== 1) return bytes
      const flags = bytes[p++]
      const minAt = p
      const min = leb()
      const len = p - minAt
      if (flags & 0x04 || min <= pages) return bytes
      // Same length in LEB128, so nothing else in the file moves.
      const enc: number[] = []
      let v = pages
      do {
        let b = v & 0x7f
        v = Math.floor(v / 128)
        if (v) b |= 0x80
        enc.push(b)
      } while (v)
      while (enc.length < len) {
        enc[enc.length - 1] |= 0x80
        enc.push(0)
      }
      if (enc.length !== len) return bytes
      const out = bytes.slice()
      out.set(enc, minAt)
      return out
    }
    p = start + size
  }
  return bytes
}
