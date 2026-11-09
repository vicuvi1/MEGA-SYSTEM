// Body → Growth: "how much am I growing" for the long run. A hero ("You since
// you started": lean mass estimate, weight, waist, strength, harder moves,
// sessions, protein-goal days) with a period switch, the honest growth level,
// a lean-gain check per month, long-run weekly charts (weight in the target
// corridor, waist, strength per muscle group, sessions vs plan, protein, kcal,
// sleep, fat % and muscle as estimates), quick logging, what's missing, and
// one row per month with Copy CSV. Reads only; pays no points.
import { useMemo, useState } from 'react'
import { corridor, leanChecks, monthlyRows, PERIODS, periodFrom, periodStats, planPerWeek, rowsCsv, strengthIndex, weeklySeries, whatsMissing, type Missing, type Period } from '@core/growthBody'
import { levelOn } from '@core/growthLevels'
import { MUSCLES } from '@core/sportSets'
import { proteinGoal } from '@core/protein'
import { openTab } from '../../PageTabs'
import { useBodyLogSheet } from '../BodyLogSheet'
import { BarsChart, LineChart } from './GrowthCharts'
import { LevelCard } from './GrowthLevel'
import { useGrowth } from './useGrowth'
import './progress.css'
import './growth.css'

const PKEY = 'life_growth_period'
const readPeriod = (): Period => {
  try {
    const v = localStorage.getItem(PKEY) as Period | null
    return v && PERIODS.some((p) => p.id === v) ? v : 'all'
  } catch {
    return 'all'
  }
}
const sgn = (n: number, unit: string, d = 1) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(d)}${unit}`
const monthName = (ym: string) => new Date(`${ym}-15T12:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
const MUSCLE_CLS: Record<string, string> = { push: 's1', pull: 's2', legs: 's3', core: 's4' }

function openPhoto() {
  openTab('body', 'progress')
  setTimeout(() => {
    const more = document.querySelector<HTMLDetailsElement>('#ptp-body-progress details.bpg-more')
    if (more) {
      more.open = true
      more.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }
  }, 120)
}

export function GrowthTab({ onLog, lastWeight }: { onLog: () => void; lastWeight: number | null }) {
  const g = useGrowth()
  const [period, setPeriodRaw] = useState<Period>(readPeriod)
  const [copied, setCopied] = useState(false)
  const bodyLog = useBodyLogSheet(onLog, lastWeight)
  const setPeriod = (p: Period) => {
    setPeriodRaw(p)
    try {
      localStorage.setItem(PKEY, p)
    } catch {
      /* private window */
    }
  }
  const idx = useMemo(() => (g ? strengthIndex(g.input.sport?.sets, Array.isArray(g.input.sport?.exercises) ? g.input.sport.exercises : []) : null), [g])
  const view = useMemo(() => {
    if (!g || !idx) return null
    const from = periodFrom(g.input, period)
    const weeks = weeklySeries(g.input, from, idx)
    return {
      stats: periodStats(g.input, period, idx),
      weeks,
      corr: corridor(weeks),
      checks: leanChecks(g.input, idx).reverse(),
      rows: monthlyRows(g.input, (d) => levelOn(g.level, d), idx).reverse(),
      missing: whatsMissing(g.input),
      plan: Math.max(1, planPerWeek(g.input.sport))
    }
  }, [g, idx, period])

  if (!g || !view) return <section className="card bpg-card gr-loading" aria-label="Growth"><p className="bpg-empty">Loading your growth…</p></section>
  const { stats: s, weeks, corr, checks, rows, missing, plan } = view
  const wk = weeks.map((w) => w.week)
  const act = (m: Missing) => {
    if (m.action === 'log') bodyLog.open()
    else if (m.action === 'photo') openPhoto()
    else if (m.action === 'food') openTab('body', 'food')
    else if (m.action === 'sleep') window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'sleep' }))
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(rowsCsv([...rows].reverse()))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  const tiles: { k: string; label: string; value: string; sub: string; muted?: boolean }[] = [
    { k: 'lean', label: 'Lean mass', value: s.lean ? sgn(s.lean.change, ' kg') : '—', sub: s.lean ? `estimate from ${s.lean.how === 'fat' ? 'body fat %' : 'scale muscle'}` : 'add body fat % to see it', muted: !s.lean },
    { k: 'weight', label: 'Weight', value: s.weight ? sgn(s.weight.change, ' kg') : '—', sub: s.weight ? `${s.weight.from.toFixed(1)} → ${s.weight.to.toFixed(1)} kg` : 'needs 2 weeks of weigh-ins', muted: !s.weight },
    { k: 'waist', label: 'Waist', value: s.waist ? sgn(s.waist.change, ' cm') : '—', sub: s.waist ? `${s.waist.from.toFixed(1)} → ${s.waist.to.toFixed(1)} cm` : 'measure weekly', muted: !s.waist },
    { k: 'strength', label: 'Strength', value: s.strengthPct == null ? '—' : sgn(s.strengthPct, '%', 0), sub: s.strengthPct == null ? 'log sets to see it' : 'strength score', muted: s.strengthPct == null },
    { k: 'unlocked', label: 'Harder moves', value: String(s.unlocked), sub: 'variations unlocked' },
    { k: 'sessions', label: 'Sessions', value: String(s.sessions), sub: `${(s.sessions / s.weeks).toFixed(1)} a week` },
    { k: 'protein', label: 'Protein goal', value: String(s.proteinDays), sub: s.foodDays ? `days of ${s.foodDays} logged` : 'log food to see it' }
  ]
  const fmtKg = (n: number) => n.toFixed(1)
  return (
    <div className="bpg gr">
      <section className="card bpg-card gr-hero" aria-label="You since you started">
        <header className="gr-hero-head">
          <div>
            <p className="bpg-eyebrow">{period === 'all' ? 'You since you started' : `Your last ${PERIODS.find((p) => p.id === period)!.label}`}</p>
            <h2>How much you are growing</h2>
          </div>
          <div className="bpg-seg gr-periods" role="tablist" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p.id} role="tab" aria-selected={period === p.id} className={period === p.id ? 'on' : ''} onClick={() => setPeriod(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
        </header>
        <ul className="gr-tiles">
          {tiles.map((t) => (
            <li key={t.k} className={`gr-tile ${t.muted ? 'muted' : ''}`} data-k={t.k}>
              <span>{t.label}</span>
              <b>{t.value}</b>
              <small>{t.sub}</small>
            </li>
          ))}
        </ul>
        <div className="gr-actions">
          <button className="btn primary small" onClick={bodyLog.open}>
            Log weight / waist
          </button>
          <button className="btn small" onClick={openPhoto}>
            Add a photo
          </button>
        </div>
        {missing.length > 0 && (
          <div className="gr-missing">
            <h3>What's missing</h3>
            <ul>
              {missing.slice(0, 4).map((m) => (
                <li key={m.id}>
                  <span>{m.text}</span>
                  {m.action && (
                    <button className="btn ghost small" onClick={() => act(m)}>
                      {m.action === 'log' ? 'Log' : m.action === 'photo' ? 'Photo' : m.action === 'food' ? 'Food' : 'Sleep'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="bpg-grid gr-top">
        <LevelCard level={g.level} />
        <section className="card bpg-card gr-checks" aria-label="Lean gain check">
          <header className="bpg-head">
            <h2>Lean gain check</h2>
            <span className="bpg-lock">month vs the month before</span>
          </header>
          {checks.length === 0 ? (
            <p className="bpg-empty">Weigh in a few mornings a week and the first month shows here.</p>
          ) : (
            <ul className="gr-check-list">
              {checks.slice(0, 4).map((c) => (
                <li key={c.month} className={`gr-check ${c.kind}`}>
                  <span className="gr-check-m">{monthName(c.month)}</span>
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="bpg-foot">Estimates from weekly averages. One month can be water: watch the trend.</p>
        </section>
      </div>

      <div className="bpg-grid gr-charts">
        <section className="card bpg-card" aria-label="Weekly average weight">
          <header className="bpg-head">
            <h2>Weight</h2>
            <span className="bpg-lock">weekly average, kg</span>
          </header>
          <LineChart label="Weekly average weight against the slow-gain corridor" weeks={wk} series={[{ id: 'w', label: 'Weight', values: weeks.map((w) => w.weight) }]} band={corr.start ? { lo: corr.lo, hi: corr.hi, label: '+0.25–0.5 kg a week' } : undefined} fmt={fmtKg} empty="Weigh in 3 mornings a week and the weekly average draws here." />
        </section>
        <section className="card bpg-card" aria-label="Waist">
          <header className="bpg-head">
            <h2>Waist</h2>
            <span className="bpg-lock">weekly average, cm</span>
          </header>
          <LineChart label="Waist, weekly average" weeks={wk} series={[{ id: 'ws', label: 'Waist', values: weeks.map((w) => w.waist) }]} fmt={fmtKg} empty="Measure your waist once a week (at the navel, relaxed)." />
        </section>
        <section className="card bpg-card" aria-label="Strength per muscle group">
          <header className="bpg-head">
            <h2>Strength</h2>
            <span className="bpg-lock">score per muscle group</span>
          </header>
          <LineChart
            label="Strength score per muscle group, weekly"
            weeks={wk}
            series={MUSCLES.map((m) => ({ id: m.id, label: m.short, cls: MUSCLE_CLS[m.id], values: weeks.map((w) => w.strength[m.id] || null) }))}
            fmt={(n) => String(Math.round(n))}
            empty="Log your sets in Training and each muscle group's strength draws here."
            legend
          />
        </section>
        <section className="card bpg-card" aria-label="Sessions per week">
          <header className="bpg-head">
            <h2>Sessions</h2>
            <span className="bpg-lock">per week vs your plan</span>
          </header>
          <BarsChart label="Training sessions per week against the plan" weeks={wk} values={weeks.map((w) => w.sessions)} plan={plan} unit="sessions" />
        </section>
        <section className="card bpg-card" aria-label="Protein">
          <header className="bpg-head">
            <h2>Protein</h2>
            <span className="bpg-lock">average a day, g</span>
          </header>
          <LineChart label="Average protein a day, weekly" weeks={wk} series={[{ id: 'p', label: 'Protein', values: weeks.map((w) => w.protein) }]} goal={{ value: proteinGoal(lastWeight, g.input.gPerKg).g, label: 'goal' }} fmt={(n) => String(Math.round(n))} empty="Log food and your weekly protein draws here." />
        </section>
        <section className="card bpg-card" aria-label="Calories">
          <header className="bpg-head">
            <h2>Calories</h2>
            <span className="bpg-lock">average a day, kcal</span>
          </header>
          <LineChart label="Average kcal a day, weekly" weeks={wk} series={[{ id: 'k', label: 'kcal', values: weeks.map((w) => w.kcal) }]} goal={g.input.kcalGoal ? { value: g.input.kcalGoal, label: 'goal' } : null} fmt={(n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)))} empty="Log food and your weekly calories draw here." />
        </section>
        <section className="card bpg-card" aria-label="Sleep">
          <header className="bpg-head">
            <h2>Sleep</h2>
            <span className="bpg-lock">average a night, hours</span>
          </header>
          <LineChart label="Average sleep a night, weekly" weeks={wk} series={[{ id: 's', label: 'Sleep', values: weeks.map((w) => w.sleepH) }]} goal={{ value: 8, label: '8 h' }} fmt={(n) => n.toFixed(1)} empty="Log your sleep and the weekly average draws here." />
        </section>
        <section className="card bpg-card" aria-label="Body fat and muscle">
          <header className="bpg-head">
            <h2>Fat % and muscle</h2>
            <span className="bpg-lock">estimate, watch the trend</span>
          </header>
          <div className="gr-pair">
            <div>
              <h3>Body fat %</h3>
              <LineChart label="Body fat %, weekly average (estimate)" weeks={wk} series={[{ id: 'f', label: 'Body fat', values: weeks.map((w) => w.fat) }]} fmt={(n) => n.toFixed(1)} empty="Add body fat % when you weigh in." />
            </div>
            <div>
              <h3>Muscle, kg</h3>
              <LineChart label="Muscle kg, weekly average (estimate)" weeks={wk} series={[{ id: 'm', label: 'Muscle', values: weeks.map((w) => w.muscle) }]} fmt={fmtKg} empty="Your scale's muscle reading draws here." />
            </div>
          </div>
        </section>
      </div>

      <section className="card bpg-card gr-months" aria-label="Monthly snapshots">
        <header className="bpg-head">
          <h2>Month by month</h2>
          <button className="btn small" onClick={copy} disabled={!rows.length}>
            {copied ? 'Copied CSV' : 'Copy CSV'}
          </button>
        </header>
        {rows.length === 0 ? (
          <p className="bpg-empty">Your first month shows here.</p>
        ) : (
          <div className="gr-table-wrap">
            <table className="gr-table">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Weight</th>
                  <th scope="col">Waist</th>
                  <th scope="col">Strength</th>
                  <th scope="col">Sessions</th>
                  <th scope="col">Protein days</th>
                  <th scope="col">Level</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.month}>
                    <th scope="row">{monthName(r.month)}</th>
                    <td>{r.weight == null ? '—' : `${r.weight.toFixed(1)} kg`}</td>
                    <td>{r.waist == null ? '—' : `${r.waist.toFixed(1)} cm`}</td>
                    <td>{r.strengthPct == null ? '—' : sgn(r.strengthPct, '%', 0)}</td>
                    <td>{r.sessions}</td>
                    <td>{r.proteinDays}</td>
                    <td>{r.level}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {bodyLog.sheet}
    </div>
  )
}
