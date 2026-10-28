import React, { useState, useEffect } from 'react'
import type { ShopState, Reward } from '@shared/api'
import { soundCoin, soundSuccess, soundTick } from './sound'
import { triggerRpgPopup } from './RpgFloatingPopups'
import { useToast } from './ui'
import { life } from './bridge'
import './economyCalibration.css'

interface Props {
  state: ShopState
  onState: (s: ShopState) => void
  onWallet: () => void
}

export function EconomyCalibration({ state, onState, onWallet }: Props) {
  const toast = useToast()

  // Currency exchange rate (e.g. 10 coins = 1 USD/MDL/EUR)
  const [exchangeRate, setExchangeRate] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('ls.economy.rate')
      return saved ? parseFloat(saved) : 10
    } catch {
      return 10
    }
  })

  // Price tier defaults
  const [tierPrices, setTierPrices] = useState<{ casual: number; medium: number; epic: number; legendary: number }>(() => {
    try {
      const saved = localStorage.getItem('ls.economy.tierPrices')
      if (saved) return JSON.parse(saved)
    } catch {}
    return { casual: 25, medium: 75, epic: 250, legendary: 1000 }
  })

  const saveRate = (val: number) => {
    const rate = Math.max(1, val)
    setExchangeRate(rate)
    localStorage.setItem('ls.economy.rate', String(rate))
    toast(`Exchange rate set: ${rate} Coins = 1 Currency Unit`, 'good')
  }

  const handlePriceChange = (tier: 'casual' | 'medium' | 'epic' | 'legendary', price: number) => {
    const updated = { ...tierPrices, [tier]: Math.max(1, price) }
    setTierPrices(updated)
    localStorage.setItem('ls.economy.tierPrices', JSON.stringify(updated))
  }

  const handleAutoAlignPrices = async () => {
    soundSuccess()
    triggerRpgPopup({
      main: 'ECONOMY BALANCED',
      sub: 'All price points aligned',
      kind: 'gold'
    })

    // Align existing shop catalog items to standard price benchmarks
    for (const r of state.rewards) {
      let targetPrice = r.price
      if (r.tier === 'bronze') targetPrice = tierPrices.casual
      else if (r.tier === 'silver') targetPrice = tierPrices.medium
      else if (r.tier === 'gold') targetPrice = tierPrices.epic
      else if (r.tier === 'legendary') targetPrice = tierPrices.legendary

      if (targetPrice !== r.price) {
        await life.shop.save({
          id: r.id,
          title: r.title,
          price: targetPrice,
          tier: r.tier,
          realCost: r.realCost,
          note: r.note,
          pinned: r.pinned
        })
      }
    }

    const next = await life.shop.state()
    onState(next)
    toast('✨ Successfully aligned catalog items to calibrated price points!', 'good')
  }

  // Daily math calculations
  const dailyEarningPotential = 63 // 15 (P1) + 10 (P2) + 20 (Clean) + 10 (Workout) + 5 (Water) + 3 (Oath)
  const recommendedDailyBudget = Math.round(dailyEarningPotential * 0.55)
  const dailySurplus = dailyEarningPotential - recommendedDailyBudget

  return (
    <div className="economy-calib-container">
      {/* Hero: Equilibrium & Health Status */}
      <section className="economy-calib-hero">
        <div className="economy-calib-title-row">
          <div className="economy-calib-badge">
            <span className="solo-pulse-beacon" />
            <span>[ SYSTEM ECONOMY MATRIX & PRICE POINT CALIBRATOR ]</span>
          </div>

          <button className="btn small primary" onClick={handleAutoAlignPrices}>
            <span>⚡ Auto-Align Catalog Prices</span>
          </button>
        </div>

        <div className="economy-gauge-card">
          <div className="economy-gauge-circle">⚖️</div>
          <div className="economy-gauge-info">
            <h4>Prime Equilibrium · Status Optimal</h4>
            <p>
              Your system allows you to earn up to <b>{dailyEarningPotential} Coins/day</b>. At <b>{exchangeRate} Coins = $1.00</b>, your daily effort translates to <b>${(dailyEarningPotential / exchangeRate).toFixed(2)}</b> in real purchasing power.
            </p>
          </div>
        </div>
      </section>

      {/* Reward Price Points Matrix */}
      <section className="economy-calib-section">
        <div className="economy-calib-section-head">
          <h3>🎯 Reward Price Points Matrix</h3>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            Set standard coin prices for each reward tier
          </span>
        </div>

        <div className="economy-matrix-grid">
          {/* Tier 1: Casual */}
          <div className="economy-tier-box">
            <div className="economy-tier-head">
              <span className="economy-tier-name">Casual Treat</span>
              <span className="economy-tier-tag casual">Bronze</span>
            </div>
            <div className="economy-tier-price-row">
              <input
                type="number"
                className="economy-tier-price-input"
                value={tierPrices.casual}
                onChange={(e) => handlePriceChange('casual', parseInt(e.target.value, 10) || 1)}
              />
              <span style={{ color: '#fbbf24', fontWeight: 700 }}>Coins</span>
              <span style={{ color: '#64748b', fontSize: '12px' }}>
                ≈ ${(tierPrices.casual / exchangeRate).toFixed(2)}
              </span>
            </div>
            <div className="economy-tier-examples">
              ☕ Specialty Coffee, 30m gaming session, snack, YouTube break.
            </div>
          </div>

          {/* Tier 2: Medium */}
          <div className="economy-tier-box">
            <div className="economy-tier-head">
              <span className="economy-tier-name">Medium Indulgence</span>
              <span className="economy-tier-tag medium">Silver</span>
            </div>
            <div className="economy-tier-price-row">
              <input
                type="number"
                className="economy-tier-price-input"
                value={tierPrices.medium}
                onChange={(e) => handlePriceChange('medium', parseInt(e.target.value, 10) || 1)}
              />
              <span style={{ color: '#fbbf24', fontWeight: 700 }}>Coins</span>
              <span style={{ color: '#64748b', fontSize: '12px' }}>
                ≈ ${(tierPrices.medium / exchangeRate).toFixed(2)}
              </span>
            </div>
            <div className="economy-tier-examples">
              🎬 Cinema ticket, favorite takeout meal, buying a book, late-night movie.
            </div>
          </div>

          {/* Tier 3: Epic */}
          <div className="economy-tier-box">
            <div className="economy-tier-head">
              <span className="economy-tier-name">Major Reward</span>
              <span className="economy-tier-tag epic">Gold</span>
            </div>
            <div className="economy-tier-price-row">
              <input
                type="number"
                className="economy-tier-price-input"
                value={tierPrices.epic}
                onChange={(e) => handlePriceChange('epic', parseInt(e.target.value, 10) || 1)}
              />
              <span style={{ color: '#fbbf24', fontWeight: 700 }}>Coins</span>
              <span style={{ color: '#64748b', fontSize: '12px' }}>
                ≈ ${(tierPrices.epic / exchangeRate).toFixed(2)}
              </span>
            </div>
            <div className="economy-tier-examples">
              👔 Fine dining dinner, new clothing piece, tech accessory, full relaxation day.
            </div>
          </div>

          {/* Tier 4: Legendary */}
          <div className="economy-tier-box">
            <div className="economy-tier-head">
              <span className="economy-tier-name">Legendary Trophy</span>
              <span className="economy-tier-tag legendary">Diamond</span>
            </div>
            <div className="economy-tier-price-row">
              <input
                type="number"
                className="economy-tier-price-input"
                value={tierPrices.legendary}
                onChange={(e) => handlePriceChange('legendary', parseInt(e.target.value, 10) || 1)}
              />
              <span style={{ color: '#fbbf24', fontWeight: 700 }}>Coins</span>
              <span style={{ color: '#64748b', fontSize: '12px' }}>
                ≈ ${(tierPrices.legendary / exchangeRate).toFixed(2)}
              </span>
            </div>
            <div className="economy-tier-examples">
              ✈️ Weekend trip, major hardware upgrade, milestone celebration trophy.
            </div>
          </div>
        </div>
      </section>

      {/* Currency Exchange & Earning Velocity */}
      <section className="economy-calib-section">
        <div className="economy-calib-section-head">
          <h3>💵 Real-World Exchange Rate & Earning Velocity</h3>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '14px', color: '#cbd5e1' }}>
            Exchange Ratio:
          </label>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="number"
              style={{
                width: '80px',
                background: 'rgba(0,0,0,0.5)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '8px',
                padding: '6px 10px',
                color: '#fbbf24',
                fontSize: '15px',
                fontWeight: 700
              }}
              value={exchangeRate}
              onChange={(e) => saveRate(parseFloat(e.target.value) || 10)}
            />
            <span style={{ color: '#fbbf24', fontWeight: 700 }}>Coins = $1.00 USD / MDL</span>
          </div>
        </div>

        <div className="economy-stats-strip">
          <div className="economy-stat-item">
            <div className="economy-stat-label">Daily Earning Capacity</div>
            <div className="economy-stat-val" style={{ color: '#38bdf8' }}>
              {dailyEarningPotential} Coins
            </div>
          </div>
          <div className="economy-stat-item">
            <div className="economy-stat-label">Rec. Daily Spend Limit</div>
            <div className="economy-stat-val" style={{ color: '#fbbf24' }}>
              {recommendedDailyBudget} Coins
            </div>
          </div>
          <div className="economy-stat-item">
            <div className="economy-stat-label">Daily Vault Savings</div>
            <div className="economy-stat-val" style={{ color: '#4ade80' }}>
              +{dailySurplus} Coins/day
            </div>
          </div>
          <div className="economy-stat-item">
            <div className="economy-stat-label">30-Day Goal Wealth</div>
            <div className="economy-stat-val" style={{ color: '#a855f7' }}>
              ~{dailySurplus * 30} Coins
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
