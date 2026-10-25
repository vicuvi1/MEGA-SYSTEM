import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { redeemBlocker, TIERS, tierUnlocked } from '@core/shop'
import type { Reward, RewardInput, ShopState, Tier } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { Coins, useAction } from '../ui'

interface Props {
  state: ShopState
  onState: (s: ShopState) => void
  /** Called after coins moved, so the top bar refreshes. */
  onWallet: () => void
}

const TIER_IDS = Object.keys(TIERS) as Tier[]

export function Shop({ state, onState, onWallet }: Props) {
  const act = useAction()
  const [editing, setEditing] = useState<RewardInput | null>(null)
  const [confirm, setConfirm] = useState<Reward | null>(null)
  const [celebrate, setCelebrate] = useState<{ title: string; sub: string } | null>(null)
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null)

  const check = (r: Reward) => redeemBlocker({ reward: r, balance: state.balance, level: state.level, monthSpent: state.monthSpent, budget: state.budget })

  async function redeem(r: Reward) {
    const s = await act(() => life.shop.redeem(r.id))
    setConfirm(null)
    if (!s) return
    onState(s)
    onWallet()
    setCelebrate({ title: `${r.title} unlocked!`, sub: 'You earned this. Go get it.' })
  }

  async function openChest(level: number) {
    const res = await act(() => life.shop.openChest(level))
    if (!res) return
    onState(res.state)
    onWallet()
    setCelebrate({ title: `+${res.coins} coins`, sub: `Level ${level} chest opened` })
  }

  async function save(r: RewardInput) {
    const s = await act(() => life.shop.save(r), 'Saved')
    if (s) {
      onState(s)
      setEditing(null)
    }
  }

  async function saveBudget() {
    const n = parseInt(budgetDraft ?? '0', 10) || 0
    const s = await act(() => life.shop.setBudget(n), 'Budget saved')
    if (s) {
      onState(s)
      setBudgetDraft(null)
    }
  }

  const used = state.budget ? Math.min(1, state.monthSpent / state.budget) : 0

  return (
    <div className="shop">
      <section className="stats">
        <div className="stat">
          <span className="label">Wallet</span>
          <div className="big">
            <Coins n={state.balance} />
          </div>
          <span className="sub">Level {state.level}</span>
        </div>

        <div className="stat">
          <span className="label">Reward budget this month</span>
          {budgetDraft === null ? (
            <>
              <div className="big small-big">
                {state.budget ? `${state.monthSpent} / ${state.budget}` : state.monthSpent} <small>{state.currency}</small>
              </div>
              {state.budget > 0 && (
                <div className="bar budget">
                  <i style={{ width: `${used * 100}%` }} className={used >= 0.9 ? 'hot' : ''} />
                </div>
              )}
              <button className="link" onClick={() => setBudgetDraft(String(state.budget || ''))}>
                {state.budget ? 'Change limit' : 'Set a monthly limit'}
              </button>
            </>
          ) : (
            <div className="row tight">
              <input autoFocus type="number" min={0} placeholder={`Limit in ${state.currency} (0 = none)`} value={budgetDraft} onChange={(e) => setBudgetDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveBudget()} />
              <button className="btn small primary" onClick={saveBudget}>
                Save
              </button>
            </div>
          )}
        </div>

        <div className={`stat chests ${state.chests.length ? 'has' : ''}`}>
          <span className="label">Chests</span>
          {state.chests.length ? (
            <div className="chest-row">
              {state.chests.slice(0, 4).map((l) => (
                <motion.button key={l} className="chest" whileHover={{ y: -3, rotate: -2 }} whileTap={{ scale: 0.92 }} onClick={() => openChest(l)} title={`Open the level ${l} chest`}>
                  <Icon name="gift" size={22} />
                  <span>LV {l}</span>
                </motion.button>
              ))}
              {state.chests.length > 4 && <span className="sub">+{state.chests.length - 4} more</span>}
            </div>
          ) : (
            <span className="sub block-sub">Every level up drops a chest with bonus coins.</span>
          )}
        </div>
      </section>

      <section className="reward-grid">
        {state.rewards.map((r) => {
          const why = check(r)
          const locked = !tierUnlocked(r.tier, state.level)
          const pct = Math.min(1, state.balance / r.price)
          const tier = TIERS[r.tier]
          return (
            <motion.article key={r.id} layout className={`reward ${locked ? 'locked' : ''} ${!why ? 'ready' : ''}`} style={{ ['--tier' as string]: tier.color }}>
              <header>
                <span className="tier">{tier.label}</span>
                <span className="reward-tools">
                  <button className={`icon-btn ${r.pinned ? 'pinned' : ''}`} aria-label={r.pinned ? 'Main goal' : 'Make this my main goal'} title={r.pinned ? 'Main goal (shown on Today)' : 'Make this my main goal'} onClick={() => save({ ...r, pinned: !r.pinned })}>
                    <Icon name="spark" size={14} />
                  </button>
                  <button className="icon-btn" aria-label="Edit reward" title="Edit" onClick={() => setEditing({ ...r })}>
                    <Icon name="sliders" size={14} />
                  </button>
                </span>
              </header>
              <h3>{r.title}</h3>
              {r.note && <p className="note">{r.note}</p>}
              <div className="price">
                <Coins n={r.price} />
                {r.realCost > 0 && (
                  <span className="real">
                    ≈ {r.realCost} {state.currency}
                  </span>
                )}
              </div>
              <div className="bar">
                <i style={{ width: `${pct * 100}%` }} />
              </div>
              {locked ? (
                <div className="lock-note">
                  <Icon name="lock" size={14} /> Unlocks at level {tier.minLevel}
                </div>
              ) : why ? (
                <div className="lock-note">{why}</div>
              ) : (
                <button className="btn primary" onClick={() => setConfirm(r)}>
                  Redeem
                </button>
              )}
            </motion.article>
          )
        })}
        <button className="reward add" onClick={() => setEditing({ title: '', price: 200, tier: 'bronze', realCost: 0, pinned: false, note: null })}>
          <Icon name="plus" size={22} />
          <span>Add a reward</span>
        </button>
      </section>

      {state.recent.length > 0 && (
        <section className="panel">
          <header className="panel-head">
            <h2>Bought</h2>
            <span className="hint">Bought by mistake? Undo it in History and the coins come back.</span>
          </header>
          <ul className="feed">
            {state.recent.map((b, i) => (
              <li key={i} className={b.undone ? 'muted' : ''}>
                <span className="what">
                  {b.title}
                  {b.undone ? ' (undone)' : ''}
                </span>
                <span className="when">{b.day}</span>
                <span className="when">{b.realCost ? `${b.realCost} ${state.currency}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {confirm && (
        <div className="sheet" role="dialog" aria-label="Confirm reward">
          <div className="sheet-card">
            <h3>Redeem {confirm.title}?</h3>
            <p className="hint">
              This spends <Coins n={confirm.price} /> from your wallet
              {confirm.realCost > 0 ? ` and counts ${confirm.realCost} ${state.currency} toward this month's reward budget` : ''}.
            </p>
            <div className="sheet-actions">
              <button className="btn ghost" onClick={() => setConfirm(null)}>
                Not yet
              </button>
              <button className="btn primary" onClick={() => redeem(confirm)}>
                Redeem
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && <RewardSheet value={editing} currency={state.currency} onCancel={() => setEditing(null)} onSave={save} onArchive={async (id) => {
        const s = await act(() => life.shop.archive(id), 'Archived')
        if (s) {
          onState(s)
          setEditing(null)
        }
      }} />}

      <AnimatePresence>
        {celebrate && <Celebration key={celebrate.title} {...celebrate} onDone={() => setCelebrate(null)} />}
      </AnimatePresence>
    </div>
  )
}

function RewardSheet({ value, currency, onCancel, onSave, onArchive }: { value: RewardInput; currency: string; onCancel: () => void; onSave: (r: RewardInput) => void; onArchive: (id: number) => void }) {
  const [r, setR] = useState(value)
  const int = (k: 'price' | 'realCost') => (e: React.ChangeEvent<HTMLInputElement>) => setR({ ...r, [k]: parseInt(e.target.value, 10) || 0 })
  return (
    <div className="sheet" role="dialog" aria-label="Edit reward">
      <div className="sheet-card">
        <h3>{r.id ? 'Edit reward' : 'New reward'}</h3>
        <label>
          What is it?
          <input autoFocus value={r.title} placeholder="e.g. Kebab night" onChange={(e) => setR({ ...r, title: e.target.value })} />
        </label>
        <div className="grid3">
          <label>
            Price (coins)
            <input type="number" min={1} value={r.price} onChange={int('price')} />
          </label>
          <label>
            Real cost ({currency})
            <input type="number" min={0} value={r.realCost} onChange={int('realCost')} />
          </label>
          <label>
            Tier
            <select value={r.tier} onChange={(e) => setR({ ...r, tier: e.target.value as Tier })}>
              {TIER_IDS.map((t) => (
                <option key={t} value={t}>
                  {TIERS[t].label} (level {TIERS[t].minLevel}+)
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Note (optional)
          <input value={r.note ?? ''} onChange={(e) => setR({ ...r, note: e.target.value })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={r.pinned} onChange={(e) => setR({ ...r, pinned: e.target.checked })} /> Main goal (shown on Today)
        </label>
        <p className="hint">A good day earns about 100 coins, so 300 coins is roughly three good days.</p>
        <div className="sheet-actions">
          {r.id && (
            <button className="btn ghost danger-text" onClick={() => onArchive(r.id!)}>
              Archive
            </button>
          )}
          <span className="spacer" />
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => onSave(r)}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

const BURST = Array.from({ length: 18 }, (_, i) => i)

function Celebration({ title, sub, onDone }: { title: string; sub: string; onDone: () => void }) {
  return (
    <motion.div className="celebrate" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onDone} onAnimationComplete={() => setTimeout(onDone, 2200)}>
      <div className="burst" aria-hidden="true">
        {BURST.map((i) => {
          const angle = (i / BURST.length) * Math.PI * 2
          return (
            <motion.i
              key={i}
              initial={{ x: 0, y: 0, opacity: 1, scale: 0.6 }}
              animate={{ x: Math.cos(angle) * 180, y: Math.sin(angle) * 180, opacity: 0, scale: 1.2 }}
              transition={{ duration: 1.1, ease: 'easeOut' }}
              style={{ background: i % 3 === 0 ? 'var(--gold)' : i % 3 === 1 ? 'var(--lime)' : '#B892FF' }}
            />
          )
        })}
      </div>
      <motion.div className="celebrate-card" initial={{ scale: 0.7, y: 20 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}>
        <Icon name="trophy" size={34} />
        <h2>{title}</h2>
        <p>{sub}</p>
      </motion.div>
    </motion.div>
  )
}
