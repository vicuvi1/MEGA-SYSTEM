// H1: moving and hiding the desktop island, the page's part. The desktop
// (island.ts) moves and hides the window; here the page shows move mode's bar
// and takes its keys, plays the slide-out before it hides and when the mouse
// rushes at it, and shows the small dot it tucks into. Only transform and
// opacity move (island-move.css), and nothing runs while it is hidden.
import { useEffect, useState } from 'react'
import { moveModeKey, resizePanel, type HideState } from '@core/islandMove'

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

/**
 * IN39: the panel's corner: drag it to make the panel wider or taller. The
 * window makes room while you drag; the size is kept for this screen.
 */
export function PanelCorner({ root, scale }: { root: React.RefObject<HTMLElement | null>; scale: number }) {
  return (
    <span
      className="di-panel-corner"
      role="separator"
      aria-label="Drag to resize the panel"
      title="Drag to resize"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        const el = root.current
        const panel = (e.currentTarget.closest('.di-panel') as HTMLElement | null) ?? null
        if (!el || !panel) return
        const k = scale || 1
        const start = { w: panel.offsetWidth, h: panel.offsetHeight }
        const x0 = e.clientX
        const y0 = e.clientY
        const target = e.currentTarget
        try { target.setPointerCapture(e.pointerId) } catch { /* fine */ }
        desk()?.islandPanelSize?.('start', start)
        let size = start
        const move = (ev: PointerEvent) => {
          size = resizePanel(start, { x: (ev.clientX - x0) / k, y: (ev.clientY - y0) / k })
          el.style.setProperty('--di-panel-w', `${size.w}px`)
          el.style.setProperty('--di-panel-maxh', `${size.h}px`)
          el.style.setProperty('--di-panel-minh', `${size.h}px`)
        }
        const up = () => {
          target.removeEventListener('pointermove', move)
          target.removeEventListener('pointerup', up)
          target.removeEventListener('pointercancel', up)
          el.style.removeProperty('--di-panel-minh')
          desk()?.islandPanelSize?.('end', size)
        }
        target.addEventListener('pointermove', move)
        target.addEventListener('pointerup', up)
        target.addEventListener('pointercancel', up)
      }}
    />
  )
}
