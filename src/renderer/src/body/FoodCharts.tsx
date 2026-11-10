// Body → Food → More → Charts: what the last 2 weeks of meals (photos and
// every other way) say: kcal and protein of an average meal per meal type (two
// charts, one scale each), when you eat (meals per hour) and the foods you eat
// most. Numbers from core/foodInsights.ts foodCharts; each bar has its value as
// text and a hover title. No points.
import { useEffect, useState } from 'react'
import { life } from '../bridge'
import type { FoodCharts as Charts } from '@core/foodInsights'
import './food-gallery.css'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const TYPE: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }
const hh = (h: number) => String(h).padStart(2, '0')

function Bars({ rows, unit, label }: { rows: { name: string; value: number; sub?: string }[]; unit: string; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <figure className="fdc-bars" aria-label={label}>
      <figcaption>{label}</figcaption>
      <ul>
        {rows.map((r) => (
          <li key={r.name} title={`${r.name}: ${fmt(r.value)} ${unit}${r.sub ? ` (${r.sub})` : ''}`}>
            <span className="fdc-name">{r.name}</span>
            <span className="fdc-track">
              <span className="fdc-fill" style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
            <span className="fdc-val num">
              {fmt(r.value)} {unit}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

export function FoodCharts() {
  const api = life.coach?.food
  const [c, setC] = useState<Charts | null>(null)
  useEffect(() => {
    if (!api?.charts) return
    const load = () => api.charts(14).then(setC).catch(() => {})
    load()
    window.addEventListener('life-body-changed', load)
    return () => window.removeEventListener('life-body-changed', load)
  }, [api])
  if (!c) return <p className="muted">Loading…</p>
  if (!c.meals) return <p className="muted fdc-empty">No meals in the last 2 weeks yet. Log a few and the charts fill in.</p>
  const types = c.byType.filter((t) => t.meals)
  const peak = Math.max(1, ...c.byHour.map((h) => h.meals))
  return (
    <div className="fdc" aria-label="Food charts">
      <h3 className="fd-sub-title">Last 2 weeks</h3>
      <p className="muted fdc-note">
        {c.meals} meals, {c.photoMeals} from photos. An average meal of each type:
      </p>
      <div className="fdc-two">
        <Bars label="kcal per meal" unit="kcal" rows={types.map((t) => ({ name: TYPE[t.type], value: t.kcal, sub: `${t.meals} meals` }))} />
        <Bars label="Protein per meal" unit="g" rows={types.map((t) => ({ name: TYPE[t.type], value: t.protein, sub: `${t.meals} meals` }))} />
      </div>
      <figure className="fdc-hours" aria-label="When you eat: meals per hour">
        <figcaption>When you eat</figcaption>
        <div className="fdc-cols">
          {c.byHour.map((h) => (
            <span key={h.hour} className="fdc-col" title={`${hh(h.hour)}:00–${hh(h.hour)}:59: ${h.meals} ${h.meals === 1 ? 'meal' : 'meals'}, ${fmt(h.kcal)} kcal`}>
              <span className="fdc-colfill" style={{ height: `${(h.meals / peak) * 100}%` }} data-n={h.meals} />
              <small className="num">{h.hour % 3 === 0 ? hh(h.hour) : ''}</small>
            </span>
          ))}
        </div>
      </figure>
      <figure className="fdc-top" aria-label="Most eaten foods">
        <figcaption>Most eaten</figcaption>
        <table>
          <thead>
            <tr>
              <th>Food</th>
              <th className="num">Times</th>
              <th className="num">Usual</th>
              <th className="num">kcal</th>
              <th className="num">Protein</th>
            </tr>
          </thead>
          <tbody>
            {c.top.map((f) => (
              <tr key={f.name}>
                <td>{f.name}</td>
                <td className="num">{f.times}</td>
                <td className="num">{fmt(f.grams)} g</td>
                <td className="num">{fmt(f.kcal)}</td>
                <td className="num">{fmt(f.protein)} g</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figure>
    </div>
  )
}
