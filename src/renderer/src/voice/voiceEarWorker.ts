/// <reference lib="webworker" />
// The ear (JV1, JV2, JV4): the only thing that runs while you're not talking.
// sherpa-onnx (WebAssembly, Apache-2.0) runs the "Hey Ben" keyword spotter
// and the Silero speech detector. A quiet room costs nothing: the wake word
// only gets sound that is louder than the room. The page's main thread never
// sees the audio: the mic's audio thread sends it straight here.
import sherpaFactory from 'sherpa-onnx/sherpa-onnx-wasm-nodejs.js'
import { createKws } from 'sherpa-onnx/sherpa-onnx-kws.js'
import { createVad } from 'sherpa-onnx/sherpa-onnx-vad.js'
import { SoundGate } from '@core/voiceFlow'
import { keywordsFile, readPieces } from '@core/voiceText'

type Mode = 'off' | 'wake' | 'vad' | 'barge'
const post = (m: unknown, t: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, t)

let M: any = null
let kws: any = null
let kwsStream: any = null
let vad: any = null
let mode: Mode = 'off'
const gate = new SoundGate(32)
/** The last ~0.6 s, fed to the wake word when a sound starts (so "Hey" isn't cut). */
const pre: Float32Array[] = []
let gateWasOpen = false
let detected = false
let loudRun = 0
/** Fallback (no wake-word model): short things said, for the page to check for "Hey Ben". */
let wakeByVad = false

function feedKws(x: Float32Array) {
  kwsStream.acceptWaveform(16000, x)
  while (kws.isReady(kwsStream)) kws.decode(kwsStream)
  const r = kws.getResult(kwsStream)
  if (r?.keyword) {
    kws.reset(kwsStream)
    post({ type: 'wake', keyword: r.keyword })
  }
}

function popSegments(): Float32Array | null {
  let out: Float32Array | null = null
  while (!vad.isEmpty()) {
    const s = vad.front()
    vad.pop()
    const a: Float32Array = s.samples
    if (!out) out = a
    else {
      const j: Float32Array = new Float32Array(out.length + a.length)
      j.set(out)
      j.set(a, out.length)
      out = j
    }
  }
  return out
}

function onAudio(x: Float32Array, level: number) {
  if (!M || mode === 'off') return
  if (mode === 'wake') {
    if (wakeByVad) return runVad(x, level, true)
    if (!kws) return
    const open = gate.frame(level)
    pre.push(x)
    if (pre.length > 19) pre.shift()
    if (open) {
      if (!gateWasOpen) for (const p of pre.slice(0, -1)) feedKws(p)
      feedKws(x)
    } else if (gateWasOpen) kws.reset(kwsStream)
    gateWasOpen = open
    return
  }
  runVad(x, level, false)
}

function runVad(x: Float32Array, level: number, wakeCheck: boolean) {
  vad.acceptWaveform(x)
  const now = vad.isDetected()
  if (mode === 'barge') {
    // Ben is talking: only a clear, loud voice for ~0.25 s counts (his own voice from the speakers doesn't).
    loudRun = now && level > 0.02 ? loudRun + 1 : 0
    if (loudRun === 8) post({ type: 'speechStart' })
    if (!now) popSegments()
    return
  }
  if (now && !detected && !wakeCheck) post({ type: 'speechStart' })
  detected = now
  const seg = popSegments()
  if (!seg) return
  if (wakeCheck) {
    // Only short things can be "Hey Ben …" (0.4–4 s).
    if (seg.length >= 6400 && seg.length <= 64000) post({ type: 'maybeWake', samples: seg }, [seg.buffer])
    return
  }
  post({ type: 'speechEnd', samples: seg }, [seg.buffer])
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data
  try {
    if (m.type === 'init') {
      M = await sherpaFactory({ wasmBinary: new Uint8Array(m.wasm), print: () => {}, printErr: () => {} })
      M.FS.writeFile('/silero.onnx', new Uint8Array(m.silero))
      vad = createVad(M, {
        sileroVad: { model: '/silero.onnx', threshold: 0.5, minSilenceDuration: 0.6, minSpeechDuration: 0.2, maxSpeechDuration: 20, windowSize: 512 },
        sampleRate: 16000,
        numThreads: 1,
        provider: 'cpu',
        debug: 0,
        bufferSizeInSeconds: 30
      })
      if (m.kws) {
        try {
          M.FS.writeFile('/enc.onnx', new Uint8Array(m.kws.encoder))
          M.FS.writeFile('/dec.onnx', new Uint8Array(m.kws.decoder))
          M.FS.writeFile('/join.onnx', new Uint8Array(m.kws.joiner))
          M.FS.writeFile('/tokens.txt', m.kws.tokens)
          const keywords = keywordsFile(['hey ben', 'hi ben', 'okay ben'], readPieces(m.kws.tokens), { boost: 1.5, threshold: m.threshold ?? 0.25 })
          if (!keywords) throw new Error('the wake word model cannot spell "hey ben"')
          kws = createKws(M, {
            featConfig: { samplingRate: 16000, featureDim: 80 },
            modelConfig: { transducer: { encoder: '/enc.onnx', decoder: '/dec.onnx', joiner: '/join.onnx' }, tokens: '/tokens.txt', provider: 'cpu', modelType: '', numThreads: 1, debug: 0, modelingUnit: '', bpeVocab: '' },
            maxActivePaths: 4,
            numTrailingBlanks: 1,
            keywordsScore: 1.0,
            keywordsThreshold: m.threshold ?? 0.25,
            keywords: '',
            keywordsBuf: keywords,
            keywordsBufSize: new TextEncoder().encode(keywords).length
          })
          kwsStream = kws.createStream()
        } catch (err) {
          kws = null
          post({ type: 'note', text: `Wake word model problem: ${(err as Error).message}. Using the backup way.` })
        }
      }
      wakeByVad = !kws
      const port: MessagePort = m.port
      port.onmessage = (ev) => ev.data?.type === 'audio' && onAudio(ev.data.samples, ev.data.level)
      post({ type: 'ready', kws: !!kws })
    } else if (m.type === 'mode') {
      if (m.mode !== mode) {
        vad?.reset()
        detected = false
        loudRun = 0
        if (kws && kwsStream) kws.reset(kwsStream)
      }
      mode = m.mode
    } else if (m.type === 'flush' && vad) {
      // Push-to-talk released: what was said so far is the whole thing.
      vad.flush()
      const seg = popSegments()
      post({ type: 'speechEnd', samples: seg ?? new Float32Array(0) }, seg ? [seg.buffer] : [])
      vad.reset()
      detected = false
    }
  } catch (err) {
    post({ type: 'error', text: (err as Error).message || String(err) })
  }
}
