// Sport Track → Progress (the approved design, docs/design/sport-track/Progress.dc.html):
// a period switch (Week / 4 weeks / 12 weeks), four numbers (workouts, hard sets, steps
// unlocked, weight), Strength over time (the best set per week on a path, with the steps
// up marked), Ready today (the readiness score), Path progress (one segmented bar per path:
// mastered steps full, your step partly filled by its real unlock progress, "NN% to <next>",
// the unlock checks with your real values), personal records and the 12-week program.
// The older recovery, warnings, challenges and by-hand logging stay under "More". Every
// number is from what you logged; an empty period says so in one line. Nothing here pays points.
import { useMemo, useState } from 'react'
import type { BodyState } from '@shared/api'
import { programPhases } from '@core/sportTrain'
import { doneSessions, trainOf } from '@core/trainLog'
import { TYPE_NAME, daysBetween } from '@core/trainWeek'
import type { LadderId } from '@core/trainLadders'
import { kpisFor, pathProgress, PERIODS, PATH_NAME, personalRecords, strengthChart, weightRange, type ProgressPeriod, type StrengthChart } from '@core/trainProgress'
import { useGrowth } from '../body/progress/useGrowth'
import { useTrainReady } from './useTrainHome'
import { ProgressMore } from './SportMore'
import { Ring } from './sportBits'
import type { SportTrain } from './useSportTrain'

const LS = 'life_progress_period'
const readPeriod = (): ProgressPeriod => {
  try {
    const v = localStorage.getItem(LS)
    return PERIODS.some((p) => p.id === v) ? (v as ProgressPeriod) : '4w'
  } catch {
    return '4w'
  }
}
const sgn = (n: number, d = 1) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(d)}`
const dayWord = (day: string, today: string) => {
  const n = daysBetween(day, today)
  return n === 0 ? 'Today' : n === 1 ? 'Yesterday' : `${n} days ago`
}

export function SportProgress({ t, body, onBody, onWallet, onWorkout }: { t: SportTrain; body: BodyState | null; onBody: (s: BodyState) => void; onWallet: () => void; onWorkout: () => void }) {
  const { st, today } = t
  const [period, setPeriodRaw] = useState<ProgressPeriod>(readPeriod)
  const [path, setPath] = useState<LadderId>('push')
  const setPeriod = (p: ProgressPeriod) => {
    setPeriodRaw(p)
    try {
      localStorage.setItem(LS, p)
    } catch {
      /* this session only */
    }
  }
  const days = PERIODS.find((p) => p.id === period)!.days
  const data = useMemo(() => trainOf(st), [st])
  const k = useMemo(() => kpisFor(st, today, days), [st, today, days])
  const paths = useMemo(() => pathProgress(st, today), [st, today])
  const prs = useMemo(() => personalRecords(st, 5), [st])
  const program = useMemo(() => programPhases(st, today), [st, today])
  const chart = useMemo(() => strengthChart(st, today, path, period), [st, today, path, period])
  const g = useGrowth()
  const wt = useMemo(() => (g ? weightRange(g.input.points, k.from, today, 'weight') : null), [g, k.from, today])
  const ws = useMemo(() => (g ? weightRange(g.input.points, k.from, today, 'waist') : null), [g, k.from, today])
  const latestW = useMemo(() => [...(g?.input.points ?? [])].reverse().find((p) => p.weight != null)?.weight ?? null, [g])
  const last = useMemo(() => [...doneSessions(data.log)].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null, [data])
  const { tr, thin } = useTrainReady(today)
  const diff = k.workouts - k.workoutsBefore
  const periodName = PERIODS.find((p) => p.id === period)!.label.toLowerCase()

  return (
    <div className="body-page sp-more sp-prog" data-sp="progress">
      <header className="sp-sec-head row">
        <div>
          <h2>Progress</h2>
          <p>What your workouts, weight and steps add up to.</p>
        </div>
        <div className="sp-period" role="group" aria-label="Period" data-sp="period">
          {PERIODS.map((p) => (
            <button key={p.id} type="button" className={p.id === period ? 'on' : ''} aria-pressed={p.id === period} onClick={() => setPeriod(p.id)} data-period={p.id}>
              {p.label}
            </button>
          ))}
        </div>
      </header>

      <section className="sp-prog-kpis" aria-label="The period in numbers">
        <Kpi label="Workouts" value={`${k.workouts}`} note={k.workoutsBefore || k.workouts ? `${diff >= 0 ? '+' : '−'}${Math.abs(diff)} vs ${days === 7 ? 'the week' : periodName} before` : 'none yet in this period'} data="workouts" />
        <Kpi label="Hard sets" value={`${k.hardSets}`} note={k.hardSets ? `≈ ${k.perWeek} a week` : 'log a workout to count them'} data="sets" />
        <Kpi label="Steps unlocked" value={`${k.unlocked.length}`} note={k.unlocked.length ? k.unlocked.map((u) => u.name).slice(0, 2).join(', ') : 'none in this period'} data="steps" />
        <Kpi label="Weight" value={wt ? `${wt.to.toFixed(1)} kg` : latestW != null ? `${latestW.toFixed(1)} kg` : '—'} note={wt ? `${sgn(wt.change)} kg${ws ? (Math.abs(ws.change) < 0.5 ? ', waist same' : `, waist ${sgn(ws.change)} cm`) : ''}` : 'weigh in twice, a week apart, to see the change'} data="weight" />
      </section>

      <div className="sp-prog-row">
        <article className="sp-card sp-chart-card" data-sp="strength-chart">
          <div className="sp-path-top">
            <h3>Strength over time</h3>
            <span className="sp-muted">Best set per {period === 'week' ? 'day' : 'week'} · steps marked</span>
          </div>
          <StrengthSvg chart={chart} path={path} />
          <div className="sp-pills" role="group" aria-label="Path">
            {paths.map((p) => (
              <button key={p.ladder} type="button" className={`sp-pillbtn${p.ladder === path ? ' on' : ''}`} aria-pressed={p.ladder === path} onClick={() => setPath(p.ladder)} data-path={p.ladder}>
                {PATH_NAME[p.ladder]}
              </button>
            ))}
          </div>
        </article>

        <article className="sp-card sp-ready" data-sp="ready">
          <h3>Ready today</h3>
          {tr && !thin ? (
            <>
              <div className="sp-ready-top">
                <Ring value={tr.score / 100} size={96} stroke={9}>
                  <b className="num">{tr.score}</b>
                </Ring>
                <b className="sp-ready-line">{tr.line}</b>
              </div>
              <ul className="sp-ready-list">
                <li>
                  <span>Why</span>
                  <b>{tr.why || 'No sleep or soreness logged'}</b>
                </li>
                <li>
                  <span>Today</span>
                  <b>{tr.mode === 'full' ? 'Full workout' : tr.mode === 'light' ? 'Lighter, 70%' : 'Short, 50%'}</b>
                </li>
                <li>
                  <span>Last workout</span>
                  <b>{last ? `${dayWord(last.date, today)}, ${TYPE_NAME[last.type].toLowerCase()}` : 'none yet'}</b>
                </li>
              </ul>
            </>
          ) : (
            <div className="sp-empty col">
              <span>No real score yet: log last night&rsquo;s sleep or tap how sore you are, and today&rsquo;s readiness shows here.</span>
              <button type="button" className="sp-btn small" onClick={onWorkout}>
                Open Workout
              </button>
            </div>
          )}
        </article>
      </div>

      <article className="sp-card sp-pathprog" data-sp="path-progress">
        <div className="sp-path-top">
          <h3>Path progress</h3>
          <span className="sp-muted">Each bar = all steps of a path · the bright part is how close you are to the next step</span>
        </div>
        <div className="sp-pp-rows">
          {paths.map((p) => (
            <div className="sp-pp" key={p.ladder} data-path={p.ladder}>
              <div className="sp-pp-name">
                <b>{p.name}</b>
                <small>{p.stand ? `Stand-in for your gear · ${p.moveName}` : `Step ${p.step} of ${p.of} · ${p.moveName}`}</small>
              </div>
              <div className="sp-pp-bar">
                <div className="sp-segs" role="img" aria-label={`${p.name}: step ${p.step} of ${p.of}${p.next ? `, ${p.pct}% to ${p.next}` : ', the top step'}`}>
                  {p.segs.map((s, i) => (
                    <span key={i} className={`sp-seg1 ${s.state}`} title={s.label}>
                      <i style={{ width: `${Math.round(s.fill * 100)}%` }} />
                    </span>
                  ))}
                </div>
                <div className="sp-pp-ends">
                  <span>{p.first}</span>
                  <span className="mid" data-pp="pct">
                    {p.stand ? 'no steps with this gear' : p.next ? `${p.pct}% to ${p.next}` : 'top step'}
                  </span>
                  <span>{p.last}</span>
                </div>
              </div>
              <ul className="sp-pp-checks" aria-label={`What unlocks ${p.next ?? 'the next step'}`}>
                {p.stand || !p.next ? (
                  <li>
                    <span>{p.stand ? 'Change your gear to follow the steps.' : 'Nothing left to unlock on this path.'}</span>
                  </li>
                ) : (
                  p.checks.map((c) => (
                    <li key={c.id} className={c.done ? 'ok' : ''}>
                      <span>
                        {c.done ? '✓' : '○'} {c.label}
                      </span>
                      <b className="num">{c.detail}</b>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ))}
        </div>
      </article>

      <div className="sp-prog-row two">
        <article className="sp-card" data-sp="records">
          <h3>Personal records</h3>
          {prs.length ? (
            <table className="sp-table">
              <thead>
                <tr>
                  <th>Move</th>
                  <th>Best</th>
                  <th>When</th>
                  <th className="r">Change</th>
                </tr>
              </thead>
              <tbody>
                {prs.map((r) => (
                  <tr key={r.move}>
                    <td>
                      <b>{r.name}</b>
                    </td>
                    <td className="num">{r.best}</td>
                    <td className="muted">{r.when}</td>
                    <td className="r acc num">{r.change}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="sp-empty col">
              <span>No records yet. Your best set of each move shows here once you log a workout.</span>
              <button type="button" className="sp-btn small" onClick={onWorkout}>
                Open Workout
              </button>
            </div>
          )}
        </article>
        <article className="sp-card" data-sp="program">
          <h3>12-week home program</h3>
          <ol className="sp-phases">
            {program.phases.map((p) => (
              <li key={p.id} className={p.state}>
                <div>
                  <b>
                    {p.name} <small>· weeks {p.weeks[0]}–{p.weeks[1]}</small>
                  </b>
                  <small>{p.what}</small>
                </div>
                <span className="st">{p.state === 'current' ? 'Now' : p.state === 'done' ? 'Done' : 'Later'}</span>
              </li>
            ))}
          </ol>
          {program.week == null && <p className="sp-small">The program starts with your first logged workout.</p>}
        </article>
      </div>

      <ProgressMore body={body} onBody={onBody} onWallet={onWallet} />
    </div>
  )
}

function Kpi({ label, value, note, data }: { label: string; value: string; note: string; data: string }) {
  return (
    <div className="sp-kpi" data-kpi={data}>
      <small>{label}</small>
      <b className="num">{value}</b>
      <span className="sp-kpi-note">{note}</span>
    </div>
  )
}

/** The best set per bucket as a line; a dashed line at each step up. */
function StrengthSvg({ chart, path }: { chart: StrengthChart; path: LadderId }) {
  const W = 900
  const H = 230
  const x0 = 60
  const x1 = W - 50
  const n = chart.buckets.length
  const xs = chart.buckets.map((_, i) => (n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1)))
  const vals = chart.buckets.map((b) => b.score).filter((v): v is number => v != null)
  if (!vals.length)
    return (
      <p className="sp-empty" data-sp="chart-empty">
        No sets on the {PATH_NAME[path]} path in this period. Log a workout and its best sets show here.
      </p>
    )
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const span = Math.max(1, hi - lo)
  const y = (v: number) => 180 - ((v - lo) / span) * 120 + (hi === lo ? -40 : 0)
  const pts = chart.buckets.map((b, i) => (b.score == null ? null : ([xs[i], y(b.score)] as const)))
  const segs: string[] = []
  let cur: string[] = []
  for (const p of pts) {
    if (p) cur.push(`${Math.round(p[0])},${Math.round(p[1])}`)
    else {
      if (cur.length > 1) segs.push(cur.join(' '))
      cur = []
    }
  }
  if (cur.length > 1) segs.push(cur.join(' '))
  const label = `${PATH_NAME[path]} strength, best set per ${n === 7 ? 'day' : 'week'}: ${vals.length} ${vals.length === 1 ? 'point' : 'points'}${chart.ups.length ? `, step up to ${chart.ups.map((u) => u.name).join(', ')}` : ''}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} className="sp-svg" data-sp="chart">
      <path d={`M40 30 H${W - 20} M40 90 H${W - 20} M40 150 H${W - 20}`} className="grid" />
      <path d={`M40 190 H${W - 20}`} className="base" />
      {segs.map((s, i) => (
        <polyline key={i} points={s} className="line" />
      ))}
      {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r="6" className="dot" />)}
      {chart.ups.map((u, i) => (
        <g key={i}>
          <path d={`M${xs[u.bucket]} 40 V190`} className="up" />
          <text x={Math.min(xs[u.bucket] + 8, W - 130)} y={54 + i * 16} className="uptext">
            Step up: {u.name.replace(/ push-ups$| rows$/, '')}
          </text>
        </g>
      ))}
      {chart.buckets.map((b, i) => (
        <text key={i} x={xs[i]} y="212" textAnchor="middle" className="axis">
          {b.label}
        </text>
      ))}
    </svg>
  )
}
