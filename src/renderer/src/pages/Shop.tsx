import { useEffect, useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { redeemBlocker, TIERS, tierUnlocked } from '@core/shop'
import { computeGoalProgress, coinsToMoneyValue } from '@core/unifiedEconomy'
import {
  calculateEffortEquivalence,
  formatDualCurrency,
  CURRENCY_CONFIGS,
  type SupportedCurrency,
  ChestLootDrop,
  EconomySummary,
  GeneratedReward,
  Reward,
  RewardInput,
  ShopState,
  Tier,
  WishlistGoal,
  WishlistGoalInput,
  BankState,
  ActiveBuff,
  CONSUMABLE_CATALOG,
  ECONOMY_PRESETS,
  EconomyConfig,
  EconomyPreset,
  Rule
} from '@shared/api'
import { features, life } from '../bridge'
import { Icon } from '../Icon'
import { Coins, useAction, useToast } from '../ui'
import { soundFanfare, soundSpend, soundTick } from '../sound'
import { RenderMarkdown } from '../SystemOracleDrawer'
import { ChestGachaModal } from '../ChestGachaModal'
import { HunterSkillCards } from '../HunterSkillCards'
import { EconomyCalibration } from '../EconomyCalibration'

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
  const [activeTab, setActiveTab] = useState<'catalog' | 'bank' | 'consumables' | 'cards' | 'goals' | 'vault' | 'tuning'>('catalog')
  const [gachaLevel, setGachaLevel] = useState<number | null>(null)
  const [bank, setBank] = useState<BankState | null>(null)
  const [activeBuffs, setActiveBuffs] = useState<ActiveBuff[]>([])
  const [stakeDraft, setStakeDraft] = useState('')
  const [withdrawDraft, setWithdrawDraft] = useState('')
  const [editingGoal, setEditingGoal] = useState<WishlistGoalInput | null>(null)
  const [depositModal, setDepositModal] = useState<{ goal: WishlistGoal; kind: 'coins' | 'cash' } | null>(null)
  const [depositAmount, setDepositAmount] = useState<string>('')
  const [depositVaultDirectModal, setDepositVaultDirectModal] = useState(false)
  const [directVaultDraft, setDirectVaultDraft] = useState('')
  const [goalInspectQuery, setGoalInspectQuery] = useState('')
  const [goalInspecting, setGoalInspecting] = useState(false)

  async function handleGoalAutoInspect() {
    const q = goalInspectQuery.trim()
    if (!q || !editingGoal) return
    setGoalInspecting(true)
    try {
      const res = await life.ai.inspectProduct(q)
      setEditingGoal({
        ...editingGoal,
        title: res.title,
        targetCoins: res.coins,
        targetRealCost: res.price,
        category: (res.category === 'wellness' ? 'luxury' : res.category) as any,
        note: res.note,
        imageUrl: res.imageUrl,
        productUrl: res.productUrl,
        currency: editingGoal.currency ?? state.currency
      })
      toast(`Auto-filled details for "${res.title}"!`, 'good')
    } catch (err: any) {
      toast(err?.message || 'Failed to inspect product', 'bad')
    } finally {
      setGoalInspecting(false)
    }
  }

  // AI Reward Oracle state
  const [showAiModal, setShowAiModal] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [generatingAi, setGeneratingAi] = useState(false)
  const [aiRewards, setAiRewards] = useState<GeneratedReward[] | null>(null)
  const [aiModelUsed, setAiModelUsed] = useState<string | null>(null)

  async function summonAiRewards() {
    setGeneratingAi(true)
    try {
      const res = await life.ai.generateRewards(aiPrompt)
      setAiRewards(res.rewards)
      setAiModelUsed(res.modelUsed)
      toast('✨ System Oracle generated 3 tailored rewards!', 'good')
    } catch (err: any) {
      toast(err?.message || 'Failed to generate AI rewards. Check keys in Settings.', 'bad')
    } finally {
      setGeneratingAi(false)
    }
  }

  async function addAiRewardToCatalog(reward: GeneratedReward) {
    const next = await act(() => life.shop.save({
      title: reward.title,
      price: reward.price,
      tier: reward.tier as Tier,
      realCost: reward.realCost,
      note: reward.note,
      imageUrl: reward.imageUrl,
      productUrl: reward.productUrl,
      pinned: false
    }), `Added "${reward.title}" to catalog!`)
    if (next) onState(next)
  }

  async function addAiRewardToWishlist(reward: GeneratedReward) {
    await act(() => life.economy.saveGoal({
      title: reward.title,
      targetRealCost: reward.realCost,
      targetCoins: reward.price,
      currency: (economy?.currency ?? 'MDL') as SupportedCurrency,
      category: reward.category as any,
      imageUrl: reward.imageUrl,
      productUrl: reward.productUrl,
      note: reward.note
    }), `Pinned "${reward.title}" as Wishlist Goal!`)
    await refreshEconomy()
  }

  const refreshEconomy = useCallback(async () => {
    try {
      const summary = await life.economy.summary()
      setEconomy(summary)
      if (summary.bank) setBank(summary.bank)
      else {
        const b = await life.economy.bankState()
        setBank(b)
      }
      if (summary.activeBuffs) setActiveBuffs(summary.activeBuffs)
      else {
        const buffs = await life.economy.activeBuffs()
        setActiveBuffs(buffs)
      }
    } catch {
      // ignore
    }
  }, [])

  // Live countdown timer for active buffs
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      setActiveBuffs((prev) =>
        prev
          .map((b) => {
            const rem = Math.max(0, Math.floor((Date.parse(b.expiresAt) - Date.now()) / 1000))
            return { ...b, remainingSeconds: rem }
          })
          .filter((b) => b.remainingSeconds > 0)
      )
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  async function handleStake(amt: number) {
    if (!amt || amt <= 0) return
    try {
      const nextBank = await life.economy.stakeCoins(amt)
      soundSpend()
      setBank(nextBank)
      setStakeDraft('')
      toast(`Successfully staked ${amt} coins in the Iron Bank!`, 'good')
      onWallet()
      refreshEconomy()
    } catch (e: any) {
      toast(e.message || 'Failed to stake coins', 'bad')
    }
  }

  async function handleWithdraw(amt: number) {
    if (!amt || amt <= 0) return
    try {
      const nextBank = await life.economy.withdrawCoins(amt)
      soundTick()
      setBank(nextBank)
      setWithdrawDraft('')
      toast(`Withdrew ${amt} coins from the Iron Bank to your wallet!`, 'good')
      onWallet()
      refreshEconomy()
    } catch (e: any) {
      toast(e.message || 'Failed to withdraw coins', 'bad')
    }
  }

  async function handleClaimInterest() {
    try {
      const res = await life.economy.claimInterest()
      soundFanfare()
      setBank(res.bank)
      toast(`🏆 Claimed +${res.claimedCoins} coins in passive staking dividends!`, 'good')
      onWallet()
      refreshEconomy()
    } catch (e: any) {
      toast(e.message || 'Failed to claim dividends', 'bad')
    }
  }

  async function handleBuyConsumable(itemId: string) {
    try {
      const res = await life.economy.buyConsumable(itemId)
      soundFanfare()
      toast(res.message, 'good')
      onWallet()
      refreshEconomy()
    } catch (e: any) {
      toast(e.message || 'Failed to purchase consumable', 'bad')
    }
  }

  function formatTimeRemaining(seconds: number): string {
    if (seconds <= 0) return 'Expired'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) return `${h}h ${m}m ${s}s`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

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

  async function changeCurrency(code: string) {
    try {
      const nextShop = await life.shop.setCurrency(code)
      await life.economy.setCurrency(code)
      onState(nextShop)
      refreshEconomy()
      toast(`Currency switched to ${code}`, 'good')
    } catch (e: any) {
      toast(e.message, 'bad')
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
      {/* REAL-WORLD CURRENCY CONVERTER & SELECTOR */}
      <section className="currency-selector-row">
        <div className="currency-selector-left">
          <Icon name="coin" size={16} />
          <span>Active Real-World Currency: <b>{state.currency}</b> (with live USD / LEI equivalences)</span>
        </div>
        <div className="currency-pill-group">
          {(['MDL', 'USD', 'EUR', 'RON'] as SupportedCurrency[]).map((cur) => (
            <button
              key={cur}
              className={`currency-pill-btn ${state.currency === cur ? 'active' : ''}`}
              onClick={() => changeCurrency(cur)}
              title={`Switch primary real-world currency to ${CURRENCY_CONFIGS[cur]?.name ?? cur}`}
            >
              {cur} {CURRENCY_CONFIGS[cur]?.symbol !== cur ? `(${CURRENCY_CONFIGS[cur]?.symbol})` : ''}
            </button>
          ))}
        </div>
      </section>
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
                    {pinned.productUrl && (
                      <button
                        type="button"
                        className="btn ghost small"
                        title="Open store deal in browser"
                        onClick={() => window.open(pinned.productUrl!, '_blank')}
                      >
                        🌐 Store Deal
                      </button>
                    )}
                    {prog.isReady && (
                      <button className="btn primary small" onClick={() => claimGoal(pinned)}>
                        Claim Triumph!
                      </button>
                    )}
                  </div>
                </div>

                {pinned.imageUrl && (
                  <div className="showcase-hero-image-wrap">
                    <img
                      src={pinned.imageUrl}
                      alt={pinned.title}
                      className="showcase-hero-img"
                      onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none' }}
                    />
                    <div className="showcase-hero-overlay" />
                  </div>
                )}

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
                        {pinned.allocatedRealCost} / {pinned.targetRealCost} {state.currency} ({prog.realCostPercent}%) <small style={{ color: 'var(--muted)', fontSize: 11 }}>({formatDualCurrency(pinned.targetRealCost, state.currency).secondaryText})</small>
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
                <div className="effort-badge">
                  <Icon name="bolt" size={13} />
                  <span>Master Milestone Grit: {calculateEffortEquivalence(pinned.targetCoins).summaryText}</span>
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
                  onClick={() => setGachaLevel(l)}
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
            className={`shop-pill-btn ${activeTab === 'bank' ? 'active' : ''}`}
            onClick={() => {
              soundTick()
              setActiveTab('bank')
            }}
          >
            <span>🏦 The Iron Bank</span>
            {bank && bank.stakedCoins > 0 && (
              <span className="count-pill" style={{ marginLeft: 6, color: '#ffd700' }}>
                {bank.stakedCoins} 🪙
              </span>
            )}
          </button>

          <button
            className={`shop-pill-btn ${activeTab === 'consumables' ? 'active' : ''}`}
            onClick={() => {
              soundTick()
              setActiveTab('consumables')
            }}
          >
            <span>🧪 Hunter Consumables</span>
            {activeBuffs.length > 0 && (
              <span className="count-pill" style={{ marginLeft: 6, color: '#38bdf8' }}>
                {activeBuffs.length} Active
              </span>
            )}
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

          <button
            className={`shop-pill-btn ${activeTab === 'tuning' ? 'active' : ''}`}
            onClick={() => {
              soundTick()
              setActiveTab('tuning')
            }}
          >
            <span>⚖️ Economy & Price Points</span>
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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

          {activeTab === 'cards' && (
        <section className="shop-skill-deck-tab">
          <HunterSkillCards walletBalance={state.balance} />
        </section>
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

          {features.ai && (
          <button
            className="btn small ai-sparkle-btn"
            onClick={() => {
              setShowAiModal(true)
              if (!aiRewards && !generatingAi) summonAiRewards()
            }}
            title="Generate AI reward ideas tailored to your hunter rank & vault"
          >
            <Icon name="spark" size={14} /> ✨ AI Rewards
          </button>
          )}
        </div>
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
                {r.imageUrl ? (
                  <div className="reward-photo-container">
                    <img
                      src={r.imageUrl}
                      alt={r.title}
                      className="reward-photo"
                      onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none' }}
                    />
                    <div className="reward-photo-gradient" />
                  </div>
                ) : (
                  <div className="reward-photo-container placeholder">
                    <span className="reward-photo-placeholder-icon">🎁</span>
                    <div className="reward-photo-gradient" />
                  </div>
                )}
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
                  <span className="real">
                    ≈ {formatDualCurrency(coinsToMoneyValue(r.price, economy?.exchangeRate ?? 10), r.currency ?? state.currency).combinedText}
                  </span>
                </div>
                <div className="effort-badge">
                  <Icon name="bolt" size={12} />
                  <span>Afforded by: {calculateEffortEquivalence(r.price).summaryText}</span>
                </div>
                <div className="bar">
                  <i style={{ width: `${pct * 100}%` }} />
                </div>
                <div className="reward-bottom-actions">
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
                  {r.productUrl && (
                    <button
                      type="button"
                      className="reward-store-btn"
                      title={`Open deal in browser: ${r.productUrl}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        window.open(r.productUrl!, '_blank')
                      }}
                    >
                      🌐 Deal
                    </button>
                  )}
                </div>
              </motion.article>
            )
          })}
        </section>
      )}

      {/* TAB: THE IRON BANK */}
      {activeTab === 'bank' && bank && (
        <section className="iron-bank-container">
          {/* Hero Banner */}
          <div className="bank-hero-banner">
            <div className="bank-hero-title-row">
              <div>
                <div className="bank-hero-badge">
                  <span>Vault Staking Engine</span>
                  {bank.streakBonusActive && <span>· 🔥 Streak Bonus Active</span>}
                </div>
                <h2 className="bank-hero-title">The Iron Bank of the Monarch</h2>
                <p className="bank-hero-sub">
                  Lock coins in the high-yield staking vault to earn daily compound dividends. Yields increase with discipline streaks, and maximum staking cap scales with your Hunter Rank.
                </p>
              </div>

              {bank.pendingInterest > 0 && (
                <button
                  className="btn primary large"
                  style={{
                    background: 'linear-gradient(135deg, #ffd700 0%, #f59e0b 100%)',
                    color: '#000',
                    fontWeight: 800,
                    boxShadow: '0 0 20px rgba(245, 200, 75, 0.4)'
                  }}
                  onClick={handleClaimInterest}
                >
                  🏆 Claim +{bank.pendingInterest} Coins!
                </button>
              )}
            </div>

            {/* Metrics Grid */}
            <div className="bank-metrics-grid">
              <div className="bank-metric-tile highlight">
                <span className="bank-metric-label">Staked In Vault</span>
                <div className="bank-metric-value" style={{ color: '#ffd700' }}>
                  {bank.stakedCoins} 🪙
                </div>
                <span className="bank-metric-sub">
                  Cap: {bank.maxStakingCap} coins (Rank Lv. {state.level})
                </span>
              </div>

              <div className="bank-metric-tile">
                <span className="bank-metric-label">Daily Yield Rate</span>
                <div className="bank-metric-value" style={{ color: '#4ade80' }}>
                  {bank.dailyRatePercent}% / day
                </div>
                <span className="bank-metric-sub">
                  {bank.streakBonusActive ? '🔥 Spartan Streak Boost' : 'Standard Yield'}
                </span>
              </div>

              <div className="bank-metric-tile">
                <span className="bank-metric-label">Pending Dividends</span>
                <div className="bank-metric-value" style={{ color: bank.pendingInterest > 0 ? '#38bdf8' : 'var(--muted)' }}>
                  +{bank.pendingInterest} 🪙
                </div>
                <span className="bank-metric-sub">
                  {bank.pendingInterest > 0 ? 'Ready to collect!' : 'Accrues daily at midnight'}
                </span>
              </div>

              <div className="bank-metric-tile">
                <span className="bank-metric-label">Lifetime Yield</span>
                <div className="bank-metric-value" style={{ color: '#c084fc' }}>
                  +{bank.totalInterestEarned} 🪙
                </div>
                <span className="bank-metric-sub">
                  Passive dividend income
                </span>
              </div>
            </div>

            {/* Staking Cap Progress */}
            <div className="bank-progress-wrap">
              <div className="bank-progress-info">
                <span>Staking Vault Utilization</span>
                <span>
                  <b>{bank.stakedCoins}</b> / {bank.maxStakingCap} coins ({Math.min(100, Math.round((bank.stakedCoins / bank.maxStakingCap) * 100))}%)
                </span>
              </div>
              <div className="bank-progress-bar">
                <div
                  className="bank-progress-fill"
                  style={{
                    width: `${Math.min(100, (bank.stakedCoins / bank.maxStakingCap) * 100)}%`
                  }}
                />
              </div>
            </div>
          </div>

          {/* Staking / Withdrawal Controls */}
          <div className="bank-actions-deck">
            {/* Stake Panel */}
            <div className="bank-panel">
              <div className="bank-panel-header">
                <div className="bank-panel-icon stake">🔒</div>
                <div>
                  <h3 className="bank-panel-title">Deposit / Stake Coins</h3>
                  <p className="bank-panel-sub">
                    Wallet: {state.balance} 🪙 · Headroom: {Math.max(0, bank.maxStakingCap - bank.stakedCoins)} 🪙
                  </p>
                </div>
              </div>

              <div className="bank-input-group">
                <div className="bank-input-row">
                  <input
                    type="number"
                    min={1}
                    max={Math.min(state.balance, bank.maxStakingCap - bank.stakedCoins)}
                    className="bank-input"
                    placeholder="Coins to stake..."
                    value={stakeDraft}
                    onChange={(e) => setStakeDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleStake(parseInt(stakeDraft, 10))}
                  />
                  <button
                    className="btn primary"
                    disabled={!parseInt(stakeDraft, 10) || parseInt(stakeDraft, 10) <= 0}
                    onClick={() => handleStake(parseInt(stakeDraft, 10))}
                  >
                    Stake
                  </button>
                </div>

                <div className="bank-presets-row">
                  {[0.25, 0.5, 0.75, 1.0].map((frac) => {
                    const maxPossible = Math.min(state.balance, bank.maxStakingCap - bank.stakedCoins)
                    const val = Math.floor(maxPossible * frac)
                    return (
                      <button
                        key={frac}
                        type="button"
                        className="bank-preset-btn"
                        onClick={() => setStakeDraft(String(val))}
                        disabled={val <= 0}
                      >
                        {frac === 1 ? 'MAX' : `${frac * 100}%`}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Withdraw Panel */}
            <div className="bank-panel">
              <div className="bank-panel-header">
                <div className="bank-panel-icon withdraw">🔓</div>
                <div>
                  <h3 className="bank-panel-title">Withdraw / Liquidate</h3>
                  <p className="bank-panel-sub">
                    Available Staked: {bank.stakedCoins} 🪙 (Instant release to wallet)
                  </p>
                </div>
              </div>

              <div className="bank-input-group">
                <div className="bank-input-row">
                  <input
                    type="number"
                    min={1}
                    max={bank.stakedCoins}
                    className="bank-input"
                    placeholder="Coins to withdraw..."
                    value={withdrawDraft}
                    onChange={(e) => setWithdrawDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleWithdraw(parseInt(withdrawDraft, 10))}
                  />
                  <button
                    className="btn secondary"
                    disabled={!parseInt(withdrawDraft, 10) || parseInt(withdrawDraft, 10) <= 0}
                    onClick={() => handleWithdraw(parseInt(withdrawDraft, 10))}
                  >
                    Withdraw
                  </button>
                </div>

                <div className="bank-presets-row">
                  {[0.25, 0.5, 0.75, 1.0].map((frac) => {
                    const val = Math.floor(bank.stakedCoins * frac)
                    return (
                      <button
                        key={frac}
                        type="button"
                        className="bank-preset-btn"
                        onClick={() => setWithdrawDraft(String(val))}
                        disabled={val <= 0}
                      >
                        {frac === 1 ? 'ALL' : `${frac * 100}%`}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Staking Tiers Guide */}
          <div className="bank-tiers-guide">
            <div className="bank-tiers-title">
              <Icon name="spark" size={16} />
              <span>Discipline Streak Dividend Multipliers</span>
            </div>
            <div className="bank-tiers-grid">
              <div className={`bank-tier-card ${bank.cleanStreak < 7 ? 'active' : ''}`}>
                <span className="bank-tier-tag">Standard (0-6 Days)</span>
                <div className="bank-tier-rate">0.5% / day</div>
                <span className="bank-tier-desc">Baseline passive staking yield</span>
              </div>
              <div className={`bank-tier-card ${bank.cleanStreak >= 7 && bank.cleanStreak < 14 ? 'active' : ''}`}>
                <span className="bank-tier-tag">Disciplined (7+ Days)</span>
                <div className="bank-tier-rate" style={{ color: '#ffd700' }}>0.8% / day</div>
                <span className="bank-tier-desc">+60% dividend yield bonus</span>
              </div>
              <div className={`bank-tier-card ${bank.cleanStreak >= 14 && bank.cleanStreak < 30 ? 'active' : ''}`}>
                <span className="bank-tier-tag">Spartan (14+ Days)</span>
                <div className="bank-tier-rate" style={{ color: '#f59e0b' }}>1.2% / day</div>
                <span className="bank-tier-desc">+140% dividend yield bonus</span>
              </div>
              <div className={`bank-tier-card ${bank.cleanStreak >= 30 ? 'active' : ''}`}>
                <span className="bank-tier-tag">Ascendant (30+ Days)</span>
                <div className="bank-tier-rate" style={{ color: '#4ade80' }}>1.5% / day</div>
                <span className="bank-tier-desc">3.0x Maximum dividend yield</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* TAB: ECONOMY & PRICE POINTS MATRIX */}
      {activeTab === 'tuning' && (
        <EconomyCalibration state={state} onState={onState} onWallet={onWallet} />
      )}

      {/* TAB: HUNTER CONSUMABLES */}
      {activeTab === 'consumables' && (
        <section className="consumables-store-container">
          {/* Active Buffs Strip */}
          {activeBuffs.length > 0 && (
            <div className="active-buffs-strip">
              <div className="active-buffs-header">
                <span className="active-buffs-label">
                  <Icon name="bolt" size={16} />
                  <span>Currently Active Tactical Buffs ({activeBuffs.length})</span>
                </span>
              </div>
              <div className="active-buffs-cards">
                {activeBuffs.map((b) => (
                  <div key={b.id} className="active-buff-card">
                    <div className="active-buff-icon">{b.icon}</div>
                    <div className="active-buff-details">
                      <h4 className="active-buff-title">{b.title}</h4>
                      <div className="active-buff-timer">
                        <Icon name="clock" size={12} />
                        <span>{formatTimeRemaining(b.remainingSeconds)} remaining</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Consumables Catalog Grid */}
          <div className="tactical-consumables-grid">
            {CONSUMABLE_CATALOG.map((item) => {
              const canAfford = state.balance >= item.costCoins
              return (
                <div key={item.id} className={`tactical-consumable-card ${item.rarity}`}>
                  <div className="consumable-card-top">
                    <div className="consumable-icon-wrap">{item.icon}</div>
                    <span className={`consumable-rarity-pill ${item.rarity}`}>
                      {item.rarity}
                    </span>
                  </div>

                  <div className="consumable-content">
                    <h3 className="consumable-name">{item.name}</h3>
                    <p className="consumable-desc">{item.description}</p>
                    <p className="consumable-quote">{item.quote}</p>
                  </div>

                  <div className="consumable-card-bottom">
                    <div className="consumable-price-tag">
                      <div className="consumable-coins-cost">
                        <Icon name="coin" size={16} />
                        <span>{item.costCoins} Coins</span>
                      </div>
                      <span className="consumable-duration-tag">
                        {item.durationHours > 0 ? `Duration: ${item.durationHours} hours` : 'Instant activation'}
                      </span>
                    </div>

                    <button
                      className={`btn ${canAfford ? 'primary' : 'secondary'}`}
                      disabled={!canAfford}
                      onClick={() => handleBuyConsumable(item.id)}
                    >
                      {canAfford ? `Acquire (${item.costCoins} 🪙)` : `Need ${item.costCoins - state.balance} 🪙`}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* TAB 2: WISHLIST MEGA GOALS */}
      {activeTab === 'goals' && (
        <section className="goals-grid">
          {(economy?.goals ?? []).map((g) => {
            const prog = computeGoalProgress(g)
            return (
              <div key={g.id} className={`goal-card ${g.completed ? 'completed' : ''}`}>
                {g.imageUrl ? (
                  <div className="goal-photo-container">
                    <img
                      src={g.imageUrl}
                      alt={g.title}
                      className="goal-photo"
                      onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none' }}
                    />
                    <div className="goal-photo-gradient" />
                  </div>
                ) : (
                  <div className="goal-photo-container placeholder">
                    <span className="reward-photo-placeholder-icon">🎯</span>
                    <div className="goal-photo-gradient" />
                  </div>
                )}
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
                          note: g.note ?? '',
                          imageUrl: g.imageUrl ?? '',
                          productUrl: g.productUrl ?? '',
                          currency: g.currency ?? state.currency
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
                <div className="effort-badge">
                  <Icon name="bolt" size={12} />
                  <span>Milestone Grit: {calculateEffortEquivalence(g.targetCoins).summaryText}</span>
                </div>

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
                      {g.allocatedRealCost} / {g.targetRealCost} {g.currency ?? state.currency} ({prog.realCostPercent}%) <small style={{ color: 'var(--muted)', fontSize: 11 }}>({formatDualCurrency(g.targetRealCost, g.currency ?? state.currency).secondaryText})</small>
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
                      {g.productUrl && (
                        <button
                          type="button"
                          className="reward-store-btn"
                          title="Open store deal in browser"
                          onClick={() => window.open(g.productUrl!, '_blank')}
                        >
                          🌐 Deal
                        </button>
                      )}
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
          exchangeRate={economy?.exchangeRate ?? 10}
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

            {features.ai && (
            <div className="ai-inspector-box">
              <div className="ai-inspector-header">
                <span className="ai-sparkle-tag">✨ AI Smart Inspector</span>
                <span className="ai-inspector-sub">Paste store link or product query to auto-fill</span>
              </div>
              <div className="ai-inspector-input-row">
                <input
                  type="text"
                  placeholder="Paste store link or query (e.g. MacBook Pro M3 or Darwin link)..."
                  value={goalInspectQuery}
                  onChange={(e) => setGoalInspectQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleGoalAutoInspect())}
                />
                <button
                  type="button"
                  className="ai-inspect-btn"
                  disabled={goalInspecting || !goalInspectQuery.trim()}
                  onClick={handleGoalAutoInspect}
                >
                  {goalInspecting ? '⚡ Analyzing...' : '⚡ Auto-Fill'}
                </button>
              </div>
            </div>
            )}

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
                Target Cost ({editingGoal.currency ?? state.currency})
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="number"
                    min={0}
                    value={editingGoal.targetRealCost}
                    onChange={(e) =>
                      setEditingGoal({ ...editingGoal, targetRealCost: parseInt(e.target.value, 10) || 0 })
                    }
                    style={{ flex: 1 }}
                  />
                  {editingGoal.targetRealCost > 0 && (
                    <button
                      type="button"
                      className="calc-coins-btn"
                      title="Calculate coins based on 10 coins = 1 MDL"
                      onClick={() =>
                        setEditingGoal({
                          ...editingGoal,
                          targetCoins: Math.round(editingGoal.targetRealCost * (100 / (economy?.exchangeRate ?? 10)))
                        })
                      }
                    >
                      ⚡ Calc Coins
                    </button>
                  )}
                </div>
              </label>
              <label>
                Currency
                <select
                  value={editingGoal.currency ?? state.currency}
                  onChange={(e) =>
                    setEditingGoal({ ...editingGoal, currency: e.target.value })
                  }
                >
                  <option value="MDL">MDL (Lei)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="RON">RON (Lei)</option>
                </select>
              </label>
            </div>

            <div className="grid2">
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

              <label>
                Note (optional)
                <input
                  value={editingGoal.note ?? ''}
                  placeholder="Why this milestone matters..."
                  onChange={(e) => setEditingGoal({ ...editingGoal, note: e.target.value })}
                />
              </label>
            </div>

            <label>
              Photo / Image URL
              <input
                value={editingGoal.imageUrl ?? ''}
                placeholder="https://images.unsplash.com/... or direct image link"
                onChange={(e) => setEditingGoal({ ...editingGoal, imageUrl: e.target.value })}
              />
            </label>

            <label>
              Product / Store Link (URL)
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="url"
                  value={editingGoal.productUrl ?? ''}
                  placeholder="https://darwin.md/... or store link"
                  onChange={(e) => setEditingGoal({ ...editingGoal, productUrl: e.target.value })}
                  style={{ flex: 1 }}
                />
                {editingGoal.productUrl && (
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => window.open(editingGoal.productUrl!, '_blank')}
                    title="Test store link in browser"
                  >
                    🌐 Test
                  </button>
                )}
              </div>
            </label>
            {editingGoal.imageUrl && (
              <div className="image-preview-row">
                <img
                  src={editingGoal.imageUrl}
                  alt="Preview"
                  className="image-preview-thumb"
                  onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none' }}
                />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Live Photo Preview</span>
              </div>
            )}
            <div className="photo-suggest-pills">
              <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center', marginRight: 4 }}>Templates:</span>
              <button type="button" className="photo-suggest-pill" onClick={() => setEditingGoal({ ...editingGoal, imageUrl: 'https://images.unsplash.com/photo-1591604129939-f1efa4d9f7fa?w=800&auto=format&fit=crop&q=80', category: 'trip' })}>🕋 Kaaba Trip</button>
              <button type="button" className="photo-suggest-pill" onClick={() => setEditingGoal({ ...editingGoal, imageUrl: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800&auto=format&fit=crop&q=80', category: 'tech' })}>💻 MacBook / Tech</button>
              <button type="button" className="photo-suggest-pill" onClick={() => setEditingGoal({ ...editingGoal, imageUrl: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=800&auto=format&fit=crop&q=80', category: 'luxury' })}>🧖 Spa Retreat</button>
              <button type="button" className="photo-suggest-pill" onClick={() => setEditingGoal({ ...editingGoal, imageUrl: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=800&auto=format&fit=crop&q=80', category: 'gear' })}>🏋️ Gym / Fitness</button>
              <button type="button" className="photo-suggest-pill" onClick={() => setEditingGoal({ ...editingGoal, imageUrl: 'https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=800&auto=format&fit=crop&q=80', category: 'investment' })}>📈 Investment Seed</button>
            </div>

            {editingGoal.targetCoins > 0 && (
              <div className="effort-badge" style={{ marginBottom: 10 }}>
                <Icon name="spark" size={13} />
                <span>Required Grit: {calculateEffortEquivalence(editingGoal.targetCoins).summaryText}</span>
              </div>
            )}

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

      {/* AI REWARD GENERATOR MODAL */}
      {showAiModal && (
        <div className="sheet" role="dialog" aria-label="AI Reward Architect">
          <div className="sheet-card ai-reward-sheet-card" style={{ maxWidth: 640 }}>
            <div className="ai-modal-header">
              <div className="ai-modal-badge" style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, background: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', fontSize: 11, fontWeight: 700, marginBottom: 6 }}>✨ System Oracle</div>
              <h3 style={{ margin: 0 }}>AI Reward Architect</h3>
              <p className="hint" style={{ margin: '4px 0 0' }}>
                Tailored rewards synthesized for your current Hunter level, coin balance, and vault savings.
              </p>
            </div>

            <div className="ai-prompt-input-row" style={{ display: 'flex', gap: 8, margin: '14px 0' }}>
              <input
                autoFocus
                placeholder="Optional interest (e.g. coffee setup, fitness equipment, tech, books, weekend trip)..."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !generatingAi && summonAiRewards()}
                style={{ flex: 1 }}
              />
              <button
                className="btn primary"
                disabled={generatingAi}
                onClick={summonAiRewards}
              >
                {generatingAi ? 'Synthesizing...' : 'Summon'}
              </button>
            </div>

            {generatingAi && (
              <div className="ai-loading-state" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
                <div style={{ fontSize: 32, animation: 'spin 2s linear infinite' }}>🔮</div>
                <p style={{ marginTop: 12, fontWeight: 600, color: '#818cf8' }}>
                  System Oracle is analyzing your progress and generating rewards...
                </p>
                <small style={{ color: 'var(--muted)' }}>Balancing dopamine, real price, and coin feasibility</small>
              </div>
            )}

            {!generatingAi && aiRewards && aiRewards.length > 0 && (
              <div className="ai-rewards-list">
                {aiModelUsed && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      Architected by <b>{aiModelUsed}</b>
                    </span>
                    <button
                      type="button"
                      className="btn ghost small"
                      style={{ padding: '2px 8px', fontSize: 11 }}
                      onClick={summonAiRewards}
                    >
                      🔄 Re-roll ideas
                    </button>
                  </div>
                )}

                <div className="ai-cards-grid" style={{ display: 'grid', gap: 12 }}>
                  {aiRewards.map((item, idx) => (
                    <div key={idx} className="ai-reward-card" style={{
                      display: 'flex',
                      gap: 14,
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 10,
                      padding: 12,
                      alignItems: 'center'
                    }}>
                      {item.imageUrl && (
                        <img
                          src={item.imageUrl}
                          alt={item.title}
                          style={{
                            width: 72,
                            height: 72,
                            borderRadius: 8,
                            objectFit: 'cover',
                            background: '#1a1a24'
                          }}
                          onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none' }}
                        />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                          <span className={`chip small tier-${item.tier}`} style={{ textTransform: 'capitalize', fontSize: 10 }}>
                            {item.tier}
                          </span>
                          <span className="chip small" style={{ fontSize: 10, textTransform: 'capitalize' }}>
                            {item.category}
                          </span>
                        </div>
                        <h4 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>{item.title}</h4>
                        <div style={{ fontSize: 13, color: '#818cf8', fontWeight: 600, marginBottom: 4 }}>
                          🪙 {item.price} coins <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· ~{item.realCost} {state.currency}</span>
                        </div>
                        <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>
                          {item.note}
                        </p>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {item.productUrl && (
                          <button
                            type="button"
                            className="btn small ghost"
                            title="Open store link in browser"
                            onClick={() => window.open(item.productUrl!, '_blank')}
                          >
                            🌐 Store
                          </button>
                        )}
                        <button
                          className="btn small secondary"
                          title="Add this reward to the regular Shop catalog"
                          onClick={() => {
                            addAiRewardToCatalog(item)
                            toast(`Added "${item.title}" to catalog!`, 'good')
                          }}
                        >
                          + Shop
                        </button>
                        <button
                          className="btn small primary"
                          title="Pin this as a Wishlist Milestone Goal"
                          onClick={() => {
                            addAiRewardToWishlist(item)
                            toast(`Pinned "${item.title}" as Milestone!`, 'good')
                          }}
                        >
                          🎯 Goal
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="sheet-actions" style={{ marginTop: 16 }}>
              <button className="btn ghost" onClick={() => setShowAiModal(false)}>
                Close
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
  exchangeRate = 10,
  onCancel,
  onSave,
  onArchive
}: {
  value: RewardInput
  currency: string
  exchangeRate?: number
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
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" min={1} value={r.price} onChange={int('price')} style={{ flex: 1 }} />
              {r.price > 0 && (
                <button
                  type="button"
                  className="calc-coins-btn"
                  title="Calculate cash equivalent based on 10 coins = 1 MDL"
                  onClick={() => setR({ ...r, realCost: Math.max(0, Math.round(coinsToMoneyValue(r.price, exchangeRate))) })}
                >
                  ⚡ Cash
                </button>
              )}
            </div>
          </label>
          <label>
            Real cost ({r.currency ?? currency})
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" min={0} value={r.realCost} onChange={int('realCost')} style={{ flex: 1 }} />
              {r.realCost > 0 && (
                <button
                  type="button"
                  className="calc-coins-btn"
                  title="Calculate coins equivalent based on 10 coins = 1 MDL"
                  onClick={() => setR({ ...r, price: Math.max(10, Math.round(r.realCost * (100 / exchangeRate))) })}
                >
                  ⚡ Coins
                </button>
              )}
            </div>
          </label>
          <label>
            Currency
            <select
              value={r.currency ?? currency}
              onChange={(e) => setR({ ...r, currency: e.target.value })}
            >
              <option value="MDL">MDL (Lei)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="RON">RON (Lei)</option>
            </select>
          </label>
        </div>

        <div className="grid2">
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
          <label>
            Note (optional)
            <input value={r.note ?? ''} onChange={(e) => setR({ ...r, note: e.target.value })} />
          </label>
        </div>

        <label>
          Photo / Image URL
          <input
            value={r.imageUrl ?? ''}
            placeholder="https://images.unsplash.com/... or direct image link"
            onChange={(e) => setR({ ...r, imageUrl: e.target.value })}
          />
        </label>

        <label>
          Product Store Link (URL)
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="url"
              value={r.productUrl ?? ''}
              placeholder="https://darwin.md/... or store link"
              onChange={(e) => setR({ ...r, productUrl: e.target.value })}
              style={{ flex: 1 }}
            />
            {r.productUrl && (
              <button
                type="button"
                className="btn secondary small"
                onClick={() => window.open(r.productUrl!, '_blank')}
                title="Test link in browser"
              >
                🌐 Test
              </button>
            )}
          </div>
        </label>
        {r.imageUrl && (
          <div className="image-preview-row">
            <img
              src={r.imageUrl}
              alt="Preview"
              className="image-preview-thumb"
              onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none' }}
            />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Live Photo Preview</span>
          </div>
        )}
        <div className="photo-suggest-pills">
          <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center', marginRight: 4 }}>Templates:</span>
          <button type="button" className="photo-suggest-pill" onClick={() => setR({ ...r, imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600&auto=format&fit=crop&q=80' })}>🧴 Skincare</button>
          <button type="button" className="photo-suggest-pill" onClick={() => setR({ ...r, imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80' })}>🎧 Tech / Audio</button>
          <button type="button" className="photo-suggest-pill" onClick={() => setR({ ...r, imageUrl: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&auto=format&fit=crop&q=80' })}>👟 Shoes / Gear</button>
          <button type="button" className="photo-suggest-pill" onClick={() => setR({ ...r, imageUrl: 'https://images.unsplash.com/photo-1621607512214-68297480165e?w=600&auto=format&fit=crop&q=80' })}>✂️ Grooming</button>
          <button type="button" className="photo-suggest-pill" onClick={() => setR({ ...r, imageUrl: 'https://images.unsplash.com/photo-1594035910387-fea47794261f?w=600&auto=format&fit=crop&q=80' })}>✨ Perfume</button>
          <button type="button" className="photo-suggest-pill" onClick={() => setR({ ...r, imageUrl: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600&auto=format&fit=crop&q=80' })}>☕ Treat</button>
        </div>

        {r.price > 0 && (
          <div className="effort-badge" style={{ marginBottom: 10 }}>
            <Icon name="bolt" size={13} />
            <span>Real-Life Grit: {calculateEffortEquivalence(r.price).summaryText}</span>
          </div>
        )}
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
