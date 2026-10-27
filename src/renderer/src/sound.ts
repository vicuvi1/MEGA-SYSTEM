// Cyberpunk & Solo Leveling Audio Synthesis Engine (Pure Web Audio API)
import { getUiPrefs } from './uiPrefs'

let ctx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!ctx) {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    ctx = new AudioCtx()
  }
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
  return ctx
}

function getMasterVolume(): number {
  const prefs = getUiPrefs()
  if (!prefs.sound) return 0
  const vol = typeof prefs.volume === 'number' ? Math.max(0, Math.min(100, prefs.volume)) : 80
  return vol / 100
}

function play(fn: (c: AudioContext, masterGain: number) => void): void {
  const master = getMasterVolume()
  if (master <= 0) return
  try {
    const audioCtx = getAudioContext()
    fn(audioCtx, master)
  } catch {
    // Audio device unavailable
  }
}

/** Synthesize a shaped oscillator tone with linear attack and exponential decay. */
function synthTone(
  c: AudioContext,
  freq: number,
  start: number,
  dur: number,
  gain: number,
  type: OscillatorType = 'sine',
  master = 1
): void {
  const t = c.currentTime + start
  const osc = c.createOscillator()
  const g = c.createGain()

  osc.type = type
  osc.frequency.setValueAtTime(freq, t)

  const peak = gain * master
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(peak, t + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)

  osc.connect(g).connect(c.destination)
  osc.start(t)
  osc.stop(t + dur + 0.03)
}

/**
 * ⚔️ Solo Leveling "System Oracle" Holographic Ascending Chime.
 * Plays when the System Oracle opens, rank advances, or daily quests complete.
 */
export const soundSystemOracle = () =>
  play((c, master) => {
    // 5-layer ascending crystal holographic chord (C6, E6, G6, B6, C7 shimmer)
    synthTone(c, 1046.5, 0, 0.22, 0.09, 'sine', master)
    synthTone(c, 1318.5, 0.06, 0.26, 0.09, 'sine', master)
    synthTone(c, 1567.98, 0.12, 0.3, 0.1, 'sine', master)
    synthTone(c, 1975.53, 0.18, 0.35, 0.08, 'triangle', master)
    synthTone(c, 2093.0, 0.24, 0.42, 0.07, 'sine', master)
  })

/**
 * ⌨️ Subtle Tactile Mechanical Switch Click.
 * Triggers on task check-offs, drag-drop releases, and high-frequency toggles.
 */
export const soundMechanicalClick = () =>
  play((c, master) => {
    const t = c.currentTime

    // 1. Damped bottom thud (180 Hz)
    const thudOsc = c.createOscillator()
    const thudGain = c.createGain()
    thudOsc.type = 'triangle'
    thudOsc.frequency.setValueAtTime(180, t)
    thudGain.gain.setValueAtTime(0.04 * master, t)
    thudGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.025)
    thudOsc.connect(thudGain).connect(c.destination)
    thudOsc.start(t)
    thudOsc.stop(t + 0.03)

    // 2. Micro noise burst transient for physical switch latching
    const bufferSize = Math.floor(c.sampleRate * 0.008)
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25))
    }

    const noise = c.createBufferSource()
    noise.buffer = buffer

    const filter = c.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(3400, t)
    filter.Q.setValueAtTime(3, t)

    const noiseGain = c.createGain()
    noiseGain.gain.setValueAtTime(0.06 * master, t)

    noise.connect(filter).connect(noiseGain).connect(c.destination)
    noise.start(t)
  })

/**
 * 💰 Gold Coin Clink:
 * Realistic metallic coin bounce with inharmonic ringing frequencies.
 */
export const soundCoin = () =>
  play((c, master) => {
    // Primary coin strike (dual inharmonic frequencies)
    synthTone(c, 2480, 0, 0.16, 0.09, 'sine', master)
    synthTone(c, 3250, 0, 0.18, 0.07, 'sine', master)

    // Secondary light rebound bounce
    synthTone(c, 2720, 0.05, 0.22, 0.07, 'sine', master)
    synthTone(c, 3480, 0.05, 0.24, 0.05, 'triangle', master)
  })

/**
 * 🛒 Purchase / Spending Deduct:
 * Smooth descending two-tone metallic resonance.
 */
export const soundSpend = () =>
  play((c, master) => {
    synthTone(c, 783.99, 0, 0.15, 0.07, 'triangle', master)
    synthTone(c, 523.25, 0.08, 0.25, 0.08, 'triangle', master)
  })

/**
 * ⚠️ System Conflict / Warning:
 * Soft digital double-pulse alert for schedule conflicts.
 */
export const soundWarning = () =>
  play((c, master) => {
    synthTone(c, 440, 0, 0.09, 0.07, 'sawtooth', master)
    synthTone(c, 370, 0.11, 0.12, 0.08, 'sawtooth', master)
  })

/**
 * 🏆 Solo Leveling Level-Up / Milestone Fanfare.
 */
export const soundFanfare = () =>
  play((c, master) => {
    synthTone(c, 523.25, 0, 0.12, 0.07, 'sine', master) // C5
    synthTone(c, 659.25, 0.08, 0.12, 0.07, 'sine', master) // E5
    synthTone(c, 783.99, 0.16, 0.16, 0.08, 'sine', master) // G5
    synthTone(c, 1046.5, 0.24, 0.22, 0.09, 'sine', master) // C6
    synthTone(c, 1318.51, 0.34, 0.38, 0.1, 'sine', master) // E6
  })

/**
 * ✨ Crisp Success Chime for ritual/task completions.
 */
export const soundSuccess = () =>
  play((c, master) => {
    synthTone(c, 880, 0, 0.1, 0.06, 'sine', master)
    synthTone(c, 1318.5, 0.07, 0.22, 0.07, 'sine', master)
  })

/**
 * 🔘 Short Tick for quick UI actions and palette opens.
 */
export const soundTick = () =>
  play((c, master) => {
    synthTone(c, 1800, 0, 0.035, 0.035, 'square', master)
  })
