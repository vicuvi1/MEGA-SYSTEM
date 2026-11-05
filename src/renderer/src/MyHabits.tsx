// Your own habits on Today (FT1): tap to log, +2 only for that tap (capped
// per day), a streak each, and "never miss twice" when one slipped yesterday.
// The editor adds, renames and removes them.
import { useCallback, useEffect, useState } from 'react'
import { life } from './bridge'
import { useLive } from './live'
import { useAction, useToast } from './ui'
import type { HabitsView } from './web/lifeExtras'
import './lifeExtras.css'

export function useMyHabits(): [HabitsView | null, () => void] {
  const [v, setV] = useState<HabitsView | null>(null)
  const load = useCallback(() => {
    life.extras?.habits().then(setV).catch(() => {})
  }, [])
  useEffect(() => {
    load()
    window.addEventListener('life-habits-changed', load)
    return () => window.removeEventListener('life-habits-changed', load)
  }, [load])
  useLive(load)
  return [v, load]
}

/** One tap: logged, paid once, and a toast that says what it paid. */
export function useTapHabit(onChange: () => void) {
  const toast = useToast()
  return useCallback(
    async (id: string, name: string) => {
      try {
        const r = await life.extras!.tapHabit(id)
        toast(r.paid ? `${name}: done · +${r.paid}` : `${name}: done (today's habit points are used up)`, 'good', { label: 'Undo', run: () => void life.extras!.untapHabit(id).then(onChange) })
        onChange()
        return true
      } catch (e) {
        toast((e as Error).message, 'bad')
        return false
      }
    },
    [toast, onChange]
  )
}

/** "Missed yesterday: Stretch. Never miss twice." */
export function MissTwiceNote({ v }: { v: HabitsView | null }) {
  if (!v?.missed.length) return null
  return (
    <p className="mh-miss" role="note">
      <b>Never miss twice:</b> {v.missed.join(', ')} slipped yesterday. A small version today keeps the chain.
    </p>
  )
}

export function HabitEditor({ v, onClose, onChange }: { v: HabitsView; onClose: () => void; onChange: () => void }) {
  const act = useAction()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const add = async () => {
    const n = name.trim()
    if (!n) return
    if (await act(() => life.extras!.editHabits({ op: 'add', name: n }), `Added: ${n}`)) {
      setName('')
      onChange()
    }
  }
  const rename = async () => {
    if (!editing) return
    if (await act(() => life.extras!.editHabits({ op: 'rename', id: editing.id, name: editing.name }), 'Renamed')) {
      setEditing(null)
      onChange()
    }
  }
  const remove = async (id: string, n: string) => {
    if (await act(() => life.extras!.editHabits({ op: 'remove', id }), `Removed: ${n}`)) onChange()
  }
  const untap = async (id: string) => {
    if (await act(() => life.extras!.untapHabit(id), 'Taken back for today')) onChange()
  }
  return (
    <section className="mh-editor" aria-label="Your habits">
      <header>
        <b>Your habits</b>
        <small className="hint">{v.pays ? `+${v.pays} a tap, up to ${v.cap} a day, only when you did it` : 'No points for these right now'}</small>
        <button className="btn small ghost" onClick={onClose} aria-label="Close">
          Done
        </button>
      </header>
      {v.rows.length === 0 && <p className="hint small">Add something small you want to do every day: "Read 10 pages", "Stretch", "No phone in bed".</p>}
      <ul>
        {v.rows.map((r) => (
          <li key={r.id}>
            {editing?.id === r.id ? (
              <form
                className="mh-row-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  void rename()
                }}
              >
                <input autoFocus value={editing.name} maxLength={60} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="New name" />
                <button className="btn small primary">Save</button>
                <button type="button" className="btn small ghost" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span className="mh-name">
                  {r.name}
                  <small>
                    {r.streak ? `🔥 ${r.streak} day${r.streak === 1 ? '' : 's'}` : 'no streak yet'} · best {r.best} · {r.week}/7 this week
                  </small>
                </span>
                {r.done && (
                  <button className="btn small ghost" onClick={() => void untap(r.id)} title="Tapped by mistake? Take it back (its points too)">
                    Undo today
                  </button>
                )}
                <button className="btn small ghost" onClick={() => setEditing({ id: r.id, name: r.name })}>
                  Rename
                </button>
                <button className="btn small ghost danger" onClick={() => void remove(r.id, r.name)}>
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mh-add"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New habit, e.g. Read 10 pages" maxLength={60} aria-label="New habit" />
        <button className="btn small primary" disabled={!name.trim()}>
          Add
        </button>
      </form>
    </section>
  )
}
