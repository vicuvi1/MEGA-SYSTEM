import { useEffect, useMemo, useState } from 'react'
import { addDays } from '@core/dates'
import { effective } from '@core/ledger'
import { RANKS } from '@core/levels'
import type { LedgerEntry, Rule, Summary } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { MODULE_LABEL, MODULES } from '../modules'
import { Coins, describeEntry } from '../ui'

const COLOR: Record<string, string> = Object.fromEntries(MODULES.map((m) => [m.id, m.color]))
const GOAL_KEY = 'ls.weekGoal'

/** Levels and the weekly review: this week against last week, best day, what slipped. */
export function Journey({ summary, rules }: { summary: Summary; rules: Rule[] }) {
  const [rows, setRows] = useState<LedgerEntry[]>([])
  const [goal, setGoal] = useState(() => {
    try {
      return localStorage.getItem(GOAL_KEY) ?? ''
    } catch {
      return ''
    }
  })
  useEffect(() => {
    life.wallet.history(2000).then(setRows).catch(() => {})
  }, [summary])

  const titles = useMemo(() => Object.fromEntries(rules.map((r) => [r.id, r.title])), [rules])
  const week = useMemo(() => {
    const live = effective(rows.slice().reverse())
    const today = summary.today
    const from = addDays(today, -6)
    const prevFrom = addDays(today, -13)
    const thisWeek = live.filter((e) => e.day >= from && e.day <= today)
    const lastWeek = live.filter((e) => e.day >= prevFrom && e.day < from)
    const earned = (list: LedgerEntry[]) => list.reduce((s, e) => s + Math.max(0, e.coins), 0)
    const byModule: Record<string, number> = {}
    for (const e of thisWeek) if (e.coins > 0) byModule[e.module] = (byModule[e.module] ?? 0) + e.coins
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d) => ({ day: d, coins: earned(thisWeek.filter((e) => e.day === d)) }))
    const best = days.reduce((a, b) => (b.coins > a.coins ? b : a), days[0])
    const slips = thisWeek.filter((e) => e.coins < 0)
    return { earned: earned(thisWeek), last: earned(lastWeek), xp: thisWeek.reduce((s, e) => s + e.xp, 0), byModule, days, best, slips }
  }, [rows, summary.today])

  const max = Math.max(1, ...week.days.map((d) => d.coins))
  const modMax = Math.max(1, ...Object.values(week.byModule))
  const diff = week.earned - week.last
  const lv = summary.level

  return (
    <div className="journey">
      <section className="stats four">
        <div className="stat hero">
          <span className="label">This week</span>
          <div className="big">
            <Coins n={week.earned} />
          </div>
          <span className="sub">{week.last ? `${diff >= 0 ? '+' : ''}${diff} vs last week` : 'Your first week'} · +{week.xp} XP</span>
        </div>
        <div className="stat">
          <span className="label">Best day</span>
          <div className="big small-big">{week.best.coins ? new Date(`${week.best.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' }) : '–'}</div>
          <span className="sub">{week.best.coins} coins</span>
        </div>
        <div className="stat">
          <span className="label">Level</span>
          <div className="big">{lv.level}</div>
          <span className="sub">
            {lv.rank} · {lv.xpForNext - lv.xpIntoLevel} XP to next
          </span>
        </div>
        <div className="stat">
          <span className="label">Slips this week</span>
          <div className="big small-big">{week.slips.length}</div>
          <span className="sub">{week.slips.length ? 'skipped, missed or reset' : 'None. Clean week.'}</span>
        </div>
      </section>

      <div className="cols even">
        <section className="panel">
          <header className="panel-head">
            <h2>Last 7 days</h2>
          </header>
          <div className="week-bars" role="img" aria-label="Coins earned each of the last 7 days">
            {week.days.map((d) => (
              <div key={d.day} className={`wb ${d.day === summary.today ? 'today' : ''}`}>
                <small>{d.coins || ''}</small>
                <i style={{ height: `${Math.max(4, (d.coins / max) * 120)}px` }} />
                <span>{new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <header className="panel-head">
            <h2>Where the coins came from</h2>
          </header>
          {Object.keys(week.byModule).length === 0 ? (
            <div className="empty small-empty">
              <p>No coins this week yet.</p>
            </div>
          ) : (
            <div className="mod-bars">
              {Object.entries(week.byModule)
                .sort((a, b) => b[1] - a[1])
                .map(([m, c]) => (
                  <div key={m} className="mb" style={{ ['--c' as string]: COLOR[m] ?? 'var(--lime)' }}>
                    <span>{MODULE_LABEL[m] ?? (m === 'quests' ? 'Daily quests' : m)}</span>
                    <span className="bar">
                      <i style={{ width: `${(c / modMax) * 100}%` }} />
                    </span>
                    <b>{c}</b>
                  </div>
                ))}
            </div>
          )}
        </section>
      </div>

      <div className="cols even">
        <section className="panel">
          <header className="panel-head">
            <h2>What slipped</h2>
          </header>
          {week.slips.length === 0 ? (
            <div className="empty small-empty">
              <Icon name="shield" size={24} />
              <p>Nothing slipped this week.</p>
            </div>
          ) : (
            <ul className="feed">
              {week.slips.slice(-8).reverse().map((e) => (
                <li key={e.id}>
                  <span className="what">{describeEntry(e, titles)}</span>
                  <span className="when">{e.day}</span>
                  <Coins n={e.coins} sign />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <header className="panel-head">
            <h2>One goal for next week</h2>
          </header>
          <textarea
            className="week-goal"
            value={goal}
            placeholder="e.g. Finish every study block on weekdays"
            maxLength={200}
            onChange={(e) => {
              setGoal(e.target.value)
              try {
                localStorage.setItem(GOAL_KEY, e.target.value)
              } catch {
                // kept until restart
              }
            }}
          />
          <p className="hint block-hint">It shows here every time you open Journey.</p>
        </section>
      </div>

      <section className="panel">
        <header className="panel-head">
          <h2>Ranks</h2>
          <span className="hint">Level up by earning XP. XP never goes down.</span>
        </header>
        <div className="ranks">
          {RANKS.map((r) => (
            <div key={r.name} className={`rank-step ${lv.level >= r.minLevel ? 'reached' : ''} ${lv.rank === r.name ? 'current' : ''}`}>
              <b>{r.name}</b>
              <small>level {r.minLevel}</small>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
