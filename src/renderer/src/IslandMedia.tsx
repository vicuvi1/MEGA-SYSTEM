// AU1: what's playing on this PC, on the island's open panel, with
// previous / play-pause / next. Only while the panel is open: asked once when
// it opens and every 30 s after (nothing while it is closed or hidden). Off
// until "Show what's playing on the island" is on (PC & automation).
import { useEffect, useRef, useState } from 'react'
import { mediaLine, type MediaNow, type MediaOp } from '@core/pcMedia'
import { tp } from './islandTap'

export function IslandMedia() {
  const [now, setNow] = useState<MediaNow | null>(null)
  const [on, setOn] = useState(true)
  const busy = useRef(false)
  const ask = async (op: MediaOp) => {
    const pcx = window.desktop?.pcx
    if (!pcx || busy.current) return
    busy.current = true
    try {
      const r = await pcx('media', op).catch(() => null)
      if (r === null) return setOn(false)
      setNow(r.now ?? null)
    } finally {
      busy.current = false
    }
  }
  useEffect(() => {
    if (!window.desktop?.pcx) return
    void ask('get')
    const t = setInterval(() => {
      if (!document.hidden) void ask('get')
    }, 30_000)
    return () => clearInterval(t)
  }, [])
  if (!on || !now || (!now.title && !now.playing)) return null
  return (
    <div className="di-media" role="group" aria-label="Music">
      <span className="di-media-t" title={now.app ? `${mediaLine(now)} · ${now.app}` : mediaLine(now)}>
        {now.playing ? '♪' : '⏸'} {mediaLine(now)}
      </span>
      <button className="di-icon" {...tp('media:prev', () => void ask('prev'))} aria-label="Previous" title="Previous">⏮</button>
      <button className="di-icon" {...tp('media:toggle', () => void ask('toggle'))} aria-label={now.playing ? 'Pause' : 'Play'} title={now.playing ? 'Pause' : 'Play'}>{now.playing ? '⏸' : '▶'}</button>
      <button className="di-icon" {...tp('media:next', () => void ask('next'))} aria-label="Next" title="Next">⏭</button>
    </div>
  )
}
