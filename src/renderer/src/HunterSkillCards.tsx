import { useState, useRef, useEffect, MouseEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { soundFanfare, soundTick } from './sound'
import { useToast } from './ui'

export type CardRarity = 'rare' | 'epic' | 'legendary' | 'mythic'

export interface SkillCardDef {
  id: string
  name: string
  attribute: 'STR' | 'AGI' | 'INT' | 'VIT' | 'SEN' | 'ALL'
  rarity: CardRarity
  tagline: string
  effect: string
  powerBonus: number
  icon: string
  lore: string
}

export const SKILL_CARDS_CATALOG: SkillCardDef[] = [
  {
    id: 'card_compound_mind',
    name: 'Compound Mind',
    attribute: 'INT',
    rarity: 'legendary',
    tagline: 'Deep Focus & Passive Staking Mastery',
    effect: '+0.25% Daily Yield to the Iron Bank and +15% Coins for 90+ min study blocks.',
    powerBonus: 120,
    icon: '🧠',
    lore: '"The true monarch compounds wisdom silently while the world sleeps."'
  },
  {
    id: 'card_shadow_momentum',
    name: 'Shadow Momentum',
    attribute: 'AGI',
    rarity: 'epic',
    tagline: 'Dawn Velocity & Early Strikes',
    effect: '+30% Coins & +40 XP for waking up on time and finishing morning directives before 12:00 PM.',
    powerBonus: 85,
    icon: '⚡',
    lore: '"Speed is not merely quickness; it is dominating the battlefield before dawn."'
  },
  {
    id: 'card_iron_aegis',
    name: 'Iron Aegis',
    attribute: 'VIT',
    rarity: 'rare',
    tagline: 'Unyielding Biological Armor',
    effect: 'Reduces streak slip penalties by 50% and automatically preserves your clean streak once per month.',
    powerBonus: 60,
    icon: '🛡️',
    lore: '"No storm can shatter a fortress forged in daily repetition."'
  },
  {
    id: 'card_titan_surge',
    name: 'Titan Surge',
    attribute: 'STR',
    rarity: 'epic',
    tagline: 'Hypertrophic Power Breakthrough',
    effect: 'Workouts award +50% XP and double coin bonus on high-tonnage progressive overload days.',
    powerBonus: 95,
    icon: '⚔️',
    lore: '"When physical limits are reached, the system shatters them."'
  },
  {
    id: 'card_mana_perception',
    name: 'Mana Perception',
    attribute: 'SEN',
    rarity: 'legendary',
    tagline: 'Sixth Sense & Loot Intuition',
    effect: 'Doubles the chance of finding Streak Shields, Elixirs, and Vault Surplus cash in Mystery Chests.',
    powerBonus: 110,
    icon: '👁️',
    lore: '"You do not merely see the world; you perceive its underlying energetic threads."'
  },
  {
    id: 'card_monarch_domain',
    name: "Monarch's Focus",
    attribute: 'ALL',
    rarity: 'mythic',
    tagline: 'Sovereign Will & Extended Flow',
    effect: 'All consumable combat elixirs (Focus Elixir, XP Booster) last 4 hours instead of 2 hours.',
    powerBonus: 250,
    icon: '👑',
    lore: '"Stand alone at the summit. The shadows bend to none but the sovereign."'
  }
]

const STORAGE_EQUIPPED_KEY = 'ls.equippedSkillCards'

interface Props {
  onClose?: () => void
  walletBalance?: number
}

export function HunterSkillCards({ onClose }: Props) {
  const toast = useToast()
  const [equippedIds, setEquippedIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_EQUIPPED_KEY)
      if (saved) return JSON.parse(saved)
    } catch {
      // ignore
    }
    return ['card_compound_mind', 'card_shadow_momentum'] // default equipped
  })

  const [inspectCard, setInspectCard] = useState<SkillCardDef | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_EQUIPPED_KEY, JSON.stringify(equippedIds))
    } catch {
      // ignore
    }
  }, [equippedIds])

  const toggleEquip = (card: SkillCardDef) => {
    if (equippedIds.includes(card.id)) {
      setEquippedIds(equippedIds.filter((id) => id !== card.id))
      soundTick()
      toast(`Unequipped "${card.name}"`, 'good')
    } else {
      if (equippedIds.length >= 3) {
        toast('Active loadout full! Unequip a card first (Max 3 active slots).', 'bad')
        return
      }
      setEquippedIds([...equippedIds, card.id])
      soundFanfare()
      toast(`Equipped "${card.name}"! Perk active in all modules.`, 'good')
    }
  }

  const totalCPBonus = equippedIds.reduce((sum, id) => {
    const card = SKILL_CARDS_CATALOG.find((c) => c.id === id)
    return sum + (card?.powerBonus ?? 0)
  }, 0)

  return (
    <div className="hunter-skill-deck-container">
      {/* HEADER SECTION */}
      <div className="deck-header">
        <div>
          <div className="deck-tag-row">
            <span className="deck-pulse-dot" />
            <span className="deck-tag">THE SYSTEM: TACTICAL PERK CARDS</span>
          </div>
          <h2 className="deck-title">Hunter Loadout & Skill Cards</h2>
          <p className="deck-sub">
            Equip up to 3 active skill cards to buff your economy, daily XP, workout yield, and bank APY.
          </p>
        </div>
        <div className="deck-cp-badge">
          <span className="cp-label">Active Loadout CP</span>
          <span className="cp-value">+{totalCPBonus} CP</span>
          <span className="cp-slots">{equippedIds.length} / 3 Slots Equipped</span>
        </div>
      </div>

      {/* 3 EQUIPPED SLOTS BAR */}
      <div className="equipped-slots-strip">
        {[0, 1, 2].map((slotIndex) => {
          const cardId = equippedIds[slotIndex]
          const card = SKILL_CARDS_CATALOG.find((c) => c.id === cardId)
          return (
            <div
              key={slotIndex}
              className={`equipped-slot-card ${card ? `filled ${card.rarity}` : 'empty'}`}
              onClick={() => card && setInspectCard(card)}
            >
              {card ? (
                <>
                  <div className="slot-top">
                    <span className="slot-icon">{card.icon}</span>
                    <span className={`slot-rarity ${card.rarity}`}>{card.rarity}</span>
                  </div>
                  <div className="slot-info">
                    <span className="slot-name">{card.name}</span>
                    <span className="slot-attr">{card.attribute} Perk</span>
                  </div>
                  <button
                    className="slot-unequip-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleEquip(card)
                    }}
                    title="Unequip from loadout"
                  >
                    ✕
                  </button>
                </>
              ) : (
                <div className="slot-empty-content">
                  <span className="slot-empty-icon">⬡</span>
                  <span className="slot-empty-text">Empty Perk Slot {slotIndex + 1}</span>
                  <span className="slot-empty-sub">Click any card below to equip</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* CARDS CATALOG GRID */}
      <div className="cards-grid-title">
        <span>Available Tactical Deck</span>
        <span className="cards-count-badge">{SKILL_CARDS_CATALOG.length} Cards Discovered</span>
      </div>

      <div className="skill-cards-grid">
        {SKILL_CARDS_CATALOG.map((card) => {
          const isEquipped = equippedIds.includes(card.id)
          return (
            <InteractiveSkillCard
              key={card.id}
              card={card}
              isEquipped={isEquipped}
              onToggle={() => toggleEquip(card)}
              onInspect={() => setInspectCard(card)}
            />
          )
        })}
      </div>

      {/* INSPECT CARD MODAL */}
      <AnimatePresence>
        {inspectCard && (
          <div className="card-inspect-backdrop" onClick={() => setInspectCard(null)}>
            <motion.div
              className={`card-inspect-modal ${inspectCard.rarity}`}
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.85, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.88, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="inspect-card-hero">
                <span className="inspect-icon">{inspectCard.icon}</span>
                <span className={`inspect-rarity-pill ${inspectCard.rarity}`}>{inspectCard.rarity.toUpperCase()}</span>
                <h3 className="inspect-title">{inspectCard.name}</h3>
                <span className="inspect-tagline">{inspectCard.tagline}</span>
              </div>

              <div className="inspect-body">
                <div className="inspect-section">
                  <span className="inspect-label">Tactical Effect</span>
                  <p className="inspect-effect">{inspectCard.effect}</p>
                </div>

                <div className="inspect-section">
                  <span className="inspect-label">Shadow Lore</span>
                  <p className="inspect-lore">{inspectCard.lore}</p>
                </div>

                <div className="inspect-meta-row">
                  <div>
                    <span className="inspect-label">Governing Stat</span>
                    <span className="inspect-stat-val" style={{ color: '#38bdf8' }}>{inspectCard.attribute}</span>
                  </div>
                  <div>
                    <span className="inspect-label">Combat Power</span>
                    <span className="inspect-stat-val" style={{ color: '#f5c84b' }}>+{inspectCard.powerBonus} CP</span>
                  </div>
                </div>
              </div>

              <div className="inspect-actions">
                <button className="btn secondary" onClick={() => setInspectCard(null)}>
                  Close
                </button>
                <button
                  className={`btn ${equippedIds.includes(inspectCard.id) ? 'ghost' : 'primary'}`}
                  onClick={() => {
                    toggleEquip(inspectCard)
                    setInspectCard(null)
                  }}
                >
                  {equippedIds.includes(inspectCard.id) ? 'Unequip Card' : 'Equip to Loadout'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** 3D Interactive Mouse Tilt Card */
function InteractiveSkillCard({
  card,
  isEquipped,
  onToggle,
  onInspect
}: {
  card: SkillCardDef
  isEquipped: boolean
  onToggle: () => void
  onInspect: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [rotateX, setRotateX] = useState(0)
  const [rotateY, setRotateY] = useState(0)
  const [glareX, setGlareX] = useState(50)
  const [glareY, setGlareY] = useState(50)

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const midX = rect.width / 2
    const midY = rect.height / 2

    // Max 14 degree tilt
    const rotX = -((y - midY) / midY) * 14
    const rotY = ((x - midX) / midX) * 14

    setRotateX(rotX)
    setRotateY(rotY)
    setGlareX((x / rect.width) * 100)
    setGlareY((y / rect.height) * 100)
  }

  const handleMouseLeave = () => {
    setRotateX(0)
    setRotateY(0)
    setGlareX(50)
    setGlareY(50)
  }

  return (
    <div
      className="card-3d-wrapper"
      style={{ perspective: 1000 }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <motion.div
        ref={cardRef}
        className={`skill-card-item ${card.rarity} ${isEquipped ? 'equipped' : ''}`}
        animate={{ rotateX, rotateY }}
        transition={{ type: 'spring', stiffness: 350, damping: 25 }}
        onClick={onInspect}
      >
        {/* Holographic foil glare layer */}
        <div
          className="card-holographic-foil"
          style={{
            background: `radial-gradient(circle at ${glareX}% ${glareY}%, rgba(255, 255, 255, 0.28) 0%, rgba(0, 242, 254, 0.15) 30%, transparent 70%)`
          }}
        />

        {/* Card Header */}
        <div className="card-top-row">
          <span className="card-attr-badge">{card.attribute}</span>
          <span className={`card-rarity-pill ${card.rarity}`}>{card.rarity}</span>
        </div>

        {/* Card Emblem */}
        <div className="card-emblem-wrap">
          <span className="card-emblem-icon">{card.icon}</span>
        </div>

        {/* Card Title & Content */}
        <div className="card-content-wrap">
          <h4 className="card-title">{card.name}</h4>
          <p className="card-tagline">{card.tagline}</p>
          <p className="card-effect-preview">{card.effect}</p>
        </div>

        {/* Card Footer */}
        <div className="card-footer-row">
          <span className="card-cp-tag">+{card.powerBonus} CP</span>
          <button
            className={`card-equip-btn ${isEquipped ? 'equipped' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            {isEquipped ? 'Equipped ✓' : '+ Equip'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
