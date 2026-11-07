// BD17: an optional check-off for creatine (3–5 g, any time) and vitamin D in
// the darker months, with a streak. Honest logging only: it pays no points.
import { SUPPS } from '@core/supplements'
import { life } from '../bridge'
import { useAction } from '../ui'
import type { BodyPlusView } from '../../../main/bodyPlus'

export function SuppCard({ v, onView }: { v: BodyPlusView; onView: (v: BodyPlusView) => void }) {
  const act = useAction()
  const api = life.coach!.bodyPlus!
  const on = v.prefs.supps
  const toggleTracked = async (id: string) => {
    const next = await act(() => api.prefs({ supps: on.includes(id) ? on.filter((x) => x !== id) : [...on, id] }))
    if (next) onView(next)
  }
  return (
    <section className="card sp-card" aria-label="Supplements">
      <header className="card-head">
        <h2>Supplements</h2>
        <span className="hint small">optional · a streak, no points</span>
      </header>
      {v.supps.length > 0 ? (
        <div className="sp-list">
          {v.supps.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`sp-tick${s.taken ? ' on' : ''}`}
              aria-pressed={s.taken}
              title={s.why}
              onClick={async () => {
                const next = await act(() => api.supp(s.id), s.taken ? `${s.name}: taken back` : `${s.emoji} ${s.name} ticked`)
                if (next) onView(next)
              }}
            >
              <span className="sp-box" aria-hidden="true">{s.taken ? '✓' : ''}</span>
              <span>
                <b>
                  {s.emoji} {s.name}
                </b>
                <small>
                  {s.dose}
                  {s.streak > 0 ? ` · 🔥 ${s.streak} day${s.streak === 1 ? '' : 's'}` : ''}
                </small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted small">Track a daily supplement here: creatine works only when you take it every day.</p>
      )}
      <div className="sp-pick">
        {SUPPS.map((s) => (
          <label key={s.id} className="sp-opt">
            <input type="checkbox" checked={on.includes(s.id)} onChange={() => void toggleTracked(s.id)} />
            {s.name} {s.months ? <small className="muted">(Oct–Mar)</small> : null}
          </label>
        ))}
      </div>
    </section>
  )
}
