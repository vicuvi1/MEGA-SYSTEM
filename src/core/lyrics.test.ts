// MU: synced lyrics and covers (made-up songs).
import { describe, expect, it } from 'vitest'
import { itunesArt, itunesUrl, lineAt, lyricsFrom, lrclibGetUrl, lrclibSearchUrl, parseLrc, safeCover, songOf } from './lyrics'
import { cleanSessionId, mediaListScript, parseMediaList } from './pcMedia'

const LRC = '[ar:Example]\n[00:01.00]First line\n[00:04.50]Second line\n[00:08.20][00:20.00]Chorus\n[00:12.000]\nnot timed'

describe('synced lyrics', () => {
  it('reads LRC lines in order, with repeated stamps', () => {
    const l = parseLrc(LRC)
    expect(l.map((x) => x.t)).toEqual([1000, 4500, 8200, 12000, 20000])
    expect(l.map((x) => x.text)).toEqual(['First line', 'Second line', 'Chorus', '', 'Chorus'])
  })
  it('finds the line playing now', () => {
    const l = parseLrc(LRC)
    expect(lineAt(l, 0)).toBe(-1)
    expect(lineAt(l, 1000)).toBe(0)
    expect(lineAt(l, 5000)).toBe(1)
    expect(lineAt(l, 99_000)).toBe(4)
  })
  it('turns player titles into a song and an artist', () => {
    expect(songOf('Example Band - Calm Morning (Official Video) [HD]', '')).toEqual({ title: 'Calm Morning', artist: 'Example Band' })
    expect(songOf('Calm Morning (feat. Someone)', 'Example Band - Topic')).toEqual({ title: 'Calm Morning', artist: 'Example Band' })
  })
  it('asks LRCLIB with the length, and searches without an artist', () => {
    expect(lrclibGetUrl({ title: 'Calm Morning', artist: 'Example Band' }, 201_400)).toBe('https://lrclib.net/api/get?track_name=Calm+Morning&artist_name=Example+Band&duration=201')
    expect(lrclibGetUrl({ title: 'Calm Morning', artist: '' }, 0)).toBeNull()
    expect(lrclibSearchUrl({ title: 'Calm Morning', artist: '' })).toBe('https://lrclib.net/api/search?track_name=Calm+Morning')
  })
  it("uses LRCLIB's synced lyrics, nearest in length, or none", () => {
    expect(lyricsFrom({ syncedLyrics: LRC })).toHaveLength(5)
    expect(lyricsFrom({ plainLyrics: 'words', syncedLyrics: null })).toBeNull()
    expect(lyricsFrom({ instrumental: true, syncedLyrics: LRC })).toBeNull()
    const pick = lyricsFrom([{ duration: 100, syncedLyrics: '[00:01]far a\n[00:02]far b' }, { duration: 200, syncedLyrics: '[00:01]near a\n[00:02]near b' }], 200_500)
    expect(pick?.[0].text).toBe('near a')
    expect(lyricsFrom(null)).toBeNull()
  })
})

describe('covers for PC players', () => {
  it('searches iTunes and only trusts its image host', () => {
    expect(itunesUrl({ title: 'Calm Morning', artist: 'Example Band' })).toBe('https://itunes.apple.com/search?term=Example+Band+Calm+Morning&entity=song&limit=1')
    expect(itunesArt({ results: [{ artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/ab/cd/100x100bb.jpg' }] })).toBe('https://is1-ssl.mzstatic.com/image/thumb/Music/ab/cd/600x600bb.jpg')
    expect(itunesArt({ results: [{ artworkUrl100: 'https://evil.example/100x100bb.jpg' }] })).toBe('')
    expect(safeCover('https://i1.sndcdn.com/artworks-x-large.jpg')).toBeTruthy()
    expect(safeCover('http://i1.sndcdn.com/a.jpg')).toBe('')
  })
})

describe('every player on the PC', () => {
  it('reads the list (one item or many) and names the players', () => {
    const one = parseMediaList('{"ok":true,"list":{"id":"Spotify.exe","playing":true,"title":"Song","artist":"Band","pos":1000,"dur":200000}}')
    expect(one).toEqual([{ id: 'Spotify.exe', app: 'Spotify', playing: true, title: 'Song', artist: 'Band', pos: 1000, dur: 200000 }])
    const many = parseMediaList('noise\n{"ok":true,"list":[{"id":"Chrome","title":"A"},{"id":"bad\'id;","title":"B"}]}')
    expect(many?.map((x) => x.app)).toEqual(['Chrome'])
    expect(parseMediaList('{"ok":false}')).toBeNull()
  })
  it('never puts an unsafe player id into the script', () => {
    expect(cleanSessionId("x'; Remove-Item")).toBeNull()
    expect(mediaListScript('next', "x'; Remove-Item")).not.toContain('Remove-Item')
    expect(mediaListScript('next', 'Spotify.exe')).toContain("-eq 'Spotify.exe'")
  })
})
