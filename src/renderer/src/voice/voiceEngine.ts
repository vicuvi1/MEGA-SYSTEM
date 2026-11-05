// The voice engine (page side): the mic, the ear worker, speech to text, the
// command parser, Ben and his voice, held together by the flow in
// core/voiceFlow.ts. The mic is opened only while it is needed and closed
// entirely (worker ended, tracks stopped) when voice is off or paused.
import { VOICE_OFF, micWanted, voiceStep, waveLevel, type VoiceEvent, type VoiceFlow } from '@core/voiceFlow'
import { parseVoiceCommand, voiceAnswer, type VoiceCommand, type VoiceCtx } from '@core/voiceCommands'
import { SentenceStream, stripWake } from '@core/voiceText'
import { EAR_PACK, shrinkWasmMemory } from '@core/voiceModels'
import workletUrl from './voiceMicWorklet.js?url'
import { getFile } from './voiceStore'
import { transcribe } from './voiceAi'
import { Speaker } from './voiceSpeak'
import { askBen } from './voiceAsk'
import { voicePrefs, type VoicePrefs } from './voicePrefs'
import { voiceAudio } from '../soundKit'

export interface VoiceHooks {
  /** What the island knows (for commands and "what's next"); null: every line goes to Ben. */
  context?: () => VoiceCtx | null
  /** Run a command the parser understood (a tap, a media key, quiet). */
  run?: (c: Exclude<VoiceCommand, { kind: 'ben' } | { kind: 'cancel' } | { kind: 'answer' } | { kind: 'say' }>) => void
  /** Push-to-talk only (the Coach page): the words go here instead of Ben. */
  onText?: (text: string) => void
}

export interface VoiceView {
  flow: VoiceFlow
  /** The wake word is the real model (false: the backup check by speech to text). */
  kws: boolean | null
  /** The last problem, in plain words. */
  problem: string | null
}

const WAKE_FILES = new Set(['kws-encoder.onnx', 'kws-decoder.onnx', 'kws-joiner.onnx', 'kws-tokens.txt'])

export class VoiceEngine {
  flow: VoiceFlow = VOICE_OFF
  kws: boolean | null = null
  problem: string | null = null
  private listeners = new Set<(v: VoiceView) => void>()
  private ear: Worker | null = null
  private earReady: Promise<void> | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private audio: ReturnType<typeof voiceAudio> = null
  private micLvl = 0
  private tickT: number | null = null
  private gen = 0
  private wakeChecks: number[] = []
  private paused: string | null = null
  readonly speaker: Speaker

  constructor(private hooks: VoiceHooks, private wakeWord: () => boolean, private prefs: () => VoicePrefs = voicePrefs) {
    this.speaker = new Speaker(prefs)
    this.speaker.onStart = () => this.step({ type: 'speakStart' })
    this.speaker.onEnd = () => this.step({ type: 'speakEnd' })
    this.speaker.onError = (why) => this.note(why)
  }

  subscribe(cb: (v: VoiceView) => void): () => void {
    this.listeners.add(cb)
    cb(this.view())
    return () => void this.listeners.delete(cb)
  }
  private view(): VoiceView {
    return { flow: this.flow, kws: this.kws, problem: this.problem }
  }
  private note(why: string | null) {
    this.problem = why
    this.listeners.forEach((l) => l(this.view()))
  }

  /** Mic level 0..1 while you talk; Ben's level while he speaks (the wave). */
  level(): { me: number; ben: number } {
    return { me: this.flow.phase === 'listening' || this.flow.phase === 'followup' ? waveLevel(this.micLvl) : 0, ben: this.flow.phase === 'speaking' ? this.speaker.level() : 0 }
  }

  enable(): void {
    this.step({ type: 'enable' })
    if (this.paused) this.step({ type: 'pause', why: this.paused })
  }
  disable(): void {
    this.step({ type: 'disable' })
  }
  /** Why the mic must stop now (PC locked, a call…); null: it may listen. */
  setPaused(why: string | null): void {
    if (why === this.paused) return
    this.paused = why
    this.step(why ? { type: 'pause', why } : { type: 'resume' })
  }
  /** The hotkey or the mic button: start listening, or send what was said. */
  ptt(): void {
    if (this.flow.phase === 'off' || this.flow.phase === 'paused') return
    if (this.flow.phase === 'speaking') this.speaker.stop()
    const was = this.flow.phase
    this.step({ type: 'ptt' })
    if (was === 'listening' && this.flow.phase === 'thinking') this.ear?.postMessage({ type: 'flush' })
  }
  /** "Never mind": quiet, and back to waiting. */
  cancel(): void {
    this.gen++
    this.speaker.stop()
    this.step({ type: 'cancel' })
  }
  destroy(): void {
    this.disable()
    this.listeners.clear()
  }

  // ---- the flow ----
  private step(e: VoiceEvent) {
    const before = this.flow
    this.flow = voiceStep(this.flow, e, Date.now())
    if (this.flow === before) return
    if (before.phase === 'speaking' && this.flow.phase === 'listening') {
      // JV4: you talked over Ben: quiet at once.
      this.gen++
      this.speaker.stop()
    }
    if (this.flow.phase === 'off' || this.flow.phase === 'paused') {
      this.gen++
      this.speaker.stop()
    }
    void this.syncMic()
    this.syncTick()
    this.listeners.forEach((l) => l(this.view()))
  }

  private syncTick() {
    const live = !['off', 'paused', 'idle'].includes(this.flow.phase)
    if (live && !this.tickT) this.tickT = window.setInterval(() => this.step({ type: 'tick' }), 500)
    if (!live && this.tickT) {
      clearInterval(this.tickT)
      this.tickT = null
    }
  }

  private earMode(): 'off' | 'wake' | 'vad' | 'barge' {
    const want = micWanted(this.flow, this.wakeWord())
    if (want === 'off') return 'off'
    if (this.flow.phase === 'speaking') return 'barge'
    if (this.flow.phase === 'thinking') return 'off'
    return want
  }

  private async syncMic() {
    const want = micWanted(this.flow, this.wakeWord())
    if (want === 'off') return this.stopMic()
    try {
      await this.startMic()
      this.ear?.postMessage({ type: 'mode', mode: this.earMode() })
    } catch (err) {
      this.note(micProblem(err))
      this.step({ type: 'error', why: 'mic' })
      this.stopMic()
      if (this.flow.phase !== 'off') this.flow = { ...this.flow, phase: 'paused', why: 'no microphone' }
      this.listeners.forEach((l) => l(this.view()))
    }
  }

  private async startMic(): Promise<void> {
    if (this.earReady) return this.earReady
    this.earReady = (async () => {
      const wake = this.wakeWord()
      const files = await Promise.all(
        EAR_PACK.files.map((f) => (!wake && WAKE_FILES.has(f.name) ? Promise.resolve(null) : getFile(f).catch((e) => (WAKE_FILES.has(f.name) ? null : Promise.reject(e)))))
      )
      const byName = (n: string) => files[EAR_PACK.files.findIndex((f) => f.name === n)]
      const kwsFiles = ['kws-encoder.onnx', 'kws-decoder.onnx', 'kws-joiner.onnx', 'kws-tokens.txt'].map(byName)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
      const audio = voiceAudio()
      if (!audio) throw new Error('No audio on this device')
      await audio.ctx.audioWorklet.addModule(workletUrl)
      const node = new AudioWorkletNode(audio.ctx, 'life-mic', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
      const src = audio.ctx.createMediaStreamSource(stream)
      src.connect(node)
      // Its output is silence; connected so the audio thread keeps running it.
      node.connect(audio.ctx.destination)
      const ch = new MessageChannel()
      node.port.postMessage({ port: ch.port1 }, [ch.port1])
      node.port.onmessage = (e) => (this.micLvl = this.micLvl * 0.5 + Number(e.data) * 0.5)
      const ear = new Worker(new URL('./voiceEarWorker.ts', import.meta.url), { type: 'module', name: 'voice-ear' })
      const wasm = shrinkWasmMemory(byName('sherpa.wasm')!, 512)
      await new Promise<void>((resolve, reject) => {
        ear.onmessage = (e) => {
          const m = e.data
          if (m.type === 'ready') {
            this.kws = wake ? !!m.kws : null
            resolve()
          } else if (m.type === 'error') reject(new Error(m.text))
          else this.fromEar(m)
        }
        ear.onerror = (e) => reject(new Error(e.message || 'The ear stopped'))
        const kws = wake && kwsFiles.every(Boolean) ? { encoder: kwsFiles[0]!.buffer, decoder: kwsFiles[1]!.buffer, joiner: kwsFiles[2]!.buffer, tokens: new TextDecoder().decode(kwsFiles[3]!) } : undefined
        ear.postMessage({ type: 'init', wasm: wasm.buffer, silero: byName('silero_vad.onnx')!.buffer, kws, threshold: this.prefs().wakeThreshold, port: ch.port2 }, [ch.port2])
      })
      ear.onmessage = (e) => (e.data.type === 'error' ? this.note(`Voice: ${e.data.text}`) : this.fromEar(e.data))
      this.stream = stream
      this.node = node
      this.audio = audio
      this.ear = ear
      this.note(null)
    })()
    try {
      await this.earReady
    } catch (e) {
      this.earReady = null
      throw e
    }
  }

  private stopMic() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    try {
      this.node?.port.postMessage({ stop: true })
      this.node?.disconnect()
    } catch {
      /* gone */
    }
    this.node = null
    this.ear?.terminate()
    this.ear = null
    this.earReady = null
    this.audio?.release()
    this.audio = null
    this.micLvl = 0
  }

  private fromEar(m: any) {
    if (m.type === 'wake') {
      if (this.flow.phase === 'idle' || this.flow.phase === 'followup') this.step({ type: 'wake' })
    } else if (m.type === 'speechStart') this.step({ type: 'speechStart' })
    else if (m.type === 'speechEnd') {
      if (this.flow.phase !== 'listening' && this.flow.phase !== 'thinking') return
      if (this.flow.phase === 'listening') this.step({ type: 'speechEnd' })
      void this.understand(m.samples as Float32Array)
    } else if (m.type === 'maybeWake') void this.checkWake(m.samples as Float32Array)
    else if (m.type === 'note') this.note(m.text)
  }

  /** The backup wake word (no keyword model): a short thing said, checked by speech to text, at most 6 a minute. */
  private async checkWake(samples: Float32Array) {
    const now = Date.now()
    this.wakeChecks = this.wakeChecks.filter((t) => now - t < 60_000)
    if (this.wakeChecks.length >= 6 || this.flow.phase !== 'idle') return
    this.wakeChecks.push(now)
    const p = this.prefs()
    const text = await transcribe(samples, p.stt, p.lang).catch(() => '')
    const w = stripWake(text)
    if (!w.woke || this.flow.phase !== 'idle') return
    this.step({ type: 'wake' })
    if (w.rest) {
      this.step({ type: 'speechEnd' })
      void this.handle(w.rest)
    }
  }

  private async understand(samples: Float32Array) {
    const gen = ++this.gen
    const p = this.prefs()
    let text = ''
    try {
      text = samples.length ? await transcribe(samples, p.stt, p.lang) : ''
    } catch (err) {
      this.note(`Speech to text: ${(err as Error).message}`)
    }
    if (gen !== this.gen) return
    // "Hey Ben, …" said in one go: the rest is the command.
    text = stripWake(text).rest.trim()
    if (!text || /^[\W_]*$/.test(text) || /^\[.*\]$|^\(.*\)$/.test(text)) return this.step({ type: 'nothing' })
    void this.handle(text)
  }

  /** What to do with what you said. */
  private async handle(text: string) {
    const gen = this.gen
    this.step({ type: 'heard', text })
    if (this.hooks.onText) {
      this.hooks.onText(text)
      // Push-to-talk only: the mic closes again.
      return this.step({ type: 'cancel' })
    }
    const ctx = this.hooks.context?.() ?? null
    const cmd: VoiceCommand = ctx ? parseVoiceCommand(text, ctx) : { kind: 'ben', text }
    if (cmd.kind === 'cancel') return this.cancel()
    if (cmd.kind === 'answer') return this.reply(voiceAnswer(cmd.topic, ctx!.snap, Date.now()))
    if (cmd.kind === 'say') return this.reply(cmd.text)
    if (cmd.kind !== 'ben') {
      this.hooks.run?.(cmd)
      return this.reply(cmd.say)
    }
    // Ben: his reply is spoken sentence by sentence as it arrives.
    const speak = this.prefs().speak
    const ss = new SentenceStream()
    if (speak) this.speaker.begin()
    try {
      const reply = await askBen(cmd.text, (soFar) => {
        if (gen !== this.gen) return
        this.step({ type: 'reply', text: soFar })
        if (speak) for (const s of ss.push(soFar)) this.speaker.say(s)
      })
      if (gen !== this.gen) return
      this.step({ type: 'reply', text: reply })
      if (!speak) return this.step({ type: 'done' })
      for (const s of ss.end(reply)) this.speaker.say(s)
      this.speaker.end()
      if (!this.speaker.busy && this.flow.phase === 'thinking') this.step({ type: 'done' })
    } catch (err) {
      if (gen !== this.gen) return
      this.speaker.stop()
      this.reply(`Sorry, ${(err as Error).message || 'Ben did not answer'}`)
    }
  }

  private reply(text: string) {
    this.step({ type: 'reply', text })
    if (!text || !this.prefs().speak) return this.step({ type: 'done' })
    this.speaker.sayAll(text)
  }
}

function micProblem(err: unknown): string {
  const n = (err as DOMException)?.name
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'The microphone is blocked. Allow it for Life System (Windows: Settings → Privacy → Microphone).'
  if (n === 'NotFoundError') return 'No microphone found.'
  return `Voice could not start: ${(err as Error)?.message || String(err)}`
}
