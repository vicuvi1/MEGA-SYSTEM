// A ring with a number inside (body-theme.css .bdy-ring), shared by the Body tabs.
import type { ReactNode } from 'react'

export function BtRing({ frac, size = 96, stroke = 9, tone = '', label, children }: { frac: number; size?: number; stroke?: number; tone?: '' | 'ok' | 'low'; label?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const f = Math.max(0, Math.min(1, Number(frac) || 0))
  return (
    <span className={`bdy-ring ${tone}`} role={label ? 'img' : undefined} aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="bg" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle className="fg" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeDasharray={`${c * f} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span>{children}</span>
    </span>
  )
}
