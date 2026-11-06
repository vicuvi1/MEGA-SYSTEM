// MU: the Music tab's rules (made-up tracks and addresses).
import { describe, expect, it } from 'vitest'
import {
  addRecent, bigArt, cleanMusicKit, DEFAULT_MUSIC, fakeWave, glowColor, hexRgb, moveStation, musicNowContext, nextIndex, nowPlayingLine, onFocusStart, pickColor, pickPlayer, prevIndex,
  pseudoBeat, queueFrom, seekFraction, shuffleOrder, sleepLeft, sleepVolume, toggleFav, upNext, waveBars, waveJsonUrl, EXAMPLE_STATIONS, RECENT_MAX
} from './music'
import { cleanKit } from './islandTiles'

const st = (id: string, slug: string) => ({ id, name: slug, url: `https://soundcloud.com/example-artist/sets/${slug}`, kind: 'playlist' as const })

describe('stations and favourites', () => {
  it('reorders stations and stays in bounds', () => {
    const list = [st('s0', 'a'), st('s1', 'b'), st('s2', 'c')]
    expect(moveStation(list, 's1', -1).map((s) => s.id)).toEqual(['s1', 's0', 's2'])
    expect(moveStation(list, 's2', 1)).toBe(list)
    expect(moveStation(list, 'nope', 1)).toBe(list)
  })
  it('stars and unstars tracks (only SoundCloud tracks)', () => {
    let favs = toggleFav([], { url: 'https://soundcloud.com/example-artist/calm-morning?si=x', title: 'Calm morning', artist: 'Example Artist' })
    expect(favs).toEqual([{ url: 'https://soundcloud.com/example-artist/calm-morning', title: 'Calm morning', artist: 'Example Artist', artwork: '' }])
    expect(toggleFav(favs, { url: 'https://evil.example/x/y', title: 'x' })).toBe(favs)
    favs = toggleFav(favs, { url: 'https://soundcloud.com/example-artist/calm-morning' })
    expect(favs).toEqual([])
  })
  it('cleans the synced music settings, with safe defaults', () => {
    expect(cleanMusicKit(null)).toEqual(DEFAULT_MUSIC)
    const m = cleanMusicKit({ stations: [st('s0', 'a')], focusMix: 's0', benSees: true, lyrics: false, pillLyric: true, eqMode: 'pitch', pin: 'sys:Spotify.exe', favs: [{ url: 'javascript:alert(1)' }] })
    expect(m).toMatchObject({ focusMix: 's0', benSees: true, lyrics: false, pillLyric: true, eqMode: 'pitch', pin: 'sys:Spotify.exe', favs: [] })
    expect(cleanMusicKit({ stations: [], focusMix: 's9', pin: "sys:a';rm" })).toMatchObject({ focusMix: null, pin: null })
    // The island kit keeps it (old kits with stations only still load).
    expect(cleanKit({ music: { stations: [st('s0', 'a')] } }).music).toMatchObject({ stations: [{ id: 's0' }], lyrics: true, benSees: false })
  })
  it('keeps recently played newest first, once each, and short', () => {
    let r = addRecent([], { url: 'https://soundcloud.com/a/one', title: 'One', artist: '', artwork: '' }, 1)
    r = addRecent(r, { url: 'https://soundcloud.com/a/two', title: 'Two', artist: '', artwork: '' }, 2)
    r = addRecent(r, { url: 'https://soundcloud.com/a/one', title: 'One', artist: '', artwork: '' }, 3)
    expect(r.map((x) => x.title)).toEqual(['One', 'Two'])
    for (let i = 0; i < 30; i++) r = addRecent(r, { url: `https://soundcloud.com/a/t${i}`, title: `T${i}`, artist: '', artwork: '' }, 10 + i)
    expect(r).toHaveLength(RECENT_MAX)
  })
  it('example stations are made up and valid', () => {
    expect(EXAMPLE_STATIONS.every((s) => s.url.includes('/example-'))).toBe(true)
  })
  it('only trusts SoundCloud artwork, and asks for the big one', () => {
    expect(bigArt('https://i1.sndcdn.com/artworks-abc123-large.jpg')).toBe('https://i1.sndcdn.com/artworks-abc123-t500x500.jpg')
    expect(bigArt('https://evil.example/a-large.jpg')).toBe('')
  })
})

describe('the queue', () => {
  const sounds = [{ title: 'One', user: { username: 'Ann' }, duration: 1000, permalink_url: 'https://soundcloud.com/ann/one' }, {}, { title: 'Three' }]
  it('reads the widget sounds, with names for ones not loaded yet', () => {
    const q = queueFrom(sounds)
    expect(q.map((x) => x.title)).toEqual(['One', 'Track 2', 'Three'])
    expect(q[0]).toMatchObject({ artist: 'Ann', dur: 1000, url: 'https://soundcloud.com/ann/one' })
    expect(queueFrom('nope')).toEqual([])
  })
  it('goes to the next track, stops at the end, or wraps with repeat', () => {
    const o = { n: 3, shuffle: false, order: [], auto: true }
    expect(nextIndex({ ...o, cur: 0, repeat: 'off' })).toBe(1)
    expect(nextIndex({ ...o, cur: 2, repeat: 'off' })).toBeNull()
    expect(nextIndex({ ...o, cur: 2, repeat: 'all' })).toBe(0)
    expect(nextIndex({ ...o, cur: 1, repeat: 'one' })).toBe(1)
    // A press of Next moves on even with repeat one, and wraps.
    expect(nextIndex({ ...o, cur: 2, repeat: 'off', auto: false })).toBe(0)
    expect(prevIndex({ n: 3, cur: 0, shuffle: false, order: [] })).toBe(2)
  })
  it('shuffles every track once, starting with the one playing', () => {
    let seed = 7
    const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
    const order = shuffleOrder(6, 3, rand)
    expect(order[0]).toBe(3)
    expect([...order].sort()).toEqual([0, 1, 2, 3, 4, 5])
    expect(nextIndex({ n: 6, cur: 3, shuffle: true, order, repeat: 'off', auto: true })).toBe(order[1])
  })
  it('lists what plays next in play order', () => {
    const q = queueFrom([{ title: 'A' }, { title: 'B' }, { title: 'C' }])
    expect(upNext(q, { cur: 1, shuffle: false, order: [], repeat: 'off' }).map((x) => x.title)).toEqual(['C'])
    expect(upNext(q, { cur: 1, shuffle: false, order: [], repeat: 'all' }).map((x) => x.title)).toEqual(['C', 'A'])
  })
})

describe('the waveform', () => {
  it('only fetches from SoundCloud waveform host, as numbers', () => {
    expect(waveJsonUrl('https://wave.sndcdn.com/AbC123xyz_m.png')).toBe('https://wave.sndcdn.com/AbC123xyz_m.json')
    expect(waveJsonUrl('https://evil.example/AbC123xyz_m.png')).toBeNull()
  })
  it('scales samples into bars from 0.08 to 1, the loudest at 1', () => {
    const bars = waveBars([0, 10, 20, 140, 70, 0, 0, 5], 4)
    expect(bars).toHaveLength(4)
    expect(Math.max(...bars)).toBe(1)
    expect(Math.min(...bars)).toBeGreaterThanOrEqual(0.08)
    expect(bars[1]).toBe(1)
    expect(waveBars([], 5)).toEqual([0.08, 0.08, 0.08, 0.08, 0.08])
    // More bars than samples still works.
    expect(waveBars([1, 2], 6)).toHaveLength(6)
  })
  it('a stand-in shape is the same every time', () => {
    expect(fakeWave('song', 20)).toEqual(fakeWave('song', 20))
    expect(fakeWave('song', 20)).not.toEqual(fakeWave('other', 20))
  })
  it('a click lands between 0 and 1', () => {
    expect(seekFraction(150, 100, 200)).toBe(0.25)
    expect(seekFraction(50, 100, 200)).toBe(0)
    expect(seekFraction(500, 100, 200)).toBe(1)
  })
})

describe('the sleep timer', () => {
  it('keeps your volume, then fades to nothing at the end', () => {
    const end = 100_000
    expect(sleepVolume(0, end, 80)).toBe(80)
    expect(sleepVolume(end - 22_500, end, 80, 45_000)).toBe(40)
    expect(sleepVolume(end, end, 80)).toBe(0)
    expect(sleepLeft(0, 15 * 60_000)).toBe('15 min')
    expect(sleepLeft(0, 30_000)).toBe('30 s')
  })
})

describe('the colour from the artwork', () => {
  const px = (list: [number, number, number, number][]) => list.flat()
  it('picks the colourful part over black and white', () => {
    const data = px([...Array(10).fill([0, 0, 0, 255]), ...Array(10).fill([255, 255, 255, 255]), ...Array(5).fill([220, 40, 60, 255])])
    expect(pickColor(data, { r: 1, g: 2, b: 3 })).toEqual({ r: 220, g: 40, b: 60 })
  })
  it('falls back when there is nothing to read', () => {
    expect(pickColor([], { r: 1, g: 2, b: 3 })).toEqual({ r: 1, g: 2, b: 3 })
    expect(pickColor(px([[200, 0, 0, 0]]), { r: 1, g: 2, b: 3 })).toEqual({ r: 1, g: 2, b: 3 })
  })
  it('makes dark colours bright enough to glow, keeping the hue', () => {
    expect(glowColor({ r: 50, g: 25, b: 0 })).toEqual({ r: 150, g: 75, b: 0 })
    expect(hexRgb('#d4ff3f')).toEqual({ r: 212, g: 255, b: 63 })
  })
  it('a made-up beat stays calm', () => {
    const b = pseudoBeat('any song')
    expect(b).toBeGreaterThanOrEqual(70)
    expect(b).toBeLessThanOrEqual(118)
  })
})

describe('focus, players and Ben', () => {
  it('a focus timer plays your focus mix, or pauses with that switch on', () => {
    const mix = st('s0', 'deep-focus')
    expect(onFocusStart({ mix, pauseInFocus: true, playing: false, playingUrl: null })).toBe('mix')
    expect(onFocusStart({ mix, pauseInFocus: true, playing: true, playingUrl: mix.url })).toBeNull()
    expect(onFocusStart({ mix: null, pauseInFocus: true, playing: true, playingUrl: 'x' })).toBe('pause')
    expect(onFocusStart({ mix: null, pauseInFocus: false, playing: true, playingUrl: 'x' })).toBeNull()
  })
  it('follows the pinned player, else whatever plays (SoundCloud first)', () => {
    const sc = { id: 'sc', name: 'SoundCloud', playing: false, title: 'A', artist: '' }
    const sp = { id: 'sys:Spotify.exe', name: 'Spotify', playing: true, title: 'B', artist: '' }
    expect(pickPlayer([sc, sp], null)?.id).toBe('sys:Spotify.exe')
    expect(pickPlayer([sc, sp], 'sc')?.id).toBe('sc')
    expect(pickPlayer([{ ...sc, playing: true }, sp], null)?.id).toBe('sc')
    expect(pickPlayer([sc], 'sys:gone')?.id).toBe('sc')
    expect(pickPlayer([], null)).toBeNull()
  })
  it('Ben sees a short line, only while fresh', () => {
    const line = nowPlayingLine({ title: 'Calm morning', artist: 'Example Artist', station: 'Deep focus' })
    expect(line).toBe('Calm morning by Example Artist (station Deep focus)')
    expect(musicNowContext({ line, at: 1000 }, 1000 + 60_000)).toMatch(/Calm morning/)
    expect(musicNowContext({ line, at: 1000 }, 1000 + 30 * 60_000)).toBeNull()
    expect(musicNowContext(null, 0)).toBeNull()
  })
})
