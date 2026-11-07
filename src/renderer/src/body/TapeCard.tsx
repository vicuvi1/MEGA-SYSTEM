// BD10: tape measurements next to the waist: arm, chest, shoulders and thigh
// (cm, synced setting body_tape). The scale moves slowly when you build
// muscle; the tape shows it sooner.
import { useState } from 'react'
import { life } from '../bridge'
import { useAction } from '../ui'
import { TAPE_PARTS, type BodyPlusView, type Tape } from '../../../main/bodyPlus'

export function TapeCard({ v, waist, onView }: { v: BodyPlusView; waist: number | null; onView: (v: BodyPlusView) => void }) {
  const act = useAction()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const last = (id: keyof Omit<Tape, 'day'>) => [...v.tape].reverse().find((t) => t[id] != null)
  const first = (id: keyof Omit<Tape, 'day'>) => v.tape.find((t) => t[id] != null)
  const save = async () => {
    const row: Record<string, number> = {}
    for (const p of TAPE_PARTS) if (form[p.id]) row[p.id] = Number(form[p.id])
    const next = await act(() => life.coach!.bodyPlus!.tape(row), 'Measurements saved')
    if (next) (onView(next), setOpen(false), setForm({}))
  }
  return (
    <section className="card tp-card" aria-label="Tape measurements">
      <header className="card-head">
        <h2>Measurements</h2>
        <button type="button" className="btn small" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Cancel' : 'Measure'}
        </button>
      </header>
      <div className="tp-grid">
        <div className="tp-cell">
          <small>Waist</small>
          <b>{waist != null ? `${waist} cm` : '–'}</b>
          <small className="muted">with your weight</small>
        </div>
        {TAPE_PARTS.map((p) => {
          const l = last(p.id)
          const f = first(p.id)
          const diff = l && f && l.day !== f.day ? Math.round(((l[p.id] as number) - (f[p.id] as number)) * 10) / 10 : null
          return (
            <div key={p.id} className="tp-cell">
              <small>{p.name}</small>
              <b>{l ? `${l[p.id]} cm` : '–'}</b>
              <small className={diff != null && diff > 0 ? 'up' : 'muted'}>{diff != null ? `${diff > 0 ? '+' : ''}${diff} cm since ${f!.day.slice(5)}` : l ? l.day.slice(5) : 'not yet'}</small>
            </div>
          )
        })}
      </div>
      {open && (
        <form
          className="tp-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          {TAPE_PARTS.map((p) => (
            <label key={p.id} title={p.tip}>
              {p.name} (cm)
              <input type="number" step="0.5" min="10" max="250" inputMode="decimal" value={form[p.id] ?? ''} placeholder={String(last(p.id)?.[p.id] ?? '')} onChange={(e) => setForm({ ...form, [p.id]: e.target.value })} />
              <small className="muted">{p.tip}</small>
            </label>
          ))}
          <button className="btn primary small" disabled={!Object.values(form).some(Boolean)}>
            Save
          </button>
        </form>
      )}
    </section>
  )
}
