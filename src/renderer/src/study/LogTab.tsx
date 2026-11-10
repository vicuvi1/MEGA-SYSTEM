// Study Time → Sessions: add a session you did (counts in the stats, pays no
// points) and fix the last 14 days (changing a timed session's minutes or day
// gives its points back).
import { useState } from 'react'
import { addDays, dayLabel } from '@core/dates'
import { hmText, type StudySession, type StudyStore } from '@core/studyTime'
import { life } from '../bridge'
import { useAction } from '../ui'

// ---------------------------------------------------------------- sessions: add and fix

export function LogTab({ store, sessions, today }: { store: StudyStore; sessions: StudySession[]; today: string }) {
  const act = useAction()
  const recent = sessions.filter((s) => s.day >= addDays(today, -14))
  const [edit, setEdit] = useState<StudySession | null>(null)
  const [blockId, setBlockId] = useState(store.blocks[0]?.id ?? '')
  const [minutes, setMinutes] = useState('')
  const [brk, setBrk] = useState('')
  const [day, setDay] = useState(today)
  const named = (id: string | null, subject: string) => store.blocks.find((b) => b.id === id)?.name ?? subject
  const add = async () => {
    const b = store.blocks.find((x) => x.id === blockId)
    if (!b) return
    const ok = await act(() => life.study!.add({ subject: b.name, blockId: b.id, minutes: Number(minutes), breakMin: Number(brk) || 0, day }), 'Session added (typed sessions pay no points)')
    if (ok) setMinutes('')
  }
  return (
    <div className="sy-log">
      <section className="sy-card" aria-label="Add a session">
        <header className="sy-head">
          <h2>Add a session you did</h2>
          <span className="sy-hint">counts in the stats, pays no points</span>
        </header>
        <form
          className="sy-row sy-addrow"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <select value={blockId} onChange={(e) => setBlockId(e.target.value)} aria-label="Block">
            {store.blocks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <input type="number" min={1} max={600} placeholder="Minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Minutes" />
          <input type="number" min={0} max={300} placeholder="Break min" value={brk} onChange={(e) => setBrk(e.target.value)} aria-label="Break minutes" />
          <input type="date" value={day} max={today} min={addDays(today, -14)} onChange={(e) => setDay(e.target.value)} aria-label="Day" />
          <button className="btn small primary" type="submit" disabled={!minutes || !blockId}>
            Add
          </button>
        </form>
      </section>
      <section className="sy-card" aria-label="Last 14 days">
        <header className="sy-head">
          <h2>Last 14 days</h2>
          <span className="sy-hint">{recent.length} sessions</span>
        </header>
        <ul className="sy-sessions">
          {recent.slice(0, 40).map((s) =>
            edit?.id === s.id ? (
              <SessionEdit key={s.id} store={store} s={s} today={today} onDone={() => setEdit(null)} />
            ) : (
              <li key={s.id}>
                <span className="sy-sday">{s.day === today ? 'Today' : dayLabel(s.day)}</span>
                <b>{named(s.blockId, s.subject)}</b>
                <span className="num">{hmText(s.minutes)}</span>
                <small>{[s.breakMin && `break ${hmText(s.breakMin)}`, s.pauseMin && `pause ${hmText(s.pauseMin)}`].filter(Boolean).join(' · ')}</small>
                <small className="sy-snote" title={s.note ?? ''}>{s.note ?? ''}</small>
                <small className={`sy-src ${s.source}`}>{s.source === 'timer' ? 'timer' : s.source === 'manual' ? 'typed' : 'put right'}</small>
                <button className="sy-icon" aria-label="Edit session" onClick={() => setEdit(s)}>
                  ✎
                </button>
                <button className="sy-icon" aria-label="Remove session" onClick={() => void act(() => life.study!.remove(s.id), 'Session removed')}>
                  ×
                </button>
              </li>
            )
          )}
          {!recent.length && <li className="sy-hint">No sessions yet. Start a block on the Timer tab.</li>}
        </ul>
      </section>
    </div>
  )
}

function SessionEdit({ store, s, today, onDone }: { store: StudyStore; s: StudySession; today: string; onDone: () => void }) {
  const act = useAction()
  const [blockId, setBlockId] = useState(s.blockId ?? '')
  const [minutes, setMinutes] = useState(String(s.minutes))
  const [brk, setBrk] = useState(String(s.breakMin))
  const [day, setDay] = useState(s.day)
  const save = async () => {
    const b = store.blocks.find((x) => x.id === blockId)
    const ok = await act(() => life.study!.edit(s.id, { blockId: blockId || null, subject: b?.name, minutes: Number(minutes), breakMin: Number(brk) || 0, day }), s.source === 'timer' && Number(minutes) !== s.minutes ? 'Saved · a changed timed session gives its points back' : 'Saved')
    if (ok) onDone()
  }
  return (
    <li className="sy-sedit">
      <select value={blockId} onChange={(e) => setBlockId(e.target.value)} aria-label="Block">
        <option value="">{s.subject}</option>
        {store.blocks.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <input type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Minutes" />
      <input type="number" min={0} max={300} value={brk} onChange={(e) => setBrk(e.target.value)} aria-label="Break minutes" />
      <input type="date" value={day} max={today} min={addDays(today, -14)} onChange={(e) => setDay(e.target.value)} aria-label="Day" />
      <button className="btn small primary" onClick={() => void save()}>
        Save
      </button>
      <button className="btn small ghost" onClick={onDone}>
        Cancel
      </button>
    </li>
  )
}
