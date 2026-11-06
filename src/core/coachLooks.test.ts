import { describe, expect, it } from 'vitest'
import { AVATAR_MAX_CHARS, benStatus, cleanLooks, doingNow, initials, okAvatar } from './coachLooks'

describe('coach looks', () => {
  it('keeps a known look and a small photo', () => {
    const me = 'data:image/jpeg;base64,AAAA'
    expect(cleanLooks({ ben: 'bot', me })).toEqual({ ben: 'bot', me })
  })
  it('falls back on anything odd', () => {
    expect(cleanLooks(null)).toEqual({ ben: 'orb', me: null })
    expect(cleanLooks({ ben: 'dragon', me: 'javascript:alert(1)' })).toEqual({ ben: 'orb', me: null })
    expect(cleanLooks({ me: 'data:image/svg+xml;base64,AAAA' }).me).toBeNull()
  })
  it('refuses a photo over the cap', () => {
    expect(okAvatar(`data:image/jpeg;base64,${'A'.repeat(AVATAR_MAX_CHARS)}`)).toBe(false)
  })
  it('makes initials', () => {
    expect(initials('Alex Doe')).toBe('AD')
    expect(initials('  sam ')).toBe('S')
    expect(initials('')).toBe('ME')
    expect(initials(null)).toBe('ME')
  })
  it('says what Ben is doing', () => {
    expect(benStatus({ busy: true, streaming: false, hour: 9 }).text).toBe('Thinking…')
    expect(benStatus({ busy: true, streaming: false, step: 'Reading your calendar', hour: 9 }).text).toBe('Reading your calendar…')
    expect(benStatus({ busy: true, streaming: true, hour: 9 })).toEqual({ text: 'Typing…', live: true })
    expect(benStatus({ busy: false, streaming: false, running: 'Study', hour: 9 }).text).toBe('Focusing with you · Study')
    expect(benStatus({ busy: false, streaming: false, hour: 19 }).text).toBe('Planning your evening')
    expect(benStatus({ busy: false, streaming: false, hour: 2 }).text).toBe('Up late with you')
  })
})

describe('doingNow', () => {
  it('says what Ben is doing now', () => {
    expect(doingNow('Read your calendar')).toBe('Checking your calendar')
    expect(doingNow('Looked up your history')).toBe('Looking up your history')
    expect(doingNow('Reading your day')).toBe('Reading your day')
    expect(doingNow(undefined)).toBe('Thinking')
  })
})
