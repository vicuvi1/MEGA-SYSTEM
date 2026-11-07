// CR5, CR13, CR14, CR19: the emergency fund (N months of your real costs),
// pay yourself first for each income with its streak, the career fund ring,
// the income target by source with your moves, and the investing projection
// (educational only, after the emergency fund).
import { useState } from 'react'
import { life } from '../bridge'
import { NOT_ADVICE, SOURCE_LABEL, type IncomeSource, type ProjectionPoint } from '@core/career/money'
import type { CareerView } from '../web/career'
import { newId } from '../web/career'
import { CrRing, lei, shortDay, type Run } from './ui'

export function MoneyTab({ v, run }: { v: CareerView; run: Run }) {
  const c = life.career!
  const m = v.money
  const [moved, setMoved] = useState<Record<string, string>>({})
  const [move, setMove] = useState('')
  const [spend, setSpend] = useState({ what: '', lei: '' })
  const num = (s: string) => Math.max(0, Math.round(Number(s.replace(',', '.')) || 0))
  const save = (patch: Parameters<typeof c.savePlan>[0], msg?: string) => run(() => c.savePlan(patch), msg)
  return (
    <div className="cr-money">
      <section className="cr-card cr-ef" aria-label="Emergency fund">
        <CrRing pct={m.ef.pct} size={104} stroke={10} tone={m.ef.full ? 'good' : 'calm'}>
          <b>{m.ef.pct == null ? '–' : `${m.ef.pct}%`}</b>
          <small>{m.ef.monthsCovered == null ? 'safety net' : `${m.ef.monthsCovered} mo`}</small>
        </CrRing>
        <div>
          <h3>Emergency fund</h3>
          {m.ef.target ? (
            <p>
              <b>{lei(m.ef.saved)}</b> of {lei(m.ef.target)} · {m.plan.months} months of costs
              <br />
              <small className="hint">
                Your costs: about {lei(m.ef.costs ?? 0)} a month (Finance Helper, last full months). Saved = your {m.ef.source}
                {m.fund.left ? `, minus the career fund` : ''}.
              </small>
            </p>
          ) : (
            <p className="hint">Log a month of spending in Money and the target works itself out.</p>
          )}
          <div className="cr-step" role="group" aria-label="Months of costs">
            <button className="btn small ghost" onClick={() => void save({ months: m.plan.months - 1 })} disabled={m.plan.months <= 1} aria-label="Fewer months">
              −
            </button>
            <span>{m.plan.months} months</span>
            <button className="btn small ghost" onClick={() => void save({ months: m.plan.months + 1 })} disabled={m.plan.months >= 12} aria-label="More months">
              +
            </button>
          </div>
        </div>
      </section>
      <section className="cr-card cr-pay" aria-label="Pay yourself first">
        <h3>
          Pay yourself first <span className="cr-pill">{m.streak.now ? `🔥 ${m.streak.now} in a row` : 'no streak yet'}</span>
        </h3>
        <p className="hint">
          When money comes in, {m.plan.payPct}% goes to savings before anything else.{' '}
          <span className="cr-step inline">
            <button className="btn small ghost" onClick={() => void save({ payPct: m.plan.payPct - 5 })} disabled={m.plan.payPct <= 5} aria-label="Less">
              −
            </button>
            <span>{m.plan.payPct}%</span>
            <button className="btn small ghost" onClick={() => void save({ payPct: m.plan.payPct + 5 })} aria-label="More">
              +
            </button>
          </span>
        </p>
        {m.asks.length ? (
          <ul className="cr-asks">
            {m.asks.slice(0, 1).map((a) => (
              <li key={a.txId}>
                <span>
                  <b>{lei(a.income)}</b> came in {shortDay(a.day)} <small className="hint">({a.note})</small>
                </span>
                <input value={moved[a.txId] ?? String(a.ask)} onChange={(e) => setMoved((x) => ({ ...x, [a.txId]: e.target.value }))} inputMode="numeric" aria-label="Lei to move" className="cr-num" />
                <button className="btn small primary" onClick={() => void run(() => c.answerPay(a.txId, a.day, num(moved[a.txId] ?? String(a.ask))), 'Paid yourself first 💪')}>
                  Moved it
                </button>
                <button className="btn small ghost" onClick={() => void run(() => c.answerPay(a.txId, a.day, 0), 'Next time')}>
                  Not now
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">No new income waiting. Total moved first: {lei(m.streak.total)} (best run {m.streak.best}).</p>
        )}
      </section>
      <section className="cr-card cr-fund" aria-label="Career fund">
        <CrRing pct={m.fund.pct ?? (m.fund.left ? 100 : 0)} size={84} tone="gold">
          <b className="small">{lei(m.fund.left)}</b>
          <small>career fund</small>
        </CrRing>
        <div>
          <h3>Career fund</h3>
          <p className="hint">
            {m.plan.careerPct}% of what you move to savings is for certificates, courses and labs.
            {m.fund.goal ? ` Goal: ${m.plan.careerGoalName}, ${lei(m.fund.goal)}.` : ''}
          </p>
          <div className="cr-form-row">
            <input defaultValue={m.plan.careerGoalName} onBlur={(e) => e.target.value !== m.plan.careerGoalName && void save({ careerGoalName: e.target.value })} aria-label="What it is for" maxLength={60} />
            <input defaultValue={m.plan.careerGoal ?? ''} onBlur={(e) => void save({ careerGoal: num(e.target.value) || null })} placeholder="lei" inputMode="numeric" aria-label="Career fund goal in lei" className="cr-num" />
          </div>
          <form
            className="cr-form-row"
            onSubmit={(e) => {
              e.preventDefault()
              void run(() => c.addSpend(spend.what, num(spend.lei)), 'Spent from the career fund').then(() => setSpend({ what: '', lei: '' }))
            }}
          >
            <input value={spend.what} onChange={(e) => setSpend((x) => ({ ...x, what: e.target.value }))} placeholder="Spent on (a lab month)" maxLength={80} aria-label="Spent on" />
            <input value={spend.lei} onChange={(e) => setSpend((x) => ({ ...x, lei: e.target.value }))} placeholder="lei" inputMode="numeric" aria-label="Lei spent" className="cr-num" />
            <button className="btn small ghost" disabled={!spend.what.trim() || !num(spend.lei)}>
              Log
            </button>
          </form>
        </div>
      </section>
      <section className="cr-card cr-income" aria-label="Income growth">
        <h3>Income this month</h3>
        <div className="cr-inc-top">
          <b>{lei(m.income.total)}</b>
          <span className="hint">{m.income.target ? `of ${lei(m.income.target)} target · ${m.income.pct}%` : 'set a monthly target →'}</span>
          <input defaultValue={m.plan.incomeTarget ?? ''} onBlur={(e) => void save({ incomeTarget: num(e.target.value) || null }, 'Target saved')} placeholder="Target lei" inputMode="numeric" aria-label="Monthly income target in lei" className="cr-num" />
        </div>
        <div className="cr-bar pbar" aria-hidden>
          <i style={{ ['--p' as string]: m.income.target ? Math.min(1, m.income.total / m.income.target) : 0 }} />
        </div>
        <div className="cr-sources">
          {(Object.keys(SOURCE_LABEL) as IncomeSource[])
            .filter((k) => m.income.bySource[k] > 0)
            .map((k) => (
              <span key={k}>
                {SOURCE_LABEL[k]} <b>{lei(m.income.bySource[k])}</b>
              </span>
            ))}
          {m.income.avg3 != null && <span className="hint">3-month average {lei(m.income.avg3)}</span>}
        </div>
        <ul className="cr-moves">
          {m.plan.moves.map((x) => (
            <li key={x.id} className={x.done ? 'done' : ''}>
              <label>
                <input type="checkbox" checked={x.done} onChange={(e) => void save({ moves: m.plan.moves.map((y) => (y.id === x.id ? { ...y, done: e.target.checked } : y)) })} /> {x.text}
              </label>
              <button className="cr-x" onClick={() => void save({ moves: m.plan.moves.filter((y) => y.id !== x.id) })} aria-label={`Remove ${x.text}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        <form
          className="cr-form-row"
          onSubmit={(e) => {
            e.preventDefault()
            void save({ moves: [...m.plan.moves, { id: newId('m'), text: move.trim(), done: false }] }).then(() => setMove(''))
          }}
        >
          <input value={move} onChange={(e) => setMove(e.target.value)} placeholder="A move that grows income (an internship, a gig a month)" maxLength={120} aria-label="Add a move" />
          <button className="btn small ghost" disabled={!move.trim()}>
            Add
          </button>
        </form>
      </section>
      <section className="cr-card cr-invest" aria-label="Investing plan">
        <header>
          <h3>Investing plan, after the safety net</h3>
          <span className={`cr-pill${m.ef.full ? ' ok' : ''}`}>{m.ef.full ? 'Emergency fund full: ready' : 'Starts when the emergency fund is full'}</span>
        </header>
        <div className="cr-form-row cr-inv-in">
          <label>
            Each month <input defaultValue={m.plan.investMonthly} onBlur={(e) => void save({ investMonthly: num(e.target.value) })} inputMode="numeric" className="cr-num" aria-label="Lei a month" /> lei
          </label>
          <label>
            for <input defaultValue={m.plan.investYears} onBlur={(e) => void save({ investYears: num(e.target.value) || 10 })} inputMode="numeric" className="cr-num s" aria-label="Years" /> years
          </label>
          <label>
            at <input defaultValue={m.plan.investRate} onBlur={(e) => void save({ investRate: Number(e.target.value.replace(',', '.')) || 0 })} inputMode="decimal" className="cr-num s" aria-label="Assumed yearly return" />% a year
          </label>
        </div>
        <Projection points={m.projection} />
        <p className="cr-note">ⓘ {NOT_ADVICE} A broad, low-cost fund spreads money over many companies; compare costs before you choose.</p>
      </section>
    </div>
  )
}

/** The projection as an area chart in lei: a band (rate ±2 points), the middle line, and what you paid in. */
function Projection({ points }: { points: ProjectionPoint[] }) {
  const W = 720
  const H = 140
  const pad = { l: 8, r: 8, t: 10, b: 18 }
  const last = points[points.length - 1]
  const max = Math.max(1, last.high)
  const x = (i: number) => pad.l + (i / Math.max(1, points.length - 1)) * (W - pad.l - pad.r)
  const y = (val: number) => H - pad.b - (val / max) * (H - pad.t - pad.b)
  const line = (k: 'value' | 'paid') => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ')
  const band = `${points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.high).toFixed(1)}`).join(' ')} ${[...points].reverse().map((p, i) => `L${x(points.length - 1 - i).toFixed(1)},${y(p.low).toFixed(1)}`).join(' ')} Z`
  return (
    <figure className="cr-proj">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`After ${last.year} years: about ${lei(last.value)} (between ${lei(last.low)} and ${lei(last.high)}), of which you paid in ${lei(last.paid)}`}>
        <path d={band} className="band" />
        <path d={line('paid')} className="paid" />
        <path d={line('value')} className="val" />
        {points.map((p, i) => (i % Math.max(1, Math.round(points.length / 5)) === 0 || i === points.length - 1 ? <text key={i} x={x(i)} y={H - 4} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>{`${p.year}y`}</text> : null))}
      </svg>
      <figcaption>
        <span>
          <i className="k val" /> could grow to <b>{lei(last.value)}</b>
        </span>
        <span>
          <i className="k band" /> range {lei(last.low)}–{lei(last.high)}
        </span>
        <span>
          <i className="k paid" /> you put in {lei(last.paid)}
        </span>
      </figcaption>
    </figure>
  )
}
