import { useState } from 'react'
import type { Rule } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { MODULE_LABEL } from '../modules'
import { useAction } from '../ui'

const MODULE_IDS = ['tasks', 'schedule', 'sleep', 'discipline', 'body', 'money']

function blank(): Rule {
  return { id: `custom.${Date.now().toString(36)}`, module: 'tasks', title: '', coins: 5, xp: 10, dailyCap: 1, cooldownMin: 0, enabled: true }
}

export function Rules({ rules, onChange }: { rules: Rule[]; onChange: (r: Rule[]) => void }) {
  const act = useAction()
  const [draft, setDraft] = useState<Rule | null>(null)

  async function save(r: Rule) {
    const next = await act(() => life.rules.save(r), 'Saved')
    if (next) {
      onChange(next)
      setDraft(null)
    }
  }

  const num = (k: keyof Rule) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => d && { ...d, [k]: e.target.value === '' || e.target.value === '-' ? 0 : parseInt(e.target.value, 10) || 0 })

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>What earns and what costs</h2>
        <button className="btn small" onClick={() => setDraft(blank())}>
          <Icon name="plus" size={14} /> New rule
        </button>
      </header>
      <p className="hint block">
        Penalties (negative coins) never take XP and never push your wallet below zero. Daily limit 0 means no limit.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Rule</th>
            <th>Section</th>
            <th className="num">Coins</th>
            <th className="num">XP</th>
            <th className="num">Per day</th>
            <th className="num">Cooldown</th>
            <th>On</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} className={r.enabled ? '' : 'muted'}>
              <td>{r.title}</td>
              <td>{MODULE_LABEL[r.module] ?? r.module}</td>
              <td className={`num ${r.coins < 0 ? 'neg-text' : ''}`}>{r.coins > 0 ? `+${r.coins}` : r.coins}</td>
              <td className="num">{r.xp}</td>
              <td className="num">{r.dailyCap || '∞'}</td>
              <td className="num">{r.cooldownMin ? `${r.cooldownMin} min` : '–'}</td>
              <td>
                <input type="checkbox" aria-label={`Turn ${r.title} on or off`} checked={r.enabled} onChange={() => save({ ...r, enabled: !r.enabled })} />
              </td>
              <td className="row-act">
                <button className="btn small ghost" onClick={() => setDraft({ ...r })}>
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {draft && (
        <div className="sheet" role="dialog" aria-label="Edit rule">
          <div className="sheet-card">
            <h3>{rules.some((r) => r.id === draft.id) ? 'Edit rule' : 'New rule'}</h3>
            <label>
              Title
              <input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label>
              Section
              <select value={draft.module} onChange={(e) => setDraft({ ...draft, module: e.target.value })}>
                {MODULE_IDS.map((m) => (
                  <option key={m} value={m}>
                    {MODULE_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid4">
              <label>
                Coins
                <input type="number" value={draft.coins} onChange={num('coins')} />
              </label>
              <label>
                XP
                <input type="number" min={0} value={draft.xp} onChange={num('xp')} />
              </label>
              <label>
                Per day
                <input type="number" min={0} value={draft.dailyCap} onChange={num('dailyCap')} />
              </label>
              <label>
                Cooldown (min)
                <input type="number" min={0} value={draft.cooldownMin} onChange={num('cooldownMin')} />
              </label>
            </div>
            <div className="sheet-actions">
              <button className="btn ghost" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => save(draft)}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
