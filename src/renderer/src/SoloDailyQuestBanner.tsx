import React, { useEffect, useState, useMemo, useCallback } from 'react'
import type { BodyState, Summary } from '@shared/api'
import { life } from './bridge'
import { triggerRpgPopup } from './RpgFloatingPopups'
import { soundCoin, soundSuccess } from './sound'
import type { PageId } from './modules'
import './soloDailyQuest.css'

interface Props {
  body: BodyState | null
  summary: Summary
  onRefresh: () => void
  onGo: (p: PageId) => void
}

/**
 * Isolated countdown timer so only this tiny span updates every second,
 * preventing the entire banner from re-rendering every 1000ms.
 */
const QuestCountdownTimer = React.memo(function QuestCountdownTimer({
  isAllCompleted,
  onUrgent
}: {
  isAllCompleted: boolean
  onUrgent?: (urgent: boolean) => void
}) {
  const [timeLeft, setTimeLeft] = useState('')

  useEffect(() => {
    if (isAllCompleted) return

    const updateCountdown = () => {
      const now = new Date()
      const end = new Date(now)
      end.setHours(23, 59, 59, 999)
      const diff = Math.max(0, end.getTime() - now.getTime())
      const hours = Math.floor(diff / (1000 * 60 * 60))
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const secs = Math.floor((diff % (1000 * 60)) / 1000)

      setTimeLeft(
        `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      )
      if (onUrgent) onUrgent(hours < 3)
    }

    updateCountdown()
    const timer = setInterval(updateCountdown, 1000)
    return () => clearInterval(timer)
  }, [isAllCompleted, onUrgent])

  if (isAllCompleted) return <span>REST SECURED</span>
  return <span>{timeLeft} LEFT</span>
})

export function SoloDailyQuestBanner({ body, summary, onRefresh, onGo }: Props) {
  const [isUrgent, setIsUrgent] = useState(false)
  const [waterMl, setWaterMl] = useState<number>(() => {
    try {
      const today = new Date().toISOString().slice(0, 10)
      const saved = localStorage.getItem('ls.hydration')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.date === today) return parsed.ml || 0
      }
    } catch {}
    return 0
  })

  const todayKey = new Date().toISOString().slice(0, 10)

  // Compute completed reps from body service
  const doneMap = useMemo(() => {
    const map: Record<string, number> = {}
    if (!body?.recentWorkouts) return map
    const todayWorkouts = body.recentWorkouts.filter((w) => w.day === todayKey)
    for (const w of todayWorkouts) {
      for (const it of w.items) {
        const key = (it.exerciseId || it.name || '').toLowerCase()
        map[key] = (map[key] || 0) + it.amount
        const cleanKey = key.replace(/[^a-z0-9]/g, '')
        if (cleanKey) map[cleanKey] = (map[cleanKey] || 0) + it.amount
      }
    }
    return map
  }, [body?.recentWorkouts, todayKey])

  const objectives = useMemo(
    () => [
      {
        id: 'pushups',
        name: 'Push-ups',
        icon: '💪',
        current: doneMap['pushups'] || 0,
        target: 123,
        unit: 'reps'
      },
      {
        id: 'situps',
        name: 'Sit-ups',
        icon: '⚡',
        current: doneMap['situps'] || 0,
        target: 60,
        unit: 'reps'
      },
      {
        id: 'press',
        name: 'Press',
        icon: '🏋️',
        current: doneMap['press'] || 0,
        target: 50,
        unit: 'reps'
      },
      {
        id: 'water',
        name: 'Hydration',
        icon: '💧',
        current: waterMl,
        target: 2700,
        unit: 'ml'
      }
    ],
    [doneMap, waterMl]
  )

  const allCompleted = useMemo(() => objectives.every((o) => o.current >= o.target), [objectives])

  const handleQuickLogWorkout = useCallback(
    async (e: React.MouseEvent, objId: string, exName: string, amount: number) => {
      const rect = e.currentTarget.getBoundingClientRect()
      soundCoin()
      triggerRpgPopup({
        main: `+${amount} ${exName}`,
        sub: '+10 STR XP',
        kind: 'xp',
        x: rect.left + rect.width / 2,
        y: rect.top
      })

      await life.body.logWorkout({
        title: `${exName} (+${amount})`,
        items: [{ exerciseId: objId, name: exName, amount, unit: 'reps' as any }],
        note: 'Logged from Daily Quest Banner'
      })
      onRefresh()
    },
    [onRefresh]
  )

  const handleQuickLogWater = useCallback(
    (e: React.MouseEvent, addedMl: number) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const nextVal = waterMl + addedMl
      setWaterMl(nextVal)
      try {
        localStorage.setItem('ls.hydration', JSON.stringify({ date: todayKey, ml: nextVal }))
      } catch {}

      soundCoin()
      triggerRpgPopup({
        main: `+${addedMl}ml Water`,
        sub: '+5 VIT XP',
        kind: 'xp',
        x: rect.left + rect.width / 2,
        y: rect.top
      })
      onRefresh()
    },
    [waterMl, todayKey, onRefresh]
  )

  const handleCompleteAll = useCallback(async () => {
    soundSuccess()
    triggerRpgPopup({
      main: 'QUEST COMPLETE!',
      sub: '+50 Gold · +100 XP',
      kind: 'gold'
    })

    const itemsToLog = []
    for (const obj of objectives) {
      if (obj.id === 'water') {
        const nextVal = Math.max(waterMl, obj.target)
        setWaterMl(nextVal)
        try {
          localStorage.setItem('ls.hydration', JSON.stringify({ date: todayKey, ml: nextVal }))
        } catch {}
      } else {
        const diff = Math.max(0, obj.target - obj.current)
        if (diff > 0) {
          itemsToLog.push({ exerciseId: obj.id, name: obj.name, amount: diff, unit: 'reps' as any })
        }
      }
    }

    if (itemsToLog.length > 0) {
      await life.body.logWorkout({
        title: 'Daily Quest: All Directives Completed',
        items: itemsToLog,
        note: 'Completed all physical directives via Solo Quest banner'
      })
    }
    onRefresh()
  }, [objectives, waterMl, todayKey, onRefresh])

  return (
    <section className={`solo-daily-quest-banner ${allCompleted ? 'completed' : isUrgent ? 'urgent' : ''}`}>
      {/* Top Header Tag & Countdown */}
      <div className="solo-quest-top-row">
        <div className="solo-quest-tag-badge">
          <span className="solo-pulse-beacon" />
          <span>
            {allCompleted
              ? '✨ [ DAILY QUEST CLEARED: ALL OBJECTIVES ACCOMPLISHED ]'
              : '[ DAILY QUEST: PREPARING TO BECOME STRONGER ]'}
          </span>
        </div>

        <div className="solo-quest-countdown" title="Time until midnight penalty check">
          <span>⏱️</span>
          <QuestCountdownTimer isAllCompleted={allCompleted} onUrgent={setIsUrgent} />
        </div>
      </div>

      {/* 4 Objectives Grid */}
      <div className="solo-quest-grid">
        {objectives.map((obj) => {
          const isDone = obj.current >= obj.target
          const pct = Math.min(100, Math.round((obj.current / obj.target) * 100))

          return (
            <div key={obj.id} className={`solo-quest-item ${isDone ? 'done' : ''}`}>
              <div className="solo-quest-item-head">
                <span className="solo-quest-item-name">
                  <span>{obj.icon}</span>
                  <span>{obj.name}</span>
                </span>
                <span className="solo-quest-item-stat">
                  {obj.current} / {obj.target} {obj.unit}
                </span>
              </div>

              <div className="solo-quest-bar-bg">
                <div className="solo-quest-bar-fill" style={{ width: `${pct}%` }} />
              </div>

              <div className="solo-quest-btn-row">
                {obj.id === 'water' ? (
                  <>
                    <button
                      className="solo-quest-mini-btn"
                      onClick={(e) => handleQuickLogWater(e, 250)}
                      title="Log +250ml"
                    >
                      +250ml
                    </button>
                    <button
                      className="solo-quest-mini-btn"
                      onClick={(e) => handleQuickLogWater(e, 500)}
                      title="Log +500ml"
                    >
                      +500ml
                    </button>
                    <button
                      className="solo-quest-mini-btn primary"
                      onClick={(e) => handleQuickLogWater(e, Math.max(0, obj.target - obj.current))}
                      title="Hit full 2.7L target"
                    >
                      ⚡ Max
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="solo-quest-mini-btn"
                      onClick={(e) => handleQuickLogWorkout(e, obj.id, obj.name, 10)}
                      title="Log +10 reps"
                    >
                      +10
                    </button>
                    <button
                      className="solo-quest-mini-btn"
                      onClick={(e) => handleQuickLogWorkout(e, obj.id, obj.name, 25)}
                      title="Log +25 reps"
                    >
                      +25
                    </button>
                    <button
                      className="solo-quest-mini-btn primary"
                      onClick={(e) =>
                        handleQuickLogWorkout(e, obj.id, obj.name, Math.max(1, obj.target - obj.current))
                      }
                      title="Log remaining reps"
                    >
                      ⚡ Max
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer warning & Full completion action */}
      <div className="solo-quest-footer">
        <span className="solo-quest-warning-text">
          {allCompleted
            ? '★ Reward: Physical recovery granted. Strength, Agility and Vitality stats boosted.'
            : 'Failure to complete daily directives before midnight triggers System Penalty Zone.'}
        </span>

        {!allCompleted && (
          <button className="solo-quest-action-all" onClick={handleCompleteAll}>
            <span>⚡ Complete All Objectives</span>
          </button>
        )}
      </div>
    </section>
  )
}
