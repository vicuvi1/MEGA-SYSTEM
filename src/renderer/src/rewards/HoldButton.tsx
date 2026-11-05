// Hold to buy (RW7): press and hold about 0.8 s while the button fills and a
// small ring closes (both by transform only). Let go early and nothing
// happens. Keyboard: hold Enter or Space.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { play } from '../soundKit'

export const HOLD_MS = 800

export function HoldButton({ onDone, children, label, disabled = false, className = '' }: { onDone: () => void; children: ReactNode; label: string; disabled?: boolean; className?: string }) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
  }
  const start = () => {
    if (disabled || timer.current) return
    setHolding(true)
    play('tick')
    timer.current = setTimeout(() => {
      timer.current = null
      setHolding(false)
      onDone()
    }, HOLD_MS)
  }
  useEffect(() => stop, [])
  return (
    <button
      type="button"
      className={`rx-hold ${holding ? 'holding' : ''} ${className}`}
      disabled={disabled}
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
        start()
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault()
          start()
        }
      }}
      onKeyUp={(e) => {
        if (e.key === 'Enter' || e.key === ' ') stop()
      }}
      onBlur={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      <i className="rx-hold-fill" aria-hidden />
      <span className="rx-hold-ring" aria-hidden>
        <i className="r" />
        <i className="l" />
      </span>
      <span className="rx-hold-text">{holding ? 'Keep holding…' : children}</span>
    </button>
  )
}
