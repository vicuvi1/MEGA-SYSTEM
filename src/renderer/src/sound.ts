// Cyberpunk & Solo Leveling Audio Synthesis Engine (Pure Web Audio API)
import { getUiPrefs } from './uiPrefs'

let ctx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!ctx || ctx.state === 'closed') {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    ctx = new AudioCtx()
  }
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
  return ctx
}

export function stopAllSounds(): void {
  if (ctx) {
    try {
      ctx.close().catch(() => {})
    } catch {}
    ctx = null
  }
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
    // Audio device unavailable or context closed
  }
}

/** Synthesize a shaped oscillator tone with safe non-zero attack and exponential decay. */
function synthTone(
  c: AudioContext,
  freq: number,
  start: number,
  dur: number,
  gain: number,
  type: OscillatorType = 'sine',
  master = 1
): void {
  try {
    const t = Math.max(c.currentTime, c.currentTime + start)
    const osc = c.createOscillator()
    const g = c.createGain()

    osc.type = type
    osc.frequency.setValueAtTime(freq, t)

    const peak = Math.max(0.0001, gain * master)
    // Never start from 0 in Web Audio before an exponential ramp (prevents RangeError / runaway tone)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(peak, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    g.gain.linearRampToValueAtTime(0, t + dur + 0.015)

    osc.connect(g)
    g.connect(c.destination)

    osc.start(t)
    osc.stop(t + dur + 0.03)

    osc.onended = () => {
      try {
        osc.disconnect()
        g.disconnect()
      } catch {}
    }
  } catch {
    // Gracefully handle timing / context race conditions
  }
}

/**
 * ⚔️ Solo Leveling "System Oracle" Holographic Ascending Chime.
 * Plays when the System Oracle opens, rank advances, or daily quests complete.
 */
export const soundSystemOracle = () =>
  play((c, master) => {
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
    try {
      const t = c.currentTime

      // 1. Damped bottom thud (180 Hz)
      const thudOsc = c.createOscillator()
      const thudGain = c.createGain()
      thudOsc.type = 'triangle'
      thudOsc.frequency.setValueAtTime(180, t)
      thudGain.gain.setValueAtTime(Math.max(0.0001, 0.04 * master), t)
      thudGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.025)
      thudGain.gain.linearRampToValueAtTime(0, t + 0.03)
      thudOsc.connect(thudGain)
      thudGain.connect(c.destination)
      thudOsc.start(t)
      thudOsc.stop(t + 0.035)
      thudOsc.onended = () => {
        try {
          thudOsc.disconnect()
          thudGain.disconnect()
        } catch {}
      }

      // 2. Micro noise burst transient for physical switch latching
      const bufferSize = Math.max(1, Math.floor(c.sampleRate * 0.008))
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
      noiseGain.gain.setValueAtTime(Math.max(0.0001, 0.06 * master), t)
      noiseGain.gain.linearRampToValueAtTime(0, t + 0.012)

      noise.connect(filter)
      filter.connect(noiseGain)
      noiseGain.connect(c.destination)

      noise.start(t)
      noise.stop(t + 0.015)
      noise.onended = () => {
        try {
          noise.disconnect()
          filter.disconnect()
          noiseGain.disconnect()
        } catch {}
      }
    } catch {}
  })

/**
 * 💰 Gold Coin Clink:
 * Realistic metallic coin bounce with inharmonic ringing frequencies.
 */
export const soundCoin = () =>
  play((c, master) => {
    synthTone(c, 2480, 0, 0.16, 0.09, 'sine', master)
    synthTone(c, 3250, 0, 0.18, 0.07, 'sine', master)
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

/**
 * 🔔 A new notification: a soft, warm two-note chime (like a message
 * arriving). It has its own switch (Settings → Notifications), so it plays
 * even when the other sound effects are off.
 */
export function soundNotify(): void {
  const prefs = getUiPrefs()
  const master = (typeof prefs.volume === 'number' ? Math.max(0, Math.min(100, prefs.volume)) : 80) / 100
  if (master <= 0) return
  try {
    const c = getAudioContext()
    synthTone(c, 880, 0, 0.32, 0.12, 'sine', master)
    synthTone(c, 1760, 0, 0.18, 0.025, 'sine', master)
    synthTone(c, 1174.66, 0.13, 0.5, 0.12, 'sine', master)
    synthTone(c, 2349.32, 0.13, 0.25, 0.022, 'sine', master)
  } catch {
    /* no audio device */
  }
}
