// Small synthesized sounds (no audio files). Muted with Settings > Sounds.
import { getUiPrefs } from './uiPrefs'

let ctx: AudioContext | null = null

function tone(freq: number, start: number, dur: number, gain = 0.06, type: OscillatorType = 'sine'): void {
  if (!ctx) ctx = new AudioContext()
  const t = ctx.currentTime + start
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

function play(fn: () => void): void {
  if (!getUiPrefs().sound) return
  try {
    fn()
  } catch {
    // no audio device
  }
}

/** Two rising notes: coins came in. */
export const soundCoin = () => play(() => {
  tone(988, 0, 0.12)
  tone(1319, 0.07, 0.22)
})

/** Falling notes: coins went out (purchase or penalty). */
export const soundSpend = () => play(() => {
  tone(659, 0, 0.12, 0.05, 'triangle')
  tone(494, 0.08, 0.2, 0.05, 'triangle')
})

/** A short tick for opening things like the command palette. */
export const soundTick = () => play(() => tone(1760, 0, 0.05, 0.025, 'square'))
