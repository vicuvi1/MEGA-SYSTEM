// One shared exercise demo for Sport Track's workout (replaces MovePic /
// DemoPic there): a bundled video (webm, muted, looping), else the two photo
// frames cross-fading, else an honest "No verified demo yet" with the written
// steps. Controls: play / pause, repeat, speed 0.5× / 0.75× / 1×. A fixed
// 16:10 frame, a loading skeleton, a fallback when a file fails (the next demo,
// then the steps) and prefers-reduced-motion (nothing plays by itself; photo
// frames show start and end side by side). Every demo carries a small source
// and licence tag, and the owner's "Looks right ✓" / "Wrong demo" answer
// (core/trainMedia.ts): a wrong demo is never shown again for that move. Nothing
// here is AI-made, and no drawing is ever shown as instruction.
import { useEffect, useMemo, useRef, useState } from 'react'
import { isVerified, mediaFor, mediaTag, type MediaItem, type MediaVerdicts } from '@core/trainMedia'
import { moveInfo } from '@core/trainLadders'
import './exercise-media.css'

export const SPEEDS = [0.5, 0.75, 1] as const
export type Speed = (typeof SPEEDS)[number]

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export interface MediaControls {
  playing: boolean
  speed: Speed
  togglePlay: () => void
  replay: () => void
  setSpeed: (s: Speed) => void
}

/** The play / pause / repeat / speed state, shared by the media and its control row. */
export function useMediaControls(): MediaControls & { round: number } {
  const [playing, setPlaying] = useState(() => !reducedMotion())
  const [speed, setSpeed] = useState<Speed>(1)
  const [round, setRound] = useState(0)
  return { playing, speed, round, togglePlay: () => setPlaying((p) => !p), replay: () => (setPlaying(true), setRound((r) => r + 1)), setSpeed }
}

interface Props {
  move: string
  verdicts?: MediaVerdicts
  /** The owner's answer for the shown demo (true: looks right, false: wrong demo, null: take it back). */
  onVerdict?: (id: string, ok: boolean | null) => void
  ctl: MediaControls & { round: number }
  /** "2 s down · 1 s up" */
  tempo?: string
  className?: string
}

/** The demo itself, in a fixed 16:10 frame. */
export function ExerciseMedia({ move, verdicts = {}, onVerdict, ctl, tempo, className = '' }: Props) {
  const items = useMemo(() => mediaFor(move, verdicts), [move, verdicts])
  const [failed, setFailed] = useState<string[]>([])
  useEffect(() => setFailed([]), [move])
  const item: MediaItem | undefined = items.find((m) => !failed.includes(m.id))
  const fail = (id: string) => setFailed((f) => (f.includes(id) ? f : [...f, id]))
  const name = moveInfo(move)?.name ?? move
  const reduced = reducedMotion()
  if (!item)
    return (
      <div className={`xm none ${className}`} data-media-kind="none" data-move={move}>
        <NoDemo move={move} broken={failed.length > 0} />
      </div>
    )
  const verified = isVerified(item, verdicts)
  return (
    <div className={`xm ${item.kind} ${className}`} data-media-kind={item.kind} data-media-id={item.id} data-move={move} data-playing={ctl.playing ? '1' : '0'} data-speed={ctl.speed}>
      {item.kind === 'video' ? (
        <VideoDemo key={`${item.id}`} item={item} name={name} ctl={ctl} onFail={() => fail(item.id)} />
      ) : (
        <FramesDemo key={`${item.id}:${ctl.round}`} item={item} name={name} ctl={ctl} reduced={reduced} onFail={() => fail(item.id)} />
      )}
      <span className="xm-tag" data-media-tag title={`${item.title} · ${item.author} · ${item.licence}. ${item.changes}${item.note ? ` ${item.note}` : ''}`}>
        {mediaTag(item)}
        {verified ? ' · checked by you ✓' : ''}
      </span>
      {tempo && <span className="xm-tempo">{tempo}</span>}
      {item.note && <span className="xm-note">{item.note}</span>}
      {onVerdict && (
        <span className="xm-verdict" role="group" aria-label="Is this demo right?">
          {verified ? (
            <button type="button" onClick={() => onVerdict(item.id, null)} data-media-verdict="undo">
              Undo check
            </button>
          ) : (
            <>
              <button type="button" onClick={() => onVerdict(item.id, true)} data-media-verdict="ok">
                Looks right ✓
              </button>
              <button type="button" onClick={() => onVerdict(item.id, false)} data-media-verdict="wrong">
                Wrong demo
              </button>
            </>
          )}
        </span>
      )}
    </div>
  )
}

function Skeleton() {
  return <span className="xm-skel" aria-hidden="true" />
}

function VideoDemo({ item, name, ctl, onFail }: { item: MediaItem; name: string; ctl: MediaControls & { round: number }; onFail: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.playbackRate = ctl.speed
  }, [ctl.speed, ready])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (ctl.playing) void el.play().catch(() => undefined)
    else el.pause()
  }, [ctl.playing, ready])
  useEffect(() => {
    const el = ref.current
    if (!el || !ctl.round) return
    el.currentTime = 0
    void el.play().catch(() => undefined)
  }, [ctl.round])
  return (
    <>
      {!ready && <Skeleton />}
      <video
        ref={ref}
        className={ready ? 'on' : ''}
        src={item.src[0]}
        muted
        loop
        playsInline
        preload="auto"
        aria-label={`${name}: demo video`}
        onLoadedData={() => setReady(true)}
        onError={onFail}
      />
    </>
  )
}

function FramesDemo({ item, name, ctl, reduced, onFail }: { item: MediaItem; name: string; ctl: MediaControls; reduced: boolean; onFail: () => void }) {
  const [loaded, setLoaded] = useState(0)
  const ready = loaded >= 2
  const dur = ctl.speed === 0.5 ? 5.2 : ctl.speed === 0.75 ? 3.5 : 2.6
  return (
    <span className={`xm-frames${reduced ? ' still' : ''}${ctl.playing ? '' : ' paused'}${ready ? ' on' : ''}`} style={{ ['--xm-dur' as string]: `${dur}s` }}>
      {!ready && <Skeleton />}
      <img src={item.src[0]} alt={`${name}, start`} draggable={false} onLoad={() => setLoaded((n) => n + 1)} onError={onFail} />
      <img className="b" src={item.src[1]} alt={`${name}, end`} draggable={false} onLoad={() => setLoaded((n) => n + 1)} onError={onFail} />
    </span>
  )
}

/** No demo (or every file failed): say so, and give the written steps. Never a drawing dressed up as technique. */
function NoDemo({ move, broken }: { move: string; broken: boolean }) {
  const info = moveInfo(move)
  return (
    <div className="xm-none">
      <b>{broken ? 'The demo could not load' : 'No verified demo yet'}</b>
      <span className="xm-none-sub">{info?.name ?? move}: follow these steps</span>
      <ol>
        {(info?.steps ?? []).slice(0, 3).map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      {info?.mistake && <p className="xm-none-tip">Common mistake: {info.mistake}</p>}
    </div>
  )
}

/** Play / pause, repeat and speed, as one row under the demo. */
export function MediaBar({ ctl, hasMedia, children }: { ctl: MediaControls; hasMedia: boolean; children?: React.ReactNode }) {
  return (
    <div className="xm-bar">
      <button type="button" className="xm-btn play" onClick={ctl.togglePlay} disabled={!hasMedia} aria-label={ctl.playing ? 'Pause demo' : 'Play demo'} data-media-ctl="play">
        {ctl.playing ? 'Pause demo' : 'Play demo'}
      </button>
      <button type="button" className="xm-btn" onClick={ctl.replay} disabled={!hasMedia} data-media-ctl="repeat">
        Repeat
      </button>
      <div className="xm-speeds" role="group" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button key={s} type="button" aria-pressed={ctl.speed === s} className={ctl.speed === s ? 'on' : ''} onClick={() => ctl.setSpeed(s)} disabled={!hasMedia} data-media-speed={s}>
            {s}×
          </button>
        ))}
      </div>
      {children}
    </div>
  )
}
