// The desktop island's shapes (IM1, IM2, IM9, IM10, IC5, IC13): the pill's
// end caps per activity, the liquid progress border, the page turn between
// activities, the day-part sky, the Today ring and the bedtime crescent.
// Transform and opacity only; the live ones redraw on the shared clock
// (onFrame: 4 times a second when still, nothing while hidden).
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { onFrame, ringColor, useFeel, type Feel } from './islandFeel'

/**
 * IM2: a rounded rectangle's outline as one path that starts at the top
 * middle and runs clockwise (pure: tested), so "how far" fills from the top.
 */
export function roundedRectPath(w: number, h: number, r: number, inset = 1): string {
  const x0 = inset
  const y0 = inset
  const x1 = Math.max(x0 + 1, w - inset)
  const y1 = Math.max(y0 + 1, h - inset)
  const rr = Math.max(0, Math.min(r - inset, (x1 - x0) / 2, (y1 - y0) / 2))
  const mx = (x0 + x1) / 2
  const f = (n: number) => Number(n.toFixed(2))
  return [
    `M${f(mx)} ${f(y0)}`,
    `H${f(x1 - rr)}`,
    `A${f(rr)} ${f(rr)} 0 0 1 ${f(x1)} ${f(y0 + rr)}`,
    `V${f(y1 - rr)}`,
    `A${f(rr)} ${f(rr)} 0 0 1 ${f(x1 - rr)} ${f(y1)}`,
    `H${f(x0 + rr)}`,
    `A${f(rr)} ${f(rr)} 0 0 1 ${f(x0)} ${f(y1 - rr)}`,
    `V${f(y0 + rr)}`,
    `A${f(rr)} ${f(rr)} 0 0 1 ${f(x0 + rr)} ${f(y0)}`,
    'Z'
  ].join(' ')
}

/**
 * IM2: the pill's outline fills as the block or timer goes on, with a glowing
 * head; amber in the last 5 minutes, red once time is up (replaces the bottom
 * line while a timer runs). It is drawn for the shape at rest; while the
 * shape moves it fades out (CSS: .di.moving).
 */
export function LiquidBorder({ from, to, w, h, r, freeze = null }: { from: number; to: number; w: number; h: number; r: number; /** Paused at (ms): it holds still there. */ freeze?: number | null }) {
  const f = useFeel()
  const path = useRef<SVGPathElement>(null)
  const head = useRef<SVGCircleElement>(null)
  const d = roundedRectPath(w, h, r, 1)
  useEffect(() => {
    let total = 0
    let lastPct = -1
    let lastColor = '-'
    const draw = (t0: number) => {
      const t = freeze ?? t0
      const el = path.current
      if (!el) return
      const pct = Math.min(1, Math.max(0, (t - from) / Math.max(1, to - from)))
      if (Math.abs(pct - lastPct) >= 0.0008) {
        el.style.strokeDashoffset = String((1 - pct).toFixed(4))
        if (!total && typeof el.getTotalLength === 'function') total = el.getTotalLength()
        if (head.current && total && typeof el.getPointAtLength === 'function') {
          const pt = el.getPointAtLength(pct * total)
          head.current.style.transform = `translate(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px)`
          head.current.style.opacity = pct > 0.002 && pct < 0.999 ? '1' : '0'
        }
        lastPct = pct
      }
      const color = ringColor(to - t) ?? 'var(--lime)'
      if (color !== lastColor) {
        el.style.stroke = color
        if (head.current) head.current.style.fill = color
        lastColor = color
      }
    }
    if (f.mode === 'off') {
      draw(Date.now())
      const i = window.setInterval(() => draw(Date.now()), 1000)
      return () => clearInterval(i)
    }
    return onFrame(draw)
  }, [from, to, f, d, freeze])
  if (w < 20 || h < 10) return null
  return (
    <svg className="di-border" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={d} className="di-border-bg" />
      <path ref={path} d={d} className="di-border-fg" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1} />
      <circle ref={head} r={2.4} cx={0} cy={0} className="di-border-head" />
    </svg>
  )
}

/** IM9: the next activity turns in like a page (Full); Calm crossfades; Off jumps. */
export function pageTurn(f: Feel) {
  if (!f.moves) return { enter: { opacity: 0 }, center: { opacity: 1 }, exit: { opacity: 0 } }
  return {
    enter: (d: number) => ({ rotateY: d * 40, x: d * 12, opacity: 0 }),
    center: { rotateY: 0, x: 0, opacity: 1 },
    exit: (d: number) => ({ rotateY: d * -40, x: d * -12, opacity: 0 })
  }
}

/** IM10: the time of day, very softly, inside the pill (a few stars at night). Opacity only; Full only. */
export function Sky() {
  return (
    <span className="di-sky" aria-hidden>
      <i style={{ left: '14%', top: '28%' }} />
      <i style={{ left: '37%', top: '64%' }} />
      <i style={{ left: '63%', top: '22%' }} />
      <i style={{ left: '86%', top: '58%' }} />
    </span>
  )
}

/**
 * IM1: the pill's end caps per activity. A water pill's right end rounds into
 * a drop that fills with your day's water; a meeting grows a small calendar
 * tile with its time from the left. They share an id, so they morph as the
 * pill changes (Full), and their outline draws in with the feel's spring.
 */
export function DropCap({ pct }: { pct: number }) {
  const f = useFeel()
  const id = useId().replace(/:/g, '')
  const p = Math.min(1, Math.max(0, pct))
  return (
    <motion.span className="di-cap di-cap-r drop" layoutId={f.moves ? 'di-cap-r' : undefined} initial={f.moves ? { scale: 0.4, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }} transition={f.pop} aria-hidden>
      <svg width="18" height="22" viewBox="0 0 18 22">
        <defs>
          <clipPath id={`dc${id}`}>
            <path d="M9 1.5C9 1.5 2 9.4 2 14a7 7 0 0 0 14 0C16 9.4 9 1.5 9 1.5Z" />
          </clipPath>
        </defs>
        <g clipPath={`url(#dc${id})`}>
          <rect x="0" y="0" width="18" height="22" className="di-cap-water-bg" />
          <rect x="0" y="0" width="18" height="22" className="di-cap-water" style={{ transform: `translateY(${((1 - p) * 21).toFixed(1)}px)` }} />
        </g>
        <motion.path d="M9 1.5C9 1.5 2 9.4 2 14a7 7 0 0 0 14 0C16 9.4 9 1.5 9 1.5Z" className="di-cap-line" initial={f.moves ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={f.pop} />
      </svg>
    </motion.span>
  )
}
export function CalendarCap({ at }: { at: number }) {
  const f = useFeel()
  const t = new Date(at).toTimeString().slice(0, 5)
  return (
    <motion.span className="di-cap di-cap-l cal" layoutId={f.moves ? 'di-cap-l' : undefined} initial={f.moves ? { x: -10, scale: 0.6, opacity: 0 } : false} animate={{ x: 0, scale: 1, opacity: 1 }} transition={f.pop} aria-label={`at ${t}`}>
      <i />
      <b>{t}</b>
    </motion.span>
  )
}

/**
 * IC5: today in one glance: three slim rings around Ben's face (must-dos,
 * water, focus). The arcs ease to their new length.
 */
export function TodayRing({ must, water, focus, size = 30, children }: { must: number; water: number; focus: number; size?: number; children?: ReactNode }) {
  const rings = [
    { k: 'must', v: must, r: size / 2 - 1.2 },
    { k: 'water', v: water, r: size / 2 - 3.6 },
    { k: 'focus', v: focus, r: size / 2 - 6 }
  ]
  return (
    <span className="di-today" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        {rings.map((x) => {
          const c = 2 * Math.PI * x.r
          return (
            <g key={x.k} className={`tr-${x.k}`}>
              <circle cx={size / 2} cy={size / 2} r={x.r} className="bg" />
              <circle cx={size / 2} cy={size / 2} r={x.r} className="fg" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, x.v)))} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
            </g>
          )
        })}
      </svg>
      <span className="di-today-in">{children}</span>
    </span>
  )
}

/** IC13: a crescent moon that fills (moonlight blue) as bedtime comes closer. */
export function Crescent({ pct, size = 20 }: { pct: number; size?: number }) {
  const id = useId().replace(/:/g, '')
  const p = Math.min(1, Math.max(0, pct))
  return (
    <svg className="di-crescent" width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <defs>
        <mask id={`cm${id}`}>
          <rect width="20" height="20" fill="#000" />
          <circle cx="10" cy="10" r="8" fill="#fff" />
          <circle cx="14" cy="7" r="7" fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#cm${id})`}>
        <rect width="20" height="20" className="cr-bg" />
        <rect width="20" height="20" className="cr-fill" style={{ transform: `translateY(${((1 - p) * 18 + 1).toFixed(1)}px)` }} />
      </g>
    </svg>
  )
}
