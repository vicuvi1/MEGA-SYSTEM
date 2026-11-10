// Sport Track → "Am I really growing?" (the approved design, docs/design/sport-track/
// Growth.dc.html), reached from the Dashboard chip. A verdict with a growth score ring and
// one honest sentence; six signs (strength, weight against the lean-gain zone, waist,
// hard sets per muscle, protein days, sleep), each Good / Improve / Fix with a bar; "To grow
// faster" (the top one or two fixes); a weight + waist chart with the lean-gain band; and a
// photo check that links the Photo Locker. With too little logged it makes up nothing: it says
// exactly what to log. The numbers come from core/growthCheck.ts (pure, tested). Reads only.
import { useEffect, useMemo, useState } from 'react'
import { cleanZone, DEFAULT_ZONE, growthCheck, growthChart, type GrowthChart, type Sign, type SignId } from '@core/growthCheck'
import { openTab } from '../PageTabs'
import { listPhotos, type StoredPhoto } from '../body/bodyPhotos'
import { useGrowth } from '../body/progress/useGrowth'
import type { SportSection } from './SportTrack'

const ZKEY = 'life_growth_zone'
const readZone = () => {
  try {
    return cleanZone(JSON.parse(localStorage.getItem(ZKEY) || 'null'))
  } catch {
    return { ...DEFAULT_ZONE }
  }
}
const STATE_WORD: Record<Sign['state'], string> = { good: 'Good', improve: 'Improve', fix: 'Fix', none: 'Log it' }
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** Opens Body → Body on its photo area (the same way the Growth tab does). */
function takePhoto() {
  openTab('body', 'progress')
  setTimeout(() => {
    const more = document.querySelector<HTMLDetailsElement>('#ptp-body-progress details.bpg-more')
    if (more) {
      more.open = true
      more.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }
  }, 120)
}

export function GrowthView({ onBack, onSection, onBodyFood }: { onBack: () => void; onSection: (s: SportSection) => void; onBodyFood: (tab: 'today' | 'food' | 'progress' | 'growth') => void }) {
  const g = useGrowth()
  const [zone, setZoneRaw] = useState(readZone)
  const [edit, setEdit] = useState(false)
  const setZone = (z: { lo: number; hi: number }) => {
    const c = cleanZone(z)
    setZoneRaw(c)
    try {
      localStorage.setItem(ZKEY, JSON.stringify(c))
    } catch {
      /* this session only */
    }
  }
  const check = useMemo(() => (g ? growthCheck(g.input, { zone }) : null), [g, zone])
  const chart = useMemo(() => (g ? growthChart(g.input, { zone }) : null), [g, zone])

  if (!g || !check || !chart)
    return (
      <div className="body-page sp-more sp-grow" data-sp="growth">
        <Head onBack={onBack} />
        <p className="sp-empty">{g === null ? 'Loading your numbers…' : 'Growth needs the body log, which this version does not have.'}</p>
      </div>
    )

  const toLog = (id: SignId) => {
    if (id === 'strength' || id === 'training') onSection('workout')
    else if (id === 'weight' || id === 'waist') onBodyFood('progress')
    else if (id === 'protein') onBodyFood('food')
    else window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'sleep' }))
  }
  const LOG_LABEL: Record<SignId, string> = { strength: 'Open Workout', weight: 'Log weight', waist: 'Log waist', training: 'Open Workout', protein: 'Log food', sleep: 'Open Sleep' }
  const tone = check.verdict === 'yes' ? 'good' : check.verdict === 'toolittle' ? 'none' : check.verdict === 'maybe' ? 'improve' : 'fix'

  return (
    <div className="body-page sp-more sp-grow" data-sp="growth" data-verdict={check.verdict}>
      <Head onBack={onBack} />
      <div className="sp-grow-top">
        <article className={`sp-card sp-verdict ${tone}`} data-sp="verdict">
          <ScoreRing score={check.score} tone={tone} />
          <div className="sp-verdict-text">
            <small className="sp-eyebrow acc">Last {check.weeks} weeks · verdict</small>
            <h3 data-sp="verdict-headline">{check.headline}</h3>
            <p className="sp-verdict-line">{check.line}</p>
            <p className="sp-small" data-sp="basis">
              {check.verdict === 'toolittle' ? `So far: ${check.counts.workouts} workouts, ${check.counts.weighIns} weigh-ins and ${check.counts.foodDays} food days.` : check.basis}
            </p>
          </div>
        </article>
        <aside className="sp-card sp-faster" data-sp="faster">
          <h3>{check.verdict === 'toolittle' ? 'To get your verdict, log this' : 'To grow faster'}</h3>
          {check.verdict === 'toolittle' ? (
            <ul className="sp-tolog" data-sp="to-log">
              {check.signs
                .filter((s) => s.log)
                .map((s) => (
                  <li key={s.id}>
                    <span>{s.log}</span>
                    <button type="button" className="sp-btn small" onClick={() => toLog(s.id)} data-log={s.id}>
                      {LOG_LABEL[s.id]}
                    </button>
                  </li>
                ))}
            </ul>
          ) : check.faster.length ? (
            <ol className="sp-faster-list">
              {check.faster.map((f, i) => (
                <li key={i}>
                  <b>{f.title}</b> <span>{f.text}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="sp-line">Nothing to fix: keep doing what you do.</p>
          )}
          <p className="sp-small foot">Checked from what you log. If a sign is red two weeks in a row, change that one first.</p>
        </aside>
      </div>

      <section className="sp-signs" aria-label="The six signs">
        {check.signs.map((s) => (
          <article key={s.id} className={`sp-sign ${s.state}`} data-sign={s.id} data-state={s.state}>
            <div className="sp-sign-top">
              <small>{s.label}</small>
              <span className={`sp-state ${s.state}`}>{STATE_WORD[s.state]}</span>
            </div>
            <b className="sp-sign-val num">{s.value}</b>
            <p className="sp-sign-mean">{s.meaning}</p>
            <div className="sp-gbar" role="img" aria-label={`${s.label}: ${s.value}`}>
              <i style={{ width: `${s.bar}%` }} />
            </div>
            <div className="sp-sign-ends">
              <span>{s.low}</span>
              <span>{s.goal}</span>
            </div>
            {s.state === 'none' && (
              <button type="button" className="sp-link" onClick={() => toLog(s.id)}>
                {LOG_LABEL[s.id]} ›
              </button>
            )}
          </article>
        ))}
      </section>

      <div className="sp-grow-bottom">
        <article className="sp-card sp-wchart" data-sp="weight-chart">
          <div className="sp-path-top">
            <h3>Weight vs the lean-gain zone</h3>
            <span className="sp-muted">
              Green band = +{zone.lo} to +{zone.hi} kg a month · above it adds fat, below it is too little food{' '}
              <button type="button" className="sp-link inline" onClick={() => setEdit((e) => !e)} aria-expanded={edit} data-sp="zone-edit">
                Change
              </button>
            </span>
          </div>
          {edit && (
            <div className="sp-zone-edit" role="group" aria-label="Lean-gain zone, kg a month">
              <label>
                From
                <input type="number" step="0.1" min="0" max="2.9" value={zone.lo} onChange={(e) => setZone({ lo: Number(e.target.value), hi: zone.hi })} />
              </label>
              <label>
                To
                <input type="number" step="0.1" min="0.1" max="3" value={zone.hi} onChange={(e) => setZone({ lo: zone.lo, hi: Number(e.target.value) })} />
              </label>
              <span className="sp-small">kg a month</span>
              <button type="button" className="sp-btn small quiet" onClick={() => setZone({ ...DEFAULT_ZONE })}>
                Back to +{DEFAULT_ZONE.lo} to +{DEFAULT_ZONE.hi}
              </button>
            </div>
          )}
          <WeightSvg chart={chart} />
        </article>
        <PhotoCheck onTake={takePhoto} />
      </div>
    </div>
  )
}

function Head({ onBack }: { onBack: () => void }) {
  return (
    <header className="sp-sec-head row">
      <div>
        <h2>Am I really growing?</h2>
        <p>One honest answer from six signs, built from what you log.</p>
      </div>
      <button type="button" className="sp-btn" onClick={onBack} data-sp="growth-back">
        ‹ Back to Dashboard
      </button>
    </header>
  )
}

function ScoreRing({ score, tone }: { score: number | null; tone: string }) {
  const r = 64
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, score ?? 0)) / 100
  return (
    <svg className={`sp-score ${tone}`} width="150" height="150" viewBox="0 0 150 150" role="img" aria-label={score == null ? 'No growth score yet' : `Growth score ${score} of 100`} data-sp="score">
      <circle cx="75" cy="75" r={r} className="bg" strokeWidth="14" fill="none" />
      <circle cx="75" cy="75" r={r} className="fg" strokeWidth="14" strokeLinecap="round" fill="none" strokeDasharray={`${c * v} ${c}`} transform="rotate(-90 75 75)" />
      <text x="75" y="76" textAnchor="middle" className="n">
        {score == null ? '—' : score}
      </text>
      <text x="75" y="98" textAnchor="middle" className="u">
        growth score
      </text>
    </svg>
  )
}

/** Weekly average weight with the lean-gain band, and the waist as a second line. */
function WeightSvg({ chart }: { chart: GrowthChart }) {
  const W = 900
  const n = chart.weeks.length
  const xs = chart.weeks.map((_, i) => (n === 1 ? W / 2 : 40 + ((W - 160) * i) / (n - 1)))
  const ws = chart.weeks.map((w) => w.weight)
  const have = ws.filter((v): v is number => v != null)
  if (have.length < 2)
    return (
      <p className="sp-empty" data-sp="wchart-empty">
        Not enough weigh-ins for a line yet. Weigh in on 3 mornings a week; the chart fills in as weeks pass.
      </p>
    )
  const bandVals = [...chart.lo, ...chart.hi].filter((v): v is number => v != null)
  const all = [...have, ...bandVals]
  const lo = Math.min(...all) - 0.3
  const hi = Math.max(...all) + 0.3
  const y = (v: number) => 190 - ((v - lo) / (hi - lo)) * 150
  const line = chart.weeks.map((w, i) => (w.weight == null ? null : `${Math.round(xs[i])},${Math.round(y(w.weight))}`)).filter(Boolean)
  const band: string[] = []
  const up: string[] = []
  const down: string[] = []
  chart.lo.forEach((v, i) => {
    const h = chart.hi[i]
    if (v != null && h != null) {
      up.push(`${Math.round(xs[i])},${Math.round(y(h))}`)
      down.unshift(`${Math.round(xs[i])},${Math.round(y(v))}`)
    }
  })
  band.push(...up, ...down)
  const wv = chart.weeks.map((w) => w.waist).filter((v): v is number => v != null)
  const wlo = Math.min(...wv)
  const whi = Math.max(...wv, wlo + 1)
  const wy = (v: number) => 238 - ((v - wlo) / (whi - wlo)) * 14
  const wline = wv.length > 1 ? chart.weeks.map((w, i) => (w.waist == null ? null : `${Math.round(xs[i])},${Math.round(wy(w.waist))}`)).filter(Boolean) : []
  return (
    <svg viewBox={`0 0 ${W} 266`} width="100%" role="img" aria-label={`Weekly average weight from ${have[0]} to ${have[have.length - 1]} kilograms${wv.length ? `, waist ${wv[wv.length - 1]} centimetres` : ''}`} className="sp-svg wide" data-sp="wchart">
      {band.length > 2 && <polygon points={band.join(' ')} className="band" />}
      <polyline points={line.join(' ')} className="line" />
      {chart.weeks.map((w, i) => w.weight != null && <circle key={i} cx={xs[i]} cy={y(w.weight)} r="4" className="dot" />)}
      {wline.length > 1 && <polyline points={wline.join(' ')} className="waist" />}
      <text x={xs[n - 1] + 70} y={y(have[have.length - 1]) + 4} className="lbl" textAnchor="end">
        {have[have.length - 1].toFixed(1)} kg
      </text>
      {wv.length > 0 && (
        <text x={W - 20} y="256" className="lbl waistl" textAnchor="end">
          waist {wv[wv.length - 1]} cm
        </text>
      )}
      <text x="40" y="262" className="axis">
        {dayLabel(chart.weeks[0].week)} · {have[0].toFixed(1)} kg
      </text>
      <text x={W - 120} y="262" className="axis" textAnchor="end" aria-hidden="true">
        now
      </text>
    </svg>
  )
}

/** The oldest and the newest progress photo (from this device and the Photo Locker), or what to do. */
function PhotoCheck({ onTake }: { onTake: () => void }) {
  const [photos, setPhotos] = useState<StoredPhoto[] | null>(null)
  useEffect(() => {
    let live = true
    void listPhotos()
      .then((l) => live && setPhotos(l))
      .catch(() => live && setPhotos([]))
    return () => {
      live = false
    }
  }, [])
  const pair = useMemo(() => {
    if (!photos || !photos.length) return []
    const last = photos[photos.length - 1]
    const first = photos.length > 1 ? photos[0] : null
    return first ? [first, last] : [last]
  }, [photos])
  const urls = useMemo(() => pair.map((p) => URL.createObjectURL(p.blob)), [pair])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])
  return (
    <article className="sp-card sp-photocheck" data-sp="photo-check">
      <h3>Photo check</h3>
      {pair.length ? (
        <div className="sp-photos">
          {pair.map((p, i) => (
            <figure key={p.id}>
              <img src={urls[i]} alt={`Progress photo, ${dayLabel(p.day)}`} />
              <figcaption>{dayLabel(p.day)}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <p className="sp-small ink">{photos == null ? 'Looking for your photos…' : 'No progress photos yet. Your first one is the starting point to compare with.'}</p>
      )}
      <p className="sp-small">Same light, same spot, once a month. They are kept in your Photo Locker, never on the server.</p>
      <div className="sp-actions tight">
        <button type="button" className="sp-btn grow" onClick={onTake} data-sp="take-photo">
          Take this month&rsquo;s photo
        </button>
        <button type="button" className="sp-btn quiet" onClick={() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'locker' }))} data-sp="open-locker">
          Photo Locker ›
        </button>
      </div>
    </article>
  )
}
