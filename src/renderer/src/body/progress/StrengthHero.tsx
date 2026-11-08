// Progress → hero: the big "+X% stronger" number and one strength chart per
// move family. Best set per day, drawn to scale (a harder variation counts
// more, so it sits higher), with a band and a name for each variation.
import { useState } from 'react'
import { addDays, daysBetween } from '@core/dates'
import { STRENGTH_PICKS, strengthHero, strengthView } from '@core/bodyProgress'
import type { SportEx } from '@core/sportLadders'
import type { SetLog } from '@core/sportSets'

const W = 960
const H = 230
const PAD = { l: 14, r: 14, t: 26, b: 24 }

export function StrengthHero({ log, exercises, today }: { log: SetLog | null | undefined; exercises: SportEx[]; today: string }) {
  const hero = strengthHero(log, exercises, today)
  const withData = STRENGTH_PICKS.filter((p) => strengthView(log, exercises, p.id, today).points.length > 0)
  const [family, setFamily] = useState<string>('')
  const pick = family && withData.some((p) => p.id === family) ? family : (withData[0]?.id ?? STRENGTH_PICKS[0].id)
  const v = strengthView(log, exercises, pick, today)
  const pts = v.points
  const start = pts.length ? (pts[0].day > addDays(today, -112) ? pts[0].day : addDays(today, -112)) : addDays(today, -56)
  const span = Math.max(21, daysBetween(start, today))
  const shown = pts.filter((p) => p.day >= start)
  const max = Math.max(1, ...shown.map((p) => p.score))
  const x = (d: string) => PAD.l + (Math.max(0, daysBetween(start, d)) / span) * (W - PAD.l - PAD.r)
  const y = (s: number) => PAD.t + (1 - s / (max * 1.12)) * (H - PAD.t - PAD.b)
  const line = shown.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ')
  const bands = v.bands.filter((b) => b.to >= start)
  const edge = (i: number) => (i + 1 < bands.length ? (x(bands[i].to) + x(bands[i + 1].from)) / 2 : W - PAD.r)
  const begin = (i: number) => (i === 0 ? PAD.l : edge(i - 1))
  return (
    <section className="card bpg-hero" aria-label="Strength">
      <header className="bpg-hero-top">
        <div>
          <p className="bpg-eyebrow">Strength</p>
          <p className="bpg-big" aria-live="polite">
            {hero.pct == null ? 'Getting started' : `${hero.pct >= 0 ? '+' : ''}${hero.pct}%`}
          </p>
          <p className="bpg-sub">{hero.pct == null ? 'Log sets for about 2 weeks and your change shows here.' : `${hero.pct >= 0 ? 'stronger' : 'change'} than 4 weeks ago, across ${hero.used} move${hero.used === 1 ? '' : 's'}`}</p>
        </div>
        <div className="bpg-pills" role="tablist" aria-label="Move">
          {STRENGTH_PICKS.map((p) => {
            const has = withData.some((w) => w.id === p.id)
            return (
              <button key={p.id} type="button" role="tab" aria-selected={pick === p.id} className={`bpg-pill${pick === p.id ? ' on' : ''}`} onClick={() => setFamily(p.id)} title={has ? undefined : 'No sets yet'}>
                {p.label}
              </button>
            )
          })}
        </div>
      </header>
      {shown.length > 0 ? (
        <>
          <svg className="bpg-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${v.name}: best set per day, ${shown.length} days. ${v.line}`}>
            {bands.map((b, i) => (
              <g key={b.move + b.from}>
                <rect x={begin(i)} y={PAD.t - 8} width={Math.max(0, edge(i) - begin(i))} height={H - PAD.t - PAD.b + 8} className={`bpg-band s${i % 2}`} />
                {edge(i) - begin(i) > 70 && (
                  <text x={begin(i) + 8} y={PAD.t + 4} className="bpg-band-name">
                    {b.name}
                  </text>
                )}
              </g>
            ))}
            <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="bpg-base" />
            <path d={line} className="bpg-line" />
            {shown.map((p) => (
              <circle key={p.day} cx={x(p.day)} cy={y(p.score)} r="3.4" className="bpg-dot">
                <title>{`${p.day.slice(5)}: ${p.reps} ${p.reps === 1 ? 'rep' : 'reps'} of ${p.name}`}</title>
              </circle>
            ))}
            <circle cx={x(shown[shown.length - 1].day)} cy={y(shown[shown.length - 1].score)} r="5.5" className="bpg-now" />
            <text x={PAD.l} y={H - 6} className="bpg-axis">
              {start.slice(5)}
            </text>
            <text x={W - PAD.r} y={H - 6} className="bpg-axis" textAnchor="end">
              today
            </text>
          </svg>
          <p className="bpg-line-note">{v.line}</p>
          <ul className="bpg-legend" aria-label="Variations">
            {bands.map((b, i) => (
              <li key={b.move + b.from} className={`s${i % 2}`}>
                <i aria-hidden="true" />
                {b.name} <small>from {b.from.slice(5)}</small>
              </li>
            ))}
          </ul>
          <p className="bpg-foot">Higher is stronger. A harder variation counts more, so a step up never looks like a drop.</p>
        </>
      ) : (
        <p className="bpg-empty">{v.line}</p>
      )}
    </section>
  )
}
