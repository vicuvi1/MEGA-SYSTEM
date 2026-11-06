// Automation hub on the island (AH1, AH2, AH4, AH6, AH20): your pinned
// automations as one-tap buttons (favourites first), a 1–3 field mini-form
// that remembers your last values, a card per run (a ring while it runs, then
// a tick or a red dot) with the flow's answer: text with Copy, a link with
// Open, an https image; and the last runs with Re-run. Everything it shows
// comes in the snapshot; every tap goes to the app window, which checks it again.
import { useState } from 'react'
import type { IslandAction, IslandSnapshot } from '@core/islandModel'
import type { IslandAutoButton, ParamValue } from '@core/automations'
import { tp } from './islandTap'
import './island-auto.css'

type Tap = (a: IslandAction, lbl?: string) => void
/** Your last values (the app window keeps them; same origin, same storage). */
const lastOf = (id: string): Record<string, ParamValue> => {
  try {
    return (JSON.parse(localStorage.getItem('ls.autoLast') || '{}') as Record<string, Record<string, ParamValue>>)[id] ?? {}
  } catch {
    return {}
  }
}

function MiniForm({ b, tap, done }: { b: IslandAutoButton; tap: Tap; done: () => void }) {
  const last = lastOf(b.id)
  const [vals, setVals] = useState<Record<string, ParamValue>>(() => Object.fromEntries(b.fields.map((p) => [p.key, last[p.key] ?? p.def ?? (p.type === 'bool' ? false : p.type === 'choice' ? p.choices![0] : '')])))
  const set = (k: string, v: ParamValue) => setVals((x) => ({ ...x, [k]: v }))
  const go = () => {
    tap({ kind: 'auto', op: 'run', id: b.id, values: vals }, b.name)
    done()
  }
  return (
    <form
      className="di-ah-form"
      onSubmit={(e) => {
        e.preventDefault()
        go()
      }}
    >
      <b>
        {b.icon} {b.name}
      </b>
      {b.fields.map((p, i) => (
        <label key={p.key}>
          {p.label}
          {p.type === 'choice' ? (
            <select value={String(vals[p.key] ?? '')} onChange={(e) => set(p.key, e.target.value)}>
              {p.choices!.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          ) : p.type === 'bool' ? (
            <input type="checkbox" checked={vals[p.key] === true} onChange={(e) => set(p.key, e.target.checked)} />
          ) : (
            <input autoFocus={i === 0} type={p.type === 'number' ? 'number' : 'text'} value={String(vals[p.key] ?? '')} min={p.min} max={p.max} maxLength={500} onChange={(e) => set(p.key, e.target.value)} />
          )}
        </label>
      ))}
      <div className="di-ah-row">
        <button type="submit" className="primary">
          Run
        </button>
        <button type="button" {...tp(`auto:cancel:${b.id}`, done)}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export function IslandAutomations({ s, tap }: { s: IslandSnapshot; tap: Tap }) {
  const v = s.auto
  const [form, setForm] = useState<string | null>(null)
  const [recent, setRecent] = useState(false)
  if (!v || (!v.buttons.length && !v.runs.length && !v.confirm)) return null
  const fb = form ? v.buttons.find((b) => b.id === form) : null
  const press = (b: IslandAutoButton) => (b.fields.length ? setForm(b.id) : tap({ kind: 'auto', op: 'run', id: b.id }, b.name))
  const c = v.confirm
  return (
    <section className="di-ah" aria-label="Your automations">
      <div className="di-ah-head">
        <b>Automations</b>
        {v.paused && <small>Paused: triggers are off</small>}
        {!!v.recent.length && <button {...tp('auto:recent', () => setRecent((x) => !x))}>{recent ? 'Hide recent' : 'Recent'}</button>}
      </div>
      {c && (
        <div className="di-ah-card">
          <div className="di-ah-top">
            <b>{c.name}</b>
            <small>{c.text}</small>
          </div>
          <ul className="di-ah-preview">
            {c.preview.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <div className="di-ah-row">
            <button className="primary" {...tp('auto:yes', () => tap({ kind: 'auto', op: 'confirm', run: c.run, yes: true }, 'Run'))}>
              Run
            </button>
            <button {...tp('auto:no', () => tap({ kind: 'auto', op: 'confirm', run: c.run, yes: false }, 'No'))}>No</button>
          </div>
        </div>
      )}
      {fb ? (
        <MiniForm b={fb} tap={tap} done={() => setForm(null)} />
      ) : (
        !!v.buttons.length && (
          <div className="di-ah-btns">
            {v.buttons.map((b) => (
              <button key={b.id} className={`di-ah-btn ${b.fav ? 'fav' : ''}`} title={b.ask ? `${b.name} (asks first)` : b.name} {...tp(`auto:${b.id}`, () => press(b))}>
                {b.icon} {b.name}
                {b.fields.length ? '…' : ''}
              </button>
            ))}
          </div>
        )
      )}
      {v.runs.map((r) => (
        <div key={r.run} className={`di-ah-card ${r.state}`}>
          <div className="di-ah-top">
            {r.state === 'running' ? <i className="di-ah-ring" aria-label="Running" /> : r.state === 'ok' ? <span className="di-ah-ok">✓</span> : <i className="di-ah-dot" aria-label="Failed" />}
            <b>{r.name}</b>
            {r.state !== 'running' && (
              <button {...tp(`auto:x:${r.run}`, () => tap({ kind: 'auto', op: 'dismiss', run: r.run }))} aria-label="Close">
                ✕
              </button>
            )}
          </div>
          {r.result?.why && <p className="di-ah-why">{r.result.why}</p>}
          {r.result?.text && <pre className="di-ah-text">{r.result.text}</pre>}
          {r.result?.image && /^https:\/\//.test(r.result.image) && <img className="di-ah-img" src={r.result.image} alt="" referrerPolicy="no-referrer" loading="lazy" />}
          {(r.result?.text || r.result?.url || r.ws) && (
            <div className="di-ah-row">
              {r.result?.text && <button {...tp(`auto:copy:${r.run}`, () => window.desktop?.islandCopy?.(r.result!.text!))}>Copy</button>}
              {r.result?.url && <button {...tp(`auto:open:${r.run}`, () => tap({ kind: 'kitLink', url: r.result!.url! }, 'Open link'))}>Open link</button>}
              {r.ws && r.state === 'ok' && <button {...tp(`auto:end:${r.run}`, () => tap({ kind: 'auto', op: 'endWs', id: r.id }, 'End workspace'))}>End workspace</button>}
            </div>
          )}
        </div>
      ))}
      {recent && (
        <div className="di-ah-recent">
          {v.recent.map((r) => (
            <div key={`${r.auto}-${r.at}`}>
              {r.ok ? '✓' : '•'}
              <span>
                {r.name} {Object.values(r.values).filter((x) => typeof x !== 'string' || x.length < 30).join(' · ')}
              </span>
              <button {...tp(`auto:rerun:${r.at}`, () => tap({ kind: 'auto', op: 'run', id: r.auto, values: r.values, rerun: true }, `Re-run ${r.name}`))}>Re-run</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
