import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { isFlowRule } from '@core/rules'
import type { BodyState, CalendarEvent, ConnectionsState, DisciplineState, Rule, ScheduleState, ShopState, Summary, TasksState } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { MODULE_LABEL, MODULES, type PageId } from '../modules'
import { todayLayout, useUiPrefs, type TodaySectionId } from '../uiPrefs'
import type { QuestState } from '@shared/api'
import { Coins, describeEntry, timeAgo, useAction } from '../ui'
import { soundSuccess } from '../sound'
import { FocusToday } from './Focus'
import { DayFlow } from '../DayFlow'
import { SoloDailyQuestBanner } from '../SoloDailyQuestBanner'
import { ProgressCard } from './Progress'
import { FunCard } from '../FunCard'
import { DayTimeline } from '../DayTimeline'

type Pop = { id: number; coins: number; xp: number }

interface Props {
  summary: Summary
  rules: Rule[]
  shop: ShopState | null
  tasks: TasksState | null
  schedule: ScheduleState | null
  discipline: DisciplineState | null
  connections: ConnectionsState | null
  body?: BodyState | null
  onOpenApp: (page: PageId) => void
  onChange: (s?: Summary) => void
  onTasks: (t: TasksState) => void
  onSchedule: (s: ScheduleState) => void
  onGo: (page: PageId) => void
}

export function Today({ summary, rules, shop, tasks, schedule, discipline, connections, body, onOpenApp, onChange, onTasks, onSchedule, onGo }: Props) {
  const onOpenShop = () => onGo('shop')
  const act = useAction()
  const [pops, setPops] = useState<Pop[]>([])
  const titles = useMemo(() => Object.fromEntries(rules.map((r) => [r.id, r.title])), [rules])
  const groups = useMemo(() => {
    const g: Record<string, Rule[]> = {}
    for (const r of rules.filter((r) => r.enabled && !isFlowRule(r.id))) (g[r.module] ??= []).push(r)
    return g
  }, [rules])

  // Undo from Today, like History: a reversing entry, so nothing is lost.
  const undoneIds = useMemo(() => new Set(summary.recent.filter((e) => e.kind === 'undo').map((e) => e.undoOf)), [summary.recent])
  async function undo(id: number) {
    const s = await act(() => life.wallet.undo(id, 'Undone from Today'), 'Undone')
    if (s) onChange(s)
  }

  async function award(rule: Rule) {
    const s = await act(() => life.wallet.award(rule.id))
    if (!s) return
    const coins = s.balance - summary.balance
    const pop = { id: Date.now(), coins, xp: s.totalXp - summary.totalXp }
    setPops((p) => [...p, pop])
    setTimeout(() => setPops((p) => p.filter((x) => x.id !== pop.id)), 1400)
    onChange(s)
  }

  const [ui] = useUiPrefs()
  // Your sections, in your order (Settings → Today screen).
  const sections: Record<TodaySectionId, () => ReactNode> = {
    reps: () => (
        <>
      <SoloDailyQuestBanner
        body={body ?? null}
        summary={summary}
        onRefresh={() => onChange()}
        onGo={onGo}
      />
        </>
      ),
    day: () => (
      <DayFlow summary={summary} discipline={discipline} connections={connections} body={body ?? null} onChange={onChange} onGo={onGo} onOpenApp={onOpenApp} rules={rules} />
    ),
    focus: () => <FocusToday onWallet={() => onChange()} timerOnly />,
    progress: () => <ProgressCard onOpen={() => onGo('progress')} />,
    timeline: () => <DayTimeline onGo={onGo} />,
    fun: () => <FunCard onWallet={() => onChange()} onOpenShop={onOpenShop} />,
    quicklog: () => (
        <>
      <div className="cols">
        <section className="panel">
          <header className="panel-head">
            <h2>Quick log</h2>
            <button className="btn small ghost" onClick={() => onGo('rules')} title="Add your own habits, change coins, limits and cooldowns">
              <Icon name="edit" size={13} /> Edit habits & coins
            </button>
          </header>
          <p className="hint block">Tap what you just did. Limits and cooldowns apply.</p>
          <div className="groups">
            {Object.entries(groups).map(([mod, list]) => {
              const color = MODULES.find((m) => m.id === mod)?.color ?? 'var(--lime)'
              return (
                <div key={mod} className="group" style={{ ['--c' as string]: color }}>
                  <h3>{MODULE_LABEL[mod] ?? mod}</h3>
                  <div className="actions">
                    {list.map((r) => (
                      <motion.button key={r.id} className={`action ${r.coins < 0 ? 'penalty' : ''}`} whileTap={{ scale: 0.96 }} onClick={() => award(r)}>
                        <span>{r.title}</span>
                        <Coins n={r.coins} sign />
                      </motion.button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>Recent</h2>
          </header>
          {summary.recent.length === 0 ? (
            <div className="empty">
              <Icon name="spark" size={28} />
              <p>Nothing yet today. Log your first win.</p>
            </div>
          ) : (
            <ul className="feed">
              {summary.recent.map((e) => (
                <li key={e.id} className={e.kind === 'undo' ? 'muted' : ''}>
                  <span className="what">{describeEntry(e, titles)}</span>
                  <span className="when">{timeAgo(e.ts)}</span>
                  {e.kind !== 'undo' && <Coins n={e.coins} sign />}
                  {e.kind !== 'undo' && !undoneIds.has(e.id) && (
                    <button className="icon-btn feed-undo" title="Undo this (the coins go back)" aria-label="Undo" onClick={() => undo(e.id)}>
                      ↩
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
        </>
      )
  }

  return (
    <div className="today">
      {todayLayout(ui)
        .filter((x) => x.on)
        .map((x) => (
          <Fragment key={x.id}>{sections[x.id]()}</Fragment>
        ))}
    </div>
  )
}

function StatsStrip5({
  summary,
  shop,
  connections,
  discipline,
  body,
  pops,
  onOpenApp,
  onOpenShop
}: {
  summary: Summary
  shop: ShopState | null
  connections: ConnectionsState | null
  discipline: DisciplineState | null
  body: BodyState | null
  pops: Pop[]
  onOpenApp: (p: PageId) => void
  onOpenShop: () => void
}) {
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const target = shop?.rewards.find((r) => r.pinned) ?? shop?.rewards.find((r) => r.price > summary.balance) ?? null
  const pct = target ? Math.min(1, summary.balance / target.price) : 0
  const left = target ? target.price - summary.balance : 0

  const w = connections?.waky
  const f = connections?.finance
  const man = connections?.man.data
  const hidden = !!discipline?.stealth
  const money = (bani: number) => (bani / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })

  return (
    <section className="stats-strip-5 stats-strip-4" aria-label="Core Metrics">
      {/* 1. Today's Harvest & Goal */}
      <div className="metric-strip-card hero-card clickable" onClick={onOpenShop} title="Coins earned today & main wishlist goal">
        <div className="metric-strip-head">
          <span className="metric-strip-label">
            <Icon name="spark" size={13} /> Today's Coins
          </span>
          <span className="metric-strip-sub">{dateLabel}</span>
        </div>
        <div className="metric-strip-value" style={{ color: 'var(--lime)' }}>
          <Coins n={summary.todayCoins} sign />
        </div>
        <div className="metric-strip-sub">
          earned today
        </div>
        {target ? (
          <div className="metric-strip-progress" title={`${left > 0 ? `${left} coins to ${target.title}` : 'Ready to redeem!'}`}>
            <span style={{ maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              🎯 {target.title}
            </span>
            <div className="metric-strip-progress-bar">
              <i style={{ width: `${Math.round(pct * 100)}%` }} />
            </div>
            <span>{Math.round(pct * 100)}%</span>
          </div>
        ) : (
          <div className="metric-strip-progress">
            <span>Shop: Pick a goal</span>
          </div>
        )}
        <div className="pops" aria-hidden="true">
          <AnimatePresence>
            {pops.map((p) => (
              <motion.span
                key={p.id}
                className={`pop ${p.coins < 0 ? 'neg' : ''}`}
                initial={{ opacity: 0, y: 10, scale: 0.8 }}
                animate={{ opacity: 1, y: -24, scale: 1 }}
                exit={{ opacity: 0, y: -40 }}
                transition={{ duration: 0.6 }}
              >
                {p.coins >= 0 ? '+' : ''}{p.coins}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* 2. Sleep & Recovery (Waky) */}
      <div
        className="metric-strip-card clickable"
        style={{ ['--accent' as string]: '#6EE7D8' }}
        onClick={() => onOpenApp('sleep')}
        title="Waky: Circadian rhythm & wake-up tracking (Click to open)"
      >
        <div className="metric-strip-head">
          <span className="metric-strip-label">
            <Icon name="moon" size={13} /> Waky · Sleep
          </span>
          <span className="metric-strip-chevron">›</span>
        </div>
        <div className="metric-strip-value" style={{ color: '#6EE7D8' }}>
          {w?.today ? w.today.time : '–'}
        </div>
        <div className="metric-strip-sub">
          {w?.today
            ? (w.today.onTime ? `Up on time · Streak ${w.streak}d` : `Target ${w.today.target}`)
            : (w?.found ? 'No check-in yet' : 'Sleep tracker')}
        </div>
      </div>

      {/* 3. Everyday Spending (Finance Helper) */}
      <div
        className="metric-strip-card clickable"
        style={{ ['--accent' as string]: '#F5C84B' }}
        onClick={() => onOpenApp('money')}
        title="Finance Helper: Everyday budget & expenses (Click to open)"
      >
        <div className="metric-strip-head">
          <span className="metric-strip-label">
            <Icon name="coin" size={13} /> Finance Helper
          </span>
          <span className="metric-strip-chevron">›</span>
        </div>
        <div className="metric-strip-value" style={{ color: '#F5C84B' }}>
          {f?.today ? `${money(f.today.everydaySpent)} ${f.currency}` : '–'}
        </div>
        <div className="metric-strip-sub">
          {f?.today?.logged
            ? `${money(f.month?.spent ?? 0)} ${f.currency} this month`
            : 'Click to log today expenses'}
        </div>
      </div>

      {/* 4. Clean Streak & Discipline (MAN) */}
      <div
        className="metric-strip-card clickable"
        style={{ ['--accent' as string]: '#FF8A3D' }}
        onClick={() => onOpenApp('discipline')}
        title="MAN: Spartan Discipline Protocol (Click to open)"
      >
        <div className="metric-strip-head">
          <span className="metric-strip-label">
            <Icon name="shield" size={13} /> MAN · Discipline
          </span>
          <span className="metric-strip-chevron">›</span>
        </div>
        <div className="metric-strip-value" style={{ color: '#FF8A3D' }}>
          {hidden ? '••' : discipline?.setup ? `Day ${discipline.current}` : (man ? `Day ${man.streakDays}` : '–')}
        </div>
        <div className="metric-strip-sub">
          {hidden
            ? 'Stealth mode active'
            : discipline?.setup
            ? (discipline.checkedInToday ? `Day ${discipline.current} · checked in` : `Day ${discipline.current} · check in due`)
            : 'Not set up'}
        </div>
      </div>

      {/* 5. Workout (Sport Track) */}
      <div
        className="metric-strip-card clickable"
        style={{ ['--accent' as string]: '#00F2FE' }}
        onClick={() => onOpenApp('body')}
        title="Sport Track (click to open)"
      >
        <div className="metric-strip-head">
          <span className="metric-strip-label">
            <Icon name="bolt" size={13} /> Sport Track
          </span>
          <span className="metric-strip-chevron">›</span>
        </div>
        <div className="metric-strip-value" style={{ color: '#00F2FE' }}>
          {body?.workoutDoneToday ? 'Workout Done' : `${body?.streak ?? 0}d Streak`}
        </div>
        <div className="metric-strip-sub">
          {body?.workoutDoneToday
            ? 'Done today'
            : `${body?.workoutsThisWeek ?? 0} workouts this week · Ready to train`}
        </div>
      </div>
    </section>
  )
}

/** Unified Daily Quest Command Hub merging Quests + Daily Rituals without duplicate boxes */
function TodaySchedule({ schedule, onSchedule, onGo }: { schedule: ScheduleState | null; onSchedule: (s: ScheduleState) => void; onGo: (p: PageId) => void }) {
  const [todayCal, setTodayCal] = useState<CalendarEvent[]>([])

  useEffect(() => {
    const today = schedule?.today || new Date().toISOString().slice(0, 10)
    life.calendar
      .events(today)
      .then((evs) => setTodayCal(evs.slice(0, 6)))
      .catch(() => {})
  }, [schedule?.today])

  const blocks = schedule && schedule.day === schedule.today ? schedule.blocks : []
  const running = blocks.find((b) => b.status === 'running')
  const pendingBlocks = blocks.filter((b) => b.status === 'pending').slice(0, 4)

  return (
    <section className="panel today-schedule-compact">
      <header className="panel-head">
        <h2>Schedule & Appointments</h2>
        <button className="link" onClick={() => onGo('schedule')}>
          Open Full Calendar →
        </button>
      </header>

      {running && (
        <div style={{ background: 'rgba(0, 210, 255, 0.1)', border: '1px solid rgba(0, 210, 255, 0.4)', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: '11px', color: '#00d2ff', fontWeight: 800, textTransform: 'uppercase' }}>▶ Current Focus Block</span>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff' }}>{running.title}</div>
          </div>
          <button className="btn small primary" onClick={() => onGo('schedule')}>
            View Timer
          </button>
        </div>
      )}

      {blocks.length === 0 && todayCal.length === 0 ? (
        <div className="empty small-empty">
          <p>Nothing scheduled for today.</p>
          <button className="btn small" onClick={() => onGo('schedule')}>
            <Icon name="plus" size={14} /> Plan your day
          </button>
        </div>
      ) : (
        <ul className="feed" style={{ margin: 0, padding: 0 }}>
          {pendingBlocks.map((b) => (
            <li key={b.id} style={{ cursor: 'pointer', padding: '8px 10px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} onClick={() => onGo('schedule')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontFamily: 'monospace', fontSize: '11px', fontWeight: 700, color: '#7cc4ff', background: 'rgba(124, 196, 255, 0.12)', padding: '2px 6px', borderRadius: '4px' }}>
                  {b.start}
                </span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{b.title}</span>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{b.minutes}m</span>
            </li>
          ))}

          {todayCal.map((ev) => (
            <li key={ev.id} style={{ cursor: 'pointer', padding: '8px 10px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} onClick={() => onGo('schedule')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontFamily: 'monospace', fontSize: '11px', fontWeight: 700, color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', padding: '2px 6px', borderRadius: '4px' }}>
                  {ev.startTime}
                </span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{ev.title}</span>
              </div>
              {ev.location && (
                <span style={{ fontSize: '11px', color: 'var(--muted)', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  📍 {ev.location}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TodayTasks({ tasks, onTasks, onWallet, onGo }: { tasks: TasksState | null; onTasks: (t: TasksState) => void; onWallet: () => void; onGo: (p: PageId) => void }) {
  const act = useAction()
  if (!tasks) return <section className="panel" />
  const colors = Object.fromEntries(tasks.categories.map((c) => [c.id, c.color]))
  const list = tasks.tasks.slice(0, 7)
  const doneCount = tasks.tasks.filter((t) => t.done).length
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Tasks today</h2>
        <button className="link" onClick={() => onGo('tasks')}>
          All tasks
        </button>
      </header>
      {list.length === 0 ? (
        <div className="empty small-empty">
          <p>No tasks for today.</p>
          <button className="btn small" onClick={() => onGo('tasks')}>
            <Icon name="plus" size={14} /> Add a task
          </button>
        </div>
      ) : (
        <ul className="task-list compact">
          {list.map((t) => (
            <li key={t.id} className={`task ${t.done ? 'done' : ''} ${t.overdue ? 'overdue' : ''}`} style={{ ['--c' as string]: colors[t.category] }}>
              <motion.button
                className="tick"
                whileTap={{ scale: 0.85 }}
                aria-label={t.done ? `Untick ${t.title}` : `Complete ${t.title}`}
                onClick={async () => {
                  const s = await act(() => (t.done ? life.tasks.uncomplete(t.id) : life.tasks.complete(t.id)))
                  if (s) {
                    onTasks(s)
                    onWallet()
                  }
                }}
              >
                {t.done && <Icon name="check" size={13} />}
              </motion.button>
              <div className="task-body">
                <span className="task-title">{t.title}</span>
                {t.notes && <span className="task-notes">{t.notes}</span>}
              </div>
              {t.priority === 1 && <span className="p1-tag">P1</span>}
            </li>
          ))}
        </ul>
      )}
      {tasks.tasks.length > 0 && <p className="hint block-hint">{doneCount} of {tasks.tasks.length} done</p>}
    </section>
  )
}

