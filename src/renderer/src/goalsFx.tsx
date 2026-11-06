// The Goals page's big moments: the milestone celebration (25/50/75/100 %,
// a week of a habit made) with a ring that fills to the new mark, a burst of
// confetti and the app's reward sound (if you want it), and the small
// climbing illustration on the empty page. Only transform and opacity move;
// with "reduce motion" there is no confetti and the ring is simply full.
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { m } from 'framer-motion'
import { feedback } from './fx'
import { reducedMotion, useCountUp } from './motionKit'
import { celebrationText, type Level } from '@core/goalKinds'
import type { GoalCard } from '@core/goals'

const SOUND = 'ls.goalSound'
export const goalSoundOn = () => {
  try {
    return localStorage.getItem(SOUND) !== '0'
  } catch {
    return true
  }
}
const setGoalSound = (on: boolean) => {
  try {
    localStorage.setItem(SOUND, on ? '1' : '0')
  } catch {
    /* a private window: the switch just doesn't stick */
  }
}

const CONFETTI = ['#c8f135', '#22d3ee', '#a78bfa', '#f5c451', '#fb7185', '#34d399']

/** A short burst of paper bits from the middle (none with reduce motion). */
export function Confetti({ n = 36, seed = 1 }: { n?: number; seed?: number }) {
  const bits = useMemo(() => {
    let s = seed * 9301 + 49297
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.5
      const r = 120 + rnd() * 160
      return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.75 - 40, rot: (rnd() - 0.5) * 540, c: CONFETTI[i % CONFETTI.length], w: 8 + rnd() * 8, round: rnd() > 0.6, d: rnd() * 60 }
    })
  }, [n, seed])
  if (reducedMotion()) return null
  return (
    <div className="gx-confetti" aria-hidden>
      {bits.map((b, i) => (
        <i key={i} className={b.round ? 'r' : ''} style={{ ['--x' as string]: `${b.x}px`, ['--y' as string]: `${b.y}px`, ['--r' as string]: `${b.rot}deg`, animationDelay: `${b.d}ms`, background: b.c, width: b.w, height: b.round ? b.w : b.w * 0.45 }} />
      ))}
    </div>
  )
}

/** The ring of the celebration: fills from the last mark to the new one. */
function BigRing({ from, to, emoji }: { from: number; to: number; emoji: string }) {
  const [go, setGo] = useState(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => setGo(true))
    return () => cancelAnimationFrame(t)
  }, [])
  const v = useCountUp(go ? to : from, 400)
  const size = 168
  const r = 70
  const c = 2 * Math.PI * r
  return (
    <div className="gx-cel-ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <defs>
          <linearGradient id="gx-cel-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#c8f135" />
            <stop offset="1" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        <circle cx={84} cy={84} r={r} className="bg" strokeWidth={12} />
        <circle cx={84} cy={84} r={r} className="fg" strokeWidth={12} stroke="url(#gx-cel-g)" strokeDasharray={`${(Math.max(0, Math.min(100, v)) / 100) * c} ${c}`} transform="rotate(-90 84 84)" />
      </svg>
      <div className="gx-cel-in">
        <span className="gx-cel-emoji">{emoji}</span>
        <b className="num">{Math.round(v)}%</b>
      </div>
    </div>
  )
}

/**
 * One celebration at a time. `level`: the mark just passed. Plays the reward
 * sound once (when the sound is on), closes on a tap, Esc, or by itself.
 */
export function Celebration({ card, level, onClose, onGo }: { card: GoalCard; level: Level; onClose: () => void; onGo?: (what: 'rewards') => void }) {
  const [sound, setSound] = useState(goalSoundOn)
  const t = celebrationText(card, level)
  const emoji = card.meta?.emoji || (level === 100 ? '🏆' : '🎯')
  const from = card.period ? 0 : Math.max(0, level - 25)
  const reward = level === 100 && !card.period ? card.meta?.reward : null
  useEffect(() => {
    if (goalSoundOn()) feedback('reward')
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    const auto = window.setTimeout(onClose, 9000)
    return () => {
      window.removeEventListener('keydown', k)
      window.clearTimeout(auto)
    }
  }, [onClose])
  return createPortal(
    <div className="gx-cel-scrim" onClick={(e) => e.target === e.currentTarget && onClose()} role="presentation">
      <m.div className={`gx-cel cv-${card.meta?.cover ?? 'aurora'}`} role="dialog" aria-modal="true" aria-label={t.title} initial={{ opacity: 0, scale: 0.88, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 26 }}>
        <Confetti seed={card.goal.id + level} />
        <span className="gx-kicker">{card.period ? 'Streak' : `Milestone · ${level}%`}</span>
        <BigRing from={from} to={card.period ? 100 : level} emoji={emoji} />
        <h2>{t.title}</h2>
        <p>{t.line}</p>
        {reward && (
          <p className="gx-cel-reward">
            🎁 Unlocked: <b>{reward.emoji ? `${reward.emoji} ` : ''}{reward.title}</b>
          </p>
        )}
        <div className="gx-cel-act">
          {reward && onGo && (
            <button className="btn" onClick={() => (onGo('rewards'), onClose())}>
              Open Rewards
            </button>
          )}
          <button className="btn primary" onClick={onClose} autoFocus>
            {level === 100 ? 'Yes! 🙌' : 'Keep going'}
          </button>
          <button
            className="btn ghost small gx-cel-sound"
            aria-pressed={sound}
            onClick={() => {
              setGoalSound(!sound)
              setSound(!sound)
            }}
            title="The celebration sound"
          >
            {sound ? '🔊 Sound on' : '🔈 Sound off'}
          </button>
        </div>
      </m.div>
    </div>,
    document.body
  )
}

/** The empty page's small picture: a path up a hill, a flag, a dot that climbs. */
export function ClimbArt() {
  return (
    <svg className="gx-climb" viewBox="0 0 240 150" role="img" aria-label="A path up to a flag">
      <defs>
        <linearGradient id="gx-hill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="h1" />
          <stop offset="1" className="h2" />
        </linearGradient>
      </defs>
      <circle cx="196" cy="34" r="16" className="sun" />
      <path d="M0 150 L70 72 L104 104 L150 40 L240 150 Z" fill="url(#gx-hill)" className="hill" />
      <path d="M18 140 C 60 132, 70 112, 96 108 S 130 84, 150 46" className="trail" pathLength={1} />
      <g className="flag">
        <line x1="150" y1="46" x2="150" y2="18" />
        <path d="M150 18 L172 24 L150 31 Z" />
      </g>
      <g className="climber">
        <circle r="6" />
      </g>
      <g className="spark s1"><path d="M0 -5 L1.4 -1.4 L5 0 L1.4 1.4 L0 5 L-1.4 1.4 L-5 0 L-1.4 -1.4 Z" /></g>
      <g className="spark s2"><path d="M0 -4 L1.1 -1.1 L4 0 L1.1 1.1 L0 4 L-1.1 1.1 L-4 0 L-1.1 -1.1 Z" /></g>
    </svg>
  )
}
