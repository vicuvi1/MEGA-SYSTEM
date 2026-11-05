// Little animated scenes for the island's reminders (A1–A7): water sloshes in a
// glass, a figure stretches, eyes blink through a 20-second break, the sky
// turns to night, a finished timer bursts, Ben's words type in, a reward
// throws confetti. Each sits at the top of the alert (peek and panel).
// Also the island's small live pieces: the glass, rolling digits, the marquee
// and the count-up. Pure presentation: no data is changed here. How much moves
// follows the island's feel (Full / Calm / Off, islandFeel.ts).
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { animate, motion, useMotionValue, useReducedMotion } from 'framer-motion'
import { useFeel, wavePath } from './islandFeel'

/** A ring that counts down `seconds` from when it appears; calls onDone at the end. */
function CountRing({ seconds, size = 40, color = '#d4ff3f', onDone }: { seconds: number; size?: number; color?: string; onDone?: () => void }) {
  const [left, setLeft] = useState(seconds)
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const start = Date.now()
    const t = setInterval(() => {
      const l = Math.max(0, seconds - (Date.now() - start) / 1000)
      setLeft(l)
      if (l <= 0) {
        clearInterval(t)
        done.current?.()
      }
    }, 250)
    return () => clearInterval(t)
  }, [seconds])
  const r = size / 2 - 3
  const c = 2 * Math.PI * r
  return (
    <span className="sc-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.14)" strokeWidth="3" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - left / seconds)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset 0.25s linear' }} />
      </svg>
      <b>{left >= 60 ? `${Math.ceil(left / 60)}m` : Math.ceil(left)}</b>
    </span>
  )
}

/** A tap on +250 / +500: `n` changes on each tap, `ml` is how much went in. */
export interface WaterSplash { n: number; ml: number }

// The glass, in its own 40×48 box: the inside of a tumbler.
const GLASS = 'M6.5 4 L33.5 4 L30.6 42.6 Q30.3 46 27 46 L13 46 Q9.7 46 9.4 42.6 Z'
const GLASS_TOP = 6
const GLASS_BOTTOM = 45
const FRONT_WAVE = wavePath(40, 2, 7)
const BACK_WAVE = wavePath(26, 1.6, 7)

/**
 * Water in a glass (WATER): a real liquid with two sine waves sliding past
 * each other, the level easing to today's amount with a spring, a slosh and
 * rising bubbles when it changes, a drop + splash + "+250 ml" falling in on
 * each tap, and a shimmer once when the day's target is reached.
 * Calm: just the eased fill. Off: still.
 */
export function Glass({ pct, size = 48, splash, shimmer = 0, label = true }: { pct: number; size?: number; splash?: WaterSplash; shimmer?: number; label?: boolean }) {
  const f = useFeel()
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const level = Math.max(0, Math.min(1, pct))
  // Where the surface sits (an empty glass still shows a film of water).
  const surface = GLASS_BOTTOM - Math.max(0.04, level) * (GLASS_BOTTOM - GLASS_TOP)
  const tilt = useMotionValue(0)
  const amp = useMotionValue(1)
  // The slosh is drawn straight into the SVG: the surface leans (a shear around
  // its middle, so the sides never show a gap) and the waves grow taller, both
  // springing back (no React re-render per frame).
  const tiltEl = useRef<SVGGElement>(null)
  const ampEl = useRef<SVGGElement>(null)
  useEffect(() => {
    const a = tilt.on('change', (v) => tiltEl.current?.setAttribute('transform', `translate(20 0) skewY(${v.toFixed(2)}) translate(-20 0)`))
    const b = amp.on('change', (v) => ampEl.current?.setAttribute('transform', `scale(1 ${Math.max(0.4, v).toFixed(3)})`))
    return () => {
      a()
      b()
    }
  }, [tilt, amp])
  const [bubbles, setBubbles] = useState<{ id: number; x: number; r: number; d: number }[]>([])
  // IC10: the waves move for 3 s after a pour (and in the peek, the panel, on hover: island.css), else still.
  const [pouring, setPouring] = useState(false)
  const before = useRef(level)
  useEffect(() => {
    const was = before.current
    before.current = level
    if (!f.extras || Math.abs(level - was) < 0.001) return setPouring(false)
    setPouring(true)
    const pour = window.setTimeout(() => setPouring(false), 3000)
    const stopPour = () => clearTimeout(pour)
    // Slosh: the surface tips toward the pour and rocks back (a loose spring).
    tilt.set(level > was ? -6 : 4)
    amp.set(2.4)
    const a = animate(tilt, 0, f.slosh)
    const b = animate(amp, 1, f.slosh)
    if (level > was) {
      const at = Date.now()
      setBubbles(Array.from({ length: 6 }, (_, i) => ({ id: at + i, x: 12 + ((i * 7.3) % 16), r: 0.8 + (i % 3) * 0.45, d: i * 0.09 })))
      const t = window.setTimeout(() => setBubbles([]), 1500)
      return () => {
        a.stop()
        b.stop()
        clearTimeout(t)
        stopPour()
      }
    }
    return () => {
      a.stop()
      b.stop()
      stopPour()
    }
  }, [level, f, tilt, amp])
  const tap = splash && splash.n > 0 && f.extras ? splash : null
  const w = Math.round((size * 40) / 48)
  return (
    <span className={`glass ${f.extras ? 'live' : 'still'} ${pouring ? 'pouring' : ''} ${level >= 1 ? 'full' : ''}`} style={{ width: w, height: size }} aria-hidden>
      <svg viewBox="0 0 40 48" width={w} height={size}>
        <defs>
          <clipPath id={`gc${uid}`}>
            <path d={GLASS} />
          </clipPath>
          <linearGradient id={`gw${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--water-hi, #8fdcff)" />
            <stop offset="1" stopColor="var(--water, #2f8fe6)" />
          </linearGradient>
          <linearGradient id={`gs${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.75" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={GLASS} fill="rgb(255 255 255 / 0.06)" />
        <g clipPath={`url(#gc${uid})`}>
          <motion.g initial={false} animate={{ y: surface }} transition={f.level}>
            <g ref={tiltEl}>
              <g ref={ampEl}>
                <path className="gl-w back" d={BACK_WAVE} fill="var(--water-hi, #8fdcff)" opacity="0.5" />
                <path className="gl-w front" d={FRONT_WAVE} fill={`url(#gw${uid})`} />
              </g>
              <rect x="-6" y="2" width="52" height="60" fill={`url(#gw${uid})`} />
            </g>
          </motion.g>
          {bubbles.map((b) => (
            <motion.circle key={b.id} cx={b.x} cy={GLASS_BOTTOM - 1} r={b.r} fill="none" stroke="rgb(255 255 255 / 0.85)" strokeWidth="0.6" initial={{ y: 0, opacity: 0 }} animate={{ y: [0, (surface - GLASS_BOTTOM) * 0.5, surface - GLASS_BOTTOM + 2], x: [0, 1.2, -0.8], opacity: [0, 1, 0] }} transition={{ duration: 1, delay: b.d, ease: 'easeOut' }} />
          ))}
          {tap && (
            <g key={`sp${tap.n}`}>
              <motion.ellipse cx="20" cy={surface} rx="3" ry="0.9" fill="none" stroke="#dff4ff" strokeWidth="0.9" initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: [0.3, 3.2], opacity: [0, 1, 0] }} transition={{ duration: 0.55, delay: 0.3, ease: 'easeOut' }} style={{ originX: 0.5, originY: 0.5 }} />
              {[-1, 0, 1].map((d) => (
                <motion.circle key={d} cx={20 + d * 2} cy={surface} r="0.9" fill="#dff4ff" initial={{ opacity: 0 }} animate={{ x: [0, d * 5], y: [0, -6 + Math.abs(d) * 2, 1], opacity: [0, 1, 0] }} transition={{ duration: 0.45, delay: 0.32, ease: 'easeOut' }} />
              ))}
            </g>
          )}
          {shimmer > 0 && f.extras && <motion.rect key={`sh${shimmer}`} x="-14" y="0" width="12" height="48" fill={`url(#gs${uid})`} transform="skewX(-18)" initial={{ x: 0, opacity: 0 }} animate={{ x: 60, opacity: [0, 1, 1, 0] }} transition={{ duration: 1, ease: 'easeInOut', delay: 0.25 }} />}
        </g>
        {tap && (
          <motion.path key={`dr${tap.n}`} d="M20 0 C20 0 17 4.5 17 6.3 A3 3 0 0 0 23 6.3 C23 4.5 20 0 20 0 Z" fill="var(--water-hi, #8fdcff)" initial={{ y: -10, opacity: 0 }} animate={{ y: [-10, surface - 6], opacity: [0, 1, 1, 0] }} transition={{ duration: 0.34, ease: 'easeIn' }} />
        )}
        <path d={GLASS} fill="none" className="gl-edge" stroke="rgb(255 255 255 / 0.55)" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M10 9 L11.8 38" stroke="rgb(255 255 255 / 0.22)" strokeWidth="1.4" strokeLinecap="round" />
        {shimmer > 0 && f.extras && <motion.path key={`ed${shimmer}`} d={GLASS} fill="none" stroke="#bfeaff" strokeWidth="2" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.2, delay: 0.2 }} />}
      </svg>
      {tap && label && (
        <motion.b key={`lb${tap.n}`} className="gl-label" initial={{ y: -size * 0.45, opacity: 0, scale: 0.8 }} animate={{ y: [-size * 0.45, (surface / 48) * size - 9], opacity: [0, 1, 1, 0], scale: [0.8, 1, 1, 0.7] }} transition={{ duration: 0.62, ease: 'easeIn' }}>
          +{tap.ml} ml
        </motion.b>
      )}
    </span>
  )
}

/** A1: the water reminder: the glass with today's water and the percent, rolling. */
export function WaterScene({ pct, splash, shimmer }: { pct: number; splash?: WaterSplash; shimmer?: number }) {
  return (
    <div className="sc sc-water" aria-hidden>
      <Glass pct={pct} size={60} splash={splash} shimmer={shimmer} />
      <span className="sc-cap">
        <Roll text={`${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%`} up />
      </span>
    </div>
  )
}

/**
 * Rolling digits (IL5): each character slides in its own slot when it changes,
 * like a flip clock. `up`: new digits come up from below (a number growing);
 * else they drop from above (a countdown). Calm: a quick crossfade; Off: plain text.
 * IC8: plain CSS animations (no animation library per digit): a ticking
 * timer only changes the one or two characters that changed.
 */
export function Roll({ text, up = false, className = '' }: { text: string; up?: boolean; className?: string }) {
  const f = useFeel()
  // The text before the last change (kept while other things re-render, so a running roll isn't cut).
  const hist = useRef({ cur: text, prev: text })
  if (hist.current.cur !== text) hist.current = { cur: text, prev: hist.current.cur }
  if (f.mode === 'off') return <span className={className}>{text}</span>
  const chars = [...text]
  const old = [...hist.current.prev]
  const changedText = hist.current.prev !== text
  return (
    <span className={`roll ${f.moves ? (up ? 'roll-up' : 'roll-down') : 'roll-fade'} ${className}`} aria-label={text}>
      {chars.map((c, i) => {
        // Lined up from the right, so "9:59" → "10:00" keeps the digits in their slots.
        const fromRight = chars.length - i
        const was = old[old.length - fromRight]
        const changed = changedText && was !== c
        return (
          <span className="roll-slot" key={fromRight} aria-hidden>
            <span className="roll-size">{c}</span>
            {changed && was !== undefined && (
              <span key={`o${was}>${c}`} className="roll-ch out">
                {was}
              </span>
            )}
            <span key={c} className={`roll-ch ${changed ? 'in' : ''}`}>
              {c}
            </span>
          </span>
        )
      })}
    </span>
  )
}

/**
 * A line of text that fades at the right edge when it is too long, and
 * slowly scrolls to its end while the mouse is on the island (IP2, Full only;
 * CSS in island.css). Without mask support it keeps the … ending.
 */
export function Marquee({ text, className = '' }: { text: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null)
  const [dist, setDist] = useState(0)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setDist(Math.max(0, el.scrollWidth - el.clientWidth))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text])
  const long = dist > 2
  return (
    <span ref={box} className={`mq ${long ? 'long' : ''} ${className}`} style={long ? ({ '--mq-d': `${-(dist + 14)}px`, '--mq-t': `${(2.4 + (dist + 14) / 26).toFixed(1)}s` } as CSSProperties) : undefined}>
      <span className="mq-in">{text}</span>
    </span>
  )
}

/** A number that counts up to its new value (push-ups +10), then settles. */
export function CountUp({ value }: { value: number }) {
  const f = useFeel()
  const [shown, setShown] = useState(value)
  const last = useRef(value)
  useEffect(() => {
    const from = last.current
    last.current = value
    if (!f.moves || value <= from) return setShown(value)
    const t0 = performance.now()
    let id = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 420)
      setShown(Math.round(from + (value - from) * (1 - (1 - k) ** 3)))
      if (k < 1) id = requestAnimationFrame(step)
    }
    id = requestAnimationFrame(step)
    return () => cancelAnimationFrame(id)
  }, [value, f.moves])
  return <>{shown}</>
}

/** A2: a figure stretching, and a 2-minute ring. */
export function MoveScene() {
  return (
    <div className="sc sc-move" aria-hidden>
      <svg viewBox="0 0 60 64" width="60" height="64" className="sc-fig">
        <circle cx="30" cy="10" r="6" fill="none" stroke="#ffb27a" strokeWidth="3" />
        <line x1="30" y1="16" x2="30" y2="40" stroke="#ffb27a" strokeWidth="3" strokeLinecap="round" />
        <g className="sc-arms">
          <line x1="30" y1="22" x2="14" y2="8" stroke="#ffb27a" strokeWidth="3" strokeLinecap="round" />
          <line x1="30" y1="22" x2="46" y2="8" stroke="#ffb27a" strokeWidth="3" strokeLinecap="round" />
        </g>
        <line x1="30" y1="40" x2="20" y2="60" stroke="#ffb27a" strokeWidth="3" strokeLinecap="round" />
        <line x1="30" y1="40" x2="40" y2="60" stroke="#ffb27a" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <CountRing seconds={120} color="#ffb27a" />
    </div>
  )
}

/** A3: eyes blink while a 20-second ring runs; then the break counts as done (IS7: the reminder goes, the island never closes itself). */
export function EyesScene({ onDone }: { onDone: () => void }) {
  return (
    <div className="sc sc-eyes" aria-hidden>
      <svg viewBox="0 0 80 40" width="80" height="40">
        {[24, 56].map((x) => (
          <g key={x}>
            <ellipse cx={x} cy="20" rx="13" ry="9" fill="#f5f5f6" />
            <circle cx={x} cy="20" r="5" fill="#2a2f45" className="sc-pupil" />
            <rect x={x - 14} y="10" width="28" height="20" fill="#05060a" className="sc-lid" />
          </g>
        ))}
      </svg>
      <CountRing seconds={20} color="#a99bff" onDone={onDone} />
      <span className="sc-cap">look 6 m away</span>
    </div>
  )
}

/** A4: the sky turns to night, stars twinkle, the moon rises. */
export function BedScene() {
  const stars = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ x: (i * 37) % 100, y: (i * 53) % 60, d: (i % 5) * 0.4 })), [])
  return (
    <div className="sc sc-bed" aria-hidden>
      {stars.map((s, i) => (
        <i key={i} style={{ left: `${s.x}%`, top: `${s.y}%`, animationDelay: `${s.d}s` }} />
      ))}
      <span className="sc-moon">🌙</span>
    </div>
  )
}

/** A5: the timer's ring bursts; a good session sweeps lime, a missed end pulses red. */
export function OverScene({ good }: { good: boolean }) {
  return (
    <div className={`sc sc-over ${good ? 'good' : ''}`} aria-hidden>
      <span className="sc-burst" />
      <span className="sc-burst b2" />
      <b>{good ? '✓' : '⏰'}</b>
    </div>
  )
}

/** A6: Ben's words type in, letter by letter. */
export function TypeIn({ text, speed = 18 }: { text: string; speed?: number }) {
  const off = useFeel().mode === 'off'
  const reduce = useReducedMotion() || off
  const [n, setN] = useState(reduce ? text.length : 0)
  useEffect(() => {
    if (reduce) return setN(text.length)
    setN(0)
    const t = setInterval(() => setN((x) => (x >= text.length ? (clearInterval(t), x) : x + 2)), speed)
    return () => clearInterval(t)
  }, [text, speed, reduce])
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && <i className="sc-caret" />}
    </>
  )
}

/** A7: confetti that bursts and falls, and a coin that flies to your points. */
export function RewardScene({ title }: { title: string }) {
  const f = useFeel()
  const reduce = useReducedMotion() || !f.extras
  const bits = useMemo(() => Array.from({ length: 26 }, (_, i) => ({ a: (i / 26) * Math.PI * 2 + (i % 3) * 0.2, v: 60 + ((i * 29) % 70), c: ['#d4ff3f', '#ffd451', '#ff7ab6', '#7fd4ff', '#ffffff'][i % 5], r: (i * 47) % 360 })), [])
  return (
    <div className="sc sc-reward" aria-hidden>
      {!reduce &&
        bits.map((b, i) => (
          <motion.i
            key={i}
            style={{ background: b.c }}
            initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
            animate={{ x: Math.cos(b.a) * b.v, y: [0, Math.sin(b.a) * b.v * 0.6, Math.sin(b.a) * b.v * 0.6 + 70], rotate: b.r * 2, opacity: [1, 1, 0] }}
            transition={{ duration: 1.6, ease: [0.15, 0.7, 0.3, 1] }}
          />
        ))}
      <motion.span className="sc-coin" initial={{ scale: 0.3, y: 10, opacity: 0 }} animate={reduce ? { scale: 1, opacity: 1 } : { scale: [0.3, 1.25, 1], y: [10, -4, 0], opacity: 1 }} transition={{ duration: 0.6 }}>
        🪙
      </motion.span>
      <motion.b initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
        {title}
      </motion.b>
    </div>
  )
}

/**
 * The scene for an alert kind, or null. `onAlertDone`: the scene finished
 * (the eye break's 20 s): it may only dismiss that reminder, never close the panel (IS7).
 */
export function AlertScene({ kind, water, splash, shimmer, title, onAlertDone }: { kind: string; water: { ml: number; target: number }; splash?: WaterSplash; shimmer?: number; title: string; onAlertDone: () => void }) {
  if (kind === 'water') return <WaterScene pct={water.target ? water.ml / water.target : 0} splash={splash} shimmer={shimmer} />
  if (kind === 'move') return <MoveScene />
  if (kind === 'eyes') return <EyesScene onDone={onAlertDone} />
  if (kind === 'bed' || kind === 'winddown') return <BedScene />
  if (kind === 'over') return <OverScene good={false} />
  if (kind === 'quality' || kind === 'end') return <OverScene good />
  if (kind === 'reward') return <RewardScene title={title} />
  return null
}
