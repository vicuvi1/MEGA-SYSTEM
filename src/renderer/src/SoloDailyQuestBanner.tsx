import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { findExercise, readSport, updateSport } from './sportTrack'
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

  // Live real-time Sport Track state from shared browser storage
  // (yesterday's reps don't count: readSport starts a new day like Sport Track does)
  const [sportState, setSportState] = useState<any>(() => (typeof localStorage === 'undefined' ? null : readSport()))

  useEffect(() => {
    const syncSport = () => {
      const s = readSport()
      if (s) setSportState(s)
    }
    window.addEventListener('storage', syncSport)
    window.addEventListener('focus', syncSport)
    window.addEventListener('life-body-changed', syncSport)
    window.addEventListener('life-sport-changed', syncSport)
    return () => {
      window.removeEventListener('life-sport-changed', syncSport)
      window.removeEventListener('storage', syncSport)
      window.removeEventListener('focus', syncSport)
      window.removeEventListener('life-body-changed', syncSport)
    }
  }, [])

  // Compute completed reps from body service
  const doneMap = useMemo(() => {
    const map: Record<string, number> = {}
    if (!body?.recentWorkouts) return map
    const todayWorkouts = body.recentWorkouts.filter((w) => w.day === todayKey)
    for (const w of todayWorkouts) {
      for (const it of w.items) {
        const key = (it.exerciseId || it.name || '').toLowerCase()
        map[key] = (map[key] || 0) + it.amount
        // "push-ups" also counts as "pushups" (but "pushups" only once).
        const cleanKey = key.replace(/[^a-z0-9]/g, '')
        if (cleanKey && cleanKey !== key) map[cleanKey] = (map[cleanKey] || 0) + it.amount
      }
    }
    return map
  }, [body?.recentWorkouts, todayKey])

  const objectives = useMemo(() => {
    const exs = sportState?.exercises || []
    const findEx = (key: string) => exs.find((e: any) => (e.id || '').toLowerCase().includes(key) || (e.name || '').toLowerCase().includes(key))

    const pushups = findEx('push')
    const situps = findEx('sit')
    const press = findEx('press')
    const water = sportState?.water

    return [
      {
        id: 'pushups',
        name: 'Push-ups',
        icon: '💪',
        current: Math.max(pushups?.doneToday || 0, doneMap['pushups'] || 0, doneMap['pushup'] || 0),
        target: pushups ? (pushups.target || 123) : 123,
        unit: 'reps'
      },
      {
        id: 'situps',
        name: 'Sit-ups',
        icon: '⚡',
        current: Math.max(situps?.doneToday || 0, doneMap['situps'] || 0, doneMap['situp'] || 0),
        target: situps ? (situps.target || 60) : 60,
        unit: 'reps'
      },
      {
        id: 'press',
        name: 'Press',
        icon: '🏋️',
        current: Math.max(press?.doneToday || 0, doneMap['press'] || 0),
        target: press ? (press.target || 50) : 50,
        unit: 'reps'
      },
      {
        id: 'water',
        name: 'Hydration',
        icon: '💧',
        current: water?.currentMl ?? waterMl,
        target: water?.targetMl ?? 2700,
        unit: 'ml'
      }
    ]
  }, [sportState, doneMap, waterMl])

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

      const data = updateSport((d) => {
        const ex = findExercise(d, objId) ?? findExercise(d, exName)
        if (ex) ex.doneToday = (Number(ex.doneToday) || 0) + amount
      })
      if (data) setSportState(data)

      await life.body.logWorkout({
        title: `${exName} (+${amount})`,
        items: [{ exerciseId: objId, name: exName, amount, unit: 'reps' as any }],
        note: 'Logged from Daily Quest Banner'
      })
      window.dispatchEvent(new CustomEvent('life-body-changed'))
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
        const data = updateSport((d) => {
          if (d.water) d.water.currentMl = nextVal
        })
        if (data) setSportState(data)
      } catch {}

      soundCoin()
      triggerRpgPopup({
        main: `+${addedMl}ml Water`,
        sub: '+5 VIT XP',
        kind: 'xp',
        x: rect.left + rect.width / 2,
        y: rect.top
      })
      window.dispatchEvent(new CustomEvent('life-body-changed'))
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

    if (typeof localStorage !== 'undefined') {
      const data = updateSport((d) => {
        d.exercises?.forEach((x: any) => {
          x.doneToday = Math.max(x.doneToday || 0, x.target || 0)
        })
        if (d.water) d.water.currentMl = Math.max(d.water.currentMl || 0, d.water.targetMl || 2700)
      })
      if (data) setSportState(data)
    }

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
    window.dispatchEvent(new CustomEvent('life-body-changed'))
    onRefresh()
  }, [objectives, waterMl, todayKey, onRefresh])

  return (
    <section className={`solo-daily-quest-banner ${allCompleted ? 'completed' : isUrgent ? 'urgent' : ''}`}>
      {/* Top Header Tag & Countdown */}
      <div className="solo-quest-top-row">
        <div className="solo-quest-tag-badge">
          <span className="solo-pulse-beacon" />
          <span>{allCompleted ? 'Reps & water: all done today ✓' : 'Reps & water today'}</span>
        </div>

        <div className="solo-quest-countdown" hidden>
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
          {allCompleted ? 'Done for today. Rest well.' : 'Tap + after each set. Counts reset at midnight.'}
        </span>

        {!allCompleted && (
          <button className="solo-quest-action-all" onClick={handleCompleteAll}>
            <span>Mark all done</span>
          </button>
        )}
      </div>
    </section>
  )
}
