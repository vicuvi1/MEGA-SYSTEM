import React, { useState } from 'react'
import type { LevelInfo } from '@shared/api'
import { life } from './bridge'
import { soundCoin, soundTick, soundFanfare } from './sound'
import './radarChart.css'

interface Props {
  level: LevelInfo
  onStatsUpdated?: () => void
  showPerks?: boolean
  compact?: boolean
}

const STAT_CONFIG = [
  { key: 'str' as const, label: 'STR', name: 'Strength', icon: '⚔️', role: 'Physical Power & Workout Output' },
  { key: 'agi' as const, label: 'AGI', name: 'Agility', icon: '💨', role: 'Circadian Velocity & Speed' },
  { key: 'vit' as const, label: 'VIT', name: 'Vitality', icon: '🛡️', role: 'Sleep & Streak Shield Resilience' },
  { key: 'int' as const, label: 'INT', name: 'Intelligence', icon: '🧠', role: 'Cognitive Focus & Coin Multipliers' },
  { key: 'sen' as const, label: 'SEN', name: 'Perception', icon: '👑', role: 'Willpower & Urge Immunity' }
]

export function HolographicRadarChart({ level, onStatsUpdated, showPerks = true, compact = false }: Props) {
  const [allocating, setAllocating] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)

  const attrs = level.attributes
  const unallocated = attrs?.unallocatedPoints ?? 0
  const allocated = attrs?.allocated ?? { str: 0, agi: 0, vit: 0, int: 0, sen: 0 }
  const perks = level.perks ?? []

  // Geometry for 5-axis pentagon radar
  const cx = 160
  const cy = 150
  const R = 95
  const angleStep = (2 * Math.PI) / 5

  const angles = STAT_CONFIG.map((_, i) => -Math.PI / 2 + i * angleStep)

  // Maximum value for scaling (at least 60)
  const maxStat = Math.max(
    60,
    attrs?.str ?? 0,
    attrs?.agi ?? 0,
    attrs?.vit ?? 0,
    attrs?.int ?? 0,
    attrs?.sen ?? 0
  )

  // Concentric pentagons
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0]

  // Data polygon points
  const dataPoints = STAT_CONFIG.map((stat, i) => {
    const val = attrs ? attrs[stat.key] : 10
    const ratio = Math.max(0.18, Math.min(1.0, val / maxStat))
    const x = cx + R * ratio * Math.cos(angles[i])
    const y = cy + R * ratio * Math.sin(angles[i])
    return { x, y, val, stat }
  })

  const polygonPath = dataPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  const handleAllocate = async (stat: 'str' | 'agi' | 'vit' | 'int' | 'sen', points: number) => {
    if (unallocated < points || allocating) return
    setAllocating(stat)
    try {
      soundCoin()
      await life.wallet.allocateStats(stat, points)
      if (unallocated <= points) {
        soundFanfare()
      }
      onStatsUpdated?.()
    } catch (e) {
      console.error(e)
    } finally {
      setAllocating(null)
    }
  }

  const handleReset = async () => {
    if (resetting) return
    const totalAllocated = allocated.str + allocated.agi + allocated.vit + allocated.int + allocated.sen
    if (totalAllocated === 0) return
    if (!window.confirm('Reset all allocated attribute points back to your free pool?')) return
    setResetting(true)
    try {
      soundTick()
      await life.wallet.resetStats()
      onStatsUpdated?.()
    } catch (e) {
      console.error(e)
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className={`holographic-radar-container ${compact ? 'compact' : ''}`}>
      {/* Header */}
      <div className="radar-header">
        <div className="radar-header-title">
          <span style={{ fontSize: 20 }}>🛡️</span>
          <div>
            <h3>HUNTER ATTRIBUTE MATRIX</h3>
            <span className="system-sub">[ Holographic Pentagon Radar & Skill Tree ]</span>
          </div>
        </div>
        <div className="radar-cp-badge" title="Combined Hunter Combat Power">
          <span>COMBAT POWER:</span>
          <b>{attrs?.totalCombatPower?.toLocaleString() ?? 0} CP</b>
        </div>
      </div>

      {/* Available Stat Points Banner */}
      {unallocated > 0 ? (
        <div className="unallocated-banner">
          <div className="unallocated-info">
            <span className="unallocated-icon">✦</span>
            <div className="unallocated-text">
              <strong>{unallocated} FREE STAT POINT{unallocated > 1 ? 'S' : ''} READY TO ALLOCATE</strong>
              <span>Invest points into attributes below to unlock higher Hunter Passives.</span>
            </div>
          </div>
          {(allocated.str + allocated.agi + allocated.vit + allocated.int + allocated.sen > 0) && (
            <button className="reset-stats-btn" onClick={handleReset} disabled={resetting}>
              ↺ Reset Allocated
            </button>
          )}
        </div>
      ) : (
        (allocated.str + allocated.agi + allocated.vit + allocated.int + allocated.sen > 0) && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="reset-stats-btn" onClick={handleReset} disabled={resetting}>
              ↺ Reset Allocated Points
            </button>
          </div>
        )
      )}

      {/* Main Two-Column View: Pentagon Radar SVG + Allocation Grid */}
      <div className="radar-main-content">
        {/* SVG Pentagon Radar */}
        <div className="radar-svg-wrapper">
          <svg className="radar-svg" viewBox="0 0 320 300">
            <defs>
              <linearGradient id="radarFillGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#00d2ff" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#0284c7" stopOpacity="0.1" />
              </linearGradient>
              <filter id="radarGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Concentric Grid Pentagons */}
            {gridLevels.map((lvl, idx) => {
              const pts = angles
                .map((a) => {
                  const gx = cx + R * lvl * Math.cos(a)
                  const gy = cy + R * lvl * Math.sin(a)
                  return `${gx.toFixed(1)},${gy.toFixed(1)}`
                })
                .join(' ')
              return (
                <polygon
                  key={idx}
                  points={pts}
                  className="radar-grid-line"
                  strokeDasharray={idx === gridLevels.length - 1 ? undefined : '2 3'}
                />
              )
            })}

            {/* 5 Axis Lines */}
            {angles.map((a, i) => {
              const x2 = cx + R * Math.cos(a)
              const y2 = cy + R * Math.sin(a)
              return <line key={i} x1={cx} y1={cy} x2={x2} y2={y2} className="radar-axis-line" />
            })}

            {/* Data Polygon */}
            <polygon points={polygonPath} className="radar-polygon" />

            {/* Vertex Nodes & Outer Labels */}
            {dataPoints.map((pt, i) => {
              const labelDist = R + 26
              const lx = cx + labelDist * Math.cos(angles[i])
              const ly = cy + labelDist * Math.sin(angles[i])
              return (
                <g key={i}>
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={4}
                    className="radar-vertex-node"
                  >
                    <title>{`${pt.stat.name}: ${pt.val}`}</title>
                  </circle>
                  <text
                    x={lx}
                    y={ly}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="radar-label highlight"
                  >
                    {pt.stat.label} {pt.val}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>

        {/* Stat Allocation Cards Grid */}
        <div className="stat-allocation-grid">
          {STAT_CONFIG.map((stat) => {
            const currentVal = attrs ? attrs[stat.key] : 10
            const ptsAllocated = allocated[stat.key] || 0
            const canAdd = unallocated > 0
            const canAdd5 = unallocated >= 5

            return (
              <div key={stat.key} className="stat-allocation-card">
                <div className="stat-info-left">
                  <div className="stat-icon-wrap">{stat.icon}</div>
                  <div className="stat-titles">
                    <div className="stat-titles-row">
                      <span className="stat-name">{stat.name}</span>
                      {ptsAllocated > 0 && (
                        <span className="stat-allocated-tag">+{ptsAllocated} Invested</span>
                      )}
                    </div>
                    <span className="stat-desc">{stat.role}</span>
                  </div>
                </div>

                <div className="stat-actions-right">
                  <div className="stat-total-display">
                    <span className="stat-num-val">{currentVal}</span>
                    <span className="stat-breakdown-sub">{stat.label}</span>
                  </div>

                  <div className="allocate-btn-group">
                    <button
                      className="allocate-btn"
                      disabled={!canAdd || allocating === stat.key}
                      onClick={() => handleAllocate(stat.key, 1)}
                      title={`Invest 1 stat point into ${stat.name}`}
                    >
                      +1
                    </button>
                    {canAdd5 && (
                      <button
                        className="allocate-btn"
                        disabled={allocating === stat.key}
                        onClick={() => handleAllocate(stat.key, 5)}
                        title={`Invest 5 stat points into ${stat.name}`}
                      >
                        +5
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Skill Tree & Unlockable Hunter Passives */}
      {showPerks && (
        <div className="skill-tree-section">
          <div className="skill-tree-header">
            <h4>
              <span>⚡</span> UNLOCKABLE HUNTER PASSIVES (SKILL TREE)
            </h4>
            <span className="skill-tree-stats-badge">
              {perks.filter((p) => p.unlocked).length} / {perks.length} Perks Active
            </span>
          </div>

          <div className="perks-grid">
            {perks.map((perk) => (
              <div key={perk.id} className={`perk-card ${perk.unlocked ? 'unlocked' : 'locked'}`}>
                <div className="perk-top-row">
                  <div className="perk-badge-wrap">
                    <span className="perk-icon">{perk.icon}</span>
                    <span className="perk-name">{perk.name}</span>
                  </div>
                  <span className={`perk-status-tag ${perk.unlocked ? 'active' : 'locked'}`}>
                    {perk.unlocked ? 'Active' : 'Locked'}
                  </span>
                </div>

                <p className="perk-desc">{perk.desc}</p>

                <div className="perk-progress-wrap">
                  <div className="perk-progress-info">
                    <span className="perk-req-pill">{perk.reqDesc}</span>
                    <span>{perk.unlocked ? '100%' : `${perk.progressPct}%`}</span>
                  </div>
                  <div className="perk-progress-bar">
                    <div
                      className="perk-progress-fill"
                      style={{
                        width: `${perk.progressPct}%`,
                        backgroundColor: perk.unlocked ? (perk.color || '#00d2ff') : '#64748b'
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
