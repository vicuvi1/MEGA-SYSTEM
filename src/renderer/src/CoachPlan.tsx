// Today: the coach's plan for the day (the same one it sends on Telegram),
// with Approve / Change / Redo, and in the evening its review: the score, the
// lesson and tomorrow's top 3. Hidden when the daily rhythm is off.
import { useCallback, useEffect, useState } from 'react'
import { fromMin, toMin, type RhythmPrefs, type RhythmState } from '@core/rhythm'
import { life } from './bridge'
import { Icon } from './Icon'
import { useAction } from './ui'
import { useLive } from './live'
import { PlanAlso } from './PlanAlso'
import { PlanShiftOffer } from './PlanShiftOffer'
import { PlanEditor } from './plan/PlanEditor'

/** `oneApprove`: on Today, where "Do this now" already shows Approve, the card doesn't repeat it. */
export function CoachPlan({ onChange, oneApprove = false, hideReview = false }: { onChange?: () => void; oneApprove?: boolean; hideReview?: boolean }) {
  const act = useAction()
  const [data, setData] = useState<{ state: RhythmState; prefs: RhythmPrefs; late?: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState('')
  const [heroApproves, setHeroApproves] = useState(false)
  // U18: a small tick-and-sparkle right after you approve.
  const [justApproved, setJustApproved] = useState(false)
  const load = useCallback(() => {
    life.coach?.rhythm?.('state').then(setData).catch(() => {})
    if (oneApprove) life.coach?.status?.().then((st) => setHeroApproves(st.move.kind === 'approve')).catch(() => {})
  }, [oneApprove])
  useEffect(load, [load])
  useLive(load)

  if (!life.coach?.rhythm || !data || !data.prefs.on) return null
  const { state } = data
  const b = state.briefing
  const ev = state.evening
  const hour = new Date().getHours()

  const run = async (action: 'propose' | 'approve', msg?: string, label = '…') => {
    setBusy(label)
    const r = await act(() => life.coach!.rhythm!(action, msg), action === 'approve' ? 'Approved: blocks in your calendar, must-dos on Today' : undefined)
    setBusy(null)
    if (r) {
      setData({ state: r.state, prefs: r.prefs })
      onChange?.()
      if (action === 'approve') {
        setJustApproved(true)
        setTimeout(() => setJustApproved(false), 1600)
      }
    }
  }

  // Evening: the review replaces the plan (on Today it shows inside the shut-down).
  if (ev && hideReview) return null
  if (ev) {
    return (
      <section className="panel cp cp-review">
        <header className="cp-head">
          <h2>
            <Icon name="spark" /> Day review
          </h2>
          <span className={`cp-score ${ev.score >= 80 ? 'good' : ev.score >= 55 ? 'ok' : 'low'}`}>{ev.score}/100</span>
        </header>
        {ev.lesson && <p className="cp-lesson">{ev.lesson}</p>}
        {ev.top3.length > 0 && (
          <>
            <h3 className="cp-sub">Tomorrow's top 3</h3>
            <ol className="cp-list">
              {ev.top3.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          </>
        )}
      </section>
    )
  }

  if (!b) {
    if (hour >= 18) return null
    return (
      <section className="panel cp cp-empty">
        <div>
          <h2>
            <Icon name="spark" /> No plan for today yet
          </h2>
          <p className="hint small">The coach plans your must-dos, blocks in your free time, training and water. You approve.</p>
        </div>
        <button className="btn primary" disabled={!!busy} onClick={() => void run('propose', undefined, 'Planning…')}>
          {busy ?? 'Plan my day'}
        </button>
      </section>
    )
  }

  const p = b.plan
  // A waiting plan with nothing in it (only the water goal) or one left over
  // in the evening isn't worth a card: Ben approves or replans on his own.
  if (b.status !== 'approved' && ((!p.mustdos.length && !p.blocks.length && !p.training) || hour >= 18)) return null
  const timed = [...p.blocks.map((x) => ({ s: x.start, e: fromMin(toMin(x.start) + x.minutes), t: x.title, train: false, tasks: (x.tasks?.length ?? 0) > 1 ? x.tasks : undefined })), ...(p.training ? [{ s: p.training.time, e: '', t: p.training.what, train: true, tasks: undefined }] : [])].sort((a, c) => a.s.localeCompare(c.s))
  const approved = b.status === 'approved'
  return (
    <section className={`panel cp ${approved ? 'cp-ok' : ''} ${justApproved ? 'cp-cheer' : ''}`}>
      <header className="cp-head">
        <h2>
          <Icon name="spark" /> {approved ? "Today's plan" : 'Your coach planned today'}
          {b.version > 1 && <small> v{b.version}</small>}
        </h2>
        {approved && <span className="chip on">✓ Approved</span>}
      </header>
      <p className="cp-headline">{p.headline}</p>
      <PlanShiftOffer state={state} late={data.late} onDone={(r) => (setData(r), onChange?.())} />
      {p.why && <p className="plan-why">{p.why}</p>}
      <div className="cp-grid">
        {p.mustdos.length > 0 && (
          <div>
            <h3 className="cp-sub">Must-dos</h3>
            <ol className="cp-list">
              {p.mustdos.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
      {/* PE1: the blocks, editable right here; edits sync to Google Calendar and Todoist. */}
      {timed.length > 0 && <PlanEditor state={state} water={data.prefs.water} />}
      <PlanAlso plan={p} />
      <p className="hint small">💧 Water goal {(p.waterMl / 1000).toFixed(1)} L</p>
      {!approved && (
        <>
          {editing ? (
            <form
              className="cp-edit"
              onSubmit={(e) => {
                e.preventDefault()
                if (!note.trim()) return
                setEditing(false)
                void run('propose', note.trim(), 'Replanning…')
                setNote('')
              }}
            >
              <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change? e.g. add the CV update, move gym to the evening" />
              <button className="btn primary small" disabled={!note.trim()}>
                Replan
              </button>
              <button type="button" className="btn ghost small" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <div className="cp-actions">
              {!(oneApprove && heroApproves) && (
                <button className="btn primary" disabled={!!busy} onClick={() => void run('approve', undefined, 'Approving…')}>
                  {busy === 'Approving…' ? busy : '✓ Approve all'}
                </button>
              )}
              <button className="btn ghost" disabled={!!busy} onClick={() => setEditing(true)}>
                Change
              </button>
              <button className="btn ghost" disabled={!!busy} onClick={() => void run('propose', undefined, 'Planning…')}>
                {busy === 'Planning…' || busy === 'Replanning…' ? busy : 'Redo'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
