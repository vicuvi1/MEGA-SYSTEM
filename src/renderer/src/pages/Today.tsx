import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Rule, ShopState, Summary } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { MODULE_LABEL, MODULES } from '../modules'
import { Coins, describeEntry, timeAgo, useAction } from '../ui'

type Pop = { id: number; coins: number; xp: number }

interface Props {
  summary: Summary
  rules: Rule[]
  shop: ShopState | null
  onChange: (s: Summary) => void
  onOpenShop: () => void
}

export function Today({ summary, rules, shop, onChange, onOpenShop }: Props) {
  const act = useAction()
  const [pops, setPops] = useState<Pop[]>([])
  const titles = useMemo(() => Object.fromEntries(rules.map((r) => [r.id, r.title])), [rules])
  const groups = useMemo(() => {
    const g: Record<string, Rule[]> = {}
    for (const r of rules.filter((r) => r.enabled)) (g[r.module] ??= []).push(r)
    return g
  }, [rules])

  async function award(rule: Rule) {
    const s = await act(() => life.wallet.award(rule.id))
    if (!s) return
    const coins = s.balance - summary.balance
    const pop = { id: Date.now(), coins, xp: s.totalXp - summary.totalXp }
    setPops((p) => [...p, pop])
    setTimeout(() => setPops((p) => p.filter((x) => x.id !== pop.id)), 1400)
    onChange(s)
  }

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="today">
      <section className="stats">
        <div className="stat hero">
          <span className="label">{dateLabel}</span>
          <div className="big">
            <Coins n={summary.todayCoins} sign />
          </div>
          <span className="sub">coins today · +{summary.todayXp} XP</span>
          <div className="pops" aria-hidden="true">
            <AnimatePresence>
              {pops.map((p) => (
                <motion.span key={p.id} className={`pop ${p.coins < 0 ? 'neg' : ''}`} initial={{ opacity: 0, y: 10, scale: 0.8 }} animate={{ opacity: 1, y: -28, scale: 1 }} exit={{ opacity: 0, y: -48 }} transition={{ duration: 0.6 }}>
                  {p.coins >= 0 ? '+' : ''}
                  {p.coins} · +{p.xp} XP
                </motion.span>
              ))}
            </AnimatePresence>
          </div>
        </div>
        <NextReward balance={summary.balance} shop={shop} onOpenShop={onOpenShop} />
        <div className="stat">
          <span className="label">Level</span>
          <div className="big">{summary.level.level}</div>
          <span className="sub">
            {summary.level.rank} · {summary.level.xpForNext - summary.level.xpIntoLevel} XP to next
          </span>
        </div>
      </section>

      <div className="cols">
        <section className="panel">
          <header className="panel-head">
            <h2>Quick log</h2>
            <span className="hint">Tap what you just did. Limits and cooldowns apply.</span>
          </header>
          <div className="groups">
            {Object.entries(groups).map(([mod, list]) => {
              const color = MODULES.find((m) => m.id === mod)?.color ?? 'var(--lime)'
              return (
                <div key={mod} className="group" style={{ ['--c' as string]: color }}>
                  <h3>{MODULE_LABEL[mod] ?? mod}</h3>
                  <div className="actions">
                    {list.map((r) => (
                      <motion.button key={r.id} className={`action ${r.coins < 0 ? 'penalty' : ''}`} whileTap={{ scale: 0.96 }} onClick={() => award(r)}>
                        <span>{r.title}</span>
                        <Coins n={r.coins} sign />
                      </motion.button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>Recent</h2>
          </header>
          {summary.recent.length === 0 ? (
            <div className="empty">
              <Icon name="spark" size={28} />
              <p>Nothing yet today. Log your first win.</p>
            </div>
          ) : (
            <ul className="feed">
              {summary.recent.map((e) => (
                <li key={e.id} className={e.kind === 'undo' ? 'muted' : ''}>
                  <span className="what">{describeEntry(e, titles)}</span>
                  <span className="when">{timeAgo(e.ts)}</span>
                  {e.kind !== 'undo' && <Coins n={e.coins} sign />}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function NextReward({ balance, shop, onOpenShop }: { balance: number; shop: ShopState | null; onOpenShop: () => void }) {
  const target = shop?.rewards.find((r) => r.pinned) ?? shop?.rewards.find((r) => r.price > balance) ?? null
  if (!target) {
    return (
      <button className="stat clickable" onClick={onOpenShop}>
        <span className="label">Next reward</span>
        <div className="big">
          <Coins n={balance} />
        </div>
        <span className="sub">Pick a main goal in the Shop</span>
      </button>
    )
  }
  const pct = Math.min(1, balance / target.price)
  const left = target.price - balance
  return (
    <button className="stat clickable" onClick={onOpenShop}>
      <span className="label">Main goal · {target.title}</span>
      <div className="big">{Math.round(pct * 100)}%</div>
      <div className="bar goal">
        <motion.i initial={false} animate={{ width: `${pct * 100}%` }} />
      </div>
      <span className="sub">{left > 0 ? `${left} coins to go` : 'Ready to redeem!'}</span>
    </button>
  )
}
