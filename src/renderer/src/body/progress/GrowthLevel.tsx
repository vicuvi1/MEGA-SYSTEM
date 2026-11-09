// Growth level: the bar (XP inside the level), "next level: what to do", the
// level history with dates, a calm celebration when a new level shows for the
// first time on this device (no motion with "reduce motion"), and the small
// chip for the Body header and Today. No points: levels are earned only from
// real progress logged at the time (core/growthLevels.ts).
import { useEffect, useState } from 'react'
import { LEVELS, newLevel, XP, type GrowthLevel } from '@core/growthLevels'
import { openTab } from '../../PageTabs'
import { markSeen, seenLevel, useGrowth } from './useGrowth'
import './growth.css'

const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function LevelCard({ level }: { level: GrowthLevel }) {
  const [party, setParty] = useState<{ name: string; day: string } | null>(null)
  useEffect(() => {
    const seen = seenLevel()
    const n = newLevel(level, seen)
    if (n) setParty({ name: n.name, day: n.day })
    if (seen == null || level.index > seen) markSeen(level.index)
  }, [level.index])
  const pct = Math.round(level.progress * 100)
  const recent = [...level.events].reverse().slice(0, 4)
  return (
    <section className="card bpg-card gr-level" aria-label="Growth level">
      <header className="bpg-head">
        <div>
          <p className="bpg-eyebrow">Growth level {level.index + 1} of {LEVELS.length}</p>
          <h2 className="gr-level-name">{level.name}</h2>
          <p className="bpg-sub">{level.line}</p>
        </div>
        <span className="gr-xp">
          <b>{level.xp.toLocaleString('en-US')}</b> XP
        </span>
      </header>
      <div className="gr-bar-wrap">
        <div className="gr-lbar" role="progressbar" aria-label={level.next ? `Progress to ${level.next.name}` : 'Top level'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ transform: `scaleX(${level.progress.toFixed(3)})` }} />
        </div>
        <p className="bpg-foot">{level.next ? `${level.toNext.toLocaleString('en-US')} XP to ${level.next.name}` : 'Top level reached. Keep building.'}</p>
      </div>
      {level.next && level.steps.length > 0 && (
        <div className="gr-next">
          <h3>Next level: what to do</h3>
          <ul>
            {level.steps.map((s) => (
              <li key={s.kind}>
                <span>{s.text}</span>
                <b>+{s.xp} XP</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      {recent.length > 0 && (
        <div className="gr-recent">
          <h3>Latest milestones</h3>
          <ul>
            {recent.map((e, i) => (
              <li key={`${e.day}-${e.kind}-${i}`}>
                <time dateTime={e.day}>{dayLabel(e.day)}</time>
                <span>{e.text}</span>
                <b>+{e.xp}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="gr-history">
        <summary>Level history and how XP is earned</summary>
        <ol className="gr-timeline">
          {level.history.map((h) => (
            <li key={h.index} className={h.index === level.index ? 'now' : ''}>
              <b>{h.name}</b>
              <time dateTime={h.day}>{dayLabel(h.day)}</time>
            </li>
          ))}
          {level.next && (
            <li className="next">
              <b>{level.next.name}</b>
              <span>next</span>
            </li>
          )}
        </ol>
        <ul className="gr-rules">
          <li>Each +0.5 kg on the weekly average with your waist in check: +{XP.lean}</li>
          <li>Each roadmap level-up: +{XP.roadmap}</li>
          <li>Strength score +5%: +{XP.strength}</li>
          <li>A week with every planned session: +{XP.week}</li>
          <li>7 days in a row at your protein goal: +{XP.protein}</li>
          <li>A month with 12+ sessions: +{XP.month}</li>
          <li>A week with 5 nights of 7 h+: +{XP.sleep}</li>
        </ul>
        <p className="bpg-foot">Only logs made on the day (or the day after) count. Imports and back-dated logs show in the charts but never move your level. Levels pay no points.</p>
      </details>
      {party && (
        <div className="gr-party" role="dialog" aria-modal="false" aria-label={`New growth level: ${party.name}`}>
          <div className="gr-party-card">
            <p className="bpg-eyebrow">New growth level</p>
            <p className="gr-party-name">{party.name}</p>
            <p className="bpg-sub">Reached {dayLabel(party.day)}. Earned from real work.</p>
            <button className="btn primary" onClick={() => setParty(null)} autoFocus>
              Nice
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/** The small level chip (Body header, Today). Opens Body → Growth. */
export function GrowthChip({ where }: { where: 'body' | 'today' }) {
  const g = useGrowth()
  if (!g) return null
  const l = g.level
  return (
    <button className={`gr-chip gr-chip-${where}`} onClick={() => openTab('body', 'growth')} title={`Growth level ${l.index + 1}: ${l.name}. ${l.next ? `${l.toNext} XP to ${l.next.name}.` : ''} Open Body → Growth`} aria-label={`Growth level ${l.name}, open Growth`}>
      <i className="gr-chip-ring" style={{ ['--p' as any]: `${Math.round(l.progress * 100)}%` }} aria-hidden="true" />
      <span>{l.name}</span>
    </button>
  )
}
