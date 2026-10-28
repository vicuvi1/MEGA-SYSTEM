import React, { useEffect, useState } from 'react'
import './rpgPopups.css'

export interface RpgPopupItem {
  id: number
  main: string
  sub?: string
  kind: 'xp' | 'gold' | 'level'
  x: number
  y: number
}

export function triggerRpgPopup(options: {
  main: string
  sub?: string
  kind?: 'xp' | 'gold' | 'level'
  x?: number
  y?: number
}) {
  const event = new CustomEvent('rpg-popup', {
    detail: {
      id: Date.now() + Math.random(),
      main: options.main,
      sub: options.sub,
      kind: options.kind || 'xp',
      x: options.x ?? (window.innerWidth / 2 + (Math.random() * 80 - 40)),
      y: options.y ?? (window.innerHeight / 2 + (Math.random() * 60 - 30))
    }
  })
  window.dispatchEvent(event)
}

export function RpgFloatingPopups() {
  const [popups, setPopups] = useState<RpgPopupItem[]>([])

  useEffect(() => {
    const handlePopup = (e: Event) => {
      const item = (e as CustomEvent).detail as RpgPopupItem
      setPopups((prev) => [...prev, item])
      setTimeout(() => {
        setPopups((prev) => prev.filter((p) => p.id !== item.id))
      }, 1300)
    }

    window.addEventListener('rpg-popup', handlePopup)
    return () => window.removeEventListener('rpg-popup', handlePopup)
  }, [])

  if (popups.length === 0) return null

  return (
    <div className="rpg-popups-container" aria-hidden="true">
      {popups.map((p) => (
        <div
          key={p.id}
          className={`rpg-popup ${p.kind}`}
          style={{ left: `${p.x}px`, top: `${p.y}px` }}
        >
          <div className="rpg-popup-main">
            {p.kind === 'gold' ? '🪙 ' : p.kind === 'level' ? '⭐ ' : '⚡ '}
            {p.main}
          </div>
          {p.sub && <div className="rpg-popup-sub">{p.sub}</div>}
        </div>
      ))}
    </div>
  )
}
