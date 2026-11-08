import type { ReactNode } from 'react'
// A small progress ring (SVG). The fill animates with a CSS transition that
// reduced motion turns off (training.css).
export function Ring({ pct, size = 56, stroke = 6, label, children, tone }: { pct: number; size?: number; stroke?: number; label: string; children?: ReactNode; tone?: 'done' | 'ended' }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(1, pct || 0))
  return (
    <span className={`bt-ring${tone ? ` ${tone}` : ''}`} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle className="bt-ring-bg" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle className="bt-ring-fg" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      {children != null && <span className="bt-ring-in">{children}</span>}
    </span>
  )
}
