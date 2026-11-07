// Settings → Ben → Memory (ME1): "What Ben knows about me". Everything Ben
// keeps about you in one list (facts, preferences, habits, goals, people),
// each with where it came from and when. Change the words, delete one, or
// forget everything about something. The questions Ben asked before
// remembering ("Remember that your shift is 17–24?") wait here too.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { life } from './bridge'
import { useAction } from './ui'
import { useLive } from './live'
import type { KnowItem, KnowKind, KnowView } from './web/benMind'
import './benMemory.css'

const KINDS: { id: KnowKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'fact', label: 'Facts' },
  { id: 'preference', label: 'Preferences' },
  { id: 'habit', label: 'Habits' },
  { id: 'goal', label: 'Goals' },
  { id: 'person', label: 'People' }
]
const ICON: Record<KnowKind, string> = { fact: '📌', preference: '⚙️', habit: '🔁', goal: '🎯', person: '👤' }
const day = (at: string) => {
  const d = new Date(at.length === 10 ? `${at}T12:00:00` : at)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''
}

function Item({ it, onSave, onDelete }: { it: KnowItem; onSave: (text: string) => void; onDelete: () => void }) {
  const [edit, setEdit] = useState(false)
  const [text, setText] = useState(it.text)
  useEffect(() => setText(it.text), [it.text])
  return (
    <li className="bm-item">
      <span className="bm-ic" aria-hidden>
        {ICON[it.kind]}
      </span>
      <div className="bm-body">
        {edit ? (
          <input
            className="bm-edit"
            autoFocus
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setEdit(false)
                if (text.trim() !== it.text) onSave(text)
              }
              if (e.key === 'Escape') {
                setEdit(false)
                setText(it.text)
              }
            }}
            onBlur={() => {
              setEdit(false)
              if (text.trim() !== it.text) onSave(text)
            }}
          />
        ) : (
          <span className="bm-text">{it.text}</span>
        )}
        <small className="bm-meta">
          {it.source} · {day(it.at)}
          {it.pinned ? ' · 📌 pinned' : ''}
        </small>
      </div>
      {it.editable && !edit && (
        <span className="bm-acts">
          <button className="btn small ghost" onClick={() => setEdit(true)} aria-label={`Change: ${it.text}`}>
            Edit
          </button>
          <button className="btn small ghost" onClick={onDelete} aria-label={`Delete: ${it.text}`}>
            Delete
          </button>
        </span>
      )}
    </li>
  )
}

export function BenMemory() {
  const act = useAction()
  const know = life.coach?.know
  const [v, setV] = useState<KnowView | null>(null)
  const [kind, setKind] = useState<KnowKind | 'all'>('all')
  const [q, setQ] = useState('')
  const [forget, setForget] = useState('')
  const [add, setAdd] = useState('')
  const load = useCallback(() => {
    know?.view().then(setV).catch(() => {})
  }, [know])
  useEffect(load, [load])
  useLive(load)
  const items = useMemo(() => (v?.items ?? []).filter((it) => (kind === 'all' || it.kind === kind) && (!q.trim() || it.text.toLowerCase().includes(q.trim().toLowerCase()))), [v, kind, q])
  if (!know || !v) return null
  const count = (k: KnowKind | 'all') => (k === 'all' ? v.items.length : v.items.filter((x) => x.kind === k).length)
  return (
    <section className="panel bm">
      <header className="panel-head">
        <h2>🧠 What Ben knows about me</h2>
      </header>
      <p className="hint block">Everything Ben keeps about you, with where it came from. He uses only the parts that fit what you ask, so his answers stay short. Change anything that is wrong.</p>

      {v.offers.length > 0 && (
        <div className="bm-offers">
          <h3 className="co-sub">Ben asks before he remembers</h3>
          {v.offers.map((o) => (
            <div key={o.id} className="bm-offer">
              <span>
                Remember that <b>{o.text.replace(/^Your /, 'your ').replace(/^You /, 'you ')}</b>?
              </span>
              <span className="bm-acts">
                <button className="btn small primary" onClick={() => void act(() => know.answer(o.id, true), 'Remembered').then((nv) => nv && setV(nv))}>
                  Yes
                </button>
                <button className="btn small ghost" onClick={() => void act(() => know.answer(o.id, false)).then((nv) => nv && setV(nv))}>
                  No
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="bm-tools">
        <div className="bm-tabs" role="tablist" aria-label="What kind">
          {KINDS.map((k) => (
            <button key={k.id} role="tab" aria-selected={kind === k.id} className={`bm-tab ${kind === k.id ? 'on' : ''}`} onClick={() => setKind(k.id)}>
              {k.label} <small>{count(k.id)}</small>
            </button>
          ))}
        </div>
        <input className="bm-search" type="search" placeholder="Search what he knows" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search what Ben knows" />
      </div>

      {items.length ? (
        <ul className="bm-list">
          {items.map((it) => (
            <Item key={it.id} it={it} onSave={(text) => void act(() => know.edit(it.id, text), 'Saved').then((nv) => nv && setV(nv))} onDelete={() => void act(() => know.remove(it.id), 'Deleted').then((nv) => nv && setV(nv))} />
          ))}
        </ul>
      ) : (
        <p className="hint small">Nothing here yet. Tell Ben things like "gym is always at 18" or "curata camera takes 40 min", and he'll keep them.</p>
      )}

      <div className="bm-row">
        <input className="bm-search" placeholder="Add something Ben should know" value={add} maxLength={200} onChange={(e) => setAdd(e.target.value)} />
        <button
          className="btn small"
          disabled={!add.trim()}
          onClick={() =>
            void act(() => know.add(add.trim()), 'Saved').then((nv) => {
              if (nv) {
                setV(nv)
                setAdd('')
              }
            })
          }
        >
          Add
        </button>
      </div>
      <div className="bm-row">
        <input className="bm-search" placeholder="Forget everything about… (a name, a topic)" value={forget} maxLength={40} onChange={(e) => setForget(e.target.value)} />
        <button
          className="btn small ghost"
          disabled={forget.trim().length < 2}
          onClick={() =>
            void act(async () => {
              const r = await know.forget(forget.trim())
              setV(r.view)
              setForget('')
              return r
            }, 'Forgotten')
          }
        >
          Forget
        </button>
      </div>

      {(v.convo.summary || v.convo.points.length > 0) && (
        <details className="bm-past">
          <summary>From your past chats ({v.convo.points.length})</summary>
          {v.convo.summary && <p className="hint small">{v.convo.summary}</p>}
          <ul className="bm-list">
            {v.convo.points.slice(0, 12).map((p) => (
              <li key={`${p.at}${p.text}`} className="bm-item">
                <span className="bm-ic" aria-hidden>
                  {p.kind === 'win' ? '🏆' : p.kind === 'struggle' ? '🧗' : '🧭'}
                </span>
                <div className="bm-body">
                  <span className="bm-text">{p.text}</span>
                  <small className="bm-meta">
                    {p.kind === 'win' ? 'A win' : p.kind === 'struggle' ? 'Found it hard' : 'Decided'} · {day(p.day)}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
