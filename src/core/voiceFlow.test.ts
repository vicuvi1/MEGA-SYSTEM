import { describe, expect, it } from 'vitest'
import { SoundGate, VOICE_OFF, VOICE_TIMING, micWanted, pauseReason, shouldUnload, voiceStep, waveLevel, type VoiceEvent, type VoiceFlow } from './voiceFlow'

const run = (events: [VoiceEvent, number][], from: VoiceFlow = VOICE_OFF) => events.reduce((f, [e, t]) => voiceStep(f, e, t), from)

describe('voice flow', () => {
  it('off by default; on: waits for the wake word', () => {
    expect(micWanted(VOICE_OFF, true)).toBe('off')
    const f = run([[{ type: 'enable' }, 0]])
    expect(f.phase).toBe('idle')
    expect(micWanted(f, true)).toBe('wake')
    expect(micWanted(f, false)).toBe('off')
  })
  it('wake → listening → thinking → speaking → follow-up → idle after 8 s', () => {
    let f = run([[{ type: 'enable' }, 0], [{ type: 'wake' }, 10], [{ type: 'speechStart' }, 500], [{ type: 'speechEnd' }, 2500]])
    expect(f.phase).toBe('thinking')
    expect(micWanted(f, true)).toBe('vad')
    f = run([[{ type: 'heard', text: 'start focus 25' }, 2900], [{ type: 'speakStart' }, 3000], [{ type: 'speakEnd' }, 5000]], f)
    expect(f.phase).toBe('followup')
    expect(f.heard).toBe('start focus 25')
    expect(voiceStep(f, { type: 'tick' }, 5000 + VOICE_TIMING.followupMs - 1).phase).toBe('followup')
    expect(voiceStep(f, { type: 'tick' }, 5000 + VOICE_TIMING.followupMs + 1).phase).toBe('idle')
  })
  it('a follow-up needs no wake word', () => {
    const f = run([[{ type: 'enable' }, 0], [{ type: 'wake' }, 1], [{ type: 'speechEnd' }, 2], [{ type: 'done' }, 3], [{ type: 'speechStart' }, 4]])
    expect(f).toMatchObject({ phase: 'listening', via: 'followup', talking: true })
  })
  it('barge-in: talking over Ben stops him and listens', () => {
    const f = run([[{ type: 'enable' }, 0], [{ type: 'ptt' }, 1], [{ type: 'speechEnd' }, 2], [{ type: 'speakStart' }, 3], [{ type: 'speechStart' }, 4]])
    expect(f).toMatchObject({ phase: 'listening', via: 'bargein' })
  })
  it('nothing said after the wake word: back to waiting', () => {
    const f = run([[{ type: 'enable' }, 0], [{ type: 'wake' }, 0]])
    expect(voiceStep(f, { type: 'tick' }, VOICE_TIMING.listenMs + 1).phase).toBe('idle')
  })
  it('push-to-talk pressed again sends what you said', () => {
    const f = run([[{ type: 'enable' }, 0], [{ type: 'ptt' }, 0], [{ type: 'speechStart' }, 100]])
    expect(voiceStep(f, { type: 'ptt' }, 900).phase).toBe('thinking')
    expect(voiceStep(run([[{ type: 'enable' }, 0], [{ type: 'ptt' }, 0]]), { type: 'ptt' }, 50).phase).toBe('idle')
  })
  it('paused (locked, a call…): the mic is off until resumed', () => {
    const f = run([[{ type: 'enable' }, 0], [{ type: 'wake' }, 1], [{ type: 'pause', why: 'PC locked' }, 2]])
    expect(f).toMatchObject({ phase: 'paused', why: 'PC locked' })
    expect(micWanted(f, true)).toBe('off')
    expect(voiceStep(f, { type: 'wake' }, 3).phase).toBe('paused')
    expect(voiceStep(f, { type: 'resume' }, 3).phase).toBe('idle')
    expect(voiceStep(f, { type: 'disable' }, 3).phase).toBe('off')
  })
})

describe('pause reasons and unloading', () => {
  it('names why the mic is off', () => {
    expect(pauseReason({})).toBeNull()
    expect(pauseReason({ locked: true })).toBe('PC locked')
    expect(pauseReason({ inCall: true, quiet: true })).toBe('in a call')
    expect(pauseReason({ idleSec: 600, idleLimitMin: 10 })).toBe('away for 10+ min')
    expect(pauseReason({ idleSec: 599, idleLimitMin: 10 })).toBeNull()
  })
  it('a model idle 2 minutes is unloaded, never while busy', () => {
    expect(shouldUnload(1000, 1000 + 120_000, false)).toBe(true)
    expect(shouldUnload(1000, 1000 + 119_000, false)).toBe(false)
    expect(shouldUnload(1000, 1000 + 999_000, true)).toBe(false)
    expect(shouldUnload(0, 999_999, false)).toBe(false)
  })
})

describe('levels', () => {
  it('the wave stays flat for room hiss and tops out at 1', () => {
    expect(waveLevel(0.003)).toBe(0)
    expect(waveLevel(0.05)).toBeGreaterThan(0.3)
    expect(waveLevel(1)).toBe(1)
  })
  it('the sound gate opens on a sound above the room and holds a moment', () => {
    const g = new SoundGate(3)
    for (let i = 0; i < 50; i++) expect(g.frame(0.002)).toBe(false)
    expect(g.frame(0.05)).toBe(true)
    expect(g.frame(0.002)).toBe(true)
    g.frame(0.002)
    g.frame(0.002)
    expect(g.frame(0.002)).toBe(false)
  })
})
