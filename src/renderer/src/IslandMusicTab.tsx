// MU: the island's Music page (a page of the opened island's pager, PL6). Big cover on the
// left, title, artist and synced lyrics on the right, the real waveform (or a
// thin bar for a PC player), the buttons, then up next, your stations,
// favourites and recently played. useMusicPage registers it as the pager's
// "music" page (replacing its placeholder) and opens it on request.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { registerIslandPage } from './widgets/islandPages'
import { addStation, removeStation } from '@core/soundcloud'
import { toggleFav, type MusicKit } from '@core/music'
import { tp } from './islandTap'
import type { KitState } from './IslandTiles'
import { getRecents, subscribeRecents } from './music/engine'
import { useMusic } from './music/remote'
import { useFollowed, useLyrics, useSystemPlayers } from './music/players'
import { rememberStationArt } from './music/hooks'
import { looksLikeWorkout, type NowCtx } from '@core/starterStations'
import type { IslandSnapshot } from '@core/islandModel'
import { VibeGrid } from './music/VibeGrid'
import { Ambient, Artwork, EqMode, Lyrics, PlayerPicker, Scroller, SleepTimer, StarButton, StationTile, SysTransport, ThinBar, Times, TrackList, Transport, UpNext, useRememberArt, useTint, tintStyle, Volume, Waveform, type Press } from './music/MusicUi'

const press: Press = (id, fn) => tp(id, () => fn())
type Sec = 'next' | 'stations' | 'favs' | 'recent'

/** What's going on, for "Play something for now". */
const nowFrom = (snap?: IslandSnapshot | null): NowCtx => ({
  hour: new Date().getHours(),
  focus: !!snap?.running && !snap.running.brk,
  workout: looksLikeWorkout(snap?.running?.subject, snap?.now?.title)
})

export function IslandMusicTab({ k, onBack, snap }: { k: KitState; onBack: () => void; snap?: IslandSnapshot | null }) {
  const sc = useMusic()
  const music = k.kit.music
  const saveMusic = (m: Partial<MusicKit>) => k.save({ ...k.kit, music: { ...music, ...m } })
  const sys = useSystemPlayers(true)
  const f = useFollowed(sc, sys, music.pin)
  const { ctl } = f
  const s = ctl.s
  const tint = useTint(s, '#d4ff3f')
  useRememberArt(sc.s, rememberStationArt)
  const lines = useLyrics(s.title, s.artist, s.dur, music.lyrics && f.kind !== 'none')
  const recents = useSyncExternalStore(subscribeRecents, getRecents, getRecents)
  const [sec, setSec] = useState<Sec>(sc.s.queue.length > 1 ? 'next' : 'stations')
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  const isSc = f.kind === 'sc'
  const now = nowFrom(snap)
  const hasLists = music.stations.length > 0 || music.favs.length > 0 || recents.length > 0
  const add = () => {
    const r = addStation(music.stations, url)
    if (r.error) return setErr(r.error)
    setErr('')
    setUrl('')
    saveMusic({ stations: r.list })
    if (r.station) ctl.run({ op: 'play', station: r.station })
  }
  const pasteForm = (
    <>
      <div className="mu-add">
        <input value={url} placeholder="soundcloud.com/artist/sets/playlist" onPointerDown={() => window.desktop?.islandFocus?.()} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} aria-label="SoundCloud address" />
        <button className="mu-btn" {...tp('mu:isl:add', add)}>Add</button>
        {!!music.stations.length && sc.s.station && music.stations.some((x) => x.url === sc.s.station?.url) && (
          <button className="mu-btn ghost" title="Remove the station that is playing" {...tp('mu:isl:del', () => saveMusic({ stations: removeStation(music.stations, music.stations.find((x) => x.url === sc.s.station?.url)!.id) }))}>Remove this one</button>
        )}
      </div>
      {err && <p className="mu-warn">{err}</p>}
    </>
  )
  return (
    <section className="di-mu mu" style={tintStyle(tint.rgb, s)} aria-label="Music">
      <Ambient s={s} />
      <div className="di-mu-head">
        <button className="mu-ic sm" aria-label="Back" title="Back" {...tp('mu:back', onBack)}>‹</button>
        <b>Music</b>
        <button className="mu-chip" title={music.eqMode === 'beat' ? 'Equalizer: beat (tap for pitch, low to high)' : 'Equalizer: pitch, low to high (tap for beat)'} {...tp('mu:eqmode', () => saveMusic({ eqMode: music.eqMode === 'beat' ? 'pitch' : 'beat' }))}>
          <EqMode on={s.playing} mode={music.eqMode} /> {music.eqMode === 'beat' ? 'Beat' : 'Pitch'}
        </button>
        {sc.s.loaded && <button className="mu-ic sm" aria-label="Stop the player" title="Stop (unloads the player)" {...tp('mu:stop', () => sc.run({ op: 'stop' }))}>■</button>}
      </div>
      <PlayerPicker players={f.players} current={f.current} pin={music.pin} onPin={(pin) => saveMusic({ pin })} press={press} prefix="mu:isl" />

      {f.kind === 'none' ? (
        <VibeGrid music={music} save={saveMusic} ctl={sc} press={press} prefix="mu:isl" now={now} paste={pasteForm} />
      ) : (
        <>
          <div className="di-mu-hero">
            <Artwork s={s} size={132} />
            <div className="di-mu-meta">
              <span className="st">
                <EqMode on={s.playing} mode={music.eqMode} /> {s.station?.name ?? 'SoundCloud'}
              </span>
              <Scroller className="t" text={s.title || (s.ready ? s.station?.name ?? '' : 'Loading…')} />
              {s.artist && <Scroller className="a" text={s.artist} />}
              {lines ? <Lyrics s={s} lines={lines} rows={3} className="di-mu-lyrics" /> : <span className="di-mu-nolyric">{music.lyrics ? (s.title ? 'No synced lyrics for this one' : '') : ''}</span>}
            </div>
          </div>
          <div>
            {isSc ? <Waveform ctl={ctl} bars={72} height={40} /> : <ThinBar s={s} />}
            <Times s={s} />
          </div>
          {isSc ? <Transport ctl={ctl} press={press} size={50} prefix="mu:isl" /> : <SysTransport ctl={ctl} press={press} size={50} prefix="mu:isl" />}
          <div className="di-mu-row">
            {isSc ? <StarButton s={s} favs={music.favs} press={press} id="mu:isl:star" onToggle={(x) => saveMusic({ favs: toggleFav(music.favs, x) })} /> : <span />}
            {isSc && <Volume ctl={ctl} />}
            {isSc && <SleepTimer ctl={ctl} press={press} prefix="mu:isl" />}
          </div>
          {s.error && <p className="mu-warn">{s.error}</p>}
        </>
      )}

      {(f.kind !== 'none' || hasLists) && <div className="di-mu-tabs" role="tablist">
        {(
          [
            ['next', 'Up next'],
            ['stations', 'Stations'],
            ['favs', 'Favourites'],
            ['recent', 'Recent']
          ] as [Sec, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={sec === id} className={`mu-chip di-mu-tab-btn ${sec === id ? 'on' : ''}`} {...tp(`mu:sec:${id}`, () => setSec(id))}>{label}</button>
        ))}
      </div>}
      {(f.kind !== 'none' || hasLists) && <div className="di-mu-sec">
        {sec === 'next' && (sc.s.loaded ? <UpNext ctl={sc} press={press} max={6} prefix="mu:isl" /> : <p className="mu-empty">Play a station to see what comes next.</p>)}
        {sec === 'stations' && (
          <>
            {!!music.stations.length && (
              <div className="mu-grid">
                {music.stations.map((x) => (
                  <StationTile key={x.id} st={x} on={sc.s.station?.url === x.url} playing={sc.s.playing} press={press} id={`mu:isl:st:${x.id}`} focusMix={music.focusMix === x.id} onPlay={() => sc.run({ op: 'play', station: x })} />
                ))}
              </div>
            )}
            {f.kind === 'none' ? (!music.stations.length && <p className="mu-empty">Your own stations show up here.</p>) : <VibeGrid music={music} save={saveMusic} ctl={sc} press={press} prefix="mu:isl:sec" now={now} title="Vibes" paste={pasteForm} />}
          </>
        )}
        {sec === 'favs' && <TrackList list={music.favs} ctl={sc} press={press} prefix="mu:isl:fav" empty="Star a track to keep it here." />}
        {sec === 'recent' && <TrackList list={recents.slice(0, 8)} ctl={sc} press={press} prefix="mu:isl:rec" empty="What you play shows up here." />}
      </div>}
    </section>
  )
}


/** Show the island's Music page: the pager remembers it, then is told (it may not be open yet). */
const goMusic = () => {
  try {
    localStorage.setItem('ls.islandPage', 'music')
  } catch {
    /* fine */
  }
  window.dispatchEvent(new CustomEvent('life-island-page', { detail: 'music' }))
}

/** Registers the Music page in the island's pager, and opens it on "life-island-music-tab" (♫, the music tile, the media row). */
export function useMusicPage(k: KitState, openPanel: () => void) {
  const kRef = useRef(k)
  kRef.current = k
  useEffect(
    () =>
      registerIslandPage({
        id: 'music',
        title: 'Music',
        icon: '🎵',
        order: 10,
        render: (ctx) => <IslandMusicTab k={kRef.current} snap={ctx.snap} onBack={() => window.dispatchEvent(new CustomEvent('life-island-page', { detail: 'day' }))} />
      }),
    []
  )
  useEffect(() => {
    const open = () => {
      goMusic()
      openPanel()
      window.setTimeout(goMusic, 60)
    }
    window.addEventListener('life-island-music-tab', open)
    return () => window.removeEventListener('life-island-music-tab', open)
  }, [])
}
