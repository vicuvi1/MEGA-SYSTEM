// Sport Track's ⋯ menu in the top bar. For now one item: the Classic tracker
// (the old embedded app: daily totals, badges and history, all still
// counted), and the way back from it to the sections.
import { useEffect, useRef, useState } from 'react'
import './sport-menu.css'

export function SportMenu({ classic, onClassic, onBack }: { classic: boolean; onClassic: () => void; onBack: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', off)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div className="sp-menu" ref={ref}>
      <button type="button" className="tb-icon sp-menu-btn" aria-label="More Sport Track options" aria-haspopup="menu" aria-expanded={open} title="More" onClick={() => setOpen((o) => !o)} data-sport-more>
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div className="sp-menu-pop" role="menu">
          {classic ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onBack()
              }}
              data-sport-menu="back"
            >
              <b>Back to Sport Track</b>
              <small>Dashboard, Workout and the rest</small>
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onClassic()
              }}
              data-sport-menu="classic"
            >
              <b>Classic tracker</b>
              <small>Your old daily totals, badges and history. All of it still counts.</small>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
