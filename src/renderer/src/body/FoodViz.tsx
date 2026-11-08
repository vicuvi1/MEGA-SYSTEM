// The food counter's pictures: the four day rings and the week chart (bars for
// protein and kcal against the goal, a weight line). The numbers come from
// core/foodDisplay.ts (pure and tested); this only draws them, with theme tokens.
import type { Ring, WeekChart } from '@core/foodDisplay'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const R = 28
const C = 2 * Math.PI * R

export function Rings({ rings }: { rings: Ring[] }) {
  return (
    <div className="fd-rings" role="group" aria-label="Today's protein, kcal, carbs and fat">
      {rings.map((r) => (
        <div key={r.id} className={`fd-ring ${r.id}${r.over ? ' over' : ''}${r.frac >= 1 && !r.over ? ' done' : ''}`} data-ring={r.id}>
          <svg viewBox="0 0 72 72" width="72" height="72" aria-hidden="true">
            <circle className="fd-ring-bg" cx="36" cy="36" r={R} />
            <circle className="fd-ring-fg" cx="36" cy="36" r={R} strokeDasharray={`${C * r.frac} ${C}`} transform="rotate(-90 36 36)" />
          </svg>
          <span className="fd-ring-num">
            <b>{fmt(r.value)}</b>
            <small>
              of {fmt(r.goal)}
              {r.unit ? ` ${r.unit}` : ''}
            </small>
          </span>
          <span className="fd-ring-label">{r.label}</span>
        </div>
      ))}
    </div>
  )
}

const W = 600
const H = 230
const L = 44
const RGT = 44
const T = 14
const B = 34

export function WeekChartView({ chart }: { chart: WeekChart }) {
  const pw = W - L - RGT
  const ph = H - T - B
  const gw = pw / chart.days.length
  const bw = Math.min(22, gw / 3)
  const y = (f: number) => T + ph * (1 - f)
  const wpts = chart.days.map((d, i) => (d.wY == null ? null : { x: L + gw * i + gw / 2, y: y(0.12 + 0.76 * d.wY), d })).filter((p): p is { x: number; y: number; d: (typeof chart.days)[number] } => !!p)
  const hasWeight = wpts.length > 0
  const summary = `Protein and kcal for the last 7 days against your goals (${fmt(chart.proteinGoal)} g, ${fmt(chart.kcalGoal)} kcal)${hasWeight ? ', and your weight' : ''}.`
  return (
    <figure className="fd-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} preserveAspectRatio="xMidYMid meet">
        <line className="fd-axis" x1={L} y1={y(0)} x2={W - RGT} y2={y(0)} />
        <line className="fd-goal" x1={L} y1={y(chart.goalY)} x2={W - RGT} y2={y(chart.goalY)} />
        <text className="fd-tick" x={L - 6} y={y(chart.goalY) + 4} textAnchor="end">
          goal
        </text>
        <text className="fd-tick" x={L - 6} y={y(0) + 4} textAnchor="end">
          0
        </text>
        <text className="fd-tick" x={L - 6} y={T + 10} textAnchor="end">
          {chart.topPct}%
        </text>
        {chart.days.map((d, i) => {
          const x0 = L + gw * i + gw / 2
          return (
            <g key={d.day} data-day={d.day}>
              <rect className="fd-bar-p" x={x0 - bw - 1} y={y(d.pH)} width={bw} height={Math.max(0, ph * d.pH)} rx="3">
                <title>{`${d.label}: protein ${fmt(d.protein)} g of ${fmt(chart.proteinGoal)} g`}</title>
              </rect>
              <rect className="fd-bar-k" x={x0 + 1} y={y(d.kH)} width={bw} height={Math.max(0, ph * d.kH)} rx="3">
                <title>{`${d.label}: ${fmt(d.kcal)} kcal of ${fmt(chart.kcalGoal)} kcal`}</title>
              </rect>
              <text className="fd-tick" x={x0} y={H - 16} textAnchor="middle">
                {d.label}
              </text>
              <text className="fd-val" x={x0} y={H - 3} textAnchor="middle">
                {d.protein ? `${fmt(d.protein)} g` : ''}
              </text>
            </g>
          )
        })}
        {hasWeight && (
          <g className="fd-wline">
            <polyline points={wpts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" />
            {wpts.map((p) => (
              <circle key={p.d.day} cx={p.x} cy={p.y} r="3.5">
                <title>{`${p.d.label}: ${p.d.weight} kg`}</title>
              </circle>
            ))}
            <text className="fd-tick" x={W - RGT + 6} y={y(0.12 + 0.76 * 1) + 4}>
              {chart.weightMax} kg
            </text>
            <text className="fd-tick" x={W - RGT + 6} y={y(0.12) + 4}>
              {chart.weightMin} kg
            </text>
          </g>
        )}
      </svg>
      <figcaption className="fd-legend">
        <span>
          <i className="sw p" /> Protein
        </span>
        <span>
          <i className="sw k" /> kcal
        </span>
        <span>
          <i className="sw g" /> Goal line (both, in % of the goal)
        </span>
        {hasWeight ? (
          <span>
            <i className="sw w" /> Weight (own scale)
          </span>
        ) : (
          <span className="muted">No weight logged this week: add it on Body to see the line.</span>
        )}
      </figcaption>
    </figure>
  )
}
