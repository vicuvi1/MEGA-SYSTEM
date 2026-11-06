import { describe, expect, it } from 'vitest'
import {
  artFrom, cleanMixTiles, cleanScUser, cleanScWebState, cleanSetsCache, cleanUserSets, cleanZoom, likeResult, mapNowPlaying, mixUrl, NO_NOW, parseClock, parseScUser,
  SCWEB_OFF, scWebPollMs, scWebRoute, setsStale, setStation, userSetsUrl, userStations, viewBounds, SETS_REFRESH_MS
} from './scAccount'
import { cleanMusicKit, DEFAULT_MUSIC } from './music'

// Made-up names only (none of these profiles is real).
describe('connect by username', () => {
  it('reads a name, @name or any link on the profile', () => {
    expect(parseScUser('example-listener')).toBe('example-listener')
    expect(parseScUser('  @Example_Listener ')).toBe('example_listener')
    expect(parseScUser('soundcloud.com/example-listener')).toBe('example-listener')
    expect(parseScUser('https://soundcloud.com/example-listener/likes?ref=x')).toBe('example-listener')
    expect(parseScUser('https://m.soundcloud.com/example-listener/sets/road-trip')).toBe('example-listener')
  })
  it('refuses other sites, SoundCloud pages and junk', () => {
    for (const bad of ['', '   ', 'https://example.com/example-listener', 'discover', 'https://soundcloud.com/discover', 'https://soundcloud.com/', 'two words', 'javascript:alert(1)', 'https://user:pw@soundcloud.com/x', 'https://soundcloud.com:8080/x', null, {}])
      expect(parseScUser(bad)).toBeNull()
  })
  it('the synced setting keeps only a clean public name', () => {
    expect(cleanScUser('https://soundcloud.com/Example-Listener')).toBe('example-listener')
    expect(cleanScUser('<script>')).toBe('')
    expect(cleanScUser(7)).toBe('')
    expect(DEFAULT_MUSIC.scUser).toBe('')
    expect(cleanMusicKit({ scUser: '@example-listener' }).scUser).toBe('example-listener')
    expect(cleanMusicKit({ pin: 'scweb' }).pin).toBe('scweb')
  })
  it('turns the name into Likes and tracks stations, and a sets address', () => {
    const st = userStations('example-listener')
    expect(st.map((s) => [s.kind, s.url])).toEqual([
      ['likes', 'https://soundcloud.com/example-listener/likes'],
      ['profile', 'https://soundcloud.com/example-listener']
    ])
    expect(userStations('discover')).toEqual([])
    expect(userSetsUrl('example-listener')).toBe('https://soundcloud.com/example-listener/sets')
    expect(userSetsUrl('')).toBeNull()
  })
  it('keeps only real playlists from what the player returns', () => {
    const sets = cleanUserSets([
      { permalink_url: 'https://soundcloud.com/example-listener/sets/road-trip', title: 'Road trip', artwork_url: 'https://i1.sndcdn.com/artworks-abc-large.jpg' },
      { permalink_url: 'https://soundcloud.com/example-listener/sets/road-trip', title: 'Again' },
      { permalink_url: 'https://soundcloud.com/example-listener/some-track', title: 'A track' },
      { permalink_url: 'https://evil.example/sets/x', title: 'Bad' },
      { permalink_url: 'https://soundcloud.com/example-listener/sets/night-drive', artwork_url: 'https://evil.example/a.jpg' },
      null
    ])
    expect(sets).toEqual([
      { url: 'https://soundcloud.com/example-listener/sets/road-trip', name: 'Road trip', art: 'https://i1.sndcdn.com/artworks-abc-large.jpg' },
      { url: 'https://soundcloud.com/example-listener/sets/night-drive', name: 'night drive', art: '' }
    ])
    expect(setStation(sets[0], 0)).toEqual({ id: 'syset0', name: 'Road trip', url: sets[0].url, kind: 'playlist' })
    expect(cleanUserSets('nope')).toEqual([])
  })
  it('asks for the playlists again once a day, or for another name', () => {
    const c = cleanSetsCache({ user: 'example-listener', at: 1000, sets: [] })
    expect(c).toEqual({ user: 'example-listener', at: 1000, sets: [] })
    expect(setsStale(c, 'example-listener', 2000)).toBe(false)
    expect(setsStale(c, 'example-listener', 1000 + SETS_REFRESH_MS + 1)).toBe(true)
    expect(setsStale(c, 'someone-else', 2000)).toBe(true)
    expect(setsStale(null, 'example-listener', 2000)).toBe(true)
    expect(cleanSetsCache({ user: '' })).toBeNull()
  })
})

describe('signed in: where the view may go', () => {
  it('keeps SoundCloud and its CDNs inside, sign-in windows apart, the rest outside', () => {
    expect(scWebRoute('https://soundcloud.com/discover')).toBe('in')
    expect(scWebRoute('https://secure.soundcloud.com/signin')).toBe('in')
    expect(scWebRoute('https://i1.sndcdn.com/a.jpg')).toBe('in')
    expect(scWebRoute('https://accounts.google.com/o/oauth2')).toBe('signin')
    expect(scWebRoute('https://www.example.com/')).toBe('out')
    expect(scWebRoute('http://soundcloud.com/')).toBe('out')
    expect(scWebRoute('https://soundcloud.com.evil.example/')).toBe('out')
    expect(scWebRoute('https://evilsoundcloud.com/')).toBe('out')
    expect(scWebRoute('https://soundcloud.com:444/')).toBe('out')
    expect(scWebRoute('https://x:y@soundcloud.com/')).toBe('block')
    expect(scWebRoute('file:///etc/passwd')).toBe('block')
    expect(scWebRoute('javascript:alert(1)')).toBe('block')
    expect(scWebRoute('not a url')).toBe('block')
  })
  it('reads often only while it plays or shows', () => {
    expect(scWebPollMs({ playing: true, visible: false })).toBe(1000)
    expect(scWebPollMs({ playing: false, visible: true })).toBe(1000)
    expect(scWebPollMs({ playing: false, visible: false })).toBe(5000)
  })
  it('zoom and bounds stay sensible', () => {
    expect(cleanZoom('x')).toBe(1)
    expect(cleanZoom(3)).toBe(1.5)
    expect(cleanZoom(0.72)).toBe(0.7)
    expect(viewBounds({ x: 10.4, y: 80, width: 900, height: 600 })).toEqual({ x: 10, y: 80, width: 900, height: 600 })
    expect(viewBounds({ x: 0, y: 0, width: 20, height: 600 })).toBeNull()
    expect(viewBounds({ x: -5, y: 0, width: 500, height: 600 })).toBeNull()
    expect(viewBounds(null)).toBeNull()
  })
})

describe('signed in: now playing', () => {
  it('maps the media session and the player bar', () => {
    const n = mapNowPlaying({
      md: { title: 'Made-up song', artist: 'Example Artist', artwork: [{ src: 'https://i1.sndcdn.com/artworks-x-t120x120.jpg', sizes: '120x120' }, { src: 'https://i1.sndcdn.com/artworks-x-t500x500.jpg', sizes: '500x500' }, { src: 'https://evil.example/big.jpg', sizes: '2000x2000' }] },
      state: 'playing',
      now: 65,
      max: 210,
      href: 'https://soundcloud.com/example-artist/made-up-song?in=x',
      liked: true
    })
    expect(n).toEqual({ title: 'Made-up song', artist: 'Example Artist', artwork: 'https://i1.sndcdn.com/artworks-x-t500x500.jpg', playing: true, pos: 65000, dur: 210000, url: 'https://soundcloud.com/example-artist/made-up-song', liked: true })
  })
  it('falls back to the player bar text when there is no media session', () => {
    const n = mapNowPlaying({ md: null, state: 'none', playingDom: true, titleDom: ' Another\nsong ', artistDom: 'Someone', passed: '1:05', duration: '3:30', artDom: 'url("https://i1.sndcdn.com/artworks-y-t50x50.jpg")', liked: 'x' })
    expect(n).toMatchObject({ title: 'Another song', artist: 'Someone', playing: true, pos: 65000, dur: 210000, url: '', liked: null, artwork: 'https://i1.sndcdn.com/artworks-y-t500x500.jpg' })
  })
  it('is safe with junk', () => {
    expect(mapNowPlaying(null)).toEqual(NO_NOW)
    expect(mapNowPlaying({ state: 'playing' }).playing).toBe(false) // no title: nothing playing
    expect(mapNowPlaying({ md: { title: 'x' }, now: 999, max: 10, state: 'paused' })).toMatchObject({ pos: 10000, dur: 10000, playing: false })
    expect(mapNowPlaying({ md: { title: 'x' }, now: -4, max: 'a' }).pos).toBe(0)
    expect(parseClock('1:02:03')).toBe(3723000)
    expect(parseClock('soon')).toBe(0)
    expect(artFrom('url(javascript:x)')).toBe('')
  })
  it('the state from the desktop is checked again', () => {
    expect(cleanScWebState(null)).toEqual(SCWEB_OFF)
    const s = cleanScWebState({ on: true, signedIn: true, live: true, visible: 'yes', zoom: 9, now: { title: 'Song', artist: 'A', playing: true, pos: 1000, dur: 5000, url: 'https://soundcloud.com/a/song', artwork: 'https://i1.sndcdn.com/x-t500x500.jpg', liked: false }, mixes: [{ url: '/discover/sets/personalized-tracks::example:1', title: 'Mix 1' }], at: 5 })
    expect(s).toMatchObject({ on: true, signedIn: true, live: true, visible: false, zoom: 1.5, at: 5 })
    expect(s.now).toEqual({ title: 'Song', artist: 'A', artwork: 'https://i1.sndcdn.com/x-t500x500.jpg', playing: true, pos: 1000, dur: 5000, url: 'https://soundcloud.com/a/song', liked: false })
    expect(s.mixes).toHaveLength(1)
  })
})

describe('signed in: "Mixed for you" tiles', () => {
  it('keeps SoundCloud links with a title, once each, with safe art', () => {
    const t = cleanMixTiles([
      { url: 'https://soundcloud.com/discover/sets/personalized-tracks::example:111', title: 'Mix 1', art: 'url("https://i1.sndcdn.com/artworks-m1-t200x200.jpg")' },
      { url: '/discover/sets/personalized-tracks::example:222', title: '  Mix 2 ', art: 'https://evil.example/x.jpg' },
      { url: 'https://soundcloud.com/discover/sets/personalized-tracks::example:111', title: 'Again' },
      { url: 'https://evil.example/discover/sets/x', title: 'Bad host' },
      { url: 'javascript:alert(1)', title: 'Bad' },
      { url: 'https://soundcloud.com/discover/sets/x', title: '' },
      { url: 'https://soundcloud.com/a/../../b', title: 'Dots' } // the browser tidies it to /b
    ])
    expect(t).toEqual([
      { url: 'https://soundcloud.com/discover/sets/personalized-tracks::example:111', title: 'Mix 1', art: 'https://i1.sndcdn.com/artworks-m1-t500x500.jpg' },
      { url: 'https://soundcloud.com/discover/sets/personalized-tracks::example:222', title: 'Mix 2', art: '' },
      { url: 'https://soundcloud.com/b', title: 'Dots', art: '' }
    ])
    expect(cleanMixTiles(Array.from({ length: 40 }, (_, i) => ({ url: `/discover/sets/mix-${i}`, title: `M${i}` })))).toHaveLength(12)
    expect(cleanMixTiles({})).toEqual([])
    expect(mixUrl('https://soundcloud.com/x?y=1#z')).toBe('https://soundcloud.com/x')
    expect(mixUrl('https://soundcloud.com/')).toBeNull()
  })
  it('tells whether the like toggled', () => {
    expect(likeResult(false, true)).toBe('liked')
    expect(likeResult(true, false)).toBe('unliked')
    expect(likeResult(true, true)).toBe('unchanged')
    expect(likeResult(null, null)).toBe('unknown')
  })
})
