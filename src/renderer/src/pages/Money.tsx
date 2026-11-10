// Money (Night 11, MO1): one native hub in the Coach look, built on Finance
// Helper's synced data: safe to spend today with a budget ring, one-line
// quick add, where the money goes, the forecast to month end, savings goals,
// the fun budget and what a point is worth. The full Finance Helper app is one
// tap away ("Open full app", the embedded app). The old separate expense
// list is gone: every lei comes from Finance Helper.
import { PageTabs, TabPanel, usePageTab } from '../PageTabs'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ConnectionsState, MoneyDaysState } from '@shared/api'
import { life } from '../bridge'
import { useCountUp, useSeen } from '../motionKit'
import { Icon } from '../Icon'
import { soundCoin, soundWarning } from '../soundKit'
import { useAction } from '../ui'
import { usePoints } from '../usePoints'
import { flyTo, QuickAddBox } from '../MoneyQuick'
import { budgetEffect, goalPlan, leiText, mergeGoals, overLine, worstLevel, daysInMonth, type BudgetLevel, type GoalIn, type GoalPlan } from '@core/moneyHub'
import { pointValue, pointValueLine, type PointValue } from '@core/pointValue'
import type { MoneyHubView } from '../web/moneyHub'
import '../money.css'
import { Donut } from '../Donut'

const lei = (bani: number) => Math.round(bani / 100).toLocaleString('en-US')
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const dow = (iso: string) => DOW[new Date(`${iso}T12:00:00Z`).getUTCDay()]
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDay = (iso: string) => `${Number(iso.slice(8))} ${SHORT[Number(iso.slice(5, 7)) - 1]}`

interface ShopValue {
  value: PointValue
  funBudgetLei: number | null
  funSpentLei: number
  funLeftLei: number | null
  hourlyLei: number | null
}

/**
 * Today's honest money moments (FX3): finished days are judged and paid once
 * first, then "Nothing spent today" and "I cooked at home" are offered.
 */
function useMoneyDays(onWallet: () => void) {
  const [state, setState] = useState<MoneyDaysState | null>(null)
  useEffect(() => {
    if (!life.money?.days) return
    life.connections
      .sync()
      .then((r) => r.awarded && onWallet())
      .catch(() => {})
      .finally(() => life.money.days().then(setState).catch(() => {}))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { state, setState }
}

/** The Money hub's data, refreshed when money or points change anywhere. */
function useHub(): [MoneyHubView | null | undefined, (v: MoneyHubView | null) => void, () => void] {
  const [view, setView] = useState<MoneyHubView | null | undefined>(undefined)
  const load = useCallback(() => {
    if (!life.finance) return setView(null)
    life.finance
      .hub()
      .then(setView)
      .catch(() => setView(null))
  }, [])
  useEffect(() => {
    load()
    const on = (e: Event) => {
      const r = (e as CustomEvent).detail
      if (r?.view) setView(r.view)
      else load()
    }
    const names = ['life-money-changed', 'life-finance-changed', 'life-wallet-changed']
    for (const n of names) window.addEventListener(n, on)
    return () => names.forEach((n) => window.removeEventListener(n, on))
  }, [load])
  return [view, setView, load]
}

export function Money({ state, onState, onWallet, onOpenApp }: { state: ConnectionsState; onState: (s: ConnectionsState) => void; onWallet: () => void; onOpenApp?: () => void }) {
  const [view] = useHub()
  const [tab, setTab] = usePageTab('money', ['today', 'month', 'goals'], 'today')
  const days = useMoneyDays(onWallet)
  const ring = useRef<HTMLDivElement>(null)
  const [pop, setPop] = useState(0)
  const openApp = onOpenApp ?? (() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'money' })))
  const added = (r: { line: string; amount: number; type: string }, input: HTMLElement | null) => {
    void flyTo(input, ring.current, `${r.type === 'income' ? '+' : '−'}${lei(r.amount)}`).then(() => setPop((n) => n + 1))
    onWallet()
  }
  return (
    <div className="mh">
      <div className="mh-amb" aria-hidden="true">
        <i className="a" />
        <i className="b" />
        <i className="c" />
      </div>
      {view === undefined ? (
        <HubSkeleton />
      ) : !view ? (
        <EmptyHub onOpenApp={openApp} />
      ) : (
        <>
          <PageTabs
            page="money"
            label="Money views"
            tabs={[
              { id: 'today', label: 'Today', title: 'Safe to spend, quick add, what you logged (1)' },
              { id: 'month', label: 'Month', title: 'Where money goes and the forecast (2)' },
              { id: 'goals', label: 'Goals & points', title: 'Savings goals, fun budget, points for money (3)' }
            ]}
            value={tab}
            onChange={setTab}
          />
          <TabPanel page="money" id="today" value={tab}>
            <div className="mh-top">
              <Hero view={view} ringRef={ring} pop={pop} streak={days.state?.streak.days ?? 0} />
              <section className="mh-card mh-quick">
                <header className="mh-head">
                  <h2>
                    <Icon name="plus" size={16} /> Quick add
                  </h2>
                  <span className="mh-hint">Enter saves</span>
                </header>
                <QuickAddBox onAdded={added} />
                <Recent view={view} />
              </section>
            </div>
            <OpenApp onOpenApp={openApp} />
          </TabPanel>
          <TabPanel page="money" id="month" value={tab}>
            <div className="mh-grid">
              <WhereMoneyGoes view={view} />
              <Forecast view={view} />
            </div>
          </TabPanel>
          <TabPanel page="money" id="goals" value={tab}>
            <div className="mh-grid">
              <Goals view={view} />
              <div className="mh-stack">
                <FunCard />
                <PointsCard state={state} onState={onState} days={days} onWallet={onWallet} />
              </div>
            </div>
          </TabPanel>
        </>
      )}
      <BankImport />
    </div>
  )
}

// ---------------------------------------------------------------- the hero

function Ring({ frac, level, size = 168, stroke = 14, children, className = '' }: { frac: number; level: BudgetLevel; size?: number; stroke?: number; children?: ReactNode; className?: string }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(Math.max(0, Math.min(1, frac))))
    return () => cancelAnimationFrame(id)
  }, [frac])
  const r = (size - stroke) / 2
  return (
    <div className={`mh-ring lv-${level} ${className}`} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle className="bg" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle className="fg" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} pathLength={1} style={{ strokeDashoffset: 1 - shown }} />
      </svg>
      <div className="mh-ring-mid">{children}</div>
    </div>
  )
}

function Hero({ view, ringRef, pop, streak }: { view: MoneyHubView; ringRef: React.RefObject<HTMLDivElement | null>; pop: number; streak: number }) {
  const h = view.hero
  const left = useCountUp(Math.max(0, h.leftToday), 380)
  const level = worstLevel(h.dayLevel, h.monthLevel)
  const [fx, setFx] = useState<'flash' | 'shake' | null>(null)
  const [ben, setBen] = useState<string | null>(null)
  const prev = useRef<BudgetLevel | null>(null)
  useEffect(() => {
    const was = prev.current
    prev.current = level
    if (was === null) return
    const e = budgetEffect(was, level)
    if (!e) return
    setFx(e)
    if (e === 'shake') {
      soundWarning()
      setBen(overLine(Math.max(0, -h.leftToday), h.tomorrow || null))
    }
    const id = setTimeout(() => setFx(null), 700)
    return () => clearTimeout(id)
  }, [level, h.leftToday, h.tomorrow])
  useEffect(() => {
    if (h.leftToday < 0) setBen(overLine(-h.leftToday, h.tomorrow || null))
  }, [h.leftToday, h.tomorrow])
  // Finished days under budget (the honest saving streak) earn a small badge.
  const max = Math.max(1, ...view.week.map((d) => d.spent), h.perDay)
  const [chartRef, seen] = useSeen<HTMLDivElement>()
  const frac = h.perDay > 0 ? Math.max(0, h.leftToday) / h.perDay : 0
  return (
    <section className={`mh-card mh-hero lv-${level} ${fx ? `fx-${fx}` : ''}`}>
      <div className="mh-hero-main">
        <span className="mh-eyebrow">Safe to spend today</span>
        <div className="mh-big">
          <span className="num">{lei(left)}</span>
          <small>lei</small>
        </div>
        <p className="mh-sub">
          {h.short > 0 ? (
            <>Bills and savings need {leiText(h.short)} more before payday.</>
          ) : (
            <>
              <b>{leiText(Math.max(0, h.left))}</b> left for {h.leftDays} {h.leftDays === 1 ? 'day' : 'days'}
              {h.leftFor === 'limit' ? ' of your monthly limit' : ' until payday'}
            </>
          )}
        </p>
        <div className="mh-chips">
          <span>
            Spent today <b>{leiText(h.spentToday)}</b>
          </span>
          {h.perDay > 0 && (
            <span>
              Day's share <b>{leiText(h.perDay)}</b>
            </span>
          )}
          {streak > 0 && <span className="mh-badge">🏅 {streak === 1 ? 'Under budget yesterday' : `${streak} days under budget`}</span>}
        </div>
        {ben && (
          <div className="mh-ben" role="status">
            <span className="mh-ben-face">B</span>
            <span>{ben}</span>
          </div>
        )}
      </div>
      <div className="mh-hero-side" ref={ringRef}>
        <Ring frac={frac} level={level}>
          <span className="mh-ring-num num">{h.perDay > 0 ? `${Math.round(frac * 100)}%` : '–'}</span>
          <small>{h.leftToday < 0 ? 'over today' : 'of today left'}</small>
        </Ring>
        {pop > 0 && (
          <span key={pop} className="mh-coin" aria-hidden="true">
            🪙
          </span>
        )}
      </div>
      <div className={`mh-week chart-in ${seen ? 'seen' : ''}`} ref={chartRef}>
        <div className="mh-bars">
          {h.perDay > 0 && <span className="mh-line" style={{ transform: `translateY(${-(h.perDay / max) * 64}px)` }} title="Today's share" />}
          {view.week.map((d, i) => (
            <div key={d.day} className={`mh-bar ${d.day === view.today ? 'today' : ''} ${h.perDay > 0 && d.spent > h.perDay ? 'over' : ''}`} title={`${shortDay(d.day)}: ${leiText(d.spent)}`}>
              <i style={{ height: `${Math.max(3, (d.spent / max) * 64)}px`, animationDelay: `${i * 30}ms` }} />
              <small>{dow(d.day)}</small>
            </div>
          ))}
        </div>
        <span className="mh-week-note">Last 7 days · {view.weekCompare.line.replace(/^This week: /, 'this week ')}</span>
      </div>
    </section>
  )
}

function Recent({ view }: { view: MoneyHubView }) {
  if (!view.recent.length) return <p className="mh-hint block">Nothing logged yet. Try “45 lunch”.</p>
  return (
    <ul className="mh-recent">
      {view.recent.slice(0, 4).map((t) => (
        <li key={t.id}>
          <span className="mh-emoji">{t.emoji}</span>
          <span className="mh-what">
            <b>{t.note || t.category}</b>
            <small>
              {t.category} · {t.account} · {t.date === view.today ? 'today' : shortDay(t.date)}
            </small>
          </span>
          <span className={`mh-amt num ${t.type === 'income' ? 'in' : ''}`}>
            {t.type === 'income' ? '+' : '−'}
            {lei(t.amount)}
          </span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------- the insights

const DONUT_COLORS = ['var(--accent)', '#38bdf8', '#a78bfa', '#fbbf24', '#f472b6', '#34d399', '#fb7185', '#94a3b8']

function WhereMoneyGoes({ view }: { view: MoneyHubView }) {
  const c = view.compare
  const [ref] = useSeen<HTMLDivElement>()
  const total = Math.max(1, c.thisTotal)
  const top = c.byCat.slice(0, 6)
  const rest = c.byCat.slice(6).reduce((s, r) => s + r.now, 0)
  const parts = [...top.map((r) => ({ key: r.id, name: `${r.emoji ? r.emoji + ' ' : ''}${r.name}`, v: r.now })), ...(rest ? [{ key: 'rest', name: 'Everything else', v: rest }] : [])]
  const monthWord = c.month === view.today.slice(0, 7) ? 'this month' : ''
  return (
    <section className="mh-card mh-where" ref={ref}>
      <header className="mh-head">
        <h2>Where money goes</h2>
        <span className="mh-hint">
          {monthWord} · days 1–{c.days} against the same days before
        </span>
      </header>
      <div className="mh-where-body">
        <Donut parts={parts.map((p, i) => ({ key: p.key, value: p.v, color: DONUT_COLORS[i % DONUT_COLORS.length], label: p.name }))} total={total}>
          <b className="num">{lei(c.thisTotal)}</b>
          <small>lei spent</small>
          {c.pct !== null && <em className={c.pct > 0 ? 'up' : c.pct < 0 ? 'down' : ''}>{c.pct > 0 ? `▲ ${c.pct}%` : c.pct < 0 ? `▼ ${Math.abs(c.pct)}%` : 'same as before'}</em>}
        </Donut>
        <ul className="mh-legend">
          {parts.map((p, i) => (
            <li key={p.key}>
              <i style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
              <span>{p.name}</span>
              <b className="num">{lei(p.v)}</b>
            </li>
          ))}
          {!parts.length && <li className="mh-hint">Nothing spent yet this month.</li>}
        </ul>
      </div>
      {/* This month so far is the number in the ring: only last month's comparison here. */}
      <div className="mh-vs">
        <div>
          <small>Same days last month</small>
          <b className="num">{leiText(c.lastTotal)}</b>
        </div>
      </div>
      {c.changes.length > 0 && (
        <ul className="mh-changes">
          {c.changes.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Forecast({ view }: { view: MoneyHubView }) {
  const f = view.forecast
  const [ref, seen] = useSeen<HTMLDivElement>()
  const W = 320
  const H = 132
  const pad = 10
  const all = [...f.actual, ...f.projected].map((p) => p.net)
  const lo = Math.min(0, ...all)
  const hi = Math.max(0, ...all, 1)
  const dim = f.projected.length + f.actual.length - 1
  const x = (i: number) => pad + (i / Math.max(1, dim - 1)) * (W - pad * 2)
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo || 1)) * (H - pad * 2)
  const solid = f.actual.map((p, i) => `${x(i).toFixed(1)},${y(p.net).toFixed(1)}`).join(' ')
  const start = f.actual.length - 1
  const dotted = f.projected.map((p, i) => `${x(start + i).toFixed(1)},${y(p.net).toFixed(1)}`).join(' ')
  const endV = f.projected.at(-1)?.net ?? f.endNet
  const good = f.endNet >= 0
  const area = f.actual.length > 1 ? `M${x(0).toFixed(1)},${y(0).toFixed(1)} L${solid.split(' ').join(' L')} L${x(start).toFixed(1)},${y(0).toFixed(1)} Z` : ''
  const todayPct = (x(start) / W) * 100
  return (
    <section className="mh-card mh-forecast" ref={ref}>
      <header className="mh-head">
        <h2>Forecast</h2>
        <span className="mh-hint">income minus spending this month</span>
      </header>
      <p className={`mh-forecast-line ${good ? 'good' : 'bad'}`}>{f.line}</p>
      <div className={`mh-chart chart-in ${seen ? 'seen' : ''}`}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="mh-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line className="zero" x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} />
          <line className="today" x1={x(start)} x2={x(start)} y1={pad} y2={H - pad} />
          {area && <path className="area" d={area} fill="url(#mh-area)" />}
          {f.actual.length > 1 && <polyline className="draw solid" points={solid} pathLength={1} />}
          {f.projected.length > 1 && <polyline className="proj" points={dotted} />}
          <circle className="now" cx={x(start)} cy={y(f.actual.at(-1)?.net ?? 0)} r="4" />
          <circle className={`end ${good ? 'good' : 'bad'}`} cx={x(dim - 1)} cy={y(endV)} r="4" />
        </svg>
        <span className={`mh-chart-end ${good ? 'good' : 'bad'}`} style={{ top: `${(y(endV) / H) * 150}px` }}>
          {good ? '+' : '−'}
          {lei(Math.abs(f.endNet))}
        </span>
        <div className="mh-chart-x">
          <span>1 {SHORT[Number(f.month.slice(5, 7)) - 1]}</span>
          <span className="mid" style={{ left: `${todayPct}%` }}>
            today
          </span>
          <span>{daysInMonth(f.month)}</span>
        </div>
      </div>
      <div className="mh-vs three">
        <div>
          <small>Spend up to</small>
          <b className="num">{leiText(f.safeDaily)}</b>
          <small>a day to end even</small>
        </div>
        <div>
          <small>Your pace</small>
          <b className="num">{leiText(f.pace)}</b>
          <small>a day</small>
        </div>
        <div>
          <small>Bills ahead</small>
          <b className="num">{view.bills.length ? leiText(view.bills.reduce((s, b) => s + b.amount, 0)) : '–'}</b>
          <small>{view.bills.length ? `next: ${view.bills[0].name}, ${shortDay(view.bills[0].date)}` : 'next 7 days'}</small>
        </div>
      </div>
    </section>
  )
}

function Goals({ view }: { view: MoneyHubView }) {
  const [wish, setWish] = useState<GoalIn[]>([])
  useEffect(() => {
    life.economy
      ?.goals?.()
      .then((list: any[]) =>
        setWish(
          (list ?? [])
            .filter((g) => !g.completed && Number(g.targetRealCost) > 0)
            .map((g) => ({ id: `w${g.id}`, name: String(g.title), emoji: '🎁', target: Math.round(Number(g.targetRealCost) * 100), current: Math.round(Number(g.allocatedRealCost || 0) * 100), source: 'rewards' as const }))
        )
      )
      .catch(() => setWish([]))
  }, [])
  const goals: GoalPlan[] = useMemo(() => {
    const fin = view.goals
    const merged = mergeGoals(fin, wish)
    return merged.map((g) => ('perWeek' in g ? (g as GoalPlan) : goalPlan(g, view.today))).slice(0, 4)
  }, [view, wish])
  return (
    <section className="mh-card mh-goals">
      <header className="mh-head">
        <h2>Savings goals</h2>
        <span className="mh-hint">Finance Helper + Rewards wishlist</span>
      </header>
      {goals.length ? (
        <div className="mh-goal-list">
          {goals.map((g) => (
            <div key={g.id} className="mh-goal">
              <Ring frac={g.ratio} level={g.ratio >= 1 ? 'ok' : 'none'} size={74} stroke={8} className="small">
                <span className="mh-goal-emoji">{g.emoji ?? '🎯'}</span>
              </Ring>
              <div className="mh-goal-text">
                <b>{g.name}</b>
                <small className="num">
                  {lei(g.current)} of {leiText(g.target)} · {Math.round(g.ratio * 100)}%
                </small>
                <span>{g.line}</span>
                {g.eta && g.eta !== 'done' && <small>At your pace: {g.eta}</small>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mh-hint block">No goals yet. Add one in Finance Helper or in Rewards.</p>
      )}
    </section>
  )
}

function FunCard() {
  const [v, setV] = useState<ShopValue | null>(null)
  useEffect(() => {
    const shop = life.shop as any
    Promise.resolve(shop.value?.() ?? null)
      .then((r: ShopValue | null) => setV(r ?? { value: pointValue({ funBudgetLei: null, earnPerDay: 0 }), funBudgetLei: null, funSpentLei: 0, funLeftLei: null, hourlyLei: null }))
      .catch(() => setV({ value: pointValue({ funBudgetLei: null, earnPerDay: 0 }), funBudgetLei: null, funSpentLei: 0, funLeftLei: null, hourlyLei: null }))
  }, [])
  if (!v) return <section className="mh-card mh-fun" />
  const budget = v.funBudgetLei ?? 0
  const frac = budget > 0 ? Math.max(0, budget - v.funSpentLei) / budget : 0
  return (
    <section className="mh-card mh-fun">
      <header className="mh-head">
        <h2>
          <Icon name="gift" size={16} /> Fun budget
        </h2>
        <button className="mh-link" onClick={() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'shop' }))}>
          Rewards →
        </button>
      </header>
      <div className="mh-fun-body">
        <Ring frac={frac} level={budget > 0 && frac < 0.2 ? 'warn' : 'ok'} size={96} stroke={10} className="small">
          <span className="mh-ring-num small num">{budget > 0 ? lei(Math.max(0, budget - v.funSpentLei) * 100) : '–'}</span>
          <small>lei left</small>
        </Ring>
        <div className="mh-fun-text">
          {budget > 0 ? (
            <p>
              <b>{lei(v.funSpentLei * 100)}</b> of {lei(budget * 100)} lei spent on fun this month.
            </p>
          ) : (
            <p>Set a monthly fun budget in Rewards: points then buy exactly that much fun.</p>
          )}
          <p className="mh-pv">{pointValueLine(v.value)}</p>
          <small>{v.value.source === 'budget' ? `Your fun budget over the ${v.value.usualMonthlyPoints} points you usually earn a month.` : 'The standard rate until you set a fun budget.'}</small>
          {v.hourlyLei ? <small>An hour of your work ≈ {Math.round(v.hourlyLei)} lei.</small> : null}
        </div>
      </div>
    </section>
  )
}

function PointsCard({ state, onState, days, onWallet }: { state: ConnectionsState; onState: (s: ConnectionsState) => void; days: ReturnType<typeof useMoneyDays>; onWallet: () => void }) {
  const pts = usePoints()
  const act = useAction()
  const [draft, setDraft] = useState<string | null>(null)
  const f = state.finance
  const d = days.state
  const t = d?.today
  const nothing = async () => {
    const r = await act(() => life.money.nothingSpent(), `Noted. If it stays that way, tonight counts as a no-spend day (+${pts('money.no_spend', 8)})`)
    if (r) days.setState(r)
  }
  const cooked = async () => {
    const r = await act(() => life.money.confirmCooked(), `Cooked at home: +${pts('money.cooked_home', 5)}`)
    if (r) {
      days.setState(r)
      soundCoin()
      onWallet()
    }
  }
  const save = async () => {
    const s = await act(() => life.connections.setDailyBudget(parseInt(draft ?? '0', 10) || 0), 'Daily budget saved')
    if (s) {
      onState(s)
      setDraft(null)
    }
  }
  return (
    <section className="mh-card mh-points">
      <header className="mh-head">
        <h2>
          <Icon name="coin" size={16} /> Points for money
        </h2>
      </header>
      <ul className="mh-rules">
        <li>
          <span>First money log of the day</span>
          <b>+{pts('money.logged', 3)}</b>
        </li>
        <li>
          <span>A day under your daily budget</span>
          <b>+{pts('money.under_budget', 5)}</b>
        </li>
      </ul>
      {t && (
        <div className="mh-today-btns">
          {t.everydayBani === 0 && (
            <button className="mh-pillbtn" onClick={nothing} disabled={t.nothingSpentTapped}>
              {t.nothingSpentTapped ? '✓ Nothing spent today' : 'Nothing spent today'}
            </button>
          )}
          <button className={`mh-pillbtn ${t.cookedGuess && !t.cooked ? 'hot' : ''}`} onClick={cooked} disabled={t.cooked}>
            {t.cooked ? '✓ Cooked at home' : t.cookedGuess ? 'Did you cook at home? Yes' : 'I cooked at home'}
          </button>
        </div>
      )}
      {d && (
        <p className="mh-hint block">
          {d.streak.days > 0 ? `${d.streak.days} day${d.streak.days === 1 ? '' : 's'} in a row under budget` : 'No days in a row under budget yet'}
          {d.streak.next ? ` · ${d.streak.next.days} in a row pays +${d.streak.next.points}` : ''}. Only what you log on the day counts.
        </p>
      )}
      <div className="mh-budget-row">
        <span>Daily budget for points</span>
        {draft === null ? (
          <button className="mh-link" onClick={() => setDraft(String(f.dailyBudget || ''))}>
            {f.dailyBudget ? `${f.dailyBudget} lei · change` : 'Set one'}
          </button>
        ) : (
          <span className="mh-inline">
            <input autoFocus type="number" min={0} inputMode="numeric" aria-label="Daily budget in lei" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
            <button className="mq-go" onClick={() => void save()}>
              Save
            </button>
          </span>
        )}
      </div>
    </section>
  )
}

function OpenApp({ onOpenApp }: { onOpenApp: () => void }) {
  return (
    <button className="mh-card mh-open" onClick={onOpenApp}>
      <span className="mh-open-icon">
        <Icon name="coin" size={26} />
      </span>
      <span className="mh-open-text">
        <b>Open full app</b>
        <small>Finance Helper: accounts, bills, jars, edit and split, CSV import, everything else</small>
      </span>
      <span className="mh-open-go">
        <Icon name="expand" size={18} />
      </span>
    </button>
  )
}

function HubSkeleton() {
  return (
    <div className="mh-top" aria-busy="true">
      <section className="mh-card mh-hero mh-skel" />
      <section className="mh-card mh-quick mh-skel" />
    </div>
  )
}

function EmptyHub({ onOpenApp }: { onOpenApp: () => void }) {
  return (
    <section className="mh-card mh-empty">
      <span className="mh-open-icon">
        <Icon name="coin" size={28} />
      </span>
      <h2>Your money lives in Finance Helper</h2>
      <p>Open it once on this device (or log something on Telegram) and this page fills in: safe to spend today, where money goes and your goals.</p>
      <button className="mq-go big" onClick={onOpenApp}>
        Open Finance Helper
      </button>
    </section>
  )
}

/** MC9: a bank statement (CSV) → new payments for Finance Helper; read here, never stored. */
function BankImport() {
  const act = useAction()
  const [on, setOn] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  useEffect(() => {
    life.plugins?.state().then((s) => setOn(!!s.on.bank)).catch(() => {})
  }, [])
  if (!on || !life.plugins) return null
  const pick = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 2_000_000) return setSaid('⚠️ That file is too big (2 MB at most).')
    const text = await file.text()
    const r = await act(() => life.plugins!.importBank(text))
    if (r) setSaid(r)
  }
  return (
    <section className="mh-card mh-bank">
      <header className="mh-head">
        <h2>
          <Icon name="coin" size={16} /> Import a bank statement
        </h2>
      </header>
      <p className="mh-hint block">Choose the CSV export from your bank. Payments you already have are skipped; the new ones go to Finance Helper. The file stays on this device and isn't kept. You can also send the file to Ben on Telegram.</p>
      <label className="mq-go" style={{ display: 'inline-flex', cursor: 'pointer' }}>
        Choose CSV file
        <input type="file" accept=".csv,text/csv" hidden onChange={(e) => void pick(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
      </label>
      {said && <p className="mh-hint block">{said}</p>}
    </section>
  )
}
