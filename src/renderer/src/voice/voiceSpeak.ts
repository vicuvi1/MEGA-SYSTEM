// Ben talks back (JV3): sentence by sentence as his reply arrives, so he
// starts after the first one. The light voice is the system's own
// (speechSynthesis: Windows voices, no download); Kokoro is the natural one
// (downloaded once, runs in the voice worker). stop() is instant (barge-in).
import { speakable } from '@core/voiceText'
import { cancelSynth, synth } from './voiceAi'
import { voiceAudio } from '../soundKit'
import type { VoicePrefs } from './voicePrefs'
import { speakMs } from '@core/voicebox'

/** TV3: the desktop's Voicebox bridge, when this is the desktop app. */
const voicebox = (): ((op: string, arg?: unknown) => Promise<{ ok: boolean; profiles?: string[] } | null>) | null => (typeof window !== 'undefined' && typeof (window as any).desktop?.voicebox === 'function' ? (window as any).desktop.voicebox : null)
/** Voicebox didn't answer once: this session uses the normal voice. */
let voiceboxDown = false
export async function probeVoicebox(): Promise<{ ok: boolean; profiles: string[] }> {
  const vb = voicebox()
  if (!vb) return { ok: false, profiles: [] }
  const r = await vb('probe').catch(() => null)
  if (r?.ok) voiceboxDown = false
  return { ok: !!r?.ok, profiles: r?.profiles ?? [] }
}

export function systemVoices(): SpeechSynthesisVoice[] {
  try {
    return typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : []
  } catch {
    return []
  }
}

/** The system voice to use: yours, else an English one (Windows' natural ones first). */
function pickVoice(name: string): SpeechSynthesisVoice | null {
  const all = systemVoices()
  return all.find((v) => v.name === name) ?? all.find((v) => /natural/i.test(v.name) && /^en/i.test(v.lang)) ?? all.find((v) => /^en/i.test(v.lang)) ?? all[0] ?? null
}

export class Speaker {
  private queue: string[] = []
  private ended = true
  private playing = false
  private gen = 0
  private sources: AudioBufferSourceNode[] = []
  private analyser: AnalyserNode | null = null
  private audio: ReturnType<typeof voiceAudio> = null
  private buf = new Float32Array(256)
  private pulse = 0
  /** TV3: a reply for Voicebox, said in one go at the end. */
  private vbText: string[] = []
  /** Kokoro: sentences already being made, in order. */
  private making: Promise<{ pcm: Float32Array; sr: number } | null>[] = []
  onStart: () => void = () => {}
  onEnd: () => void = () => {}
  onError: (why: string) => void = () => {}

  constructor(private prefs: () => VoicePrefs) {}

  get busy(): boolean {
    return this.playing || this.queue.length > 0 || this.making.length > 0 || !this.ended
  }

  /** A new reply starts (what was still queued goes). */
  begin(): void {
    this.stop()
    this.ended = false
  }
  /** One more sentence to say. */
  say(sentence: string): void {
    const t = speakable(sentence)
    if (!t) return
    if (this.prefs().voicebox && voicebox() && !voiceboxDown) {
      this.vbText.push(t)
      return
    }
    if (this.ended && !this.busy) this.ended = false
    if (this.prefs().tts === 'kokoro') {
      const p = this.prefs()
      this.making.push(synth(t, p.kokoroVoice, p.speed).catch((e) => (this.onError(`Kokoro: ${(e as Error).message}`), null)))
    } else this.queue.push(t)
    void this.pump()
  }
  /** No more sentences in this reply. */
  end(): void {
    if (this.vbText.length) return void this.voiceboxSay(this.vbText.splice(0).join(' '))
    this.ended = true
    if (!this.busy) this.onEnd()
  }
  /** Voicebox speaks the reply itself; if it doesn't answer, the normal voice does (no message). */
  private async voiceboxSay(text: string): Promise<void> {
    const gen = this.gen
    this.playing = true
    this.onStart()
    const r = await voicebox()!('speak', { text, profile: this.prefs().voiceboxProfile }).catch(() => null)
    if (gen !== this.gen) return
    if (!r?.ok) {
      voiceboxDown = true
      this.playing = false
      for (const s of text.split(/(?<=[.!?])\s+/)) this.say(s)
      this.ended = true
      if (!this.busy) this.onEnd()
      return
    }
    // Voicebox plays it: Ben "speaks" for about as long as the words take.
    await new Promise((ok) => setTimeout(ok, speakMs(text)))
    if (gen !== this.gen) return
    this.playing = false
    this.ended = true
    this.onEnd()
  }
  /** Say one short thing (a reply in full). */
  sayAll(text: string): void {
    this.begin()
    for (const s of text.split(/(?<=[.!?])\s+/)) this.say(s)
    this.end()
  }

  /** Quiet now. */
  stop(): void {
    this.gen++
    this.vbText = []
    this.queue = []
    this.making = []
    cancelSynth()
    try {
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    } catch {
      /* none */
    }
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        /* already done */
      }
    }
    this.sources = []
    const wasPlaying = this.playing
    this.playing = false
    this.ended = true
    this.audio?.release()
    this.audio = null
    this.analyser = null
    if (wasPlaying) this.onEnd()
  }

  /** How loud Ben is now, 0..1 (the island's wave). */
  level(): number {
    if (this.analyser) {
      this.analyser.getFloatTimeDomainData(this.buf)
      let s = 0
      for (const x of this.buf) s += x * x
      return Math.min(1, Math.sqrt(s / this.buf.length) * 5)
    }
    // System voices give no audio to measure: a soft pulse per word.
    this.pulse *= 0.86
    return this.playing ? Math.max(0.15, this.pulse) : 0
  }

  private async pump(): Promise<void> {
    if (this.playing) return
    const gen = this.gen
    if (this.making.length) {
      this.playing = true
      this.onStart()
      while (this.making.length && gen === this.gen) {
        const r = await this.making[0]
        if (gen !== this.gen) return
        this.making.shift()
        if (r?.pcm.length) await this.playPcm(r.pcm, r.sr, gen)
      }
      if (gen !== this.gen) return
      this.playing = false
      this.audio?.release()
      this.audio = null
      this.analyser = null
      if (this.ended && !this.busy) this.onEnd()
      return
    }
    const next = this.queue.shift()
    if (next == null) return
    this.playing = true
    this.onStart()
    await new Promise<void>((resolve) => {
      try {
        const u = new SpeechSynthesisUtterance(next)
        const v = pickVoice(this.prefs().systemVoice)
        if (v) u.voice = v
        u.lang = v?.lang ?? 'en-US'
        u.rate = this.prefs().speed
        u.onboundary = () => (this.pulse = 0.7 + Math.random() * 0.3)
        u.onend = () => resolve()
        u.onerror = () => resolve()
        speechSynthesis.speak(u)
      } catch {
        resolve()
      }
    })
    if (gen !== this.gen) return
    this.playing = false
    if (this.queue.length) return this.pump()
    if (this.ended) this.onEnd()
  }

  private playPcm(pcm: Float32Array, sr: number, gen: number): Promise<void> {
    this.audio ??= voiceAudio()
    const a = this.audio
    if (!a) return Promise.resolve()
    const b = a.ctx.createBuffer(1, pcm.length, sr)
    b.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0)
    const src = a.ctx.createBufferSource()
    src.buffer = b
    if (!this.analyser) {
      this.analyser = a.ctx.createAnalyser()
      this.analyser.fftSize = 256
      this.analyser.connect(a.out)
    }
    src.connect(this.analyser)
    this.sources.push(src)
    return new Promise((resolve) => {
      src.onended = () => {
        this.sources = this.sources.filter((x) => x !== src)
        resolve()
      }
      if (gen !== this.gen) return resolve()
      src.start()
    })
  }
}
