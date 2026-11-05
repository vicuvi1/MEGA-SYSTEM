// Little animated scenes for the island's reminders (A1–A7): water fills a
// glass, a figure stretches, eyes blink through a 20-second break, the sky
// turns to night, a finished timer bursts, Ben's words type in, a reward
// throws confetti. Each sits at the top of the alert (peek and panel).
// Pure presentation: no data is changed here.
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

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

/** A1: a drop falls into a glass that fills to today's water; `splash` changes on each +250. */
export function WaterScene({ pct, splash }: { pct: number; splash: number }) {
  const reduce = useReducedMotion()
  const level = Math.max(0.06, Math.min(1, pct))
  return (
    <div className="sc sc-water" aria-hidden>
      <svg viewBox="0 0 80 64" width="80" height="64">
        <defs>
          <clipPath id="glass">
            <path d="M22 14 L58 14 L54 58 Q53 61 50 61 L30 61 Q27 61 26 58 Z" />
          </clipPath>
          <linearGradient id="wat" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7fd4ff" />
            <stop offset="1" stopColor="#2f8fe6" />
          </linearGradient>
        </defs>
        <g clipPath="url(#glass)">
          <motion.g initial={false} animate={{ y: 47 * (1 - level) }} transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 80, damping: 14 }}>
            <rect x="18" y="14" width="44" height="60" fill="url(#wat)" />
            <motion.path d="M10 15 Q20 11 30 15 T50 15 T70 15 L70 20 L10 20 Z" fill="#9fe0ff" animate={reduce ? undefined : { x: [0, -20, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }} />
          </motion.g>
        </g>
        <path d="M22 14 L58 14 L54 58 Q53 61 50 61 L30 61 Q27 61 26 58 Z" fill="none" stroke="rgb(255 255 255 / 0.55)" strokeWidth="2" />
        {!reduce && (
          <motion.path key={`d${splash}`} d="M40 0 C40 0 35 7 35 10 A5 5 0 0 0 45 10 C45 7 40 0 40 0 Z" fill="#9fe0ff" initial={{ y: -12, opacity: 1 }} animate={{ y: 14 + 40 * (1 - level), opacity: [1, 1, 0] }} transition={{ duration: 0.7, ease: 'easeIn' }} />
        )}
        {!reduce && splash > 0 && (
          <motion.ellipse key={`s${splash}`} cx="40" cy={16 + 44 * (1 - level)} rx="4" ry="1.5" fill="none" stroke="#bfeaff" strokeWidth="1.5" initial={{ scale: 0.4, opacity: 1 }} animate={{ scale: 3.4, opacity: 0 }} transition={{ duration: 0.8, delay: 0.6 }} style={{ transformOrigin: 'center', transformBox: 'fill-box' }} />
        )}
      </svg>
      <span className="sc-cap">{Math.round(level * 100)}%</span>
    </div>
  )
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

/** A3: eyes blink while a 20-second ring runs; then it closes itself. */
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
  const reduce = useReducedMotion()
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
  const reduce = useReducedMotion()
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

/** The scene for an alert kind, or null. */
export function AlertScene({ kind, water, splash, title, onDone }: { kind: string; water: { ml: number; target: number }; splash: number; title: string; onDone: () => void }) {
  if (kind === 'water') return <WaterScene pct={water.target ? water.ml / water.target : 0} splash={splash} />
  if (kind === 'move') return <MoveScene />
  if (kind === 'eyes') return <EyesScene onDone={onDone} />
  if (kind === 'bed' || kind === 'winddown') return <BedScene />
  if (kind === 'over') return <OverScene good={false} />
  if (kind === 'quality' || kind === 'end') return <OverScene good />
  if (kind === 'reward') return <RewardScene title={title} />
  return null
}
