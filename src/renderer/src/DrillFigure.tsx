// BD11: the desk drill's moving figure, drawn with Sport Track's figure
// (core/sportFigure.ts joints → core/sportDraw.ts shapes) as plain SVG paths.
// The figure moves by requestAnimationFrame (it stops by itself in a hidden
// window) and only while the drill runs; with reduced motion it stays still.
import { useEffect, useState } from 'react'
import { boxOf, stillFrame, type Anim, type Frame } from '@core/sportFigure'
import { figureShapes } from '@core/sportDraw'
import { FLOOR } from '@core/sportFigure'

export function FigureSvg({ anim, frame, size = 88 }: { anim: Anim; frame?: Frame; size?: number }) {
  const f = figureShapes(frame ?? stillFrame(anim))
  const [x, y, w, h] = boxOf(anim, 1.25, 70)
  return (
    <svg className="dr-fig" width={size * 1.25} height={size} viewBox={`${x} ${y} ${w} ${h}`} aria-hidden>
      {(anim.props ?? []).map((p, i) =>
        p.k === 'wall' ? (
          <rect key={i} className="dr-prop" x={p.x - 3} y={y} width={3} height={FLOOR - y} />
        ) : p.k === 'door' ? (
          <rect key={i} className="dr-prop" x={p.x - 2} y={y + 2} width={2.5} height={FLOOR - y - 2} />
        ) : null
      )}
      <line className="dr-floor" x1={x} x2={x + w} y1={FLOOR + 1} y2={FLOOR + 1} />
      <path className="dr-far" d={f.armFar + f.legFar} />
      <path className="dr-body" d={f.torso + f.head + f.legNear + f.armNear} />
    </svg>
  )
}

/** Seconds since `startedAt` (null: not running), at animation speed. */
export function useClock(startedAt: number | null): number {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (startedAt == null) return setT(0)
    let id = 0
    const step = () => {
      setT((Date.now() - startedAt) / 1000)
      id = requestAnimationFrame(step)
    }
    id = requestAnimationFrame(step)
    return () => cancelAnimationFrame(id)
  }, [startedAt])
  return t
}
