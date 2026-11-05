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
  if (!web && !local) return null
  const toggle = () => {
    if (engine) return engine.ptt()
    if (on) return rec.current?.stop()
    const R = Recognition()
    const r = new R()
    r.lang = navigator.language || 'en-US'
    r.interimResults = true
    r.continuous = false
    const start = base ? `${base.trim()} ` : ''
    let finalText = ''
    r.onresult = (e: any) => {
      const all = Array.from(e.results as ArrayLike<any>)
      finalText = all.map((x: any) => x[0].transcript).join('')
      onText(start + finalText, false)
    }
    r.onend = () => {
      setOn(false)
      onListening(false)
      if (finalText.trim()) onText(start + finalText, true)
    }
    r.onerror = () => (setOn(false), onListening(false))
    rec.current = r
    setOn(true)
    onListening(true)
    r.start()
  }
  return (
    <button type="button" className={`cx-tool ${on ? 'rec' : ''}`} onClick={toggle} disabled={disabled} aria-label={on ? 'Stop and send' : 'Talk to Ben'} title={on ? 'Listening… tap to send' : 'Talk to Ben (tap, speak, it sends when you stop)'}>
      🎙
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

let speaker: Speaker | null = null
let stream: SentenceStream | null = null
/** The Coach page reads Ben's reply aloud as it streams (when 🔊 is on). */
export const readAloud = {
  start(): void {
    if (!voicePrefs().readAloud) {
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
