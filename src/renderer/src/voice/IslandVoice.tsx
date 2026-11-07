// Voice on the desktop island (JV1–JV6): owns the voice engine in the island
// window. "Hey Ben", the hotkey or the 🎤 button start listening; the island
// peeks and shows the wave while you talk and while Ben answers. Commands run
// as island taps; the rest goes to Ben, who answers out loud. The mic closes
// entirely when voice is off, the PC is locked or idle, or the island is quiet,
// hidden, in a call or locked.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IslandAction, IslandPrefs, IslandSnapshot } from '@core/islandModel'
import { pauseReason, phaseLabel } from '@core/voiceFlow'
import { VoiceEngine, type VoiceView } from './voiceEngine'
import { useVoicePrefs, voicePrefs } from './voicePrefs'
import { VoiceWave } from './VoiceWave'
import './voice.css'

const desk = () => (window as any).desktop as Record<string, any> | undefined

export interface IslandVoiceProps {
  snap: IslandSnapshot
  chips: IslandPrefs['chips']
  /** The island's own tap (the same path as its buttons). */
  tap: (a: IslandAction) => void
  /** The pill peeks (the wake word was heard). */
  onWake: () => void
  quiet: boolean
  inCall: boolean
  hidden: boolean
  reduced: boolean
  /** The card appeared/changed size: the click area follows. */
  onLayout?: () => void
}

/** Is voice on (the hotkey and 🎤 go to it instead of a voice note)? */
export const islandVoiceOn = () => voicePrefs().on

export function IslandVoice(p: IslandVoiceProps) {
  const [prefs, setPrefs] = useVoicePrefs()
  const live = useRef(p)
  live.current = p
  const engine = useMemo(
    () =>
      new VoiceEngine(
        {
          context: () => ({ snap: live.current.snap, chips: live.current.chips, now: Date.now() }),
          run: (c) => {
            if (c.kind === 'action') live.current.tap(c.action)
            else if (c.kind === 'media') void desk()?.voiceMedia?.(c.key)
            else if (c.kind === 'quiet') desk()?.islandQuiet?.(c.minutes ?? 0)
          }
        },
        () => voicePrefs().wake
      ),
    []
  )
  const [view, setView] = useState<VoiceView>({ flow: engine.flow, kws: null, problem: null })
  useEffect(() => engine.subscribe(setView), [engine])
  useEffect(() => () => engine.destroy(), [engine])
  // On / off from Settings (any window).
  useEffect(() => {
    if (prefs.on) engine.enable()
    else engine.disable()
  }, [prefs.on, prefs.wake, engine])
  // The PC: locked, asleep, or nobody at it (from the desktop app).
  const [power, setPower] = useState<{ locked: boolean; idleSec: number }>({ locked: false, idleSec: 0 })
  useEffect(() => {
    desk()?.onVoicePower?.((s: { locked?: boolean; idleSec?: number }) => setPower({ locked: !!s?.locked, idleSec: Number(s?.idleSec) || 0 }))
  }, [])
  const why = pauseReason({ locked: power.locked, idleSec: power.idleSec, idleLimitMin: prefs.idleStopMin, quiet: p.quiet, inCall: p.inCall, hidden: p.hidden, appLocked: !!p.snap.locked })
  useEffect(() => engine.setPaused(why), [why, engine])
  // The hotkey (Settings → Desktop island → Talk to Ben) and the 🎤 button.
  useEffect(() => {
    const on = () => engine.ptt()
    // TV3: hold the 🎤 to talk: pressing starts, letting go after a moment sends (a quick tap still waits for you to stop talking).
    let downAt = 0
    const down = () => {
      downAt = Date.now()
      if (engine.flow.phase !== 'listening') engine.ptt()
      else downAt = -1
    }
    const up = () => {
      if (downAt === 0) return
      const held = downAt > 0 ? Date.now() - downAt : Infinity
      downAt = 0
      if (held > 450 && engine.flow.phase === 'listening') engine.ptt()
    }
    window.addEventListener('island-voice-ptt', on)
    window.addEventListener('island-voice-ptt-down', down)
    window.addEventListener('island-voice-ptt-up', up)
    return () => {
      window.removeEventListener('island-voice-ptt', on)
      window.removeEventListener('island-voice-ptt-down', down)
      window.removeEventListener('island-voice-ptt-up', up)
    }
  }, [engine])
  // Heard "Hey Ben": the island peeks.
  const phase = view.flow.phase
  const prev = useRef(phase)
  useEffect(() => {
    if (phase === 'listening' && prev.current !== 'listening') live.current.onWake()
    prev.current = phase
    live.current.onLayout?.()
  }, [phase])
  const level = useCallback(() => engine.level(), [engine])
  const show = phase === 'listening' || phase === 'thinking' || phase === 'speaking' || phase === 'followup'
  if (!prefs.on || !show) return null
  const words = phase === 'speaking' || (phase === 'followup' && view.flow.reply) ? view.flow.reply : view.flow.heard
  return (
    <div className={`di-voice is-${phase}`} data-hot role="status" aria-live="polite" onClick={() => (phase === 'speaking' ? engine.cancel() : engine.ptt())} title={phase === 'speaking' ? 'Tap: stop' : 'Tap: send now'}>
      <VoiceWave level={level} active={phase !== 'thinking'} reduced={p.reduced} />
      <span className="di-voice-text">
        <b>{phaseLabel(view.flow)}</b>
        {words && phase !== 'thinking' && <small>{words.replace(/<[^>]+>/g, '').slice(-140)}</small>}
        {view.problem && <small className="di-voice-err">{view.problem}</small>}
      </span>
      <button
        type="button"
        className="di-voice-mute"
        data-hot
        aria-pressed={!prefs.speak}
        title={prefs.speak ? "Mute Ben's voice (he answers in text)" : "Ben's voice is off: tap to hear him"}
        onClick={(e) => {
          e.stopPropagation()
          if (prefs.speak && phase === 'speaking') engine.cancel()
          setPrefs({ speak: !prefs.speak })
        }}
      >
        {prefs.speak ? '🔊' : '🔇'}
      </button>
    </div>
  )
}
