import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { soundFanfare, soundTick, soundSpend } from './sound'
import type { ChestLootDrop } from '@shared/api'

interface Props {
  level: number
  onClose: () => void
  onOpenDirect: (level: number) => Promise<ChestLootDrop>
}

interface GachaCard {
  id: number
  title: string
  sub: string
  icon: string
  rarity: 'rare' | 'epic' | 'legendary'
  isUserPick?: boolean
}

export function ChestGachaModal({ level, onClose, onOpenDirect }: Props) {
  const [opening, setOpening] = useState(false)
  const [pickedCardId, setPickedCardId] = useState<number | null>(null)
  const [actualDrop, setActualDrop] = useState<ChestLootDrop | null>(null)
  const [revealed, setRevealed] = useState(false)

  // 3 Card Deck Candidates
  const [cards] = useState<GachaCard[]>([
    { id: 1, title: 'Shadow Fortune', sub: 'Abundant Hunter Coins', icon: '🪙', rarity: 'rare' },
    { id: 2, title: 'Monarch Relic', sub: 'Rare Elixir or Shield', icon: '⚡', rarity: 'legendary' },
    { id: 3, title: 'Ancient Rune', sub: 'Skill Upgrade & Multiplier', icon: '🃏', rarity: 'epic' }
  ])

  const handlePickCard = async (cardId: number) => {
    if (opening || pickedCardId !== null) return
    setPickedCardId(cardId)
    setOpening(true)
    soundTick()

    try {
      const drop = await onOpenDirect(level)
      setActualDrop(drop)
      soundFanfare()
      setRevealed(true)
    } catch {
      // fallback
      soundSpend()
      setPickedCardId(null)
      setOpening(false)
    }
  }

  return (
    <div className="chest-gacha-backdrop" onClick={revealed ? onClose : undefined}>
      <motion.div
        className="chest-gacha-modal"
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.82, opacity: 0, y: 30 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.85, opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="gacha-header">
          <div className="gacha-tag-pill">
            <span className="gacha-pulse-dot" />
            <span>[ SYSTEM MYSTERY CHEST · LV.{level} ]</span>
          </div>
          <h2 className="gacha-title">
            {revealed ? '✨ REWARD MANIFESTED' : 'SELECT YOUR FATE'}
          </h2>
          <p className="gacha-sub">
            {revealed
              ? 'The system has bestowed an authentic loot drop for your ascendant growth.'
              : 'Hover and choose one of the three floating cards to draw your dimensional treasure.'}
          </p>
        </div>

        {/* 3 CARDS SELECTION STAGE */}
        <div className="gacha-cards-stage">
          {cards.map((card) => {
            const isPicked = pickedCardId === card.id
            const isFlipped = isPicked && revealed

            return (
              <div
                key={card.id}
                className={`gacha-card-container ${isPicked ? 'picked' : ''} ${isFlipped ? 'flipped' : ''}`}
                onClick={() => !revealed && handlePickCard(card.id)}
              >
                <motion.div
                  className="gacha-card-flipper"
                  animate={{
                    rotateY: isFlipped ? 180 : 0,
                    y: isPicked ? -16 : 0,
                    scale: isPicked ? 1.05 : 1
                  }}
                  transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
                >
                  {/* CARD FRONT (FACEDOWN IN GACHA VIEW) */}
                  <div className={`gacha-card-facedown ${card.rarity}`}>
                    <div className="facedown-border-glow" />
                    <div className="facedown-center-emblem">
                      <span className="facedown-crest">⚔️</span>
                      <span className="facedown-roman">LV.{level}</span>
                    </div>
                    <div className="facedown-scanlines" />
                    <div className="facedown-hover-hint">PICK CARD</div>
                  </div>

                  {/* CARD BACK (REVEALED REWARD VIEW) */}
                  <div className="gacha-card-revealed">
                    <div className="revealed-glow-burst" />
                    <span className="revealed-icon">
                      {actualDrop?.type === 'shield'
                        ? '🛡️'
                        : actualDrop?.type === 'vault_boost'
                        ? '💰'
                        : actualDrop?.type === 'multiplier_24h'
                        ? '⚡'
                        : '🪙'}
                    </span>
                    <span className="revealed-headline">
                      {actualDrop?.label ?? card.title}
                    </span>
                    <span className="revealed-coins">
                      {actualDrop?.type === 'coins'
                        ? `+${actualDrop.value} Coins`
                        : actualDrop?.type === 'shield'
                        ? `+${actualDrop.value} Streak Shield`
                        : actualDrop?.type === 'vault_boost'
                        ? `+${actualDrop.value} Vault Cash`
                        : `+${actualDrop?.value ?? 50} Multiplier`}
                    </span>
                    <p className="revealed-detail">
                      {actualDrop?.description ?? 'Treasure added to your Hunter Wallet!'}
                    </p>
                  </div>
                </motion.div>
              </div>
            )
          })}
        </div>

        {/* CLAIM BUTTON */}
        <AnimatePresence>
          {revealed && (
            <motion.div
              className="gacha-footer-actions"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <button className="btn-gacha-claim" onClick={onClose}>
                <span>Claim Triumph & Proceed</span>
                <span style={{ fontSize: 16 }}>➔</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
