// LF18: the life wheel. Once a quarter, rate 8 areas from 1 to 10 in two
// minutes; past quarters are drawn under this one, and the weakest area
// suggests the next season's theme.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { life } from '../bridge'
import { useAction } from '../ui'
import { artUrl } from '../wallpaper/art'
import { AREA_IDS, WHEEL_AREAS, average, quarterLabel, quarterOf, wheelChange, wheelHistory, wheelPoints, type Ratings, type WheelArea } from '@core/lifeWheel'
import type { SagaView } from '../web/sagaStore'

const C = 200
const R = 150
const PAST = ['#5aa8ff', '#b892ff', '#ff9f43']

export function WheelTab({ v, onSeason }: { v: SagaView; onSeason: () => void }) {
  const act = useAction()
  const q = quarterOf(v.today)
  const hist = useMemo(() => wheelHistory(v.wheel), [v.wheel])
  const saved = v.wheel.quarters[q] ?? {}
  const [r, setR] = useState<Ratings>(() => ({ ...Object.fromEntries(AREA_IDS.map((a) => [a, 5])), ...saved }))
  const [hover, setHover] = useState<WheelArea | null>(null)
  const [showPast, setShowPast] = useState(true)
  useEffect(() => {
    if (Object.keys(saved).length) setR((x) => ({ ...x, ...saved }))
  }, [JSON.stringify(saved)]) // eslint-disable-line react-hooks/exhaustive-deps
  const past = hist.filter((h) => h.q !== q).slice(-3)
  const prev = past[past.length - 1]?.ratings ?? null
  const change = wheelChange(r, prev)
  const dirty = AREA_IDS.some((a) => r[a] !== saved[a])
  const poly = (x: Ratings) => wheelPoints(x, C, C, R).map((p) => p.join(',')).join(' ')
  const sug = v.suggestion
  return (
    <div className="sg-wheel-page">
      <section className="sg-wheel-card">
        <header>
          <span className="sg-kicker">Life wheel · {quarterLabel(q)}</span>
          <h1 className="sg-title sm">How does life feel?</h1>
          <p className="sg-theme">{v.wheelDue.due ? `Rate this quarter (${v.wheelDue.daysLeft} days left). Two minutes, your gut, 1 to 10.` : `Rated. Average ${average(saved)}/10. You can change it until the quarter ends.`}</p>
        </header>
        <div className="sg-wheel-wrap">
          <svg className="sg-wheel" viewBox="0 0 400 400" role="img" aria-label={`Life wheel: ${AREA_IDS.map((a) => `${a} ${r[a] ?? '-'}`).join(', ')}`}>
            <defs>
              <radialGradient id="sgWheelFill" cx="50%" cy="50%" r="50%">
                <stop offset="0" stopColor="var(--accent, #c8f135)" stopOpacity="0.05" />
                <stop offset="1" stopColor="var(--accent, #c8f135)" stopOpacity="0.38" />
              </radialGradient>
            </defs>
            {[2, 4, 6, 8, 10].map((n) => <circle key={n} className="sg-wheel-ring" cx={C} cy={C} r={(R * n) / 10} />)}
            {WHEEL_AREAS.map((a, i) => {
              const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 8
              const x = C + Math.cos(ang) * (R + 30)
              const y = C + Math.sin(ang) * (R + 30)
              const lx = C + Math.cos(ang) * R
              const ly = C + Math.sin(ang) * R
              return (
                <g key={a.id} className={`sg-spoke ${hover === a.id ? 'on' : ''}`}>
                  <line x1={C} y1={C} x2={lx} y2={ly} />
                  <text x={x} y={y - 4} textAnchor="middle" className="sg-wheel-icon">{a.icon}</text>
                  <text x={x} y={y + 13} textAnchor="middle" className="sg-wheel-lbl">{a.label}</text>
                </g>
              )
            })}
            {showPast && past.map((h, i) => <polygon key={h.q} className="sg-wheel-past" points={poly(h.ratings)} style={{ stroke: PAST[(past.length - 1 - i) % PAST.length] }} />)}
            <polygon className="sg-wheel-now" points={poly(r)} fill="url(#sgWheelFill)" />
            {wheelPoints(r, C, C, R).map(([x, y], i) => <circle key={i} className="sg-wheel-dot" cx={x} cy={y} r={hover === AREA_IDS[i] ? 6 : 4} style={{ fill: WHEEL_AREAS[i].color }} />)}
            <text x={C} y={C + 6} textAnchor="middle" className="sg-wheel-avg">{average(r)}</text>
          </svg>
          {past.length > 0 && (
            <div className="sg-wheel-legend">
              <button className={`sg-chip ${showPast ? 'on' : ''}`} onClick={() => setShowPast((x) => !x)}>Past quarters</button>
              {showPast && past.map((h, i) => <span key={h.q} style={{ '--pc': PAST[(past.length - 1 - i) % PAST.length] } as CSSProperties}><i />{quarterLabel(h.q)} · {h.avg}</span>)}
              <span className="now"><i />{quarterLabel(q)} · {average(r)}</span>
            </div>
          )}
        </div>
      </section>
      <section className="sg-wheel-side">
        <div className="sg-rates">
          {WHEEL_AREAS.map((a) => (
            <label key={a.id} className="sg-rate" style={{ '--ac': a.color } as CSSProperties} onMouseEnter={() => setHover(a.id)} onMouseLeave={() => setHover(null)}>
              <span className="sg-rate-name"><span><span aria-hidden="true">{a.icon}</span> {a.label}</span><small>{a.ask}</small></span>
              <input type="range" min={1} max={10} value={r[a.id] ?? 5} onChange={(e) => setR((x) => ({ ...x, [a.id]: Number(e.target.value) }))} onFocus={() => setHover(a.id)} onBlur={() => setHover(null)} aria-label={`${a.label}, 1 to 10`} />
              <b>{r[a.id] ?? 5}</b>
              {change[a.id] ? <em className={change[a.id]! > 0 ? 'up' : 'down'}>{change[a.id]! > 0 ? `+${change[a.id]}` : change[a.id]}</em> : <em />}
            </label>
          ))}
        </div>
        <button className="btn primary" disabled={!dirty && !v.wheelDue.due} onClick={() => act(() => life.saga!.rateWheel(r), 'Saved. See you next quarter.')}>
          {v.wheelDue.due ? 'Save this quarter' : dirty ? 'Save changes' : 'Saved'}
        </button>
        {sug && (
          <div className="sg-next-theme" style={{ '--sc': sug.theme.color } as CSSProperties}>
            {artUrl(sug.theme.cover) && <img src={artUrl(sug.theme.cover)!} alt="" aria-hidden="true" />}
            <span className="sg-next-shade" />
            <div>
              <span className="sg-kicker">Ben suggests the next season</span>
              <b>{sug.theme.name}</b>
              <small>{sug.why}</small>
              <button className="btn sm" onClick={onSeason}>See seasons</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
