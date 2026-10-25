import { useEffect, useMemo, useState } from 'react'
import type { LedgerEntry, Rule, Summary } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { MODULE_LABEL } from '../modules'
import { Coins, describeEntry, useAction } from '../ui'

export function History({ rules, onChange }: { rules: Rule[]; onChange: (s: Summary) => void }) {
  const act = useAction()
  const [rows, setRows] = useState<LedgerEntry[]>([])
  const [undoing, setUndoing] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const titles = useMemo(() => Object.fromEntries(rules.map((r) => [r.id, r.title])), [rules])
  const undone = useMemo(() => new Set(rows.filter((r) => r.kind === 'undo').map((r) => r.undoOf)), [rows])

  const load = () => life.wallet.history(300).then(setRows)
  useEffect(() => {
    load()
  }, [])

  async function confirmUndo(id: number) {
    const s = await act(() => life.wallet.undo(id, reason), 'Undone')
    if (!s) return
    onChange(s)
    setUndoing(null)
    setReason('')
    load()
  }

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Every coin in and out</h2>
        <span className="hint">Nothing is ever deleted. An undo needs a reason and shows up here.</span>
      </header>
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Section</th>
            <th>What</th>
            <th className="num">Coins</th>
            <th className="num">XP</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className={e.kind === 'undo' || undone.has(e.id) ? 'muted' : ''}>
              <td>{new Date(e.ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
              <td>{MODULE_LABEL[e.module] ?? e.module}</td>
              <td>{describeEntry(e, titles)}</td>
              <td className="num">{e.kind !== 'undo' && <Coins n={e.coins} sign />}</td>
              <td className="num">{e.kind !== 'undo' && e.xp > 0 ? `+${e.xp}` : ''}</td>
              <td className="row-act">
                {e.kind !== 'undo' && !undone.has(e.id) &&
                  (undoing === e.id ? (
                    <span className="undo-form">
                      <input autoFocus placeholder="Why?" value={reason} onChange={(ev) => setReason(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && confirmUndo(e.id)} />
                      <button className="btn small" onClick={() => confirmUndo(e.id)}>
                        Undo
                      </button>
                      <button className="btn small ghost" onClick={() => setUndoing(null)}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button className="icon-btn" aria-label="Undo" title="Undo" onClick={() => setUndoing(e.id)}>
                      <Icon name="undo" size={15} />
                    </button>
                  ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="empty">No entries yet.</div>}
    </section>
  )
}
