// "Water today": every glass logged today (time, amount, from where), so you
// can see exactly what counts and remove a wrong one (Undo brings it back).
// It reads the one water log (body_log), the same one every screen sums.
import { useCallback, useEffect, useState } from 'react'
import { sourceLabel, type LogEntry } from '@core/bodyLog'
import { toggleWaterEntry, waterEntries } from './water'

const timeOf = (e: LogEntry) => (e.source === 'earlier' ? 'before' : new Date(e.at).toTimeString().slice(0, 5))

export function WaterHistory({ compact = false }: { compact?: boolean }) {
  const [list, setList] = useState<LogEntry[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [undo, setUndo] = useState<string | null>(null)
  const load = useCallback(() => void waterEntries().then(setList).catch(() => setList([])), [])
  useEffect(() => {
    load()
    window.addEventListener('life-water-changed', load)
    window.addEventListener('life-sport-changed', load)
    window.addEventListener('focus', load)
    return () => {
      window.removeEventListener('life-water-changed', load)
      window.removeEventListener('life-sport-changed', load)
      window.removeEventListener('focus', load)
    }
  }, [load])

  const flip = async (id: string) => {
    setBusy(id)
    const r = await toggleWaterEntry(id).catch(() => null)
    setBusy(null)
    setUndo(r?.removed ? id : null)
    load()
  }

  if (!list) return <p className="hint small">Loading…</p>
  const total = list.filter((e) => !e.removed).reduce((t, e) => t + e.amount, 0)
  return (
    <div className={`water-history${compact ? ' compact' : ''}`} aria-label="Water today">
      <div className="wh-head">
        <b>Water today</b>
        <small>{Math.max(0, total)} ml from {list.filter((e) => !e.removed).length} entr{list.filter((e) => !e.removed).length === 1 ? 'y' : 'ies'}</small>
      </div>
      {list.length === 0 ? (
        <p className="hint small">Nothing logged yet today.</p>
      ) : (
        <ul>
          {[...list].reverse().map((e) => (
            <li key={e.id} className={e.removed ? 'removed' : ''}>
              <span className="wh-time">{timeOf(e)}</span>
              <span className="wh-ml">{e.amount > 0 ? '+' : '−'}{Math.abs(e.amount)} ml</span>
              <span className="wh-src">{sourceLabel(e.source)}</span>
              <button className="chip" disabled={busy === e.id} onClick={() => void flip(e.id)} title={e.removed ? 'Count it again' : 'Remove this entry (you can undo)'}>
                {e.removed ? 'Undo' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {undo && (
        <p className="hint small" role="status">
          Removed. <button className="linkish" onClick={() => void flip(undo)}>Undo</button>
        </p>
      )}
    </div>
  )
}
