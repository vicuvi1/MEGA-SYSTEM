// Settings → Ben → Ben's notes about you (BR4): the four notes Ben keeps and
// always reads (About you, Goals now, How to coach you, People). You can edit
// them, pin one (Ben reads it but can't change it), see what changed in his
// memory lately (his notes, facts he learned, the nightly tidy-up) and undo it.
import { useCallback, useEffect, useState } from 'react'
import { BLOCK_CAP, type MemBlock, type MemChange, type MemoryView } from '@core/benMemory'
import { life } from './bridge'
import { useAction } from './ui'
import { useLive } from './live'

const BY: Record<MemChange['by'], string> = { ben: 'Ben', you: 'You', tidy: 'Night tidy-up' }
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const cut = (t: string | null, n = 90) => (t == null ? '' : t.length > n ? `${t.slice(0, n)}…` : t)

function changeText(c: MemChange): string {
  if (c.why === 'undo') return `Undid a change to ${c.what === 'block' ? `"${c.name}"` : 'a fact'}`
  if (c.what === 'block') return `Changed "${c.name}"`
  if (c.before == null) return `Remembered: ${cut(c.after)}`
  if (c.after == null) return `Forgot: ${cut(c.before)}`
  return `Rewrote: ${cut(c.before, 50)} → ${cut(c.after, 60)}`
}

function Block({ b, onSave }: { b: MemBlock; onSave: (patch: { text?: string; pinned?: boolean }) => void }) {
  const [text, setText] = useState(b.text)
  useEffect(() => setText(b.text), [b.text])
  return (
    <div className="field">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>
          <b>{b.name}</b> <small className="hint">{text.length}/{BLOCK_CAP}</small>
        </span>
        <button className={`btn small ${b.pinned ? '' : 'ghost'}`} aria-pressed={!!b.pinned} title={b.pinned ? 'Pinned: Ben reads it but cannot change it' : 'Pin it so Ben cannot change it'} onClick={() => onSave({ pinned: !b.pinned })}>
          {b.pinned ? '📌 Pinned' : 'Pin'}
        </button>
      </div>
      <textarea className="co-about" rows={3} maxLength={BLOCK_CAP} value={text} placeholder="Empty: Ben fills it as he learns about you" onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() !== b.text && onSave({ text })} />
    </div>
  )
}

export function BenNotes() {
  const act = useAction()
  const [v, setV] = useState<MemoryView | null>(null)
  const load = useCallback(() => {
    life.coach?.brain?.view().then(setV).catch(() => {})
  }, [])
  useEffect(load, [load])
  useLive(load)
  const brain = life.coach?.brain
  if (!brain || !v) return null
  const pinned = v.facts.filter((f) => f.pin)
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>🧠 Ben's notes about you</h2>
      </header>
      <p className="hint block">Ben keeps these four notes himself and reads them before every answer. Fix anything wrong, or pin a note so he can't change it.</p>
      {v.blocks.map((b) => (
        <Block key={b.name} b={b} onSave={(patch) => void act(() => brain.editBlock(b.name, patch)).then((nv) => nv && setV(nv))} />
      ))}

      <details>
        <summary>
          Facts he remembers ({v.facts.length}
          {pinned.length ? `, ${pinned.length} pinned` : ''})
        </summary>
        <p className="hint small">Pinned facts are never changed or tidied away.</p>
        <ul className="ab-list">
          {v.facts
            .slice()
            .reverse()
            .map((f) => (
              <li key={f.t} className="row" style={{ justifyContent: 'space-between', gap: '0.5rem' }}>
                <span>{f.t}</span>
                <button className={`btn small ${f.pin ? '' : 'ghost'}`} aria-pressed={!!f.pin} onClick={() => void act(() => brain.pinFact(f.t, !f.pin)).then((nv) => nv && setV(nv))}>
                  {f.pin ? '📌' : 'Pin'}
                </button>
              </li>
            ))}
        </ul>
      </details>

      <h3 className="co-sub">Recent memory changes</h3>
      {v.changes.length ? (
        <ul className="ab-list">
          {v.changes.map((c) => (
            <li key={c.id} className="row" style={{ justifyContent: 'space-between', gap: '0.5rem' }}>
              <span>
                <small className="hint">
                  {when(c.at)} · {BY[c.by]}
                </small>{' '}
                {changeText(c)}
                {c.why && c.why !== 'undo' ? <small className="hint"> ({c.why})</small> : null}
              </span>
              {!c.undone && c.why !== 'undo' && (
                <button
                  className="btn small ghost"
                  onClick={() =>
                    void act(async () => {
                      const r = await brain.undo(c.id)
                      setV(r.view)
                      return r
                    }, 'Undone')
                  }
                >
                  Undo
                </button>
              )}
              {c.undone && <small className="hint">undone</small>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint small">Nothing yet. What Ben learns, and his nightly memory tidy-up (around 03:00), shows here.</p>
      )}
    </section>
  )
}
