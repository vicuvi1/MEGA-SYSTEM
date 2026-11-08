// Progress → personal records wall: trophy cards (max reps in one set per
// move, longest hold, best day, first time on a harder variation). Records
// from the last 7 days are highlighted. Nothing here pays points.
import { useState } from 'react'
import { personalRecords } from '@core/bodyProgress'
import type { DayLog, SportEx } from '@core/sportLadders'
import type { SetLog } from '@core/sportSets'

const ICON: Record<string, string> = { reps: '🏆', hold: '⏱️', day: '🔥', first: '🪜' }
const SHOWN = 8

export function RecordsWall({ log, exercises, days, today }: { log: SetLog | null | undefined; exercises: SportEx[]; days: DayLog | null | undefined; today: string }) {
  const [all, setAll] = useState(false)
  const list = personalRecords(log, exercises, days, today)
  const shown = all ? list : list.slice(0, SHOWN)
  const fresh = list.filter((r) => r.isNew).length
  return (
    <section className="card bpg-card" aria-label="Personal records">
      <header className="bpg-head">
        <h2>Records</h2>
        <span className="bpg-lock">{list.length ? `${list.length} trophies${fresh ? `, ${fresh} new this week` : ''}` : ''}</span>
      </header>
      {list.length === 0 ? (
        <p className="bpg-empty">No records yet. Log a set in Sport Track and your best ones go on this wall.</p>
      ) : (
        <>
          <ul className="bpg-wall">
            {shown.map((r) => (
              <li key={r.id} className={`bpg-trophy ${r.kind}${r.isNew ? ' new' : ''}`}>
                <span className="ic" aria-hidden="true">
                  {ICON[r.kind]}
                </span>
                <b>{r.value}</b>
                <span className="t">{r.title}</span>
                <small>{r.day.slice(5)}</small>
                {r.isNew && <em>New</em>}
              </li>
            ))}
          </ul>
          {list.length > SHOWN && (
            <button type="button" className="btn ghost small" onClick={() => setAll(!all)} aria-expanded={all}>
              {all ? 'Show fewer' : `Show all ${list.length}`}
            </button>
          )}
        </>
      )}
    </section>
  )
}
