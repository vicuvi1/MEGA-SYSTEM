// Small shared pieces of Sport Track's sections: the card header, a progress
// ring and the play icon. Looks: sport-track.css (Life's tokens, lime accent).
import type { ReactNode } from 'react'
import { Icon } from '../Icon'

export const sign = (n: number, d = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(d)}`

export function CardHead({ icon, title, sub, right }: { icon: Parameters<typeof Icon>[0]['name']; title: string; sub?: string; right?: ReactNode }) {
  return (
    <header className="sp-head">
      <span className="sp-head-icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <div className="sp-head-text">
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {right && <div className="sp-head-right">{right}</div>}
    </header>
  )
}

export function Ring({ value, size = 96, stroke = 8, children }: { value: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value || 0))
  return (
    <span className="sp-ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="sp-ring-bg" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} className="sp-ring-fg" strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - v)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="sp-ring-in">{children}</span>
    </span>
  )
}

export const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 1.8v10.4L12 7z" fill="currentColor" />
  </svg>
)
