// H1: moving and hiding the desktop island, the page's part. The desktop
// (island.ts) moves and hides the window; here the page shows move mode's bar
// and takes its keys, plays the slide-out before it hides and when the mouse
// rushes at it, and shows the small dot it tucks into. Only transform and
// opacity move (island-move.css), and nothing runs while it is hidden.
import { useEffect, useState } from 'react'
import { moveModeKey, type HideState } from '@core/islandMove'

const desk = () => (typeof window !== 'undefined' ? window.desktop : undefined)

export function useIslandMove() {
  const [hide, setHide] = useState<HideState>({ mode: 'shown', until: 0 })
  const [moveMode, setMoveMode] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [dodge, setDodge] = useState(false)
  useEffect(() => {
    const d = desk()
    d?.onIslandHideState?.((h) => {
      setHide(h)
      if (h.mode !== 'hidden') setLeaving(false)
    })
    d?.onIslandLeaving?.(() => setLeaving(true))
    // Shown again: the slide-out is over (the page plays its way in from the class going away).
    d?.onIslandVisible?.((v) => { if (v) setLeaving(false) })
    d?.onIslandMoveMode?.(() => setMoveMode(true))
    d?.onIslandMoveModeEnd?.(() => setMoveMode(false))
    d?.onIslandDodge?.((on) => setDodge(on))
  }, [])
  // Move mode: the arrow keys nudge it, Enter saves, Esc puts it back.
  useEffect(() => {
    if (!moveMode) return
    const key = (e: KeyboardEvent) => {
      const k = moveModeKey(e.key, { shift: e.shiftKey, alt: e.altKey })
      if (!k) return
      e.preventDefault()
      e.stopPropagation()
      if (k === 'save' || k === 'cancel') {
        desk()?.islandMoveEnd?.(k === 'save')
        setMoveMode(false)
      } else desk()?.islandNudge?.(k.nudge)
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [moveMode])
  const classes = `${leaving ? 'di-leaving' : ''} ${dodge ? 'di-dodge' : ''} ${moveMode ? 'di-move-mode' : ''} ${hide.mode === 'dot' ? 'di-parked' : ''}`
  return { hide, moveMode, classes, parked: hide.mode === 'dot' }
}

/** Move mode's bar: what the keys do, plus Save and Cancel for the mouse. */
export function MoveModeBar() {
  return (
    <div className="di-movebar" data-hot role="dialog" aria-label="Move mode">
      <span>✥ Move mode: arrow keys nudge it (Shift: bigger steps), or drag it.</span>
      <button type="button" className="di-movebar-ok" onClick={() => desk()?.islandMoveEnd?.(true)}>Save (Enter)</button>
      <button type="button" onClick={() => desk()?.islandMoveEnd?.(false)}>Cancel (Esc)</button>
    </div>
  )
}

/** The small dot it tucks into (double-click the pill); a click brings it back. */
export function ParkedDot() {
  return (
    <button
      type="button"
      className="di-park-dot"
      data-hot
      aria-label="The island is tucked into a dot: click to bring it back"
      title="Click to bring the island back"
      onClick={() => desk()?.islandHide?.(null)}
    />
  )
}

/** The grip on the pill: press and drag at once (no hold needed, no round menu). */
export function GripHandle({ onPointerDown }: { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void }) {
  return <span className="di-grip" role="presentation" title="Drag to move" aria-hidden onPointerDown={onPointerDown}>⋮⋮</span>
}
