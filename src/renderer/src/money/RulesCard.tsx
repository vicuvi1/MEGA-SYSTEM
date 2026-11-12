// Money phase 5: category rules. Your rules ("contains linella → Food") are
// edited and deleted here (they sync and a deleted one stays deleted); what
// the app learned from your records is listed read-only with how sure it is,
// with "Make a rule" to turn one into a rule. Folded by default.
import { useEffect, useState } from 'react'
import { life } from '../bridge'
import { useToast } from '../ui'
import type { RulesView } from '../web/moneySortCore'
import './sort.css'

const pct = (x: number) => `${Math.round(x * 100)}%`

export function RulesCard() {
  const [open, setOpen] = useState(false)
  const [v, setV] = useState<RulesView | null>(null)
  const [match, setMatch] = useState('')
  const [type, setType] = useState('expense')
  const [cat, setCat] = useState('')
  const toast = useToast()
  useEffect(() => {
    if (!open || !life.moneySort) return
    const load = () => void life.moneySort!.rules().then(setV).catch(() => setV(null))
    load()
    window.addEventListener('life-moneysort-changed', load)
    return () => window.removeEventListener('life-moneysort-changed', load)
  }, [open])
  if (!life.moneySort) return null
  const api = life.moneySort
  const run = async (fn: () => Promise<RulesView | null>, said: string) => {
    try {
      setV(await fn())
      toast(said, 'good')
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  const cats = (t: string) => (v?.categories ?? []).filter((c) => c.type === t)
  return (
    <details className="mh-card ts-rules" data-testid="rules-card" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <h2>🏷️ Category rules</h2>
        <span className="mh-hint">{v ? `${v.rules.length} rules · ${v.learned.length} learned` : 'What files itself'}</span>
      </summary>
      {v && (
        <>
          <p className="mh-hint block">A rule always wins. "Learned" is worked out from what you chose before: it files by itself only when sure (3 or more the same way).</p>
          <ul className="ts-rlist" data-testid="rules-list">
            {v.rules.map((r) => (
              <li key={r.id} data-testid="rule-row" data-match={r.match}>
                <b>"{r.match}"</b>
                <span className="ts-arrow">→</span>
                <select aria-label={`Category for ${r.match}`} value={r.category} onChange={(e) => void run(() => api.saveRule({ id: r.id, match: r.match, type: r.type, category: e.target.value }), 'Rule changed')}>
                  {cats(r.type).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.emoji ? `${c.emoji} ` : ''}
                      {c.name}
                    </option>
                  ))}
                </select>
                {r.learned && <i className="ts-autotag">from To sort</i>}
                {r.type === 'income' && <small>income</small>}
                <button className="ts-x" aria-label={`Delete the rule for ${r.match}`} data-testid="rule-del" onClick={() => void run(() => api.deleteRule(r.id), `Rule "${r.match}" deleted`)}>
                  ✕
                </button>
              </li>
            ))}
            {!v.rules.length && <li className="mh-hint">No rules yet. Sorting a payment makes one.</li>}
          </ul>
          <form
            className="ts-rnew"
            onSubmit={(e) => {
              e.preventDefault()
              const c = cat || cats(type)[0]?.id
              if (!c) return
              void run(() => api.saveRule({ match, type, category: c }), `Rule "${match.trim()}" saved`).then(() => setMatch(''))
            }}
          >
            <input value={match} onChange={(e) => setMatch(e.target.value)} placeholder="When the text has… (e.g. linella)" aria-label="When the text has" />
            <select value={type} onChange={(e) => (setType(e.target.value), setCat(''))} aria-label="Spending or income">
              <option value="expense">Spending</option>
              <option value="income">Income</option>
            </select>
            <select value={cat || cats(type)[0]?.id || ''} onChange={(e) => setCat(e.target.value)} aria-label="File it as">
              {cats(type).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji ? `${c.emoji} ` : ''}
                  {c.name}
                </option>
              ))}
            </select>
            <button className="mh-pillbtn" type="submit" disabled={match.trim().length < 2}>
              + Rule
            </button>
          </form>
          {v.learned.length > 0 && (
            <>
              <h3 className="ts-sub">Learned from your records</h3>
              <ul className="ts-rlist learned" data-testid="learned-list">
                {v.learned.slice(0, 30).map((l) => (
                  <li key={`${l.type}|${l.merchant}`}>
                    <b>{l.merchant}</b>
                    <span className="ts-arrow">→</span>
                    <span>{l.categoryName}</span>
                    <i className={`ts-lv lv-${l.level}`}>
                      {l.level} · {pct(l.confidence)} of {l.n}
                    </i>
                    <button className="ts-chip ghost" onClick={() => void run(() => api.saveRule({ match: l.merchant, type: l.type, category: l.category }), `Rule "${l.merchant}" made`)}>
                      Make a rule
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </details>
  )
}
