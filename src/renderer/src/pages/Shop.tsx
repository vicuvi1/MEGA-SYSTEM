import { useEffect, useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { redeemBlocker, TIERS, tierUnlocked } from '@core/shop'
import { computeGoalProgress } from '@core/unifiedEconomy'
import type {
  ChestLootDrop,
  EconomySummary,
  Reward,
  RewardInput,
  ShopState,
  Tier,
  WishlistGoal,
  WishlistGoalInput
} from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { Coins, useAction, useToast } from '../ui'
import { soundFanfare, soundSpend, soundTick } from '../sound'

interface Props {
  state: ShopState
  onState: (s: ShopState) => void
  /** Called after coins moved, so the top bar refreshes. */
  onWallet: () => void
}

const TIER_IDS = Object.keys(TIERS) as Tier[]

export function Shop({ state, onState, onWallet }: Props) {
  const act = useAction()
  const toast = useToast()
  const [editing, setEditing] = useState<RewardInput | null>(null)
  const [confirm, setConfirm] = useState<Reward | null>(null)
  const [celebrate, setCelebrate] = useState<{ title: string; sub: string } | null>(null)
  const [chestLoot, setChestLoot] = useState<ChestLootDrop | null>(null)
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null)
  const [shields, setShields] = useState(0)

  // Economy state
  const [economy, setEconomy] = useState<EconomySummary | null>(state.economy ?? null)
  const [activeTab, setActiveTab] = useState<'catalog' | 'goals' | 'vault'>('catalog')
  const [editingGoal, setEditingGoal] = useState<WishlistGoalInput | null>(null)
  const [depositModal, setDepositModal] = useState<{ goal: WishlistGoal; kind: 'coins' | 'cash' } | null>(null)
  const [depositAmount, setDepositAmount] = useState<string>('')
  const [depositVaultDirectModal, setDepositVaultDirectModal] = useState(false)
  const [directVaultDraft, setDirectVaultDraft] = useState('')

  const refreshEconomy = useCallback(async () => {
    try {
      const summary = await life.economy.summary()
      setEconomy(summary)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    refreshEconomy()
    life.shields.count().then(setShields).catch(() => {})
  }, [state, refreshEconomy])

  async function buyShield() {
    const res = await act(() => life.shields.buy(), 'Streak Shield purchased!')
    if (res) {
      soundFanfare()
      setShields(res.shields)
      onWallet()
      refreshEconomy()
    }
  }

  const check = (r: Reward) =>
    redeemBlocker({
      reward: r,
      balance: state.balance,
      level: state.level,
      monthSpent: state.monthSpent,
      budget: state.budget
    })

  async function redeem(r: Reward) {
    const s = await act(() => life.shop.redeem(r.id))
    setConfirm(null)
    if (!s) return
    onState(s)
    onWallet()
    refreshEconomy()
    setCelebrate({ title: `${r.title} unlocked!`, sub: 'You earned this. Go get it.' })
  }

  async function openChest(level: number) {
    try {
      const res = await life.economy.openChest(level)
      soundFanfare()
      setChestLoot(res.drop)
      onWallet()
      refreshEconomy()
      const nextShop = await life.shop.state()
      onState(nextShop)
    } catch (e: any) {
      toast(e.message || 'Failed to open chest', 'bad')
    }
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
      refreshEconomy()
    }
  }

  // Goal actions
  async function saveGoal(input: WishlistGoalInput) {
    try {
      await life.economy.saveGoal(input)
      toast('Wishlist Goal saved!', 'good')
      setEditingGoal(null)
      refreshEconomy()
    } catch (e: any) {
      toast(e.message || 'Failed to save goal', 'bad')
    }
  }

  async function pinGoal(id: number) {
    try {
      await life.economy.pinGoal(id)
      toast('Goal pinned as main milestone!', 'good')
      refreshEconomy()
    } catch (e: any) {
      toast(e.message, 'bad')
    }
  }

  async function deleteGoal(id: number) {
    try {
      await life.economy.deleteGoal(id)
      toast('Goal removed', 'info')
      refreshEconomy()
    } catch (e: any) {
      toast(e.message, 'bad')
    }
  }

  async function handleDeposit() {
    if (!depositModal) return
    const amt = parseInt(depositAmount, 10)
    if (!amt || amt <= 0) return

    try {
      if (depositModal.kind === 'coins') {
        await life.economy.depositCoins(depositModal.goal.id, amt)
        soundSpend()
        toast(`Deposited ${amt} coins into ${depositModal.goal.title}`, 'good')
        onWallet()
      } else {
        await life.economy.depositVault(depositModal.goal.id, amt)
        soundSpend()
        toast(`Allocated ${amt} ${state.currency} into ${depositModal.goal.title}`, 'good')
      }
      setDepositModal(null)
      setDepositAmount('')
      refreshEconomy()
    } catch (e: any) {
      toast(e.message || 'Failed to deposit funds', 'bad')
    }
  }

  async function claimGoal(g: WishlistGoal) {
    try {
      await life.economy.claimGoal(g.id)
      soundFanfare()
      setCelebrate({
        title: `🏆 ${g.title} Achieved!`,
        sub: 'A monument to your consistency and financial discipline. Victory!'
      })
      refreshEconomy()
    } catch (e: any) {
      toast(e.message, 'bad')
    }
  }

  async function handleDirectVaultDeposit() {
    const amt = parseInt(directVaultDraft, 10)
    if (!amt || amt <= 0) return
    try {
      await life.economy.creditVault(amt, 'Manual surplus savings deposit')
      toast(`Added +${amt} ${state.currency} to Reward Vault!`, 'good')
      setDepositVaultDirectModal(false)
      setDirectVaultDraft('')
      refreshEconomy()
    } catch (e: any) {
      toast(e.message, 'bad')
    }
  }

  const used = state.budget ? Math.min(1, state.monthSpent / state.budget) : 0
  const pinned = economy?.pinnedGoal

  return (
    <div className="shop">
      {/* MASTER ECONOMY COMMAND DECK */}
      <section className="economy-command-deck">
        {/* Card 1: Coins Wealth */}
        <div className="economy-card">
          <div className="economy-card-top">
            <span className="economy-card-label">Coins Wealth</span>
            <span className="economy-card-icon icon-coins">🪙</span>
          </div>
          <div className="economy-card-value">
            <Coins n={state.balance} />
          </div>
          <div className="economy-card-sub">
            <span>
              ≈ <b>{economy?.coinsRealValue ?? Math.round(state.balance * 0.1)}</b> {state.currency} value
            </span>
            <small>LV {state.level}</small>
          </div>
        </div>

        {/* Card 2: Reward Surplus Vault */}
        <div className="economy-card">
          <div className="economy-card-top">
            <span className="economy-card-label">Reward Vault (Savings)</span>
            <span className="economy-card-icon icon-vault">💰</span>
          </div>
          <div className="economy-card-value">
            {economy?.vaultBalance ?? 0} <small>{state.currency}</small>
          </div>
          <div className="economy-card-sub">
            <span>Surplus savings fund</span>
            <button
              className="vault-deposit-btn"
              onClick={() => setDepositVaultDirectModal(true)}
              title="Manually inject savings surplus into reward vault"
            >
              + Deposit
            </button>
          </div>
        </div>

        {/* Card 3: Monthly Real-Money Reward Budget */}
        <div className="economy-card">
          <div className="economy-card-top">
            <span className="economy-card-label">Monthly Reward Cap</span>
            <span className="economy-card-icon icon-budget">💳</span>
          </div>
          {budgetDraft === null ? (
            <>
              <div className="economy-card-value">
                {state.monthSpent} / {state.budget || '∞'} <small>{state.currency}</small>
              </div>
              <div className="economy-card-sub">
                {state.budget > 0 ? (
                  <span className="bar budget" style={{ height: 6, margin: 0, width: '100%' }}>
                    <i style={{ width: `${used * 100}%` }} className={used >= 0.9 ? 'hot' : ''} />
                  </span>
                ) : (
                  <span>No spending cap set</span>
                )}
                <button
                  className="link"
                  style={{ fontSize: 11, padding: 0 }}
                  onClick={() => setBudgetDraft(String(state.budget || ''))}
                >
                  Edit
                </button>
              </div>
            </>
          ) : (
            <div className="row tight" style={{ marginTop: 4 }}>
              <input
                autoFocus
                type="number"
                min={0}
                placeholder={`Limit in ${state.currency}`}
                value={budgetDraft}
                onChange={(e) => setBudgetDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveBudget()}
                style={{ fontSize: 13, padding: '4px 8px' }}
              />
              <button className="btn small primary" onClick={saveBudget}>
                Save
              </button>
            </div>
          )}
        </div>

        {/* Card 4: Active Discipline Multiplier */}
        <div className="economy-card">
          <div className="economy-card-top">
            <span className="economy-card-label">Active Multiplier</span>
            <span className="economy-card-icon icon-multiplier">🔥</span>
          </div>
          <div className="economy-card-value" style={{ color: 'var(--orange)' }}>
            {economy?.multiplier.totalRate ?? 1.0}x
          </div>
          <div className="economy-card-sub">
            <span className="multiplier-flame-badge">{economy?.multiplier.label ?? 'Standard (1.0x)'}</span>
          </div>
        </div>
      </section>

      {/* PINNED DREAM WISHLIST GOAL SHOWCASE */}
      {pinned && (
        <section className="pinned-goal-showcase">
          {(() => {
            const prog = computeGoalProgress(pinned)
            return (
              <>
                <div className="showcase-header">
                  <span className="showcase-tag">
                    <Icon name="trophy" size={16} />
                    <span>Active Master Milestone ({pinned.category})</span>
                  </span>
                  <div className="showcase-actions">
                    <button
                      className="btn secondary small"
                      onClick={() => setDepositModal({ goal: pinned, kind: 'coins' })}
                    >
                      Deposit Coins
                    </button>
                    <button
                      className="btn secondary small"
                      onClick={() => setDepositModal({ goal: pinned, kind: 'cash' })}
                    >
                      Deposit Vault Cash
                    </button>
                    {prog.isReady && (
                      <button className="btn primary small" onClick={() => claimGoal(pinned)}>
                        Claim Triumph!
                      </button>
                    )}
                  </div>
                </div>

                <div className="showcase-title-row">
                  <div>
                    <h2>{pinned.title}</h2>
                    {pinned.note && <p>{pinned.note}</p>}
                  </div>
                </div>

                <div className="showcase-bars">
                  <div className="progress-group">
                    <div className="progress-label-row">
                      <span className="progress-label">Habit Discipline (Coins)</span>
                      <span className="progress-fraction">
                        {pinned.allocatedCoins} / {pinned.targetCoins} 🪙 ({prog.coinsPercent}%)
                      </span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill-coins" style={{ width: `${prog.coinsPercent}%` }} />
                    </div>
                  </div>

                  <div className="progress-group">
                    <div className="progress-label-row">
                      <span className="progress-label">Financial Discipline (Surplus Cash)</span>
                      <span className="progress-fraction">
                        {pinned.allocatedRealCost} / {pinned.targetRealCost} {state.currency} ({prog.realCostPercent}%)
                      </span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill-cash" style={{ width: `${prog.realCostPercent}%` }} />
                    </div>
                  </div>
                </div>

                <div className="showcase-footer">
                  <span className="eta-chip">
                    <Icon name="spark" size={14} />
                    {prog.isReady
                      ? 'Goal Complete! Ready to Claim.'
                      : prog.etaDays
                      ? `Estimated ${prog.etaDays} days remaining at your current velocity`
                      : 'Funding in progress'}
                  </span>
                  <span>Overall Milestone: <b>{prog.overallPercent}%</b></span>
                </div>
              </>
            )
          })()}
        </section>
      )}

      {/* MYSTERY CHESTS ROW */}
      <section className="stats" style={{ marginBottom: 20 }}>
        <div className={`stat chests ${state.chests.length ? 'has' : ''}`} style={{ width: '100%' }}>
          <span className="label">Level Mystery Chests</span>
          {state.chests.length ? (
            <div className="chest-row">
              {state.chests.map((l) => (
                <motion.button
                  key={l}
                  className="chest"
                  whileHover={{ y: -3, scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => openChest(l)}
                  title={`Open Level ${l} Mystery Chest (Coins, Shields, Vault Boosts & 2x Multipliers!)`}
                >
                  <Icon name="gift" size={24} />
                  <span>LV {l} Chest</span>
                </motion.button>
              ))}
            </div>
          ) : (
            <span className="sub block-sub">
              Every level-up unlocks a Mystery Chest with coins, shields, vault surplus cash, or 2x multipliers!
            </span>
          )}
        </div>
      </section>

      {/* CATEGORY TABS ROW */}
      <div className="shop-tabs-row">
        <div className="shop-pills">
          <button
            className={`shop-pill-btn ${activeTab === 'catalog' ? 'active' : ''}`}
            onClick={() => {
              soundTick()
              setActiveTab('catalog')
            }}
          >
            <span>Rewards Catalog</span>
            <span className="count-pill" style={{ marginLeft: 6 }}>
              {state.rewards.length}
            </span>
          </button>

          <button
            className={`shop-pill-btn ${activeTab === 'goals' ? 'active' : ''}`}
            onClick={() => {
              soundTick()
              setActiveTab('goals')
            }}
          >
            <span>Wishlist Mega Goals</span>
            <span className="count-pill" style={{ marginLeft: 6 }}>
              {economy?.goals.length ?? 0}
            </span>
          </button>

          <button
            className={`shop-pill-btn ${activeTab === 'vault' ? 'active' : ''}`}
            onClick={() => {
              soundTick()
              setActiveTab('vault')
            }}
          >
            <span>Savings Vault & Redemptions</span>
          </button>
        </div>

        {activeTab === 'catalog' && (
          <button
            className="btn small secondary"
            onClick={() =>
              setEditing({ title: '', price: 300, tier: 'bronze', realCost: 0, pinned: false, note: null })
            }
          >
            <Icon name="plus" size={14} /> Add Reward
          </button>
        )}

        {activeTab === 'goals' && (
          <button
            className="btn small primary"
            onClick={() =>
              setEditingGoal({
                title: '',
                targetCoins: 5000,
                targetRealCost: 2000,
                category: 'gear',
                pinned: false,
                note: ''
              })
            }
          >
            <Icon name="plus" size={14} /> Add Mega Goal
          </button>
        )}
      </div>

      {/* TAB 1: REWARDS CATALOG */}
      {activeTab === 'catalog' && (
        <section className="reward-grid">
          {/* Streak Shield Card */}
          <article className="reward ready" style={{ ['--tier' as string]: '#6EE7D8' }}>
            <header>
              <span className="tier" style={{ color: '#6EE7D8' }}>
                PROTECTION
              </span>
              <span className="reward-tools">
                <span className="badge-shield">Inventory: {shields}</span>
              </span>
            </header>
            <h3>Streak Shield</h3>
            <p className="note">
              Protects your streak flame if you miss a day. Consumed automatically when needed.
            </p>
            <div className="price">
              <Coins n={50} />
              <span className="real">Protection</span>
            </div>
            <div className="bar">
              <i style={{ width: `${Math.min(100, (state.balance / 50) * 100)}%` }} />
            </div>
            {state.balance < 50 ? (
              <div className="lock-note">Need {50 - state.balance} more coins</div>
            ) : (
              <button className="btn primary" onClick={buyShield}>
                Buy Shield (50 🪙)
              </button>
            )}
          </article>

          {state.rewards.map((r) => {
            const why = check(r)
            const locked = !tierUnlocked(r.tier, state.level)
            const pct = Math.min(1, state.balance / r.price)
            const tier = TIERS[r.tier]
            return (
              <motion.article
                key={r.id}
                layout
                className={`reward ${locked ? 'locked' : ''} ${!why ? 'ready' : ''}`}
                style={{ ['--tier' as string]: tier.color }}
              >
                <header>
                  <span className="tier">{tier.label}</span>
                  <span className="reward-tools">
                    <button
                      className={`icon-btn ${r.pinned ? 'pinned' : ''}`}
                      aria-label={r.pinned ? 'Main goal' : 'Make this my main goal'}
                      title={r.pinned ? 'Main goal (shown on Today)' : 'Make this my main goal'}
                      onClick={() => save({ ...r, pinned: !r.pinned })}
                    >
                      <Icon name="spark" size={14} />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label="Edit reward"
                      title="Edit"
                      onClick={() => setEditing({ ...r })}
                    >
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
        </section>
      )}

      {/* TAB 2: WISHLIST MEGA GOALS */}
      {activeTab === 'goals' && (
        <section className="goals-grid">
          {(economy?.goals ?? []).map((g) => {
            const prog = computeGoalProgress(g)
            return (
              <div key={g.id} className={`goal-card ${g.completed ? 'completed' : ''}`}>
                <div className="goal-card-header">
                  <span className="goal-cat-badge">{g.category}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {!g.pinned && !g.completed && (
                      <button
                        className="icon-btn"
                        title="Pin as main milestone"
                        onClick={() => pinGoal(g.id)}
                      >
                        <Icon name="spark" size={14} />
                      </button>
                    )}
                    <button
                      className="icon-btn"
                      title="Edit goal"
                      onClick={() =>
                        setEditingGoal({
                          id: g.id,
                          title: g.title,
                          targetCoins: g.targetCoins,
                          targetRealCost: g.targetRealCost,
                          category: g.category,
                          pinned: g.pinned,
                          note: g.note ?? ''
                        })
                      }
                    >
                      <Icon name="sliders" size={14} />
                    </button>
                    <button className="icon-btn" title="Delete goal" onClick={() => deleteGoal(g.id)}>
                      <Icon name="undo" size={14} />
                    </button>
                  </div>
                </div>

                <h3>{g.title}</h3>
                {g.note && <p className="note">{g.note}</p>}

                <div className="progress-group">
                  <div className="progress-label-row">
                    <span className="progress-label">Coins Progress</span>
                    <span className="progress-fraction">
                      {g.allocatedCoins} / {g.targetCoins} 🪙 ({prog.coinsPercent}%)
                    </span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill-coins" style={{ width: `${prog.coinsPercent}%` }} />
                  </div>
                </div>

                <div className="progress-group">
                  <div className="progress-label-row">
                    <span className="progress-label">Vault Cash Progress</span>
                    <span className="progress-fraction">
                      {g.allocatedRealCost} / {g.targetRealCost} {state.currency} ({prog.realCostPercent}%)
                    </span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill-cash" style={{ width: `${prog.realCostPercent}%` }} />
                  </div>
                </div>

                <div className="goal-card-actions">
                  {!g.completed ? (
                    <>
                      <button
                        className="btn secondary small"
                        style={{ flex: 1 }}
                        onClick={() => setDepositModal({ goal: g, kind: 'coins' })}
                      >
                        + Coins
                      </button>
                      <button
                        className="btn secondary small"
                        style={{ flex: 1 }}
                        onClick={() => setDepositModal({ goal: g, kind: 'cash' })}
                      >
                        + Cash
                      </button>
                      {prog.isReady && (
                        <button
                          className="btn primary small"
                          style={{ flex: 1 }}
                          onClick={() => claimGoal(g)}
                        >
                          Claim!
                        </button>
                      )}
                    </>
                  ) : (
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: 'var(--green)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4
                      }}
                    >
                      <Icon name="check" size={14} /> Completed
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {/* TAB 3: SAVINGS VAULT & REDEMPTIONS LEDGER */}
      {activeTab === 'vault' && (
        <section className="panel">
          <header className="panel-head">
            <h2>Reward Vault & Savings Activity</h2>
            <span className="hint">
              Every surplus lei saved under your daily budget accumulates in your Reward Vault.
            </span>
          </header>

          <ul className="feed">
            {(economy?.recentVaultEntries ?? []).map((v) => (
              <li key={v.id}>
                <span className="what">
                  <b>{v.kind.replace('_', ' ').toUpperCase()}</b>: {v.note}
                </span>
                <span className="when">{v.day}</span>
                <span
                  className="when"
                  style={{ color: v.amount >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}
                >
                  {v.amount >= 0 ? `+${v.amount}` : v.amount} {state.currency}
                </span>
              </li>
            ))}
          </ul>

          <div style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 16, marginBottom: 10 }}>Redeemed Rewards History</h3>
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
          </div>
        </section>
      )}

      {/* CONFIRM REDEEM SHEET */}
      {confirm && (
        <div className="sheet" role="dialog" aria-label="Confirm reward">
          <div className="sheet-card">
            <h3>Redeem {confirm.title}?</h3>
            <p className="hint">
              This spends <Coins n={confirm.price} /> from your wallet
              {confirm.realCost > 0
                ? ` and counts ${confirm.realCost} ${state.currency} toward this month's reward budget`
                : ''}
              .
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

      {/* EDIT REWARD SHEET */}
      {editing && (
        <RewardSheet
          value={editing}
          currency={state.currency}
          onCancel={() => setEditing(null)}
          onSave={save}
          onArchive={async (id) => {
            const s = await act(() => life.shop.archive(id), 'Archived')
            if (s) {
              onState(s)
              setEditing(null)
            }
          }}
        />
      )}

      {/* EDIT WISHLIST GOAL SHEET */}
      {editingGoal && (
        <div className="sheet" role="dialog" aria-label="Edit Wishlist Goal">
          <div className="sheet-card">
            <h3>{editingGoal.id ? 'Edit Wishlist Goal' : 'New Wishlist Mega Goal'}</h3>
            <label>
              Goal Name
              <input
                autoFocus
                value={editingGoal.title}
                placeholder="e.g. Kaaba Pilgrimage Fund or MacBook Pro"
                onChange={(e) => setEditingGoal({ ...editingGoal, title: e.target.value })}
              />
            </label>

            <div className="grid3">
              <label>
                Target Coins
                <input
                  type="number"
                  min={0}
                  value={editingGoal.targetCoins}
                  onChange={(e) =>
                    setEditingGoal({ ...editingGoal, targetCoins: parseInt(e.target.value, 10) || 0 })
                  }
                />
              </label>
              <label>
                Target Cost ({state.currency})
                <input
                  type="number"
                  min={0}
                  value={editingGoal.targetRealCost}
                  onChange={(e) =>
                    setEditingGoal({ ...editingGoal, targetRealCost: parseInt(e.target.value, 10) || 0 })
                  }
                />
              </label>
              <label>
                Category
                <select
                  value={editingGoal.category || 'gear'}
                  onChange={(e) =>
                    setEditingGoal({ ...editingGoal, category: e.target.value as any })
                  }
                >
                  <option value="gear">Gear</option>
                  <option value="tech">Tech</option>
                  <option value="trip">Trip / Spiritual</option>
                  <option value="luxury">Luxury</option>
                  <option value="emergency">Emergency Cushion</option>
                  <option value="investment">Investment Seed</option>
                </select>
              </label>
            </div>

            <label>
              Note (optional)
              <input
                value={editingGoal.note ?? ''}
                placeholder="Why this milestone matters..."
                onChange={(e) => setEditingGoal({ ...editingGoal, note: e.target.value })}
              />
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={editingGoal.pinned}
                onChange={(e) => setEditingGoal({ ...editingGoal, pinned: e.target.checked })}
              />
              Pin as Main Milestone Showcase
            </label>

            <div className="sheet-actions">
              <button className="btn ghost" onClick={() => setEditingGoal(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => saveGoal(editingGoal)}>
                Save Goal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DEPOSIT MODAL SHEET */}
      {depositModal && (
        <div className="sheet" role="dialog" aria-label="Deposit to Goal">
          <div className="sheet-card">
            <h3>
              Deposit {depositModal.kind === 'coins' ? 'Coins' : state.currency} into {depositModal.goal.title}
            </h3>
            <p className="hint">
              {depositModal.kind === 'coins'
                ? `Available in Wallet: ${state.balance} coins`
                : `Available in Reward Vault: ${economy?.vaultBalance ?? 0} ${state.currency}`}
            </p>

            <div className="deposit-dialog">
              <div className="deposit-input-row">
                <input
                  type="number"
                  autoFocus
                  min={1}
                  max={
                    depositModal.kind === 'coins'
                      ? state.balance
                      : economy?.vaultBalance ?? 0
                  }
                  placeholder={`Amount to deposit...`}
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleDeposit()}
                />
              </div>

              <div className="deposit-quick-buttons">
                {depositModal.kind === 'coins' ? (
                  <>
                    <button className="deposit-quick-btn" onClick={() => setDepositAmount('50')}>50 🪙</button>
                    <button className="deposit-quick-btn" onClick={() => setDepositAmount('100')}>100 🪙</button>
                    <button className="deposit-quick-btn" onClick={() => setDepositAmount('250')}>250 🪙</button>
                    <button className="deposit-quick-btn" onClick={() => setDepositAmount(String(state.balance))}>Max</button>
                  </>
                ) : (
                  <>
                    <button className="deposit-quick-btn" onClick={() => setDepositAmount('50')}>50 {state.currency}</button>
                    <button className="deposit-quick-btn" onClick={() => setDepositAmount('100')}>100 {state.currency}</button>
                    <button className="deposit-quick-btn" onClick={() => setDepositAmount('200')}>200 {state.currency}</button>
                    <button className="deposit-quick-btn" onClick={() => setDepositAmount(String(economy?.vaultBalance ?? 0))}>Max</button>
                  </>
                )}
              </div>
            </div>

            <div className="sheet-actions">
              <button className="btn ghost" onClick={() => setDepositModal(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={handleDeposit}>
                Deposit Funds
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIRECT VAULT CASH DEPOSIT MODAL */}
      {depositVaultDirectModal && (
        <div className="sheet" role="dialog" aria-label="Deposit to Reward Vault">
          <div className="sheet-card">
            <h3>Add Real Money to Reward Vault</h3>
            <p className="hint">
              Transfer saved real-world cash (surplus from discipline or side income) into your Reward Vault pool.
            </p>
            <div className="deposit-dialog">
              <div className="deposit-input-row">
                <input
                  type="number"
                  autoFocus
                  min={1}
                  placeholder={`Amount in ${state.currency}...`}
                  value={directVaultDraft}
                  onChange={(e) => setDirectVaultDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleDirectVaultDeposit()}
                />
              </div>
            </div>
            <div className="sheet-actions">
              <button className="btn ghost" onClick={() => setDepositVaultDirectModal(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={handleDirectVaultDeposit}>
                Add to Vault
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CHEST LOOT MODAL */}
      {chestLoot && (
        <div className="sheet" role="dialog" aria-label="Chest Loot Drop">
          <div className="sheet-card" style={{ maxWidth: 380 }}>
            <div className="chest-loot-modal">
              <div className="chest-loot-badge">
                {chestLoot.type === 'shield'
                  ? '🛡️'
                  : chestLoot.type === 'vault_boost'
                  ? '💰'
                  : chestLoot.type === 'multiplier_24h'
                  ? '⚡'
                  : '🪙'}
              </div>
              <h3 className="chest-loot-title">{chestLoot.label}</h3>
              <p className="chest-loot-desc">{chestLoot.description}</p>
            </div>
            <div className="sheet-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button className="btn primary" onClick={() => setChestLoot(null)}>
                Claim Loot!
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CELEBRATION MODAL */}
      <AnimatePresence>
        {celebrate && <Celebration key={celebrate.title} {...celebrate} onDone={() => setCelebrate(null)} />}
      </AnimatePresence>
    </div>
  )
}

function RewardSheet({
  value,
  currency,
  onCancel,
  onSave,
  onArchive
}: {
  value: RewardInput
  currency: string
  onCancel: () => void
  onSave: (r: RewardInput) => void
  onArchive: (id: number) => void
}) {
  const [r, setR] = useState(value)
  const int = (k: 'price' | 'realCost') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setR({ ...r, [k]: parseInt(e.target.value, 10) || 0 })

  return (
    <div className="sheet" role="dialog" aria-label="Edit reward">
      <div className="sheet-card">
        <h3>{r.id ? 'Edit reward' : 'New reward'}</h3>
        <label>
          What is it?
          <input
            autoFocus
            value={r.title}
            placeholder="e.g. Kebab night"
            onChange={(e) => setR({ ...r, title: e.target.value })}
          />
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
          <input
            type="checkbox"
            checked={r.pinned}
            onChange={(e) => setR({ ...r, pinned: e.target.checked })}
          />{' '}
          Main goal (shown on Today)
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
    <motion.div
      className="celebrate"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onDone}
      onAnimationComplete={() => setTimeout(onDone, 2400)}
    >
      <div className="burst" aria-hidden="true">
        {BURST.map((i) => {
          const angle = (i / BURST.length) * Math.PI * 2
          return (
            <motion.i
              key={i}
              initial={{ x: 0, y: 0, opacity: 1, scale: 0.6 }}
              animate={{ x: Math.cos(angle) * 180, y: Math.sin(angle) * 180, opacity: 0, scale: 1.2 }}
              transition={{ duration: 1.1, ease: 'easeOut' }}
              style={{
                background: i % 3 === 0 ? 'var(--gold)' : i % 3 === 1 ? 'var(--lime)' : '#B892FF'
              }}
            />
          )
        })}
      </div>
      <motion.div
        className="celebrate-card"
        initial={{ scale: 0.7, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 16 }}
      >
        <Icon name="trophy" size={38} />
        <h2>{title}</h2>
        <p>{sub}</p>
      </motion.div>
    </motion.div>
  )
}
