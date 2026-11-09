// Training → Progress (folded, so the tab stays short): the streak (rest days
// never break it, only a missed planned session), sessions per week against
// the plan, weekly hard sets per muscle with the 10–20 zone, reps per
// exercise per week, strength (the Progress tab's own StrengthHero) next to
// the weekly weight and waist from body_comp (read only), and the monthly
// progress-photo nudge with a link to the local-only photo compare. Every
// number comes from data already saved; nothing here writes or pays.
import { useEffect, useMemo, useState } from 'react'
import { addDays, dayLabel } from '@core/dates'
import { MUSCLES, WEEKLY_SETS } from '@core/sportSets'
import { doneSessions, trainOf } from '@core/trainLog'
import { hardSetsWeeks, photoDue, repsPerExercise, sessionsPerWeek, trainStreak } from '@core/trainStreak'
import { StrengthHero } from '../progress/StrengthHero'
import { useBodyComp } from '../progress/BodyCompPanel'
import { listPhotos } from '../bodyPhotos'
import '../progress/progress.css'

const short = (monday: string) => dayLabel(monday, false)

/** Thin bars, one hue, rounded tops on the baseline; an optional target line and zone band. */
function Bars({
  values,
  labels,
  max,
  unit,
  target,
  zone,
  label
}: {
  values: number[]
  labels: string[]
  max: number
  unit: string
  target?: number
  zone?: { lo: number; hi: number }
  label: string
}) {
  const W = 300
  const H = 96
  const top = Math.max(1, max)
  const bw = W / values.length
  const y = (v: number) => H - (Math.min(v, top) / top) * (H - 6)
  return (
    <div className="tr-bars-wrap">
      <svg className="tr-bars" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
        {zone && <rect className="tr-bars-zone" x={0} width={W} y={y(zone.hi)} height={y(zone.lo) - y(zone.hi)} />}
        <line className="tr-bars-base" x1={0} x2={W} y1={H} y2={H} />
        {values.map((v, i) => {
          const h = H - y(v)
          return (
            <g key={i} className="tr-bar-hit">
              <rect x={i * bw} y={0} width={bw} height={H} fill="transparent" />
              {v > 0 && <rect className={`tr-bar${i === values.length - 1 ? ' now' : ''}`} x={i * bw + bw * 0.3} width={bw * 0.4} y={H - Math.max(2, h)} height={Math.max(2, h)} rx={3} />}
              <title>{`${labels[i]}: ${v} ${unit}`}</title>
            </g>
          )
        })}
        {target != null && target > 0 && <line className="tr-bars-target" x1={0} x2={W} y1={y(target)} y2={y(target)} />}
      </svg>
      <div className="tr-bars-axis" aria-hidden="true">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  )
}

/** A thin line through weekly values (gaps where a week has none). */
function Line({ points, label, unit }: { points: { x: string; v: number | null }[]; label: string; unit: string }) {
  const W = 300
  const H = 80
  const vals = points.map((p) => p.v).filter((v): v is number => v != null)
  if (vals.length < 2) return <p className="bdy-note">Not enough weigh-ins yet: 3 a week make a weekly average.</p>
  const lo = Math.min(...vals) - 0.3
  const hi = Math.max(...vals) + 0.3
  const x = (i: number) => 6 + (i / Math.max(1, points.length - 1)) * (W - 12)
  const y = (v: number) => 6 + (1 - (v - lo) / (hi - lo)) * (H - 12)
  let d = ''
  points.forEach((p, i) => {
    if (p.v == null) return
    d += `${d && points[i - 1]?.v != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`
  })
  return (
    <svg className="tr-line" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
      <path d={d} />
      {points.map((p, i) =>
        p.v == null ? null : (
          <circle key={i} cx={x(i)} cy={y(p.v)} r={4}>
            <title>{`Week of ${short(p.x)}: ${p.v.toFixed(1)} ${unit}`}</title>
          </circle>
        )
      )}
    </svg>
  )
}

export function ProgressDash({ st, today }: { st: any; today: string }) {
  const data = useMemo(() => trainOf(st), [st])
  const done = useMemo(() => doneSessions(data.log), [data])
  const streak = useMemo(() => trainStreak(data.week, done, today), [data, done, today])
  const perWeek = useMemo(() => sessionsPerWeek(data.week, done, today, 8), [data, done, today])
  const exercises = Array.isArray(st?.exercises) ? st.exercises : []
  const muscles = useMemo(() => hardSetsWeeks(st?.sets, exercises, today, 6), [st, exercises, today])
  const reps = useMemo(() => repsPerExercise(st?.days, exercises, today, 8, 6), [st, exercises, today])
  const [pick, setPick] = useState('')
  const ex = reps.find((r) => r.id === pick) ?? reps[0] ?? null
  const comp = useBodyComp()
  const [lastPhoto, setLastPhoto] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    const load = () =>
      void listPhotos()
        .then((l) =>
          setLastPhoto(
            l.length
              ? l
                  .map((p) => p.day)
                  .sort()
                  .pop()!
              : null
          )
        )
        .catch(() => setLastPhoto(null))
    load()
    window.addEventListener('life-photos-changed', load)
    return () => window.removeEventListener('life-photos-changed', load)
  }, [])
  const photo = lastPhoto === undefined ? null : photoDue(lastPhoto, today)
  const openPhotos = () => {
    window.dispatchEvent(
      new CustomEvent('life-open-tab', {
        detail: { page: 'body', tab: 'progress' }
      })
    )
    window.setTimeout(
      () =>
        document.getElementById('bpg-photos')?.scrollIntoView({
          block: 'start',
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
        }),
      250
    )
  }
  const thisWeek = perWeek[perWeek.length - 1]
  const weeks = comp?.weeks.slice(-8) ?? []
  const waist = comp?.waist ?? []
  const waistNow = waist[waist.length - 1] ?? null
  const waistThen = waistNow ? (waist.find((w) => w.day >= addDays(waistNow.day, -28)) ?? null) : null

  return (
    <details className="bdy-card tr-prog" data-tr="dashboard">
      <summary>
        <span className="tr-prog-title">Progress</span>
        <span className="bdy-note">
          {streak.sessions ? `${streak.sessions}-session streak` : 'No streak yet'} · {thisWeek.done}/{thisWeek.planned} this week
        </span>
      </summary>
      <div className="tr-prog-body">
        <div className="tr-prog-stats">
          <div className="bdy-stat" data-tr="streak">
            <b className="bdy-num">{streak.sessions}</b>
            <span>{streak.sessions === 1 ? 'session' : 'sessions'} in a row</span>
            <small className="bdy-note">{streak.since ? `since ${dayLabel(streak.since)}. Rest days never break it.` : 'Rest days never break it; only a missed planned session does.'}</small>
          </div>
          <div className="bdy-stat">
            <b className="bdy-num">
              {thisWeek.done}/{thisWeek.planned}
            </b>
            <span>sessions this week</span>
            <small className="bdy-note">against your weekly split</small>
          </div>
        </div>

        <section className="tr-prog-sec" data-tr="per-week">
          <h3>Sessions per week</h3>
          <Bars
            values={perWeek.map((w) => w.done)}
            labels={perWeek.map((w) => short(w.monday))}
            max={Math.max(thisWeek.planned + 1, ...perWeek.map((w) => w.done))}
            unit="sessions"
            target={thisWeek.planned}
            label="Sessions per week, the last 8 weeks, with the plan as a line"
          />
          <p className="bdy-note">The line is your plan ({thisWeek.planned} a week).</p>
        </section>

        <section className="tr-prog-sec" data-tr="muscles">
          <h3>Hard sets per muscle, per week</h3>
          <div className="tr-prog-grid">
            {MUSCLES.map((m) => {
              const vals = muscles.map((w) => w.sets[m.id])
              return (
                <div key={m.id} className="tr-prog-mini" data-muscle={m.id}>
                  <span className="tr-prog-mini-head">
                    <b>{m.short}</b>
                    <small>{vals[vals.length - 1]} this week</small>
                  </span>
                  <Bars
                    values={vals}
                    labels={muscles.map((w) => short(w.monday))}
                    max={WEEKLY_SETS.hi + 6}
                    unit="hard sets"
                    zone={WEEKLY_SETS}
                    label={`${m.short}: hard sets per week, the last 6 weeks, with the 10 to 20 zone`}
                  />
                </div>
              )
            })}
          </div>
          <p className="bdy-note">
            The band is the zone that grows muscle ({WEEKLY_SETS.lo}–{WEEKLY_SETS.hi} a week).
          </p>
        </section>

        <section className="tr-prog-sec" data-tr="reps">
          <h3>Total reps per exercise</h3>
          {ex ? (
            <>
              <div className="bdy-seg tr-prog-pills" role="radiogroup" aria-label="Exercise">
                {reps.map((r) => (
                  <button key={r.id} type="button" role="radio" aria-checked={r.id === ex.id} onClick={() => setPick(r.id)}>
                    {r.name}
                  </button>
                ))}
              </div>
              <Bars
                values={ex.weeks.map((w) => w.total)}
                labels={ex.weeks.map((w) => short(w.monday))}
                max={Math.max(...ex.weeks.map((w) => w.total))}
                unit={ex.unit === 'sec' ? 'seconds' : 'reps'}
                label={`${ex.name}: total per week, the last 8 weeks`}
              />
              <p className="bdy-note">
                {ex.total.toLocaleString('en-US')} {ex.unit === 'sec' ? 'seconds' : 'reps'} in 8 weeks.
              </p>
            </>
          ) : (
            <p className="bdy-note">Log a few sets and your weekly totals show here.</p>
          )}
        </section>

        <section className="tr-prog-sec tr-prog-body-sec" data-tr="strength-body">
          <h3>Strength and body</h3>
          <div className="bpg tr-prog-strength">
            <StrengthHero log={st?.sets ?? null} exercises={exercises} today={today} />
          </div>
          <div className="tr-prog-grid two">
            <div className="tr-prog-mini" data-tr="weight">
              <span className="tr-prog-mini-head">
                <b>Weight, weekly average</b>
                <small>{comp?.head ? `${comp.head.avg.toFixed(1)} kg ${comp.head.which}` : 'from your weigh-ins'}</small>
              </span>
              <Line
                points={weeks.map((w) => ({
                  x: w.week,
                  v: w.enough ? w.avg : null
                }))}
                label="Weekly average weight, the last 8 weeks"
                unit="kg"
              />
            </div>
            <div className="tr-prog-mini" data-tr="waist">
              <span className="tr-prog-mini-head">
                <b>Waist</b>
                <small>{waistNow ? `${waistNow.waist} cm` : 'not logged yet'}</small>
              </span>
              <p className="bdy-note">
                {waistNow && waistThen && waistThen.day !== waistNow.day
                  ? `${waistNow.waist - waistThen.waist === 0 ? 'The same as' : `${waistNow.waist > waistThen.waist ? '+' : '−'}${Math.abs(Math.round((waistNow.waist - waistThen.waist) * 10) / 10)} cm since`} ${dayLabel(waistThen.day, false)}. Strength up with the waist steady means muscle.`
                  : 'Log your waist weekly: strength up with the waist steady means muscle.'}
              </p>
            </div>
          </div>
        </section>

        {photo && (
          <section className={`tr-prog-sec tr-photo${photo.due ? ' due' : ''}`} data-tr="photo">
            <p className="bdy-note">{photo.line}</p>
            <button type="button" className="bdy-btn quiet" onClick={openPhotos} data-tr="photo-open">
              Open photo compare
            </button>
          </section>
        )}
      </div>
    </details>
  )
}
