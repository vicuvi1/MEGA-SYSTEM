// Rewards: what your points buy. Guilt-free fun time and real rewards you
// save for (pin the one you're saving toward). Points come from focus,
// finished tasks and must-dos, week goals, and a little from habits.
import { priceInDays } from '@core/shop'
import { redeemReward } from '../redeem'
import { useEffect, useState } from 'react'
import type { RewardInput, ShopState } from '@shared/api'
import { redeemBlocker, type Reward } from '@core/shop'
import { life } from '../bridge'
import { FunCard } from '../FunCard'
import { Icon } from '../Icon'
import { soundSuccess } from '../sound'
import { useAction } from '../ui'
import { POINT_RULES } from '../../../main/points'
import { STREAK_LABEL, type StreakId, type Unlock } from '@core/unlocks'
import type { UnlocksView } from '../web/lifeExtras'
import '../lifeExtras.css'

/** Reward locks: unlock with a goal or a streak (FT21). */
function useUnlocks(): [UnlocksView | null, () => void] {
  const [v, setV] = useState<UnlocksView | null>(null)
  const load = () => void life.extras?.unlocks().then(setV).catch(() => {})
  useEffect(load, [])
  return [v, load]
}

function LockEditor({ rewardId, view, onDone }: { rewardId: number; view: UnlocksView | null; onDone: () => void }) {
  const act = useAction()
  const cur = view?.locks[String(rewardId)]
  const openGoals = (view?.goals ?? []).filter((g) => !g.done)
  const [kind, setKind] = useState<'goal' | 'streak'>(cur?.kind ?? (openGoals.length ? 'goal' : 'streak'))
  const [goalId, setGoalId] = useState<number>(cur?.kind === 'goal' ? cur.goalId : openGoals[0]?.id ?? 0)
  const [streak, setStreak] = useState<StreakId>(cur?.kind === 'streak' ? cur.streak : 'workout')
  const [days, setDays] = useState<number>(cur?.kind === 'streak' ? cur.days : 14)
  const save = async (u: Unlock | null) => {
    if (await act(() => life.extras!.setUnlock(rewardId, u), u ? 'Lock saved: points still count, the buy waits for it' : 'Lock removed')) onDone()
  }
  return (
    <div className="rw-lock-edit">
      <div className="row">
        <select value={kind} onChange={(e) => setKind(e.target.value as 'goal' | 'streak')} aria-label="Unlock with">
          <option value="goal">When a goal is done</option>
          <option value="streak">At a streak</option>
        </select>
        {kind === 'goal' ? (
          <select value={goalId} onChange={(e) => setGoalId(Number(e.target.value))} aria-label="Goal">
            {!openGoals.length && <option value={0}>No open goals: add one on the Goals page</option>}
            {openGoals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} aria-label="Days" />
            <select value={streak} onChange={(e) => setStreak(e.target.value as StreakId)} aria-label="Streak">
              {(Object.keys(STREAK_LABEL) as StreakId[]).map((k) => (
                <option key={k} value={k}>
                  day {STREAK_LABEL[k]} streak
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <div className="row">
        <button
          className="btn small primary"
          disabled={kind === 'goal' && !goalId}
          onClick={() => void save(kind === 'goal' ? { kind: 'goal', goalId, title: openGoals.find((g) => g.id === goalId)?.title ?? 'goal' } : { kind: 'streak', streak, days })}
        >
          Save lock
        </button>
        {cur && (
          <button className="btn small ghost" onClick={() => void save(null)}>
            Remove lock
          </button>
        )}
        <button className="btn small ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/** A full 50-minute focus session pays this much (+3 per 10 min). */
const PER_SESSION = 15

const blank = { title: '', price: '', realCost: '', note: '' }

export function Rewards({ state, onState, onWallet }: { state: ShopState; onState: (s: ShopState) => void; onWallet: () => void }) {
  const act = useAction()
  const [locks, reloadLocks] = useUnlocks()
  const [locking, setLocking] = useState<number | null>(null)
  const [form, setForm] = useState(blank)
  const [editing, setEditing] = useState<number | null>(null)
  const [sure, setSure] = useState<number | null>(null)
  const live = state.rewards.filter((r) => !r.archived).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.price - b.price)
  const lockOf = (r: Reward) => (locks?.states[String(r.id)] && !locks.states[String(r.id)].met ? locks.states[String(r.id)].text : null)
  const why = (r: Reward) => redeemBlocker({ reward: r, balance: state.balance, level: state.level, monthSpent: state.monthSpent, budget: state.budget }) ?? lockOf(r)

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
    const s = await act(() => redeemReward(r.id), `${r.title}: yours. You earned it.`)
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
                  <span className="rw-price">
                    {r.price.toLocaleString()} pts
                    {priceInDays(r.price, state.earnPerDay ?? 0) && <small className="rw-days"> · {priceInDays(r.price, state.earnPerDay ?? 0)}</small>}
                  </span>
                </div>
                {r.note && <p className="hint">{r.note}</p>}
                {locks?.states[String(r.id)] && (
                  <p className={`rw-lock ${locks.states[String(r.id)].met ? 'open' : ''}`}>
                    {locks.states[String(r.id)].met ? '🔓' : '🔒'} {locks.states[String(r.id)].text}
                  </p>
                )}
                {locking === r.id && <LockEditor rewardId={r.id} view={locks} onDone={() => { setLocking(null); reloadLocks() }} />}
                <div className="rw-bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
                <div className="rw-foot">
                  <span className="hint">
                    {left ? `${left.toLocaleString()} to go · about ${Math.ceil(left / PER_SESSION)} focus sessions` : blocked ? (lockOf(r) ? 'Points ready, waiting for the lock' : blocked) : 'Ready'}
                    {r.realCost ? ` · costs ${r.realCost} ${state.currency}` : ''}
                  </span>
                  <span className="row">
                    <button className="btn small ghost" onClick={() => { setEditing(r.id); setForm({ title: r.title, price: String(r.price), realCost: r.realCost ? String(r.realCost) : '', note: r.note ?? '' }) }}>
                      Edit
                    </button>
                    {locks && (
                      <button className="btn small ghost" onClick={() => setLocking(locking === r.id ? null : r.id)} title="Unlock it only when a goal is done or a streak is reached">
                        {locks.locks[String(r.id)] ? 'Lock' : 'Add lock'}
                      </button>
                    )}
                    <button className="btn small ghost danger" onClick={() => void archive(r)}>
                      Remove
                    </button>
                    <button className={`btn small ${sure === r.id || !blocked ? 'primary' : ''}`} disabled={!!blocked} onClick={() => void redeem(r)} onBlur={() => setSure(null)}>
                      {sure === r.id ? `Confirm −${r.price}` : blocked ? (left ? `${left.toLocaleString()} more pts` : lockOf(r) ? 'Locked' : 'Not yet') : 'Get it'}
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
