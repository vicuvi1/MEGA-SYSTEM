// Drawings for the Discipline page: the streak ring, the rank emblems and the
// day medals. Pure SVG; the motion is CSS and stops under reduced motion.
import { useEffect, useState, type ReactNode } from 'react'

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

/** A ring that draws itself in once (0–1). */
export function Ring({ size, stroke, pct, className = '', children, label }: { size: number; stroke: number; pct: number; className?: string; children?: ReactNode; label?: string }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(pct))
    return () => cancelAnimationFrame(id)
  }, [pct])
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div className={`dx-ring ${className}`} style={{ width: size, height: size }} role={label ? 'img' : undefined} aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="dx-ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="dx-ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(1, shown)))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="dx-ring-in">{children}</div>
    </div>
  )
}

export function Flame({ size = 22 }: { size?: number }) {
  return (
    <svg className="dx-flame" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2.5c.6 3-1.2 4.7-2.6 6.3C8 10.4 6.8 12 6.8 14.4A5.2 5.2 0 0 0 12 19.6a5.2 5.2 0 0 0 5.2-5.2c0-2-.8-3.4-1.7-4.6-.3 1.2-1 2-1.9 2.4.4-3.5-.4-7-1.6-9.7Z"
        fill="currentColor"
      />
      <path d="M12 21.5a3 3 0 0 1-3-3c0-1.6 1.3-2.5 2.2-3.7.3 1 .9 1.5 1.6 1.7.1-.8 0-1.5-.3-2.3 1.4 1 2.5 2.4 2.5 4.3a3 3 0 0 1-3 3Z" fill="currentColor" opacity="0.55" />
    </svg>
  )
}

/** A rank emblem: a shield with the tier's numeral (locked ones are faint). */
export function Emblem({ tier, state = 'done', size = 56 }: { tier: number; state?: 'done' | 'current' | 'locked'; size?: number }) {
  const top = tier >= 6
  return (
    <svg className={`dx-emblem t${tier} ${state}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={`dxg${tier}${state}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="dx-em-a" />
          <stop offset="1" className="dx-em-b" />
        </linearGradient>
      </defs>
      {top && <path className="dx-em-wings" d="M6 22c4 1 7 4 9 8-4 0-7-2-9-8Zm52 0c-4 1-7 4-9 8 4 0 7-2 9-8ZM8 34c4 0 7 2 9 6-4 1-7-1-9-6Zm48 0c-4 0-7 2-9 6 4 1 7-1 9-6Z" />}
      <path className="dx-em-shield" d="M32 5 52 12v17c0 14-8.6 24-20 30C20.6 53 12 43 12 29V12Z" fill={`url(#dxg${tier}${state})`} />
      <path className="dx-em-inner" d="M32 11 47 16.4V29c0 10.6-6.3 18.3-15 23-8.7-4.7-15-12.4-15-23V16.4Z" fill="none" />
      {state === 'locked' ? (
        <path className="dx-em-lock" d="M27 30v-3a5 5 0 0 1 10 0v3h1.5v10h-13V30Zm3 0h4v-3a2 2 0 0 0-4 0Z" />
      ) : (
        <text className="dx-em-num" x="32" y="37" textAnchor="middle" dominantBaseline="middle">
          {ROMAN[tier - 1] ?? tier}
        </text>
      )}
    </svg>
  )
}

/** A day medal for the badge grid. */
export function Medal({ days, state }: { days: number; state: 'now' | 'earned' | 'next' | 'locked' }) {
  return (
    <svg className={`dx-medal ${state}`} width="58" height="58" viewBox="0 0 64 64" aria-hidden="true">
      <path className="dx-md-ribbon" d="M20 4h10l4 14h-10ZM44 4H34l-4 14h10Z" />
      <circle className="dx-md-rim" cx="32" cy="38" r="22" />
      <circle className="dx-md-face" cx="32" cy="38" r="17" />
      {state === 'locked' ? (
        <path className="dx-md-lock" d="M27.5 37v-2.6a4.5 4.5 0 0 1 9 0V37H38v9H26v-9Zm2.7 0h3.6v-2.6a1.8 1.8 0 0 0-3.6 0Z" />
      ) : (
        <text className="dx-md-num" x="32" y="39" textAnchor="middle" dominantBaseline="middle">
          {days}
        </text>
      )}
    </svg>
  )
}
