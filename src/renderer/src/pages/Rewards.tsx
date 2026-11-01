// Rewards: what your points buy. Guilt-free fun time and real rewards you
// save for (pin the one you're saving toward). Points come from focus,
// finished tasks and must-dos, week goals, and a little from habits.
import { useState } from 'react'
import type { RewardInput, ShopState } from '@shared/api'
import { redeemBlocker, type Reward } from '@core/shop'
import { life } from '../bridge'
import { FunCard } from '../FunCard'
import { Icon } from '../Icon'
import { soundSuccess } from '../sound'
import { useAction } from '../ui'
import { POINT_RULES } from '../../../main/points'

/** A full 50-minute focus session pays this much (+3 per 10 min). */
const PER_SESSION = 15

const blank = { title: '', price: '', realCost: '', note: '' }

export function Rewards({ state, onState, onWallet }: { state: ShopState; onState: (s: ShopState) => void; onWallet: () => void }) {
  const act = useAction()
  const [form, setForm] = useState(blank)
  const [editing, setEditing] = useState<number | null>(null)
  const [sure, setSure] = useState<number | null>(null)
  const live = state.rewards.filter((r) => !r.archived).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.price - b.price)
  const why = (r: Reward) => redeemBlocker({ reward: r, balance: state.balance, level: state.level, monthSpent: state.monthSpent, budget: state.budget })

  const save = async () => {
    const price = Math.round(Number(form.price))
    const input: RewardInput = {
      ...(editing ? { id: editing } : {}),
      title: form.title.trim(),
      price,
      realCost: Math.max(0, Math.round(Number(form.realCost) || 0)),
      tier: 'bronze',
      pinned: editing ? !!state.rewards.find((r) => r.id === editing)?.pinned : false,
      note: form.note.trim() || null
    } as RewardInput
    const s = await act(() => life.shop.save(input), editing ? 'Reward updated' : 'Reward added')
    if (s) {
      onState(s)
      setForm(blank)
      setEditing(null)
    }
  }
  const pin = async (r: Reward) => {
    // One pinned reward: the one you're saving for.
    for (const o of state.rewards.filter((x) => x.pinned && x.id !== r.id)) await life.shop.save({ ...o, pinned: false } as RewardInput)
    const s = await act(() => life.shop.save({ ...r, pinned: !r.pinned } as RewardInput))
    if (s) onState(s)
  }
  const redeem = async (r: Reward) => {
    if (sure !== r.id) return setSure(r.id)
    setSure(null)
    const s = await act(() => life.shop.redeem(r.id), `${r.title}: yours. You earned it.`)
    if (s) {
      soundSuccess()
      onState(s)
      onWallet()
    }
  }
  const archive = async (r: Reward) => {
    const s = await act(() => life.shop.archive(r.id), 'Reward removed')
    if (s) onState(s)
  }

  return (
    <div className="rw">
      <section className="panel rw-head">
        <div>
          <span className="rw-kicker">Points to spend</span>
          <div className="rw-balance">
            {state.balance.toLocaleString()} <span>🪙</span>
          </div>
        </div>
        <div className="rw-rules" aria-label="How points work">
          <span className="rw-kicker">How you earn</span>
          <ul>
            {POINT_RULES.map((r) => (
              <li key={r.id} title={r.hint}>
                <b>{r.value}</b>
                <span>{r.label}</span>
                <small>{r.hint}</small>
              </li>
            ))}
          </ul>
          <p className="hint small">Fun time costs 1 point a minute. A full focus session ({PER_SESSION} points) buys 15 minutes of guilt-free fun.</p>
        </div>
      </section>

      <FunCard onWallet={onWallet} onOpenShop={() => document.querySelector('.rw-add input')?.scrollIntoView({ behavior: 'smooth' })} />

      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="gift" /> Your rewards
          </h2>
          <span className="hint">⭐ pin the one you're saving for</span>
        </header>
        {!live.length && <p className="hint">No rewards yet. Add something you really want below: a game, headphones, a dinner out.</p>}
        <div className="rw-grid">
          {live.map((r) => {
            const blocked = why(r)
            const pct = Math.min(100, (state.balance / Math.max(1, r.price)) * 100)
            const left = Math.max(0, r.price - state.balance)
            return (
              <div key={r.id} className={`rw-card ${r.pinned ? 'pinned' : ''} ${blocked ? '' : 'ready'}`}>
                <div className="rw-top">
                  <button className={`rw-pin ${r.pinned ? 'on' : ''}`} onClick={() => void pin(r)} aria-label={r.pinned ? 'Unpin' : 'Pin as my goal'} title={r.pinned ? 'Unpin' : 'Saving for this'}>
                    ★
                  </button>
                  <b className="rw-title">{r.title}</b>
                  <span className="rw-price">{r.price.toLocaleString()} 🪙</span>
                </div>
                {r.note && <p className="hint">{r.note}</p>}
                <div className="rw-bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
                <div className="rw-foot">
                  <span className="hint">
                    {left ? `${left.toLocaleString()} to go · about ${Math.ceil(left / PER_SESSION)} focus sessions` : blocked ?? 'Ready'}
                    {r.realCost ? ` · costs ${r.realCost} ${state.currency}` : ''}
                  </span>
                  <span className="row">
                    <button className="btn small ghost" onClick={() => { setEditing(r.id); setForm({ title: r.title, price: String(r.price), realCost: r.realCost ? String(r.realCost) : '', note: r.note ?? '' }) }}>
                      Edit
                    </button>
                    <button className="btn small ghost" onClick={() => void archive(r)}>
                      Remove
                    </button>
                    <button className={`btn small ${sure === r.id ? 'primary' : ''}`} disabled={!!blocked} onClick={() => void redeem(r)} onBlur={() => setSure(null)}>
                      {sure === r.id ? `Confirm −${r.price}` : 'Get it'}
                    </button>
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        <form
          className="rw-add"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <h3>{editing ? 'Edit reward' : 'Add a reward'}</h3>
          <div className="row">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What, e.g. New headphones" maxLength={80} required />
            <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value.replace(/\D/g, '') })} placeholder="Points, e.g. 600" inputMode="numeric" required />
            <input value={form.realCost} onChange={(e) => setForm({ ...form, realCost: e.target.value.replace(/\D/g, '') })} placeholder={`Real cost (${state.currency}), optional`} inputMode="numeric" />
          </div>
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Note, optional (link, size, color…)" maxLength={140} />
          <div className="row">
            <button className="btn primary" disabled={!form.title.trim() || !(Number(form.price) > 0)}>
              <Icon name={editing ? 'check' : 'plus'} size={14} /> {editing ? 'Save' : 'Add reward'}
            </button>
            {editing && (
              <button type="button" className="btn ghost" onClick={() => { setEditing(null); setForm(blank) }}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      {state.recent.length > 0 && (
        <section className="panel">
          <header className="panel-head">
            <h2>Recently got</h2>
          </header>
          <ul className="rw-recent">
            {state.recent.slice(0, 8).map((x, i) => (
              <li key={i} className={x.undone ? 'undone' : ''}>
                <span>{x.title}</span>
                <span className="hint">
                  {x.day}
                  {x.realCost ? ` · ${x.realCost} ${state.currency}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
