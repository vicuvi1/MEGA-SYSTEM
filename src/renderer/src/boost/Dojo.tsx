// LF14: Dojo mode. A full-screen deep-focus scene over the app while the
// focus timer runs: a wallpaper-style picture (rainy dojo, starfield bridge,
// night city), soft rain or stars drawn by CSS (transform/opacity only), a
// breathing ink-brush ring that counts the timer down, the session's goal
// under it, an optional low ambient sound from the sound kit under your
// music, and a calm bow when the time is up. Esc (or ✕) leaves; the timer
// keeps running. Light: the clock redraws a few times a second through
// requestAnimationFrame (nothing while hidden); with reduce motion nothing
// breathes or falls.
import { useEffect, useMemo, useRef, useState } from 'react'
import { breathAt, dojoClock, frameMs, ringStroke, sceneOf, DOJO_SCENES, type DojoPrefs, type DojoScene } from '@core/dojo'
import { artUrl } from '../wallpaper/art'
import { reducedMotion } from '../motionKit'
import { setBedVolume, startBed, stopBed } from '../soundKit'

export interface DojoTimer {
  subject: string
  goal?: string | null
  startedAt: number
  endsAt: number
  /** Paused since (ms), or null. */
  pausedAt?: number | null
}

const R = 118

export function Dojo({ timer, prefs, onScene, onClose, now: fixedNow }: { timer: DojoTimer | null; prefs: DojoPrefs; onScene: (s: DojoScene) => void; onClose: () => void; now?: () => number }) {
  const clock = fixedNow ?? Date.now
  const reduced = useMemo(() => reducedMotion(), [])
  const [now, setNow] = useState(clock())
  const [bowed, setBowed] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const scene = sceneOf(prefs.scene)
  const art = artUrl(scene.art)
  const end = timer ? (timer.pausedAt ? timer.endsAt + (now - timer.pausedAt) : timer.endsAt) : now
  const total = timer ? Math.max(1, end - timer.startedAt) : 1
  const left = timer ? Math.max(0, end - now) : 0
  const ended = !!timer && left <= 0

  // The clock: a few frames a second (one a second with reduce motion), never while hidden.
  useEffect(() => {
    let raf = 0
    let last = 0
    const step = (t: number) => {
      if (t - last >= frameMs(reduced)) {
        last = t
        setNow(clock())
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [reduced, clock])

  // The low ambient sound under the music (the sound kit's own, one audio engine).
  useEffect(() => {
    if (prefs.ambient === 'off') return
    startBed(prefs.ambient)
    setBedVolume(prefs.ambientVol)
    return () => stopBed(1.2)
  }, [prefs.ambient, prefs.ambientVol])

  // The bow once the time is up (then the sound fades).
  useEffect(() => {
    if (!ended || bowed) return
    setBowed(true)
    stopBed(3)
  }, [ended, bowed])

  // Esc leaves; focus stays inside.
  useEffect(() => {
    box.current?.focus()
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const b = breathAt(now, prefs.breath, reduced)
  const s = ringStroke(left / total, R)
  return (
    <div className={`dojo dojo-${scene.id} ${reduced ? 'still' : ''} ${ended ? 'ended' : ''}`} role="dialog" aria-modal="true" aria-label="Dojo mode" tabIndex={-1} ref={box} data-dojo={scene.id}>
      {art && <img className="dojo-art" src={art} alt="" aria-hidden />}
      <div className="dojo-shade" aria-hidden />
      {!reduced && <div className={`dojo-fx fx-${scene.fx}`} aria-hidden>{Array.from({ length: scene.fx === 'stars' ? 28 : 22 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${-((i * 0.53) % 3).toFixed(2)}s`, animationDuration: `${(scene.fx === 'stars' ? 3 : 0.9) + (i % 5) * 0.17}s` }} />)}</div>}
      <div className="dojo-top">
        <div className="dojo-scenes" role="radiogroup" aria-label="Scene">
          {DOJO_SCENES.map((x) => (
            <button key={x.id} role="radio" aria-checked={x.id === scene.id} className={x.id === scene.id ? 'on' : ''} onClick={() => onScene(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        <button className="dojo-x" aria-label="Leave Dojo mode (Esc)" title="Leave (Esc). The timer keeps running." onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="dojo-center">
        {!ended ? (
          <>
            <svg className="dojo-ring" viewBox="0 0 300 300" aria-hidden>
              <g className="dojo-breath" style={{ transform: `scale(${b.scale})` }}>
                <circle cx="150" cy="150" r={R + 12} className="dojo-halo" style={{ opacity: 0.12 + 0.18 * (b.phase === 'in' ? b.t : 1 - b.t) }} />
                <circle cx="150" cy="150" r={R} className="dojo-track" />
                <circle cx="150" cy="150" r={R + 5} className="dojo-brush" />
                <circle cx="150" cy="150" r={R} className="dojo-ink" strokeDasharray={s.dash} strokeDashoffset={s.offset} transform="rotate(-90 150 150)" />
              </g>
            </svg>
            <div className="dojo-read">
              <b className="dojo-clock">{timer ? dojoClock(left) : '—'}</b>
              <span className="dojo-breath-word" aria-live="off">{reduced ? 'breathe' : b.phase === 'in' ? 'breathe in' : 'breathe out'}</span>
            </div>
          </>
        ) : (
          <div className="dojo-bow" aria-live="polite">
            <svg viewBox="0 0 120 120" aria-hidden className="dojo-bow-fig">
              <g className="dojo-bow-body">
                <circle cx="60" cy="30" r="9" />
                <path d="M60 40 L60 74" />
              </g>
              <path d="M60 74 L48 104 M60 74 L72 104" />
              <path d="M40 112 H80" className="dojo-floor" />
            </svg>
            <b>The bow.</b>
            <span>Well done. Say how it went when you’re ready.</span>
          </div>
        )}
        <p className="dojo-goal">{timer ? timer.goal || timer.subject : 'No timer is running: start one and come back.'}</p>
      </div>
    </div>
  )
}
