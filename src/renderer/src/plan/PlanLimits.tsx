// Coach → Daily rhythm → Time limits: the limits the planner never breaks
// (core/planLimits.ts). Saved at once (synced setting plan_limits).
import { useState } from 'react'
import { CAP_KINDS, CAP_NAMES, type CapKind, type PlanLimits, type ProtectedBlock } from '@core/planLimits'
import { useAction } from '../ui'
import { saveSetup, useSetup } from './planSetup'
import './planEditor.css'

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_TITLES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ORDER = [1, 2, 3, 4, 5, 6, 0]
const hoursOf = (m: number | null | undefined) => (m == null ? '' : String(Math.round((m / 60) * 4) / 4))
const minsOf = (h: string): number | null => (h.trim() === '' || !(Number(h) > 0) ? null : Math.round(Number(h) * 60))

export function PlanLimitsEditor() {
  const act = useAction()
  const setup = useSetup()
  const [adding, setAdding] = useState(false)
  if (!setup) return null
  const l = setup.limits
  const save = (patch: Partial<PlanLimits>) => void act(() => saveSetup({ limits: patch }), 'Limits saved')
  const setProtect = (list: ProtectedBlock[]) => save({ protect: list })
  const setCap = (kind: CapKind, minutes: number | null) => save({ caps: [...l.caps.filter((c) => c.kind !== kind), ...(minutes ? [{ kind, minutes }] : [])] })
  return (
    <div className="pl" data-plan-limits>
      <h3 className="pl-title">Time limits</h3>
      <p className="hint small">The planner never breaks these. When a limit leaves no room for a deadline, Ben says so plainly instead.</p>
      <div className="co-rhythm-rows">
        <label>
          Most work a day (hours)
          <input type="number" min={0.5} max={16} step={0.5} placeholder="No limit" data-limit-focus defaultValue={hoursOf(l.maxFocusMin)} key={`f${l.maxFocusMin}`} onBlur={(e) => minsOf(e.target.value) !== l.maxFocusMin && save({ maxFocusMin: minsOf(e.target.value) })} />
        </label>
        <label>
          Off at (nothing planned after)
          <span className="pl-row">
            <input type="time" data-limit-off value={l.offAt ?? ''} onChange={(e) => save({ offAt: e.target.value || null })} />
            {l.offAt && (
              <button type="button" className="pl-x" title="No off time" onClick={() => save({ offAt: null })}>
                ✕
              </button>
            )}
          </span>
        </label>
        {CAP_KINDS.map((k) => (
          <label key={k}>
            Most {CAP_NAMES[k].toLowerCase()} a day (hours)
            <input type="number" min={0.25} max={16} step={0.25} placeholder="No limit" data-limit-cap={k} defaultValue={hoursOf(l.caps.find((c) => c.kind === k)?.minutes)} key={`${k}${l.caps.find((c) => c.kind === k)?.minutes}`} onBlur={(e) => setCap(k, minsOf(e.target.value))} />
          </label>
        ))}
      </div>
      <div className="pl-prot">
        <b>Protected blocks</b>
        <span className="hint small">Fixed time the planner plans around (training, meals).</span>
        {l.protect.map((p, i) => (
          <div key={`${p.title}${i}`} className="pl-prow" data-protect-row>
            <span className="pl-pname">{p.title}</span>
            <span>
              {p.start} · {p.minutes} min
            </span>
            <span className="pl-days">
              {ORDER.map((d) => (
                <button key={d} type="button" title={DAY_TITLES[d]} className={!p.days.length || p.days.includes(d) ? 'on' : ''} onClick={() => setProtect(l.protect.map((x, j) => (j !== i ? x : { ...x, days: (x.days.length ? x.days : ORDER).includes(d) ? (x.days.length ? x.days : ORDER).filter((y) => y !== d) : [...x.days, d] })))}>
                  {DAYS[d]}
                </button>
              ))}
            </span>
            <button type="button" className="pl-x" title="Remove" onClick={() => setProtect(l.protect.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        {adding ? (
          <form
            className="pl-add"
            onSubmit={(e) => {
              e.preventDefault()
              const f = new FormData(e.currentTarget)
              const title = String(f.get('title') ?? '').trim()
              const start = String(f.get('start') ?? '')
              const minutes = Number(f.get('minutes'))
              if (!title || !/^\d\d:\d\d$/.test(start) || !(minutes >= 5)) return
              setProtect([...l.protect, { title, start, minutes, days: [] }])
              setAdding(false)
            }}
          >
            <input name="title" placeholder="Training" aria-label="Name" data-protect-title required />
            <input name="start" type="time" aria-label="Starts at" defaultValue="18:00" data-protect-start required />
            <input name="minutes" type="number" min={5} max={240} step={5} defaultValue={45} aria-label="Minutes" data-protect-min required />
            <button className="btn small">Add</button>
            <button type="button" className="btn small ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="btn small ghost" data-protect-add onClick={() => setAdding(true)}>
            + Add protected block
          </button>
        )}
      </div>
    </div>
  )
}
