import { describe, expect, it } from 'vitest'
import { isNoiseTranscript } from './voiceNoise'

describe('isNoiseTranscript', () => {
  it('drops stock sign-offs that speech to text hears in silence', () => {
    expect(isNoiseTranscript('Thanks for your time today. Nice meeting you. Bye.')).toBe(true)
    expect(isNoiseTranscript('Thank you for watching!')).toBe(true)
    expect(isNoiseTranscript('Bye.')).toBe(true)
    expect(isNoiseTranscript('See you next time.')).toBe(true)
    expect(isNoiseTranscript('Please subscribe to my channel.')).toBe(true)
    expect(isNoiseTranscript('')).toBe(true)
  })
  it('keeps anything real, even with a sign-off in it', () => {
    expect(isNoiseTranscript('Start focus 25 minutes')).toBe(false)
    expect(isNoiseTranscript('Thanks, add 500 ml of water')).toBe(false)
    expect(isNoiseTranscript('Log 2 eggs. Bye.')).toBe(false)
    expect(isNoiseTranscript('What is my plan today?')).toBe(false)
  })
})
