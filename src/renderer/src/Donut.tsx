// One donut for the app (the Money page's "Where money goes" ring, Study Time's
// "Where your time goes"): stroked SVG circles, one per part, drawn when it
// comes into view; the big number and its words sit in the middle.
// Tap a part (or its legend row, done by the page) to pick it.
import type { ReactNode } from 'react'
import { useSeen } from './motionKit'
import './donut.css'

export interface DonutPart {
  key: string
  value: number
  color: string
  /** For the hover text. */
  label?: string
}

export function Donut({ parts, total, children, size, picked, onPick, className = '' }: { parts: DonutPart[]; total: number; children?: ReactNode; size?: number; picked?: string | null; onPick?: (key: string) => void; className?: string }) {
  const [ref, seen] = useSeen<HTMLDivElement>()
  const sum = Math.max(1, total)
  let acc = 0
  return (
    <div ref={ref} className={`mh-donut ${seen ? 'seen' : ''} ${picked ? 'has-pick' : ''} ${className}`} style={size ? { width: size, height: size } : undefined}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="bg" cx="60" cy="60" r="46" />
        {parts.map((p) => {
          const f = p.value / sum
          const gap = Math.max(0, f - 0.006)
          const el = (
            <circle
              key={p.key}
              className={picked === p.key ? 'on' : ''}
              cx="60"
              cy="60"
              r="46"
              pathLength={1}
              stroke={p.color}
              strokeDasharray={`${gap} ${1 - gap}`}
              strokeDashoffset={-acc}
              onClick={onPick ? () => onPick(p.key) : undefined}
              style={onPick ? { cursor: "pointer" } : undefined}
            >
              {p.label && <title>{p.label}</title>}
            </circle>
          )
          acc += f
          return el
        })}
      </svg>
      <div className="mh-donut-mid">{children}</div>
    </div>
  )
}
