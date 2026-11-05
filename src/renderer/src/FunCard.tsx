// "Treat yourself" on Today: what your coins buy right now. Guilt-free fun
// time (1 coin a minute) and your Shop rewards: the ones you can get now, and
// how far the next one is in focus sessions.
import { buyToast, redeemReward } from './redeem'
import { useCallback, useEffect, useState } from 'react'
import type { ShopState } from '@shared/api'
import type { Reward } from '@core/shop'
import { redeemBlocker } from '@core/shop'
import { life } from './bridge'
import { Icon } from './Icon'
import { play, soundSuccess } from './soundKit'
import { useAction } from './ui'
import { barFill } from './motionKit'

/** A full 50-minute focus session pays this much (+3 per 10 min). */
const COINS_PER_SESSION = 15
const FUN = [15, 30, 60]

function useShop(): [ShopState | null, () => void] {
  const [s, setS] = useState<ShopState | null>(null)
  const load = useCallback(() => {
    life.shop.state().then(setS).catch(() => {})
  }, [])
  useEffect(() => {
    load()
    window.addEventListener('life-wallet-changed', load)
    return () => window.removeEventListener('life-wallet-changed', load)
  }, [load])
  return [s, load]
}

export function FunCard({ onWallet, onOpenShop }: { onWallet: () => void; onOpenShop: () => void }) {
  const [shop, reload] = useShop()
  const act = useAction()
  const [what, setWhat] = useState('Gaming')
  const [sure, setSure] = useState<number | null>(null)
  if (!shop) return null
  const bal = shop.balance
  const blocker = (r: Reward) => redeemBlocker({ reward: r, balance: bal, level: shop.level, monthSpent: shop.monthSpent, budget: shop.budget })
  const live = shop.rewards.filter((r) => !r.archived)
  const canGet = live.filter((r) => !blocker(r)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.price - a.price).slice(0, 3)
  // The next goal: pinned first, else the cheapest you can't afford yet.
  const next = live
    .filter((r) => r.price > bal)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.price - b.price)[0]

  const fun = async (min: number) => {
    const r = await act(() => life.focus.fun(min, what), `Enjoy ${min} min of ${what.toLowerCase()} 🎮`)
    if (r) {
      soundSuccess()
      onWallet()
      reload()
    }
  }
  const redeem = async (r: Reward) => {
    if (sure !== r.id) return setSure(r.id)
    setSure(null)
    const ok = await act(() => redeemReward(r.id), (s) => buyToast(s, `${r.title}: yours! 🎁`))
    if (ok) {
      play('reward')
      onWallet()
      reload()
    }
  }

  return (
    <section className="panel fun-card">
      <header className="fun-head">
        <h3>
          <Icon name="gift" size={16} /> Treat yourself
        </h3>
        <span className="fun-bal">
          <b>{bal}</b> 🪙
        </span>
      </header>

      <div className="fun-row">
        <span className="fun-label">Guilt-free fun · 1 point a minute</span>
        <div className="fun-time">
          <select value={what} onChange={(e) => setWhat(e.target.value)} aria-label="What kind of fun">
            {['Gaming', 'YouTube', 'Series', 'Social media', 'Free time'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          {FUN.map((m) => (
            <button key={m} className="btn small" disabled={bal < m} onClick={() => void fun(m)} title={bal < m ? `You need ${m - bal} more points` : `Spend ${m} points`}>
              {m} min
            </button>
          ))}
        </div>
      </div>

      {canGet.length > 0 && (
        <div className="fun-row">
          <span className="fun-label">You can get now</span>
          <ul className="fun-list">
            {canGet.map((r) => (
              <li key={r.id}>
                <span className="fun-title">{r.title}</span>
                <button className={`btn small ${sure === r.id ? 'primary' : ''}`} onClick={() => void redeem(r)} onBlur={() => setSure(null)}>
                  {sure === r.id ? `Confirm −${r.price}` : `Get it · ${r.price}`}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {next && (
        <div className="fun-row">
          <span className="fun-label">Next goal</span>
          <div className="fun-next">
            <span className="fun-title">{next.title}</span>
            <div className="bar pbar" role="img" aria-label={`${bal} of ${next.price} points`}>
              <i style={barFill(bal / next.price)} />
            </div>
            <span className="hint">
              {next.price - bal} points to go · about {Math.ceil((next.price - bal) / COINS_PER_SESSION)} focus sessions
            </span>
          </div>
        </div>
      )}

      {!live.length && <p className="hint">Add rewards you really want in the Shop (a game, headphones, a dinner out), with a price in points.</p>}
      <button className="btn small ghost fun-shop" onClick={onOpenShop}>
        Edit rewards
      </button>
    </section>
  )
}
