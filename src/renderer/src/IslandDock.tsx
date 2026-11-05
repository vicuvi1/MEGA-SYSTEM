// IN38: the mini dock, its own small window (/?island=1&dock=1): the tiles
// you marked "dock" (counters, timers, water, exercises) and the running
// timer, apart from the main pill. Drag it by its handle (the system moves
// the window); turn it off in the island's edit mode. It gets the same
// snapshots as the island and its taps go the same way (to the app window).
import { useEffect, useRef, useState } from 'react'
import { EMPTY_ISLAND, type IslandAction, type IslandSnapshot } from '@core/islandModel'
import { cleanKit, countOf, tileAction, type Tile } from '@core/islandTiles'
import { calendarDay } from '@core/dates'
import './islandKit.css'

const desk = () => (typeof window !== 'undefined' ? window.desktop : undefined)
const left = (r: NonNullable<IslandSnapshot['running']>, now: number) => {
  const ms = Math.max(0, r.endsAt - (r.pausedAt ?? now))
  return `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
}

export function IslandDock() {
  const [s, setS] = useState<IslandSnapshot>(EMPTY_ISLAND)
  const [now, setNow] = useState(Date.now())
  const [bump, setBump] = useState<Record<string, number>>({})
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    document.documentElement.classList.add('di-dock-page')
    desk()?.onIslandState?.((v: any) => {
      if (v && typeof v === 'object' && !('beat' in v && Object.keys(v).length === 1)) setS(v as IslandSnapshot)
    })
    desk()?.onIslandAck?.(() => setBump({}))
  }, [])
  // The running timer's seconds: once a second, only while a timer runs and the window is shown.
  useEffect(() => {
    if (!s.running) return
    const t = window.setInterval(() => { if (!document.hidden) setNow(Date.now()) }, 1000)
    return () => clearInterval(t)
  }, [s.running])
  const kit = cleanKit(s.kit)
  const tiles = kit.tiles.filter((t) => t.dock)
  // The window fits the strip.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const r = el.getBoundingClientRect()
    void Promise.resolve(desk()?.islandKit?.('dockSize', { w: Math.ceil(r.width) + 4, h: Math.ceil(r.height) + 4 })).catch(() => null)
  }, [tiles.length, !!s.running])
  const day = calendarDay(new Date(now))
  const fire = (t: Tile) => {
    if (t.kind === 'counter') setBump((b) => ({ ...b, [t.id]: (b[t.id] ?? 0) + (t.n ?? 1) }))
    const exId = t.name ? s.reps.find((r) => r.name.toLowerCase() === t.name!.toLowerCase())?.id ?? null : null
    const a: IslandAction | null = tileAction(t, 'tap', { exId, subject: t.label })
    if (a) desk()?.islandAction?.({ ...a, ...(a.kind === 'reps' || a.kind === 'water' || a.kind === 'start' ? { id: Math.random().toString(36).slice(2, 10) } : {}) } as IslandAction)
  }
  return (
    <div className="di-dock" ref={root} role="toolbar" aria-label="Mini dock">
      <span className="di-dock-grip" title="Drag to move" aria-hidden>⋮⋮</span>
      {s.running && (
        <span className={`di-dock-timer ${s.running.pausedAt ? 'paused' : ''}`} title={s.running.subject}>⏱ {left(s.running, now)}</span>
      )}
      {tiles.map((t) => (
        <button key={t.id} className={`di-dock-tile kind-${t.kind}`} title={t.label} onClick={() => fire(t)}>
          <i>{t.icon}</i>
          {t.kind === 'counter' && <small>{countOf(kit, t.id, day) + (bump[t.id] ?? 0)}</small>}
          {t.kind === 'water' && <small>{Math.round(s.water.ml / 100) / 10}l</small>}
          {t.kind === 'timer' && <small>{t.minutes}′</small>}
          {t.kind === 'exercise' && <small>+{t.n}</small>}
        </button>
      ))}
      {!tiles.length && !s.running && <span className="di-dock-empty">Mark tiles “dock” in the island’s edit mode</span>}
    </div>
  )
}
