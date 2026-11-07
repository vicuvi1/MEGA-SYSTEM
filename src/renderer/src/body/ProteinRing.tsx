// A small ring: today's protein against the goal (Today, Body, the island).
// The arc is drawn once (nothing animates: motion budget).
import './protein-ring.css'

export function ProteinRing({ g, goal, size = 64, label = true }: { g: number; goal: number; size?: number; label?: boolean }) {
  const r = size / 2 - 5
  const c = 2 * Math.PI * r
  const f = goal > 0 ? Math.min(1, g / goal) : 0
  const done = goal > 0 && g >= goal
  return (
    <span className={`pr-ring${done ? ' done' : ''}`} role="img" aria-label={`Protein: ${g} of ${goal} g today`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="pr-ring-bg" />
        <circle cx={size / 2} cy={size / 2} r={r} className="pr-ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - f)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      {label && (
        <span className="pr-ring-num">
          <b>{g}</b>
          <small>/{goal} g</small>
        </span>
      )}
    </span>
  )
}
