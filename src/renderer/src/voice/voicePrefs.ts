// Voice settings, kept on this device (localStorage): the desktop island and
// the app window share them (same origin), and follow each other's changes.
// Voice is OFF until you turn it on in Settings → Voice.
import { useEffect, useState } from 'react'
import type { SttModelId, TtsEngine } from '@core/voiceModels'

export interface VoicePrefs {
  /** The main switch (desktop: the mic, wake word and Ben's voice). */
  on: boolean
  /** Listen for "Hey Ben" (else only the hotkey and the mic button). */
  wake: boolean
  /** Wake word sensitivity, 0.1 (strict) … 0.5 (eager). */
  wakeThreshold: number
  stt: SttModelId
  /** For Whisper: '' = find out by itself. */
  lang: string
  tts: TtsEngine
  /** Windows / system voice name ('' = the default one). */
  systemVoice: string
  kokoroVoice: string
  speed: number
  /** Ben reads his replies aloud (the island; the Coach page has its own switch). */
  speak: boolean
  /** Coach page: read Ben's replies aloud. */
  readAloud: boolean
  /** The mic stops after this many minutes without mouse/keys (0: never). */
  idleStopMin: number
}

export const DEFAULT_VOICE: VoicePrefs = {
  on: false,
  wake: true,
  wakeThreshold: 0.25,
  stt: 'moonshine-tiny',
  lang: '',
  tts: 'system',
  systemVoice: '',
  kokoroVoice: 'am_michael',
  speed: 1,
  speak: true,
  readAloud: false,
  idleStopMin: 10
}

const KEY = 'ls.voice'
const listeners = new Set<(p: VoicePrefs) => void>()

function load(): VoicePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    const p = { ...DEFAULT_VOICE, ...(raw && typeof raw === 'object' ? raw : {}) } as VoicePrefs
    p.speed = Math.min(1.6, Math.max(0.7, Number(p.speed) || 1))
    p.wakeThreshold = Math.min(0.5, Math.max(0.1, Number(p.wakeThreshold) || 0.25))
    p.idleStopMin = Math.max(0, Math.min(120, Number(p.idleStopMin) || 0))
    return p
  } catch {
    return DEFAULT_VOICE
  }
}

let current = load()

export const voicePrefs = (): VoicePrefs => current

export function setVoicePrefs(p: Partial<VoicePrefs>): void {
  current = { ...current, ...p }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* private window: lasts until restart */
  }
  listeners.forEach((l) => l(current))
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    current = load()
    listeners.forEach((l) => l(current))
  })
}

export function onVoicePrefs(cb: (p: VoicePrefs) => void): () => void {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

export function useVoicePrefs(): [VoicePrefs, (p: Partial<VoicePrefs>) => void] {
  const [p, setP] = useState(current)
  useEffect(() => onVoicePrefs(setP), [])
  return [p, setVoicePrefs]
}
