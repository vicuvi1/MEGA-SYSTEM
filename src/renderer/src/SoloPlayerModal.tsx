import React, { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Summary } from '@shared/api'
import type { PageId } from './modules'
import { soundSystemOracle, soundMechanicalClick } from './sound'
import { Icon } from './Icon'
import { RadarChart } from './RadarChart'
import { HunterSkillCards } from './HunterSkillCards'

export interface SoloPlayerModalProps {
  open: boolean
  onClose: () => void
  summary: Summary | null
  onGo: (page: PageId) => void
}

export function SoloPlayerModal({ open, onClose, summary, onGo }: SoloPlayerModalProps) {
  const [modalTab, setModalTab] = useState<'status' | 'cards'>('status')
  useEffect(() => {
    if (open) {
      soundSystemOracle()
    }
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !summary || !summary.level) return null

  const lv = summary.level
  const attrs = lv.attributes
  const xpPct = Math.min(100, Math.max(2, Math.round(lv.progress * 100)))
  const xpNeeded = Math.max(0, lv.xpForNext - lv.xpIntoLevel)

  const handleGo = (page: PageId) => {
    soundMechanicalClick()
    onGo(page)
    onClose()
  }

  return (
    <AnimatePresence>
      <div className="solo-modal-backdrop" onClick={onClose}>
        <motion.div
          className="solo-system-window player-status-window"
          onClick={(e) => e.stopPropagation()}
          initial={{ scale: 0.88, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 10 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          style={{ maxWidth: '720px', width: '94%' }}
        >
          {/* Cybernetic Corner Brackets & Scanlines */}
          <div className="solo-corner-bottom-left" />
          <div className="solo-corner-bottom-right" />
          <div className="solo-scanline" />
          <div className="solo-grid-bg" />

          {/* Floating Energy Particles */}
          <div className="solo-mote-particle" style={{ top: '20%', left: '10%', animationDelay: '0s' }} />
          <div className="solo-mote-particle" style={{ top: '70%', right: '15%', animationDelay: '1.4s' }} />
          <div className="solo-mote-particle" style={{ top: '45%', right: '8%', animationDelay: '2.3s' }} />

          {/* Header Tag */}
          <div className="solo-window-top">
            <div className="solo-system-header-tag">
              <span className="solo-pulse-beacon" />
              <span>[ THE SYSTEM: HUNTER STATUS WINDOW ]</span>
            </div>
            <span className="solo-system-code">ID-SYS://AWAKEN-001</span>
          </div>

          {/* Title & Motivational Tag */}
          <h2 className="solo-main-title" style={{ fontSize: '24px' }}>
            <span>⚡</span>
            <span>YOUR POWER GROWS</span>
          </h2>
          <div className="solo-quest-name" style={{ color: '#00d2ff', marginBottom: '14px' }}>
            HUNTER ASCENT IN PROGRESS · REALITY IS THE DUNGEON
          </div>

          <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#94a3b8', lineHeight: '1.5' }}>
            Every habit executed, every workout pushed, and every study block conquered directly powers your Hunter Attributes and elevates your Combat Power.
          </p>

          {/* Modal Tab Switcher */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              className={`btn small ${modalTab === 'status' ? 'primary' : 'secondary'}`}
              style={{ fontWeight: 800, padding: '7px 16px', borderRadius: '8px' }}
              onClick={() => {
                soundMechanicalClick()
                setModalTab('status')
              }}
            >
              ⚡ Status Window & Radar
            </button>
            <button
              className={`btn small ${modalTab === 'cards' ? 'primary' : 'secondary'}`}
              style={{ fontWeight: 800, padding: '7px 16px', borderRadius: '8px' }}
              onClick={() => {
                soundMechanicalClick()
                setModalTab('cards')
              }}
            >
              🃏 Tactical Skill Cards Loadout
            </button>
          </div>

          {modalTab === 'cards' ? (
            <HunterSkillCards walletBalance={summary.balance} />
          ) : (
            <>
          {/* Hunter Primary Profile Card */}
          <div
            style={{
              background: 'rgba(0, 0, 0, 0.45)',
              border: '1px solid rgba(0, 210, 255, 0.28)',
              borderRadius: '10px',
              padding: '16px 18px',
              marginBottom: '16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div
                style={{
                  width: '50px',
                  height: '50px',
                  borderRadius: '12px',
                  background: `${lv.rankColor}22`,
                  border: `2px solid ${lv.rankColor}`,
                  color: lv.rankColor,
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: '24px',
                  boxShadow: `0 0 16px ${lv.rankColor}55`
                }}
              >
                {lv.rankBadge}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      background: lv.rankColor,
                      color: '#050811',
                      fontSize: '10px',
                      fontWeight: 800,
                      padding: '2px 7px',
                      borderRadius: '4px',
                      letterSpacing: '0.04em'
                    }}
                  >
                    {lv.hunterGrade}
                  </span>
                  <span style={{ fontSize: '16px', fontWeight: 800, color: '#f8fafc' }}>
                    {lv.hunterTitle}
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '14px', color: '#38bdf8' }}>
                    Lv.{lv.level}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '3px' }}>
                  Total Combat Power:{' '}
                  <b style={{ color: '#00d2ff', fontSize: '14px' }}>
                    {attrs.totalCombatPower.toLocaleString()} CP
                  </b>
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>
                Wallet Balance
              </div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#f5c84b' }}>
                🪙 {summary.balance.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Animated Growing XP Bar */}
          <div
            style={{
              background: 'rgba(8, 15, 30, 0.75)',
              border: '1px solid rgba(0, 210, 255, 0.2)',
              borderRadius: '10px',
              padding: '16px',
              marginBottom: '16px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 800, color: '#38bdf8', letterSpacing: '0.06em' }}>
                EXPERIENCE LEVEL PROGRESSION
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: '#cbd5e1' }}>
                {lv.xpIntoLevel} / {lv.xpForNext} XP ({xpPct}%)
              </span>
            </div>

            {/* Glowing animated bar */}
            <div
              style={{
                height: '12px',
                background: 'rgba(0, 0, 0, 0.6)',
                borderRadius: '6px',
                overflow: 'hidden',
                position: 'relative',
                border: '1px solid rgba(0, 210, 255, 0.3)',
                boxShadow: 'inset 0 0 8px rgba(0, 0, 0, 0.8)'
              }}
            >
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${xpPct}%` }}
                transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  height: '100%',
                  background: 'linear-gradient(90deg, #0ea5e9 0%, #00d2ff 70%, #38bdf8 100%)',
                  boxShadow: '0 0 16px rgba(0, 210, 255, 0.8), 0 0 6px #00d2ff',
                  borderRadius: '5px',
                  position: 'relative'
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', fontSize: '11px', color: '#64748b' }}>
              <span>Awakened as {lv.rank}</span>
              <span style={{ color: '#38bdf8' }}>
                {lv.nextRank ? `⚡ ${xpNeeded} XP to ${lv.nextRank.name}` : 'Apex Hunter Rank'}
              </span>
            </div>
          </div>

          {/* Radar Chart & 5 Core Attributes */}
          <div style={{ marginBottom: '16px', background: 'rgba(0, 0, 0, 0.45)', border: '1px solid rgba(0, 210, 255, 0.22)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#38bdf8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Hunter Combat Matrix & Core Attributes
              </span>
              <span style={{ fontSize: '11px', color: '#64748b' }}>5-Point Resonance Chart</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '20px', flexWrap: 'wrap' }}>
              <RadarChart stats={attrs} size={185} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px', flex: 1, minWidth: '260px' }}>
                {[
                  { code: 'STR', val: attrs.str, name: 'Strength', color: '#ff6b8b', hint: 'Workouts' },
                  { code: 'AGI', val: attrs.agi, name: 'Agility', color: '#38bdf8', hint: 'Wake-ups' },
                  { code: 'VIT', val: attrs.vit, name: 'Vitality', color: '#4ade80', hint: 'Sleep' },
                  { code: 'INT', val: attrs.int, name: 'Intelligence', color: '#b892ff', hint: 'Focus' },
                  { code: 'SEN', val: attrs.sen, name: 'Perception', color: '#f5c84b', hint: 'Discipline' }
                ].map((a) => (
                  <div
                    key={a.code}
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '8px',
                      padding: '8px 4px',
                      textAlign: 'center'
                    }}
                  >
                    <div style={{ fontSize: '11px', fontWeight: 900, color: a.color }}>
                      {a.code}
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 800, color: '#f8fafc', margin: '2px 0' }}>
                      {a.val}
                    </div>
                    <div style={{ fontSize: '9px', color: '#64748b' }}>{a.hint}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Allocatable Stat Points Notification Banner */}
          {attrs.unallocatedPoints > 0 && (
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(245, 200, 75, 0.15) 0%, rgba(234, 179, 8, 0.05) 100%)',
                border: '1px solid rgba(245, 200, 75, 0.4)',
                borderRadius: '8px',
                padding: '12px 16px',
                marginBottom: '16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: '0 0 16px rgba(245, 200, 75, 0.15)'
              }}
            >
              <div>
                <b style={{ color: '#f5c84b', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>✨</span> Free Attribute Points: +{attrs.unallocatedPoints} Available
                </b>
                <span style={{ fontSize: '11px', color: '#cbd5e1' }}>
                  Invest in Strength, Agility, Intelligence, Vitality, or Sense.
                </span>
              </div>
              <button
                className="btn small primary"
                onClick={() => handleGo('journey')}
                style={{ background: '#f5c84b', color: '#000', borderColor: '#f5c84b' }}
              >
                Invest Points
              </button>
            </div>
          )}
          </>
          )}

          {/* Action Buttons */}
          <div className="solo-modal-actions">
            <button className="solo-btn ghost" onClick={onClose}>
              Dismiss
            </button>
            <button className="solo-btn primary" onClick={() => handleGo('journey')}>
              <Icon name="trophy" size={14} /> Open Full Hunter Journey
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
