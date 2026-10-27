import React, { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { soundSystemOracle, soundFanfare, soundWarning, soundMechanicalClick } from './sound'

export interface SoloSystemModalProps {
  open: boolean
  onClose: () => void
  type: 'quest-complete' | 'level-up' | 'penalty-warning'
  data?: {
    title?: string
    subtitle?: string
    coins?: number
    xp?: number
    level?: number
    prevLevel?: number
    statPoints?: number
    hunterRank?: string
    hunterTitle?: string
    objectives?: { label: string; done: boolean }[]
    onAction?: () => void
    actionLabel?: string
  }
}

export function SoloSystemModal({ open, onClose, type, data }: SoloSystemModalProps) {
  useEffect(() => {
    if (!open) return
    if (type === 'quest-complete') {
      soundSystemOracle()
    } else if (type === 'level-up') {
      soundFanfare()
    } else if (type === 'penalty-warning') {
      soundWarning()
    }
  }, [open, type])

  if (!open) return null

  const isPenalty = type === 'penalty-warning'

  const handleAction = () => {
    soundMechanicalClick()
    if (data?.onAction) {
      data.onAction()
    }
    onClose()
  }

  return (
    <AnimatePresence>
      <div className="solo-modal-backdrop" onClick={onClose}>
        <motion.div
          className={`solo-system-window ${isPenalty ? 'penalty-mode' : ''}`}
          onClick={(e) => e.stopPropagation()}
          initial={{ scale: 0.88, opacity: 0, y: 14 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 10 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Cybernetic Corner Brackets & Scanline */}
          <div className="solo-corner-bottom-left" />
          <div className="solo-corner-bottom-right" />
          <div className="solo-scanline" />
          <div className="solo-grid-bg" />

          {/* Floating Energy Particles */}
          <div className="solo-mote-particle" style={{ top: '25%', left: '15%', animationDelay: '0s' }} />
          <div className="solo-mote-particle" style={{ top: '65%', right: '20%', animationDelay: '1.2s' }} />
          <div className="solo-mote-particle" style={{ top: '40%', right: '10%', animationDelay: '2.1s' }} />

          {/* Top Header Tag */}
          <div className="solo-window-top">
            <div className="solo-system-header-tag">
              <span className="solo-pulse-beacon" />
              <span>
                {isPenalty
                  ? '[ SYSTEM ALERT: PENALTY IMMINENT ]'
                  : type === 'level-up'
                    ? '[ SYSTEM: HUNTER LEVEL UP ]'
                    : '[ SYSTEM: QUEST ACCOMPLISHED ]'}
              </span>
            </div>
            <span className="solo-system-code">ID-SYS://00-LIFE</span>
          </div>

          {/* Main Title & Subtitle */}
          <h2 className="solo-main-title">
            <span>{isPenalty ? '⚠️' : type === 'level-up' ? '⚡' : '🏆'}</span>
            <span>
              {data?.title ??
                (isPenalty
                  ? 'PENALTY QUEST WARNING'
                  : type === 'level-up'
                    ? 'LEVEL ADVANCEMENT CONFIRMED'
                    : 'DAILY QUEST COMPLETED')}
            </span>
          </h2>

          <div className="solo-quest-name">
            {data?.subtitle ??
              (isPenalty
                ? 'Survival Directive: Conquer Impulses'
                : type === 'level-up'
                  ? `Ascending to Level ${data?.level ?? 1}`
                  : 'Daily Quest: Preparation to Become Strong')}
          </div>

          {/* Objectives Box for Quest Complete */}
          {type === 'quest-complete' && (
            <div className="solo-objectives-box">
              <div style={{ fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 800, color: 'var(--muted)', letterSpacing: '0.12em', marginBottom: 8 }}>
                ACCOMPLISHED OBJECTIVES:
              </div>
              {data?.objectives && data.objectives.length > 0 ? (
                data.objectives.map((obj, i) => (
                  <div key={i} className="solo-objective-row">
                    <div className="solo-obj-left">
                      <span style={{ color: '#00d2ff' }}>[✓]</span>
                      <span>{obj.label}</span>
                    </div>
                    <span className="solo-obj-status">CLEAR</span>
                  </div>
                ))
              ) : (
                <>
                  <div className="solo-objective-row">
                    <div className="solo-obj-left">
                      <span style={{ color: '#00d2ff' }}>[✓]</span>
                      <span>Push-ups / Physical Conditioning</span>
                    </div>
                    <span className="solo-obj-status">CLEAR</span>
                  </div>
                  <div className="solo-objective-row">
                    <div className="solo-obj-left">
                      <span style={{ color: '#00d2ff' }}>[✓]</span>
                      <span>Deep Cognitive Study & Knowledge Block</span>
                    </div>
                    <span className="solo-obj-status">CLEAR</span>
                  </div>
                  <div className="solo-objective-row">
                    <div className="solo-obj-left">
                      <span style={{ color: '#00d2ff' }}>[✓]</span>
                      <span>Real-World Priority Tasks Accomplished</span>
                    </div>
                    <span className="solo-obj-status">CLEAR</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Level Up Stats Box */}
          {type === 'level-up' && (
            <div className="solo-objectives-box" style={{ textAlign: 'center', padding: '20px 14px' }}>
              <div style={{ fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 6 }}>
                HUNTER LEVEL EVOLUTION
              </div>
              <div style={{ fontSize: 32, fontFamily: 'var(--display)', fontWeight: 900, color: '#00d2ff', textShadow: '0 0 20px rgba(0, 210, 255, 0.6)' }}>
                LV {data?.prevLevel ?? (data?.level ? data.level - 1 : 1)} ➔ LV {data?.level ?? 2}
              </div>
              <div style={{ marginTop: 8, fontSize: 13, color: '#fbbf24', fontWeight: 700, fontFamily: 'var(--mono)' }}>
                ✦ +{data?.statPoints ?? 3} Free Stat Points Available for Allocation
              </div>
            </div>
          )}

          {/* Penalty Warning Directive Box */}
          {type === 'penalty-warning' && (
            <div className="solo-objectives-box" style={{ borderColor: 'rgba(244, 63, 94, 0.3)' }}>
              <div style={{ fontSize: 13, color: '#ffc2c8', lineHeight: 1.5 }}>
                Hunter, giving in to urges will trigger cognitive regression and reset your discipline combat rating. Stand firm, activate the Urge Crusher, and conquer your impulses.
              </div>
            </div>
          )}

          {/* Rewards Section */}
          {!isPenalty && (
            <div className="solo-rewards-box">
              <span className="solo-rewards-title">ACQUIRED SYSTEM REWARDS:</span>
              <div className="solo-reward-item">
                <span style={{ color: '#38bdf8' }}>💎</span>
                <span>Full Status Recovery (Mental Clarity & Drive Restored)</span>
              </div>
              {data?.statPoints && data.statPoints > 0 ? (
                <div className="solo-reward-item">
                  <span style={{ color: '#fbbf24' }}>✦</span>
                  <span>+{data.statPoints} Free Attribute Allocation Points</span>
                </div>
              ) : null}
              {data?.coins ? (
                <div className="solo-reward-item">
                  <span style={{ color: '#c8f135' }}>🪙</span>
                  <span>+{data.coins} Gold Coins & +{data.xp ?? 0} XP</span>
                </div>
              ) : null}
            </div>
          )}

          {/* Primary Action Button */}
          <button className="solo-accept-btn" onClick={handleAction}>
            <span>{isPenalty ? '⚡' : '✦'}</span>
            <span>
              {data?.actionLabel ??
                (isPenalty
                  ? 'COMMENCE URGE CRUSHER'
                  : type === 'level-up'
                    ? 'ALLOCATE ATTRIBUTE POINTS'
                    : 'ACCEPT SYSTEM REWARDS')}
            </span>
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
