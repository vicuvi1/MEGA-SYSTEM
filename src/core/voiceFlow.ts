// Voice, the flow (pure, tested): one small state machine for the whole
// conversation. Off → waiting for "Hey Ben" → listening → thinking → Ben
// speaking → 8 s for a follow-up → back to waiting. It also says what the
// microphone should run in each state (nothing, only the tiny wake word, or the
// speech detector), when the mic must stop (voice off, PC locked or idle,
// island quiet/hidden, a call), and when a big model may be unloaded.

export type VoicePhase = 'off' | 'paused' | 'idle' | 'listening' | 'thinking' | 'speaking' | 'followup'
export type VoiceVia = 'wake' | 'ptt' | 'followup' | 'bargein'

export interface VoiceFlow {
  phase: VoicePhase
  since: number
  via?: VoiceVia
  /** Listening: you started talking (the speech detector heard you). */
  talking?: boolean
  /** What you said (the last line). */
  heard?: string
  /** What Ben (or the island) is saying. */
  reply?: string
  /** Why it is paused, or the last problem. */
  why?: string
}

export type VoiceEvent =
  | { type: 'enable' }
  | { type: 'disable' }
  | { type: 'pause'; why: string }
  | { type: 'resume' }
  | { type: 'wake' }
  | { type: 'ptt' }
  | { type: 'speechStart' }
  | { type: 'speechEnd' }
  | { type: 'heard'; text: string }
  | { type: 'nothing' }
  | { type: 'reply'; text: string }
  | { type: 'speakStart' }
  | { type: 'speakEnd' }
  | { type: 'done' }
  | { type: 'tick' }
  | { type: 'cancel' }
  | { type: 'error'; why: string }

export const VOICE_TIMING = {
  /** After Ben finishes: this long to answer back without "Hey Ben". */
  followupMs: 8000,
  /** After the wake word or the hotkey: this long to start talking. */
  listenMs: 7000,
  /** One thing said can't run longer than this (a TV in the background). */
  maxTalkMs: 20_000,
  /** A model not used this long is unloaded (memory back). */
  unloadMs: 120_000
}

export const VOICE_OFF: VoiceFlow = { phase: 'off', since: 0 }

export function voiceStep(f: VoiceFlow, e: VoiceEvent, now: number, timing = VOICE_TIMING): VoiceFlow {
  const to = (phase: VoicePhase, x: Partial<VoiceFlow> = {}): VoiceFlow => ({ phase, since: now, ...x })
  if (e.type === 'disable') return to('off')
  if (f.phase === 'off') return e.type === 'enable' ? to('idle') : f
  if (e.type === 'enable') return f
  if (e.type === 'pause') return f.phase === 'paused' && f.why === e.why ? f : to('paused', { why: e.why })
  if (f.phase === 'paused') return e.type === 'resume' ? to('idle') : f
  if (e.type === 'resume') return f
  if (e.type === 'cancel') return to('idle')
  if (e.type === 'error') return to('idle', { why: e.why })
  switch (f.phase) {
    case 'idle':
      if (e.type === 'wake' || e.type === 'ptt') return to('listening', { via: e.type })
      return f
    case 'listening':
      if (e.type === 'speechStart') return { ...f, talking: true, since: f.talking ? f.since : now }
      if (e.type === 'speechEnd') return to('thinking', { via: f.via })
      // Pressed again (push-to-talk): what you said so far is sent.
      if (e.type === 'ptt') return f.talking ? to('thinking', { via: f.via }) : to('idle')
      if (e.type === 'tick') {
        if (!f.talking && now - f.since > timing.listenMs) return to('idle')
        if (f.talking && now - f.since > timing.maxTalkMs) return to('thinking', { via: f.via })
      }
      return f
    case 'thinking':
      if (e.type === 'heard') return { ...f, heard: e.text }
      if (e.type === 'nothing') return to('idle', { heard: f.heard })
      if (e.type === 'reply') return { ...f, reply: e.text }
      if (e.type === 'speakStart') return to('speaking', { heard: f.heard, reply: f.reply })
      if (e.type === 'done') return to('followup', { heard: f.heard, reply: f.reply })
      // A stuck answer never keeps the mic open forever.
      if (e.type === 'tick' && now - f.since > 120_000) return to('idle')
      return f
    case 'speaking':
      if (e.type === 'reply') return { ...f, reply: e.text }
      if (e.type === 'speakEnd') return to('followup', { heard: f.heard, reply: f.reply })
      // JV4: you talk over Ben: he stops at once and listens.
      if (e.type === 'speechStart') return to('listening', { via: 'bargein', talking: true })
      if (e.type === 'ptt') return to('listening', { via: 'ptt' })
      return f
    case 'followup':
      if (e.type === 'speechStart') return to('listening', { via: 'followup', talking: true })
      if (e.type === 'wake' || e.type === 'ptt') return to('listening', { via: e.type })
      if (e.type === 'tick' && now - f.since > timing.followupMs) return to('idle')
      return f
  }
  return f
}

/** What the microphone runs: nothing (mic closed), only the wake word, or the speech detector. */
export function micWanted(f: VoiceFlow, wakeWord: boolean): 'off' | 'wake' | 'vad' {
  if (f.phase === 'off' || f.phase === 'paused') return 'off'
  if (f.phase === 'idle') return wakeWord ? 'wake' : 'off'
  return 'vad'
}

/** Why the mic must stop now (null: it may listen). */
export function pauseReason(o: { locked?: boolean; idleSec?: number; idleLimitMin?: number; quiet?: boolean; inCall?: boolean; hidden?: boolean; appLocked?: boolean }): string | null {
  if (o.locked) return 'PC locked'
  if (o.appLocked) return 'Life System is locked'
  if (o.inCall) return 'in a call'
  if (o.quiet) return 'island is quiet'
  if (o.hidden) return 'island is hidden'
  if (o.idleLimitMin && (o.idleSec ?? 0) >= o.idleLimitMin * 60) return `away for ${o.idleLimitMin}+ min`
  return null
}

/** A big model (speech to text, Ben's voice) not used for a while goes, so its memory comes back. */
export function shouldUnload(lastUse: number, now: number, busy: boolean, timing = VOICE_TIMING): boolean {
  return !busy && lastUse > 0 && now - lastUse >= timing.unloadMs
}

/** The island's words for each state. */
export function phaseLabel(f: VoiceFlow): string {
  switch (f.phase) {
    case 'off':
      return 'Voice is off'
    case 'paused':
      return `Mic off: ${f.why ?? 'paused'}`
    case 'idle':
      return 'Say "Hey Ben"'
    case 'listening':
      return f.talking ? 'Listening…' : f.via === 'bargein' ? 'Go on…' : "I'm listening"
    case 'thinking':
      return f.heard ? `“${f.heard.slice(0, 60)}”` : 'Got it…'
    case 'speaking':
      return 'Ben'
    case 'followup':
      return 'Anything else?'
  }
}

/** A short sound cue's level (0..1) from audio samples: the wave on the island follows it. */
export function rms(x: Float32Array): number {
  if (!x.length) return 0
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i] * x[i]
  return Math.sqrt(s / x.length)
}

/** Mic level (RMS) to a 0..1 wave height, with a soft floor so room hiss stays flat. */
export function waveLevel(r: number, floor = 0.006): number {
  if (r <= floor) return 0
  return Math.min(1, Math.log10(1 + ((r - floor) / 0.08) * 9))
}

/**
 * The wake word is only fed when there is sound: a quiet room costs nothing.
 * Tracks the room's noise floor and says whether this frame is louder than it.
 */
export class SoundGate {
  floor = 0.004
  private open = 0
  constructor(private holdFrames = 30) {}
  /** True while this frame (or one in the last ~1 s) is clearly above the room's noise. */
  frame(level: number): boolean {
    // The floor follows quiet frames fast and loud ones very slowly.
    this.floor = level < this.floor ? this.floor * 0.9 + level * 0.1 : this.floor * 0.999 + level * 0.001
    this.floor = Math.max(0.0008, Math.min(0.05, this.floor))
    if (level > this.floor * 2.2 && level > 0.004) this.open = this.holdFrames
    else if (this.open > 0) this.open--
    return this.open > 0
  }
}
