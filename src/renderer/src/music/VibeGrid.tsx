// MU: "Pick a vibe": the starter stations as cards (a generated gradient
// cover, an icon, a lift on hover, a play button that turns into an
// equalizer while it plays), the "Play something for now" button, and
// "Paste your own link" as a small secondary option. One tap plays. Used by
// the island's Music page and the app's Music page. Starters you hide sync
// (island_kit.music.hiddenStarters); ones SoundCloud won't play here hide by
// themselves (stationHealth.ts).
import { useState, type CSSProperties, type ReactNode } from 'react'
import { pickForNow, visibleStarters, whyPick, toggleHidden, type NowCtx, type StarterStation } from '@core/starterStations'
import type { MusicKit } from '@core/music'
import type { MusicCtl } from './remote'
import { Eq, type Press } from './MusicUi'
import { uiTick } from './engine'
import { useUnavailable } from './stationHealth'
import './vibes.css'

const PlayIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
  </svg>
)

function VibeCard({ st, ctl, press, prefix, onHide }: { st: StarterStation; ctl: MusicCtl; press: Press; prefix: string; onHide: () => void }) {
  const on = ctl.s.station?.url === st.url
  const playing = on && ctl.s.playing
  const go = () => {
    uiTick()
    if (on && ctl.s.ready) return ctl.run({ op: playing ? 'pause' : 'resume' })
    ctl.run({ op: 'play', station: { id: st.id, name: st.name, url: st.url, kind: st.kind } })
  }
  return (
    <div className={`vb-card ${on ? 'on' : ''} ${playing ? 'playing' : ''}`} style={{ ['--vb-a' as string]: st.colors[0], ['--vb-b' as string]: st.colors[1] } as CSSProperties}>
      <button className="vb-main" aria-label={playing ? `Pause ${st.name}` : `Play ${st.name}`} {...press(`${prefix}:vibe:${st.id}`, go)}>
        <span className="vb-art" aria-hidden>
          <i className="vb-glow" />
          <span className="vb-icon">{st.icon}</span>
          <span className="vb-play">
            <span className="vb-tri">
              <PlayIcon />
            </span>
            <Eq on={playing} className="vb-eq" />
          </span>
        </span>
        <b>{st.name}</b>
        <small>{st.blurb}</small>
      </button>
      <button className="vb-hide" aria-label={`Hide ${st.name}`} title="Hide this station (you can show it again)" {...press(`${prefix}:vibe-hide:${st.id}`, onHide)}>
        ×
      </button>
    </div>
  )
}

/**
 * The vibes. `now`: what's going on (the hour, a focus timer, a workout) for
 * "Play something for now". `paste`: the form for your own link, shown when
 * you open "Paste your own link".
 */
export function VibeGrid({ music, save, ctl, press, prefix, now, paste, title = 'Pick a vibe', pasteOpen }: { music: MusicKit; save: (m: Partial<MusicKit>) => void; ctl: MusicCtl; press: Press; prefix: string; now: NowCtx; paste?: ReactNode; title?: string; pasteOpen?: boolean }) {
  const unavailable = useUnavailable()
  const list = visibleStarters({ hidden: music.hiddenStarters, unavailable, mine: music.stations })
  const pick = pickForNow(now, list)
  const [open, setOpen] = useState(!!pasteOpen)
  const hidden = music.hiddenStarters.length
  return (
    <div className="vb">
      <div className="vb-head">
        <h4>{title}</h4>
        {hidden > 0 && (
          <button className="vb-link" {...press(`${prefix}:vibe-unhide`, () => save({ hiddenStarters: [] }))}>
            Show {hidden} hidden
          </button>
        )}
      </div>
      {pick && (
        <button
          className="vb-now"
          style={{ ['--vb-a' as string]: pick.colors[0], ['--vb-b' as string]: pick.colors[1] } as CSSProperties}
          {...press(`${prefix}:vibe-now`, () => (uiTick(), ctl.run({ op: 'play', station: { id: pick.id, name: pick.name, url: pick.url, kind: pick.kind } })))}
        >
          <span className="vb-now-ic" aria-hidden>
            <PlayIcon size={16} />
          </span>
          <span className="vb-now-t">
            <b>Play something for now</b>
            <small>
              {pick.icon} {pick.name} {whyPick(now)}
            </small>
          </span>
        </button>
      )}
      {list.length ? (
        <div className="vb-grid">
          {list.map((st) => (
            <VibeCard key={st.id} st={st} ctl={ctl} press={press} prefix={prefix} onHide={() => save({ hiddenStarters: toggleHidden(music.hiddenStarters, st.id) })} />
          ))}
        </div>
      ) : (
        <p className="mu-empty">No starter stations to show. {hidden ? 'Show the hidden ones, or paste' : 'Paste'} your own SoundCloud link.</p>
      )}
      {paste && (
        <div className="vb-own">
          {open || !list.length ? (
            paste
          ) : (
            <button className="vb-link" {...press(`${prefix}:vibe-own`, () => setOpen(true))}>
              + Paste your own SoundCloud link
            </button>
          )}
        </div>
      )}
    </div>
  )
}
