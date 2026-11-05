// IN-SC: SoundCloud addresses and stations (made-up addresses).
import { describe, expect, it } from 'vitest'
import { addStation, cleanStations, parseSoundCloud, removeStation, renameStation, shouldPause, STATIONS_MAX, timeText, widgetSrc } from './soundcloud'

describe('a pasted SoundCloud address', () => {
  it('knows tracks, playlists, likes and profiles', () => {
    expect(parseSoundCloud('https://soundcloud.com/example-artist/calm-morning')).toMatchObject({ kind: 'track', url: 'https://soundcloud.com/example-artist/calm-morning' })
    expect(parseSoundCloud('soundcloud.com/example-artist/sets/focus-mix?si=abc&utm_source=x')).toMatchObject({ kind: 'playlist', url: 'https://soundcloud.com/example-artist/sets/focus-mix' })
    expect(parseSoundCloud('https://m.soundcloud.com/Example-Artist/likes')).toMatchObject({ kind: 'likes', url: 'https://soundcloud.com/example-artist/likes' })
    expect(parseSoundCloud('https://www.soundcloud.com/example-artist')).toMatchObject({ kind: 'profile' })
  })
  it('refuses everything else', () => {
    for (const bad of ['https://soundcloud.com.evil.example/a/b', 'https://example.com/a/b', 'javascript:alert(1)', 'https://soundcloud.com/', 'https://soundcloud.com/discover', 'https://soundcloud.com/a/followers', 'https://soundcloud.com/a/b/c/d', 'https://user@soundcloud.com/a', 'https://soundcloud.com:444/a', 'https://soundcloud.com/a/sets', 'https://soundcloud.com/a%2Fb/c']) {
      expect(parseSoundCloud(bad), bad).toBeNull()
    }
  })
  it('plays through the official embed player only', () => {
    const src = widgetSrc('https://soundcloud.com/example-artist/calm-morning')
    expect(src.startsWith('https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fexample-artist%2Fcalm-morning')).toBe(true)
    expect(src).toContain('auto_play=false')
  })
})

describe('stations', () => {
  it('adds with a name from the address, no doubles', () => {
    let r = addStation([], 'https://soundcloud.com/example-artist/sets/focus-mix')
    expect(r.station).toMatchObject({ id: 's0', name: 'Focus mix', kind: 'playlist' })
    r = addStation(r.list, 'https://soundcloud.com/example-artist/sets/focus-mix?x=1')
    expect(r.error).toMatch(/already/)
    r = addStation(r.list, 'https://soundcloud.com/lofi-example/likes', 'Lofi I like')
    expect(r.list.map((s) => s.name)).toEqual(['Focus mix', 'Lofi I like'])
    expect(addStation(r.list, 'https://example.com/x').error).toMatch(/not a SoundCloud/)
  })
  it('renames, removes and keeps at most 12', () => {
    let list = addStation([], 'https://soundcloud.com/example-artist').list
    list = renameStation(list, 's0', '  My artist ')
    expect(list[0].name).toBe('My artist')
    expect(removeStation(list, 's0')).toEqual([])
    const many = Array.from({ length: 20 }, (_, i) => ({ url: `https://soundcloud.com/artist-${i}` }))
    expect(cleanStations(many)).toHaveLength(STATIONS_MAX)
    expect(cleanStations([{ url: 'https://soundcloud.com/a' }, { url: 'https://soundcloud.com/a' }, { url: 'bad' }])).toHaveLength(1)
  })
  it('says the time and when to pause by itself', () => {
    expect(timeText(65_400)).toBe('1:05')
    expect(shouldPause({ playing: true, call: true, locked: false, focusStarted: false, pauseInFocus: false })).toBe('call')
    expect(shouldPause({ playing: true, call: false, locked: true, focusStarted: false, pauseInFocus: false })).toBe('locked')
    expect(shouldPause({ playing: true, call: false, locked: false, focusStarted: true, pauseInFocus: false })).toBeNull()
    expect(shouldPause({ playing: true, call: false, locked: false, focusStarted: true, pauseInFocus: true })).toBe('focus')
    expect(shouldPause({ playing: false, call: true, locked: true, focusStarted: true, pauseInFocus: true })).toBeNull()
  })
})
