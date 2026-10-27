import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { soundFanfare, soundTick, soundSpend } from './sound'
import { useToast } from './ui'

export interface DungeonRaid {
  id: string
  rank: 'C' | 'B' | 'A' | 'S'
  name: string
  boss: string
  objective: string
  anteCoins: number
  rewardCoins: number
  rewardXp: number
  rewardLoot: string
  totalHp: number
  currentHp: number
  status: 'available' | 'active' | 'completed' | 'failed'
}

const DEFAULT_RAIDS: DungeonRaid[] = [
  {
    id: 'raid_c_study',
    rank: 'C',
    name: 'Citadel of Deep Focus',
    boss: 'Lord of Distraction',
    objective: 'Complete 3 Study Blocks with zero social media.',
    anteCoins: 20,
    rewardCoins: 60,
    rewardXp: 120,
    rewardLoot: '1 Mystery Chest',
    totalHp: 3,
    currentHp: 3,
    status: 'available'
  },
  {
    id: 'raid_b_iron',
    rank: 'B',
    name: 'Iron Colosseum Gauntlet',
    boss: 'Titan of Inertia',
    objective: 'Log a heavy progressive workout + 10 min mobility.',
    anteCoins: 30,
    rewardCoins: 90,
    rewardXp: 180,
    rewardLoot: '🧪 Focus Elixir (2x)',
    totalHp: 2,
    currentHp: 2,
    status: 'available'
  },
  {
    id: 'raid_s_monarch',
    rank: 'S',
    name: "Monarch's Gate: Absolute Will",
    boss: 'The Shadow Relapse',
    objective: 'Maintain Clean Day + 4 Deep Focus Blocks + In Bed on time.',
    anteCoins: 50,
    rewardCoins: 200,
    rewardXp: 400,
    rewardLoot: '👑 Monarch Rune Card',
    totalHp: 3,
    currentHp: 3,
    status: 'available'
  }
]

const STORAGE_KEY = 'ls.dungeonRaids.state'

interface Props {
  balance: number
  onAwardCoins?: (amount: number, note: string) => void
}

export function DungeonRaidCards({ balance, onAwardCoins }: Props) {
  const toast = useToast()
  const [raids, setRaids] = useState<DungeonRaid[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) return JSON.parse(saved)
    } catch {
      // ignore
    }
    return DEFAULT_RAIDS
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(raids))
    } catch {
      // ignore
    }
  }, [raids])

  const handleEnterRaid = (raid: DungeonRaid) => {
    if (balance < raid.anteCoins) {
      toast(`Insufficient coins! Need ${raid.anteCoins} 🪙 to stake entry into this Dungeon.`, 'bad')
      return
    }
    soundSpend()
    setRaids((prev) =>
      prev.map((r) =>
        r.id === raid.id
          ? { ...r, status: 'active', currentHp: r.totalHp }
          : r
      )
    )
    toast(`Entered "${raid.name}"! Staked ${raid.anteCoins} 🪙. Complete directives to deal damage!`, 'good')
  }

  const handleDealDamage = (raidId: string) => {
    soundTick()
    setRaids((prev) =>
      prev.map((r) => {
        if (r.id !== raidId) return r
        const nextHp = Math.max(0, r.currentHp - 1)
        const isDefeated = nextHp === 0
        if (isDefeated) {
          soundFanfare()
          toast(`⚔️ DUNGEON BOSS DEFEATED! Claim your bounty!`, 'good')
        }
        return {
          ...r,
          currentHp: nextHp,
          status: isDefeated ? 'completed' : 'active'
        }
      })
    )
  }

  const handleClaimVictory = (raid: DungeonRaid) => {
    soundFanfare()
    onAwardCoins?.(raid.rewardCoins, `Dungeon Cleared: ${raid.name}`)
    toast(`🏆 Cleared "${raid.name}"! Won +${raid.rewardCoins} 🪙 & +${raid.rewardXp} XP!`, 'good')
    setRaids((prev) =>
      prev.map((r) =>
        r.id === raid.id
          ? { ...r, status: 'completed' }
          : r
      )
    )
  }

  const handleForfeit = (raidId: string) => {
    soundSpend()
    setRaids((prev) =>
      prev.map((r) =>
        r.id === raidId
          ? { ...r, status: 'available', currentHp: r.totalHp }
          : r
      )
    )
    toast('Raid forfeited. Ante coins were surrendered to the Iron Bank.', 'bad')
  }

  return (
    <section className="dungeon-raids-section">
      <div className="raids-header">
        <div>
          <div className="raids-tag-row">
            <span className="raids-beacon" />
            <span className="raids-tag">[ SYSTEM CONTRACTS: HIGH-STAKES DUNGEON RAIDS ]</span>
          </div>
          <h3 className="raids-title">Dimensional Gateways & Bounties</h3>
          <p className="raids-sub">
            Stake coins from your wallet to open high-difficulty gates. Slay the boss through real-life discipline for 300%+ returns.
          </p>
        </div>
      </div>

      <div className="raids-cards-grid">
        {raids.map((raid) => {
          const hpPct = Math.round((raid.currentHp / raid.totalHp) * 100)
          const isBossDead = raid.currentHp === 0

          return (
            <motion.div
              key={raid.id}
              className={`raid-contract-card ${raid.rank.toLowerCase()} ${raid.status}`}
              whileHover={{ y: -3 }}
              transition={{ duration: 0.2 }}
            >
              {/* Top Banner */}
              <div className="raid-card-top">
                <span className={`raid-rank-pill ${raid.rank.toLowerCase()}`}>
                  RANK {raid.rank}
                </span>
                <span className="raid-status-chip">
                  {raid.status === 'active'
                    ? '⚔️ RAID IN PROGRESS'
                    : raid.status === 'completed'
                    ? '✓ CLEARED'
                    : 'GUEST GATE'}
                </span>
              </div>

              {/* Title & Boss */}
              <div className="raid-card-main">
                <h4 className="raid-gate-name">{raid.name}</h4>
                <div className="raid-boss-label">
                  Boss: <b style={{ color: '#fff' }}>{raid.boss}</b>
                </div>
                <p className="raid-objective">{raid.objective}</p>
              </div>

              {/* Boss HP Bar */}
              {raid.status === 'active' && (
                <div className="raid-boss-hp-box">
                  <div className="boss-hp-header">
                    <span>Boss Health</span>
                    <span>{raid.currentHp} / {raid.totalHp} Hits Remaining</span>
                  </div>
                  <div className="boss-hp-track">
                    <motion.div
                      className="boss-hp-fill"
                      animate={{ width: `${hpPct}%` }}
                      transition={{ duration: 0.4 }}
                    />
                  </div>
                  <button
                    className="btn-deal-damage"
                    onClick={() => handleDealDamage(raid.id)}
                  >
                    ⚔️ Deal Directive Strike (-1 HP)
                  </button>
                </div>
              )}

              {/* Staking & Bounty Footer */}
              <div className="raid-bounty-row">
                <div className="bounty-col">
                  <span className="bounty-label">Stake Required</span>
                  <span className="bounty-val stake">{raid.anteCoins} 🪙</span>
                </div>
                <div className="bounty-col">
                  <span className="bounty-label">Triumph Bounty</span>
                  <span className="bounty-val win">+{raid.rewardCoins} 🪙</span>
                </div>
                <div className="bounty-col">
                  <span className="bounty-label">Loot Drop</span>
                  <span className="bounty-loot-tag">{raid.rewardLoot}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="raid-card-actions">
                {raid.status === 'available' && (
                  <button
                    className="btn-raid-enter"
                    onClick={() => handleEnterRaid(raid)}
                  >
                    <span>Stake {raid.anteCoins} 🪙 & Enter Gate</span>
                  </button>
                )}

                {raid.status === 'active' && !isBossDead && (
                  <button
                    className="btn-raid-forfeit"
                    onClick={() => handleForfeit(raid.id)}
                  >
                    Surrender Raid
                  </button>
                )}

                {raid.status === 'active' && isBossDead && (
                  <button
                    className="btn-raid-claim"
                    onClick={() => handleClaimVictory(raid)}
                  >
                    <span>🏆 Claim Victory (+{raid.rewardCoins} 🪙)</span>
                  </button>
                )}

                {raid.status === 'completed' && (
                  <div className="raid-completed-badge">
                    <span>✓ GATE CONQUERED TODAY</span>
                  </div>
                )}
              </div>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}
