import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useWater } from './water'
import { dayKey } from '@core/dates'
import { findExercise, readSport, updateSport } from './sportTrack'
import type { BodyState, Summary } from '@shared/api'
import { life } from './bridge'
import { triggerRpgPopup } from './RpgFloatingPopups'
import { soundCoin, soundSuccess } from './sound'
import type { PageId } from './modules'

interface Props {
  body: BodyState | null
  summary: Summary
  onRefresh: () => void
  onGo: (p: PageId) => void
}

export function SoloDailyQuestBanner({ body, summary, onRefresh, onGo }: Props) {
  // The one shared water log (water.ts), not a counter of its own.
  const water = useWater()
  const waterMl = water.ml
  const waterTarget = water.target

  const todayKey = dayKey(new Date(), undefined, 0)

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
        // The shared water log and its one goal, not Sport Track's local copy (N3).
        current: waterMl,
        target: waterTarget,
        unit: 'ml'
      }
    ]
  }, [sportState, doneMap, waterMl, waterTarget])

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
      void water.add(addedMl)

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
    [water, onRefresh]
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
      })
      if (data) setSportState(data)
    }

    const itemsToLog = []
    for (const obj of objectives) {
      if (obj.id === 'water') {
        if (obj.target > waterMl) void water.add(obj.target - waterMl)
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
    <section className={`card reps ${allCompleted ? 'all-done' : ''}`} aria-label="Reps and water today">
      <header className="card-head">
        <h2>Reps & water</h2>
        {!allCompleted ? (
          <button className="btn small ghost" onClick={handleCompleteAll} title="Log everything that's left">
            Mark all done
          </button>
        ) : (
          <span className="chip ok">All done ✓</span>
        )}
      </header>
      <ul className="reps-list">
        {objectives.map((obj) => {
          const isDone = obj.current >= obj.target
          const pct = Math.min(100, Math.round((obj.current / obj.target) * 100))
          const water = obj.id === 'water'
          const steps = water ? [250, 500] : [10, 25]
          const log = (e: React.MouseEvent, n: number) => (water ? handleQuickLogWater(e, n) : handleQuickLogWorkout(e, obj.id, obj.name, n))
          return (
            <li key={obj.id} className={isDone ? 'done' : ''}>
              <div className="reps-top">
                <span className="reps-name">
                  {obj.icon} {obj.name}
                </span>
                <span className="reps-stat">
                  {obj.current}/{obj.target} {obj.unit}
                </span>
              </div>
              <div className="reps-bar">
                <i style={{ width: `${pct}%` }} />
              </div>
              {!isDone && (
                <div className="reps-btns">
                  {steps.map((n) => (
                    <button key={n} className="chip" onClick={(e) => log(e, n)} title={water ? `Log +${n} ml` : `Log +${n} reps`}>
                      +{n}
                      {water ? 'ml' : ''}
                    </button>
                  ))}
                  <button className="chip on" onClick={(e) => log(e, Math.max(1, obj.target - obj.current))} title="Log what's left">
                    ✓ All
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
