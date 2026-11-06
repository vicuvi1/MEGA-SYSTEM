// Your healthy day on the island (HD): the small ring on the pill, the
// Healthy day card on the Day page (water, moves, breaks, sleep, the streak
// and the daily bonus), the evening "how did your body do" line, Sunday's
// weekly card and wind-down mode. The numbers come from the app window
// (core/healthyDay.ts); nothing here keeps data of its own.
import { healthyHeadline, healthySegments, type HealthyView, type WeeklyHealth, type WindDownMode } from '@core/healthyDay'
import type { IslandAction } from '@core/islandModel'
import { bedClock } from '@core/islandModel'
import { barFill } from './motionKit'
import { tp } from './islandTap'
import './island-health.css'

/** The score as a colour: green when all four are done, warm while on the way. */
const tone = (h: HealthyView) => (h.met === 4 ? 'all' : h.score >= 60 ? 'good' : 'low')

/** The pill's small ring: today's healthy score (hover says what's left). */
export function HealthBadge({ health }: { health: HealthyView | null | undefined }) {
  if (!health) return null
  const r = 7
  const c = 2 * Math.PI * r
  const left = health.parts.filter((p) => !p.done).map((p) => p.label.toLowerCase())
  return (
    <span className={`hd-badge hd-${tone(health)}`} title={`Healthy day: ${health.met} of 4 complete, ${health.score}% overall${left.length ? ` · left: ${left.join(', ')}` : ' · all four done'}${health.streak > 1 ? ` · ${health.streak}-day streak` : ''}`} aria-label={`Healthy day ${health.met} of 4`}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <circle cx="9" cy="9" r={r} className="hd-ring-bg" />
        <circle cx="9" cy="9" r={r} className="hd-ring" strokeDasharray={c} strokeDashoffset={c * (1 - health.score / 100)} transform="rotate(-90 9 9)" />
      </svg>
      {health.met === 4 && <small aria-hidden>💚</small>}
    </span>
  )
}

/**
 * The ring: four segments (water, moves, breaks, sleep), each filled by its
 * own progress, so a half-done water shows as half a segment and the middle
 * says how many of the four are complete.
 */
export function HealthRing({ health }: { health: HealthyView }) {
  const r = 21
  const c = 2 * Math.PI * r
  const gap = 9
  const seg = c / 4 - gap
  return (
    <span className="hd-score" role="img" aria-label={`${health.met} of 4 complete, ${health.score}% overall`}>
      <svg viewBox="0 0 52 52" aria-hidden>
        {healthySegments(health.parts).map((p, i) => (
          <g key={p.id} transform={`rotate(${-90 + i * 90 + (gap / c) * 180} 26 26)`}>
            <circle cx="26" cy="26" r={r} className="hd-seg-bg" strokeDasharray={`${seg} ${c}`} />
            {p.fill > 0 && <circle cx="26" cy="26" r={r} className={`hd-seg ${p.done ? 'done' : ''}`} strokeDasharray={`${seg * p.fill} ${c}`} />}
          </g>
        ))}
      </svg>
      <b>{health.met}</b>
      <small>/4</small>
    </span>
  )
}

/** The Day page's Healthy day card: four parts, the count, overall progress, the streak, the bonus, and the evening line. */
export function HealthCard({ health, evening }: { health: HealthyView; evening: boolean }) {
  const t = tone(health)
  return (
    <section className={`hd-card hd-${t}`} aria-label="Healthy day">
      <div className="hd-top">
        <HealthRing health={health} />
        <div className="hd-title">
          <b>Healthy day</b>
          <small>
            {healthyHeadline(health)}
            {health.streak > 1 ? ` · 🔥 ${health.streak} days` : ''}
          </small>
        </div>
      </div>
      <ul className="hd-parts">
        {health.parts.map((p) => (
          <li key={p.id} className={p.done ? 'done' : ''}>
            <span className="hd-ico" aria-hidden>{p.done ? '✓' : p.icon}</span>
            <span className="hd-label">
              <b>{p.label}</b>
              <small>{p.text}</small>
            </span>
            <span className="pbar hd-bar" aria-hidden>
              <i style={barFill(p.pct)} />
            </span>
          </li>
        ))}
      </ul>
      {evening && <p className="hd-line">{health.line}</p>}
    </section>
  )
}

/** Sunday's card: the week for your body. */
export function WeekHealthCard({ week }: { week: WeeklyHealth }) {
  return (
    <section className="hd-card hd-week" aria-label="Your body this week">
      <div className="hd-title">
        <b>🩺 Your body this week</b>
        <small>{week.healthyDays} healthy day{week.healthyDays === 1 ? '' : 's'} of 7</small>
      </div>
      <ul className="hd-week-lines">
        {week.lines.slice(0, 3).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Wind-down mode (bedtime − 60 min): the countdown, "close the laptop",
 * calm music if you want it, and Going to bed. After bedtime: firmer, no music.
 */
export function WindDownCard({ mode, tap, playing }: { mode: WindDownMode; tap: (a: IslandAction, label?: string) => void; playing: boolean }) {
  const late = mode.phase === 'late'
  return (
    <section className={`hd-wind ${late ? 'late' : ''}`} aria-label="Wind-down">
      <span className="hd-moon" aria-hidden>🌙</span>
      <div className="hd-wind-mid">
        <b>{late ? mode.title : `Bed in ${bedClock(mode.minutes)}`}</b>
        <small>{mode.line}</small>
      </div>
      <div className="hd-wind-acts di-actions">
        {mode.music && !playing && (
          <button type="button" {...tp('wind:music', () => tap({ kind: 'calmMusic' }, '🎵 Calm music'))}>
            🎵 Calm music
          </button>
        )}
        <button type="button" className="primary" {...tp('wind:bed', () => tap({ kind: 'bed' }, '🌙 Going to bed'))}>
          🌙 Going to bed
        </button>
      </div>
    </section>
  )
}
