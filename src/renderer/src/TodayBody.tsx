// Today → Body: the Healthy day ring (water, moves, screen breaks, bed on
// time) and last night's sleep, above Reps & water. Read only: the ring never
// pays here (the island's healthTick does, once, for what you really logged),
// and each number shows once: water in Reps & water, bedtime in the sleep card.
import { useCallback, useEffect, useState } from 'react'
import { healthyHeadline, sleptOnTime, type HealthyView } from '@core/healthyDay'
import type { SleepSummary } from '@core/sleep'
import { life } from './bridge'
import { useLive } from './live'
import { HealthRing } from './IslandHealth'
import { healthPeek } from './islandNudgesFeed'
import { WATER_TARGET_ML } from '@core/defaults'

const hm = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? ` ${Math.round(min % 60)}m` : ''}`

const EVENTS = ['life-water-changed', 'life-body-changed', 'life-sport-changed', 'life-sleep-changed', 'life-external-changed']

/** Today's healthy-day count (Body tab badge and card), refreshed when water, moves or sleep change. */
export function useHealthyToday(): { health: HealthyView | null; sleep: SleepSummary | null } {
  const [health, setHealth] = useState<HealthyView | null>(null)
  const [sleep, setSleep] = useState<SleepSummary | null>(null)
  const load = useCallback(() => {
    void (async () => {
      const [st, sl] = await Promise.all([life.coach?.status?.().catch(() => null) ?? null, life.sleep?.state().catch(() => null) ?? null])
      setSleep(sl as SleepSummary | null)
      const bedTarget = sl?.todayLog?.bedTarget ?? sl?.recentLogs?.find((l) => l.bedTarget)?.bedTarget ?? '23:00'
      const water = { ml: st?.today.waterMl ?? 0, target: st?.today.waterTarget || WATER_TARGET_ML }
      const h = await healthPeek(Date.now(), water, sleptOnTime(sl?.todayLog, bedTarget)).catch(() => null)
      setHealth(h)
    })()
  }, [])
  useEffect(() => {
    load()
    for (const e of EVENTS) window.addEventListener(e, load)
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, load)
    }
  }, [load])
  useLive(load)
  return { health, sleep }
}

export function HealthyToday({ health }: { health: HealthyView | null }) {
  if (!health) return null
  const tone = health.met === 4 ? 'all' : health.score >= 60 ? 'good' : 'low'
  // Water and bedtime have their numbers in their own cards; here only done / not yet.
  const where: Record<string, string> = { water: 'log it in Reps & water', sleep: 'see Sleep' }
  return (
    <section className={`card tb-health hd-${tone}`} aria-label="Healthy day">
      <HealthRing health={health} />
      <div className="tb-health-mid">
        <b>Healthy day</b>
        <small>
          {healthyHeadline(health)}
          {health.streak > 1 ? ` · 🔥 ${health.streak} days` : ''}
        </small>
        <ul className="tb-parts">
          {health.parts.map((p) => (
            <li key={p.id} className={p.done ? 'done' : ''} title={p.text}>
              <span aria-hidden>{p.done ? '✓' : p.icon}</span>
              <b>{p.label}</b>
              <small>{p.done ? 'done' : where[p.id] ?? p.text}</small>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function SleepToday({ sleep, onOpen }: { sleep: SleepSummary | null; onOpen: () => void }) {
  if (!sleep) return null
  const log = sleep.todayLog
  return (
    <section className="card tb-sleep" aria-label="Sleep">
      <header className="card-head">
        <h2>🌙 Sleep</h2>
        <button className="btn small ghost" onClick={onOpen}>
          Open Sleep
        </button>
      </header>
      <div className="tb-sleep-row">
        <span className={log?.wakeTime ? (log.onTime ? 'good' : 'late') : ''}>
          <small>Up today</small>
          <b>{log?.wakeTime ?? '—'}</b>
          <small>{log?.wakeTime ? `goal ${log.wakeTarget}${log.onTime ? ' · on time' : ''}` : 'not logged yet'}</small>
        </span>
        <span className={log?.bedTime ? (log.bedOnTime ? 'good' : 'late') : ''}>
          <small>Bed last night</small>
          <b>{log?.bedTime ?? '—'}</b>
          <small>{log?.bedTime ? `goal ${log.bedTarget ?? sleep.bedTarget ?? '23:00'}${log.bedOnTime ? ' · on time' : ''}` : 'not logged'}</small>
        </span>
        <span>
          <small>Wake-up streak</small>
          <b>{sleep.streak}</b>
          <small>{sleep.avgSleepMin ? `about ${hm(sleep.avgSleepMin)} a night` : `best ${sleep.bestStreak}`}</small>
        </span>
      </div>
    </section>
  )
}
