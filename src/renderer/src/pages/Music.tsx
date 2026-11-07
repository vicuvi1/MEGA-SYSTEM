// MU: the Music page (website and desktop). The same player as the island's
// Music tab, full page: the cover on the left, title, artist and synced lyrics
// on the right, the waveform and the buttons below; then up next, your
// stations (add, rename, reorder, remove, the focus mix), favourites,
// recently played and the options. On the website the player runs in this
// window (MusicHost in App); in the desktop app it drives the island's player,
// so there is one player, not two. Stations sync across devices (island_kit).
import { useEffect, useState, useSyncExternalStore } from 'react'
import { DEFAULT_KIT, type IslandKit } from '@core/islandTiles'
import { moveStation, toggleFav, type MusicKit } from '@core/music'
import { nextOnly, ONLY_LABEL, ONLY_SHORT } from '@core/musicOnly'
import { addStation, removeStation, renameStation, STATION_KIND_LABEL } from '@core/soundcloud'
import { life } from '../bridge'
import { getRecents, subscribeRecents } from '../music/engine'
import { useMusic } from '../music/remote'
import { useFollowed, useLyrics, useSystemPlayers } from '../music/players'
import { rememberStationArt } from '../music/hooks'
import {
  Ambient, Artwork, clickPress, EqMode, Lyrics, MuIcon, PlayerPicker, Scroller, SleepTimer, StarButton, StationTile, SysTransport, ThinBar, Times, TrackList, Transport, UpNext,
  useRememberArt, useTint, tintStyle, Volume, Waveform
} from '../music/MusicUi'
import { VibeGrid } from '../music/VibeGrid'
import { hasScWeb, useScWeb } from '../music/scWeb'
import { LikeButton, MUSIC_TAB_KEY, ScWebPanel, YourScRow } from '../music/YourSoundCloud'
import { PageTabs, TabPanel, usePageTab, type PageTab } from '../PageTabs'
import '../music/musicPage.css'

function useMusicKit(): [IslandKit, (m: Partial<MusicKit>) => void] {
  const [kit, setKit] = useState<IslandKit>(DEFAULT_KIT)
  useEffect(() => {
    void life.islandKit?.get().then(setKit).catch(() => {})
  }, [])
  const save = (m: Partial<MusicKit>) => {
    setKit((k) => {
      const next = { ...k, music: { ...k.music, ...m } }
      void life.islandKit?.save(next).catch(() => {})
      return next
    })
  }
  return [kit, save]
}

export function Music() {
  const [kit, saveMusic] = useMusicKit()
  const music = kit.music
  const sc = useMusic()
  const sys = useSystemPlayers(!!window.desktop?.pcx)
  const web = useScWeb()
  const f = useFollowed(sc, sys, music.pin, web)
  // Player · Library · Options (and Your SoundCloud, signed in, on the desktop): one switch.
  const tabList: PageTab[] = [
    { id: 'player', label: 'Player', title: 'Now playing, lyrics, up next (1)' },
    { id: 'library', label: 'Library', count: music.stations.length || null, title: 'Your stations, favourites and recently played (2)' },
    { id: 'options', label: 'Options', title: 'Your SoundCloud name, lyrics and the pill (3)' },
    ...(hasScWeb() ? [{ id: 'web', label: 'Your SoundCloud', title: "SoundCloud's own site, signed in (4)" }] : [])
  ]
  const [tab, setTab] = usePageTab('music', tabList.map((t) => t.id), 'player', MUSIC_TAB_KEY)
  useEffect(() => {
    // "Your mixes" on the island opens the signed-in tab.
    const ev = (e: Event) => setTab((e as CustomEvent).detail === 'web' && hasScWeb() ? 'web' : 'player')
    window.addEventListener('life-music-tab', ev)
    return () => window.removeEventListener('life-music-tab', ev)
  }, [setTab])
  const { ctl } = f
  const s = ctl.s
  const tint = useTint(s, '#c8f135')
  useRememberArt(sc.s, rememberStationArt)
  const lines = useLyrics(s.title, s.artist, s.dur, music.lyrics && f.kind !== 'none')
  const recents = useSyncExternalStore(subscribeRecents, getRecents, getRecents)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const isSc = f.kind === 'sc'
  const press = clickPress
  const add = () => {
    const r = addStation(music.stations, url, name)
    if (r.error) return setErr(r.error)
    setErr('')
    setUrl('')
    setName('')
    saveMusic({ stations: r.list })
  }
  const tabs = <PageTabs page="music" label="Music views" tabs={tabList} value={tab} onChange={setTab} />
  if (tab === 'web') {
    return (
      <div className="mup mu mup-web" style={tintStyle(tint.rgb, s)}>
        {tabs}
        <ScWebPanel />
      </div>
    )
  }
  return (
    <div className="mup mu" style={tintStyle(tint.rgb, s)}>
      {tabs}
      <TabPanel page="music" id="player" value={tab}>
      {f.kind === 'none' && !sc.probing && (
        <section className="mup-card mup-vibes" aria-label="Pick a vibe">
          <VibeGrid music={music} save={saveMusic} ctl={sc} press={press} prefix="page" now={{ hour: new Date().getHours() }} />
        </section>
      )}
      <section className={`mup-hero ${f.kind === 'none' ? 'idle' : ''} ${s.playing ? 'playing' : ''}`} aria-label="Now playing">
        <Ambient s={s} />
        <div className="mup-hero-in">
          <Artwork s={s} size={260} className="mup-art" />
          <div className="mup-meta">
            <div className="mup-top">
              <span className="mup-src">
                <EqMode on={s.playing} mode={music.eqMode} />
                {f.kind === 'sys' ? f.current?.name : s.station?.name ?? 'Music'}
                {sc.remote && isSc && <em>· on the island</em>}
              </span>
              <button className="mu-chip" title="Switch the equalizer between beat and pitch (low to high)" onClick={() => saveMusic({ eqMode: music.eqMode === 'beat' ? 'pitch' : 'beat' })}>
                {music.eqMode === 'beat' ? 'Beat' : 'Pitch'}
              </button>
            </div>
            <PlayerPicker players={f.players} current={f.current} pin={music.pin} onPin={(pin) => saveMusic({ pin })} press={press} />
            {f.kind === 'none' ? (
              <>
                <h2 className="mup-title">Nothing playing</h2>
                <p className="mup-artist">{sc.probing ? 'Looking for the island…' : 'Pick a vibe above, or one of your stations below.'}</p>
              </>
            ) : (
              <>
                <Scroller className="mup-title" text={s.title || (s.ready ? s.station?.name ?? '' : 'Loading…')} />
                {s.artist && <Scroller className="mup-artist" text={s.artist} />}
                {lines ? <Lyrics s={s} lines={lines} rows={5} className="mup-lyrics" /> : <p className="mup-nolyric">{music.lyrics ? (s.title ? 'No synced lyrics found for this track.' : '') : 'Lyrics are off.'}</p>}
              </>
            )}
          </div>
        </div>
        {f.kind !== 'none' && (
          <div className="mup-bottom">
            {isSc ? <Waveform ctl={ctl} bars={140} height={56} /> : <ThinBar s={s} />}
            <Times s={s} />
            <div className="mup-ctl">
              <div className="mup-ctl-l">{f.kind === 'web' && <LikeButton press={press} id="page:like" />}{isSc && <StarButton s={s} favs={music.favs} press={press} onToggle={(x) => saveMusic({ favs: toggleFav(music.favs, x) })} />}</div>
              {isSc ? <Transport ctl={ctl} press={press} size={62} /> : <SysTransport ctl={ctl} press={press} size={62} />}
              <div className="mup-ctl-r">
                {isSc && <SleepTimer ctl={ctl} press={press} />}
                {isSc && <Volume ctl={ctl} />}
              </div>
            </div>
            {s.error && <p className="mu-warn">{s.error}</p>}
          </div>
        )}
      </section>

      <section className="mup-card">
        <h3>Up next</h3>
        {sc.s.loaded ? <UpNext ctl={sc} press={press} max={10} /> : <p className="mu-empty">Play a station to see what comes next.</p>}
      </section>
      </TabPanel>

      <TabPanel page="music" id="library" value={tab}>
      {f.kind !== 'none' && (
        <section className="mup-card mup-vibes">
          <VibeGrid music={music} save={saveMusic} ctl={sc} press={press} prefix="page:sec" now={{ hour: new Date().getHours() }} title="Vibes" />
        </section>
      )}
      <div className="mup-cols">
        <div className="mup-col">
          <section className="mup-card">
            <div className="mup-card-head">
              <h3>Stations</h3>
              <small>{music.stations.length} of 12 · on all your devices</small>
            </div>
            {music.stations.length ? (
              <div className="mu-grid">
                {music.stations.map((x) => (
                  <StationTile key={x.id} st={x} on={sc.s.station?.url === x.url} playing={sc.s.playing} press={press} id={`st:${x.id}`} focusMix={music.focusMix === x.id} onPlay={() => sc.run({ op: 'play', station: x })} />
                ))}
              </div>
            ) : (
              <p className="mu-empty">Paste a SoundCloud playlist, track or likes link to keep it here, next to the vibes.</p>
            )}
            <div className="mu-add">
              <input value={url} placeholder="https://soundcloud.com/artist/sets/playlist" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} aria-label="SoundCloud address" />
              <input value={name} placeholder="Name (optional)" className="mup-name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} aria-label="Station name" />
              <button className="mu-btn" onClick={add}>
                <MuIcon d="plus" size={14} /> Add
              </button>
            </div>
            {err && <p className="mu-warn">{err}</p>}
            {!!music.stations.length && (
              <p className="mu-empty">
                Tip: mark a station “workout only” or “boring only” and the player keeps it for those timers. That's Rewards' “Pair it” idea, felt every day.{' '}
                <button className="mu-chip" onClick={() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'shop' }))}>Open Rewards</button>
              </p>
            )}
            {!!music.stations.length && (
              <ul className="mup-manage">
                {music.stations.map((x, i) => (
                  <li key={x.id}>
                    {editing === x.id ? (
                      <input autoFocus defaultValue={x.name} aria-label="New name" onBlur={(e) => (saveMusic({ stations: renameStation(music.stations, x.id, e.target.value) }), setEditing(null))} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                    ) : (
                      <span className="mup-mname">
                        <b>{x.name}</b>
                        <small>{STATION_KIND_LABEL[x.kind]}</small>
                      </span>
                    )}
                    <button className={`mu-chip ${music.focusMix === x.id ? 'on' : ''}`} title="Start this station when a focus timer starts" onClick={() => saveMusic({ focusMix: music.focusMix === x.id ? null : x.id })}>
                      <MuIcon d="bolt" size={13} /> Focus mix
                    </button>
                    <button
                      className={`mu-chip ${music.onlyDuring?.[x.url] ? 'on' : ''}`}
                      data-only={music.onlyDuring?.[x.url] ?? 'any'}
                      title={`${music.onlyDuring?.[x.url] ? ONLY_LABEL[music.onlyDuring[x.url]] : 'Plays any time'}. Tap to change: any time → only during workout → only during boring tasks. The island plays it only while that timer runs (a temptation bundle, like Rewards’ “Pair it”).`}
                      onClick={() => {
                        const n = nextOnly(music.onlyDuring?.[x.url])
                        const rest = Object.fromEntries(Object.entries(music.onlyDuring ?? {}).filter(([k]) => k !== x.url))
                        saveMusic({ onlyDuring: n ? { ...rest, [x.url]: n } : rest })
                      }}
                    >
                      {music.onlyDuring?.[x.url] ? ONLY_SHORT[music.onlyDuring[x.url]] : '⏱ any time'}
                    </button>
                    <button className="mu-ic sm" aria-label={`Rename ${x.name}`} title="Rename" onClick={() => setEditing(x.id)}><MuIcon d="pen" size={14} /></button>
                    <button className="mu-ic sm" aria-label={`Move ${x.name} up`} title="Move up" disabled={i === 0} onClick={() => saveMusic({ stations: moveStation(music.stations, x.id, -1) })}><MuIcon d="up" size={14} /></button>
                    <button className="mu-ic sm" aria-label={`Move ${x.name} down`} title="Move down" disabled={i === music.stations.length - 1} onClick={() => saveMusic({ stations: moveStation(music.stations, x.id, 1) })}><MuIcon d="down" size={14} /></button>
                    <button className="mu-ic sm" aria-label={`Remove ${x.name}`} title="Remove" onClick={() => saveMusic({ stations: removeStation(music.stations, x.id), focusMix: music.focusMix === x.id ? null : music.focusMix })}><MuIcon d="x" size={14} /></button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="mup-col">
          <section className="mup-card">
            <h3>Favourites</h3>
            <TrackList list={music.favs} ctl={sc} press={press} prefix="fav" empty="Star a track (☆ under the player) to keep it here." right={(x) => <button className="mu-ic sm" aria-label={`Remove ${x.title} from favourites`} onClick={() => saveMusic({ favs: toggleFav(music.favs, x) })}><MuIcon d="x" size={14} /></button>} />
          </section>
          <section className="mup-card">
            <h3>Recently played</h3>
            <TrackList list={recents.slice(0, 10)} ctl={sc} press={press} prefix="rec" empty="What you play shows up here (on this device)." />
          </section>
        </div>
      </div>
      </TabPanel>

      <TabPanel page="music" id="options" value={tab}>
      <div className="mup-cols">
        <div className="mup-col">
          <section className="mup-card" aria-label="Your SoundCloud">
            <YourScRow music={music} save={saveMusic} ctl={sc} press={press} prefix="page" />
          </section>
        </div>
        <div className="mup-col">
          <section className="mup-card mup-opts">
            <h3>Options</h3>
            <label><input type="checkbox" checked={music.lyrics} onChange={(e) => saveMusic({ lyrics: e.target.checked })} /> Synced lyrics <small>(the song's name is looked up on lrclib.net)</small></label>
            <label><input type="checkbox" checked={music.pillLyric} disabled={!music.lyrics} onChange={(e) => saveMusic({ pillLyric: e.target.checked })} /> Show the lyric line on the island's pill</label>
            <label><input type="checkbox" checked={music.nowToast} onChange={(e) => saveMusic({ nowToast: e.target.checked })} /> A small "now playing" card with the cover when the track changes</label>
            <label><input type="checkbox" checked={music.benSees} onChange={(e) => saveMusic({ benSees: e.target.checked })} /> Ben can see what's playing</label>
            <p className="mu-empty">It pauses by itself in a call, when the PC locks, and (with "Pause music during focus" on in PC & automation) when a focus timer starts. In the desktop app a focus mix plays instead, and the media keys work while it's loaded.</p>
          </section>
        </div>
      </div>
      </TabPanel>
    </div>
  )
}
