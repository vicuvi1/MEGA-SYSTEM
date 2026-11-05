// The big-model worker, from the page's side: started on first use, ended
// after 2 minutes without use (all its memory comes back). One per page.
import { VOICE_TIMING, shouldUnload } from '@core/voiceFlow'
import type { SttModelId } from '@core/voiceModels'

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void }
type ProgressCb = (p: { file: string; loaded: number; total: number }) => void

let worker: Worker | null = null
let seq = 0
let lastUse = 0
let busy = 0
const pending = new Map<number, Pending>()
const loads = new Map<string, Pending>()
const progressCbs = new Set<ProgressCb>()
let timer: number | null = null

function get(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./voiceAiWorker.ts', import.meta.url), { type: 'module', name: 'voice-ai' })
  worker.onmessage = (e) => {
    const m = e.data
    if (m.type === 'progress') return progressCbs.forEach((cb) => cb(m))
    if (m.type === 'loaded') {
      loads.get(m.what)?.resolve(true)
      loads.delete(m.what)
      return
    }
    if (m.type === 'error' && m.id == null) {
      loads.get(m.what)?.reject(new Error(m.text))
      loads.delete(m.what)
      return
    }
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    if (m.type === 'error') p.reject(new Error(m.text))
    else p.resolve(m)
  }
  worker.onerror = (e) => {
    const err = new Error(e.message || 'The voice models stopped')
    pending.forEach((p) => p.reject(err))
    loads.forEach((p) => p.reject(err))
    pending.clear()
    loads.clear()
    unload()
  }
  timer ??= window.setInterval(() => {
    if (shouldUnload(lastUse, Date.now(), busy > 0 || pending.size > 0 || loads.size > 0)) unload()
  }, 20_000)
  return worker
}

/** End the worker now (its models leave memory). */
export function unload(): void {
  worker?.terminate()
  worker = null
  if (timer) clearInterval(timer)
  timer = null
}

export const aiLoaded = () => !!worker

function call<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  const id = ++seq
  lastUse = Date.now()
  busy++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    get().postMessage({ ...msg, id }, transfer)
  }).finally(() => {
    busy--
    lastUse = Date.now()
  })
}

export async function transcribe(audio: Float32Array, model: SttModelId, lang: string): Promise<string> {
  const r = await call<{ text: string }>({ type: 'stt', audio, model, lang }, [audio.buffer])
  return r.text
}

/** One sentence in Kokoro's voice (24 kHz samples). */
export async function synth(text: string, voice: string, speed: number): Promise<{ id: number; pcm: Float32Array; sr: number }> {
  const r = await call<{ id: number; pcm: Float32Array; sr: number }>({ type: 'tts', text, voice, speed })
  return r
}

/** Skip every sentence asked for so far (you talked over Ben). */
export function cancelSynth(): void {
  worker?.postMessage({ type: 'cancel', upTo: seq })
}

/** Download (and load) a part ahead of time, with progress: Settings → Voice. */
export function preload(what: 'stt' | 'tts', o: { model?: SttModelId; voice?: string }, onProgress?: ProgressCb): Promise<void> {
  if (onProgress) progressCbs.add(onProgress)
  lastUse = Date.now()
  return new Promise<void>((resolve, reject) => {
    loads.set(what, { resolve, reject })
    get().postMessage({ type: 'load', what, ...o })
  }).finally(() => {
    if (onProgress) progressCbs.delete(onProgress)
    lastUse = Date.now()
  })
}

export const UNLOAD_AFTER_MS = VOICE_TIMING.unloadMs
