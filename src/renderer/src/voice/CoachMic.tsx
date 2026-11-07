// JV7: voice on the Coach page (web, phone and desktop). 🎙 is push-to-talk:
// tap, talk, and what you said goes to Ben when you stop. It uses the
// browser's own speech recognition where there is one (free); otherwise, on a
// strong enough device with Voice on, the same on-device speech to text as the
// desktop; else it is hidden. 🔊 reads Ben's replies aloud (system voices).
// No wake word on the web.
import { useEffect, useMemo, useRef, useState } from 'react'
import { SentenceStream } from '@core/voiceText'
import { VoiceEngine } from './voiceEngine'
import { useVoicePrefs, voicePrefs } from './voicePrefs'
import { Speaker } from './voiceSpeak'
import './voice.css'

const Recognition = (): any => (typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null : null)
/** The desktop app's Chromium has the API but no service behind it. */
const isDesktop = () => typeof window !== 'undefined' && !!(window as any).desktop
/** Strong enough for on-device speech to text: 4+ cores and 4+ GB (when the browser tells). */
export function strongDevice(): boolean {
  const n = navigator.hardwareConcurrency || 2
  const mem = (navigator as any).deviceMemory as number | undefined
  return n >= 4 && (mem == null || mem >= 4) && typeof AudioWorkletNode !== 'undefined' && typeof Worker !== 'undefined'
}

export function CoachMic({ base, onText, onListening, disabled }: { base: string; onText: (text: string, final: boolean) => void; onListening: (on: boolean) => void; disabled?: boolean }) {
  const [p] = useVoicePrefs()
  const [on, setOn] = useState(false)
  const rec = useRef<any>(null)
  const web = !isDesktop() && !!Recognition()
  const local = !web && p.on && (isDesktop() || strongDevice())
  const engine = useMemo(() => (local ? new VoiceEngine({ onText: (t) => onTextRef.current(t, true) }, () => false) : null), [local])
  const onTextRef = useRef(onText)
  onTextRef.current = onText
  const onRef = useRef(on)
  onRef.current = on
  useEffect(() => {
    if (!engine) return
    engine.enable()
    const off = engine.subscribe((v) => {
      const listening = v.flow.phase === 'listening'
      setOn(listening)
      onListening(listening)
    })
    return () => (off(), engine.destroy())
  }, [engine]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => rec.current?.abort?.(), [])
  const start = () => {
    if (onRef.current) return
    if (engine) return engine.ptt()
    const R = Recognition()
    if (!R) return
    const r = new R()
    r.lang = navigator.language || 'en-US'
    r.interimResults = true
    r.continuous = false
    const first = base ? `${base.trim()} ` : ''
    let finalText = ''
    r.onresult = (e: any) => {
      const all = Array.from(e.results as ArrayLike<any>)
      finalText = all.map((x: any) => x[0].transcript).join('')
      onTextRef.current(first + finalText, false)
    }
    r.onend = () => {
      setOn(false)
      onListening(false)
      if (finalText.trim()) onTextRef.current(first + finalText, true)
    }
    r.onerror = () => (setOn(false), onListening(false))
    rec.current = r
    setOn(true)
    onListening(true)
    r.start()
  }
  const finish = () => {
    if (!onRef.current) return
    if (engine) return engine.ptt()
    rec.current?.stop()
  }
  const toggle = () => (onRef.current ? finish() : start())
  // TV3: push to talk. Hold Ctrl+Space anywhere on the page (or hold the button): talk, let go to send.
  const held = useRef<{ at: number; key: boolean; stop?: boolean } | null>(null)
  useEffect(() => {
    if (!web && !local) return
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !e.ctrlKey || e.repeat || disabled) return
      e.preventDefault()
      held.current = { at: Date.now(), key: true }
      start()
    }
    const up = (e: KeyboardEvent) => {
      if (!held.current?.key || (e.code !== 'Space' && e.key !== 'Control')) return
      held.current = null
      finish()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => (window.removeEventListener('keydown', down), window.removeEventListener('keyup', up))
  }) // eslint-disable-line react-hooks/exhaustive-deps
  if (!web && !local) return null
  return (
    <button
      type="button"
      className={`cx-tool ${on ? 'rec' : ''}`}
      disabled={disabled}
      aria-label={on ? 'Stop and send' : 'Talk to Ben'}
      title={on ? 'Listening… let go (or tap) to send' : 'Talk to Ben: hold to talk (or Ctrl+Space), or tap, speak, and it sends when you stop'}
      onPointerDown={() => {
        // Listening already: this tap stops and sends. Else start, and see how long it's held.
        held.current = { at: Date.now(), key: false, stop: onRef.current }
        if (!onRef.current) start()
      }}
      onPointerUp={() => {
        const h = held.current
        held.current = null
        // Held for a moment: letting go sends. A quick tap keeps listening until you stop talking (or tap again).
        if (h && (h.stop || Date.now() - h.at > 450)) finish()
      }}
      onPointerLeave={() => held.current && !held.current.stop && Date.now() - held.current.at > 450 && ((held.current = null), finish())}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle())}
    >
      {on ? (
        <span className="cf-wave" aria-hidden>
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      ) : (
        '🎙'
      )}
    </button>
  )
}

/** TV3: Ben's voice on / off (a reply to something you said by voice is read aloud unless he's muted). */
export function BenMute() {
  const [p, setP] = useVoicePrefs()
  if (typeof speechSynthesis === 'undefined' && !p.on) return null
  return (
    <button type="button" className={`cx-tool cf-mute ${p.muted ? '' : 'voice-on'}`} onClick={() => (!p.muted && stopReading(), setP({ muted: !p.muted, ...(p.muted ? {} : { readAloud: false }) }))} aria-pressed={!p.muted} aria-label={p.muted ? "Ben's voice is off" : "Ben's voice is on"} title={p.muted ? "Ben's voice is off: tap to hear him again" : 'Ben answers out loud when you talk to him: tap to mute'}>
      {p.muted ? '🔇' : '🔊'}
    </button>
  )
}

/** 🔊: Ben's replies read aloud (a switch saved on this device). */
export function ReadAloudToggle() {
  const [p, setP] = useVoicePrefs()
  if (typeof speechSynthesis === 'undefined' && !p.on) return null
  return (
    <button type="button" className={`cx-tool ${p.readAloud ? 'voice-on' : ''}`} onClick={() => (p.readAloud && stopReading(), setP({ readAloud: !p.readAloud }))} aria-pressed={p.readAloud} title={p.readAloud ? 'Reading Ben aloud: tap to stop' : "Read Ben's replies aloud"}>
      {p.readAloud ? '🔊' : '🔈'}
    </button>
  )
}

/** The same switch as a line in the Coach page's ⋯ menu. */
export function ReadAloudMenuItem() {
  const [p, setP] = useVoicePrefs()
  if (typeof speechSynthesis === 'undefined' && !p.on) return null
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={p.readAloud} onClick={() => (p.readAloud && stopReading(), setP({ readAloud: !p.readAloud }))}>
      {p.readAloud ? '✓ ' : ''}Read Ben's replies aloud
    </button>
  )
}

let speaker: Speaker | null = null
let stream: SentenceStream | null = null
/** The Coach page reads Ben's reply aloud as it streams (when 🔊 is on). */
export const readAloud = {
  /** `voice`: you said it by voice, so Ben answers out loud too (unless he's muted). */
  start(voice = false): void {
    const v = voicePrefs()
    if (v.muted || (!v.readAloud && !voice)) {
      stream = null
      return
    }
    // On the web the light voice is used unless Voice (with Kokoro) is on.
    speaker ??= new Speaker(() => {
      const v = voicePrefs()
      return v.on ? v : { ...v, tts: 'system' }
    })
    speaker.begin()
    stream = new SentenceStream()
  },
  feed(soFar: string): void {
    if (!speaker || !stream) return
    for (const s of stream.push(soFar)) speaker.say(s)
  },
  end(reply: string): void {
    if (!speaker || !stream) return
    for (const s of stream.end(reply)) speaker.say(s)
    speaker.end()
    stream = null
  }
}
export function stopReading(): void {
  speaker?.stop()
  stream = null
}
