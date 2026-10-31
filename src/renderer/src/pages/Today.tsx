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
import { SoloSystemModal } from '../SoloSystemModal'
import { DungeonRaidCards } from '../DungeonRaidCards'
import { TodoistPanel } from '../TodoistPanel'
import { FocusToday } from './Focus'
import { DayFlow } from '../DayFlow'
import { SoloDailyQuestBanner } from '../SoloDailyQuestBanner'
import { ProgressCard } from './Progress'
import { FunCard } from '../FunCard'

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
    greeting: () => <Greeting summary={summary} shop={shop} tasks={tasks} schedule={schedule} />,
    apps: () => (
        <>
      <StatsStrip5
        summary={summary}
        shop={shop}
        connections={connections}
        discipline={discipline}
        body={body ?? null}
        pops={pops}
        onOpenApp={onOpenApp}
        onOpenShop={onOpenShop}
      />
        </>
      ),
    pillars: () => (
        <>
      <DailyGrandSlamCard
        summary={summary}
        discipline={discipline}
        connections={connections}
        body={body ?? null}
        onGo={onGo}
        onChange={onChange}
      />
        </>
      ),
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
    checklist: () => (
        <>
      <UnifiedQuestHub
        summary={summary}
        discipline={discipline}
        connections={connections}
        body={body ?? null}
        onChange={onChange}
        onGo={onGo}
        onOpenApp={onOpenApp}
      />
        </>
      ),
    day: () => (
      <DayFlow summary={summary} discipline={discipline} connections={connections} body={body ?? null} onChange={onChange} onGo={onGo} onOpenApp={onOpenApp} />
    ),
    focus: () => <FocusToday onWallet={() => onChange()} timerOnly />,
    progress: () => <ProgressCard onOpen={() => onGo('progress')} />,
    fun: () => <FunCard onWallet={() => onChange()} onOpenShop={onOpenShop} />,
    todoist: () => <TodoistPanel today={summary.today} onWallet={() => onChange()} />,
    raids: () => <DungeonRaidCards balance={summary.balance} onAwardCoins={() => onChange()} />,
    plan: () => (
        <>
      <div className="cols even">
        <TodaySchedule schedule={schedule} onSchedule={onSchedule} onGo={onGo} />
        <TodayTasks tasks={tasks} onTasks={onTasks} onWallet={() => onChange()} onGo={onGo} />
      </div>
        </>
      ),
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

function Greeting({ summary, shop, tasks, schedule }: { summary: Summary; shop: ShopState | null; tasks: TasksState | null; schedule: ScheduleState | null }) {
  const [ui] = useUiPrefs()
  const h = new Date().getHours()
  const hello = h < 5 ? 'Night Watch' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Evening Command'
  const blocksLeft = schedule && schedule.day === schedule.today ? schedule.blocks.filter((b) => b.status === 'pending' || b.status === 'running').length : 0
  const tasksLeft = tasks?.tasks.filter((t) => !t.done).length ?? 0
  const goal = shop?.rewards.find((r) => r.pinned)
  const ANTI_LAZINESS_QUOTES = [
    '⚡ ARISE · The system grants zero rewards to the hesitant. Strike now.',
    '⚔️ DISCIPLINE PROTOCOL ACTIVE · Every rep, focus block, and clean hour fuels S-Rank power.',
    '🛡️ ZERO DOPAMINE SLIPS · Sloth is the only dungeon boss you must execute today.',
    '👑 MONARCH AWAKENING · The weak make excuses; the strong conquer the slate.',
    '🔥 CONQUER THE SLATE · One focused action right now destroys hours of procrastination.',
    '💎 IRON STANDARD · What you do today echoes into your stats forever.'
  ]
  const quote = ANTI_LAZINESS_QUOTES[new Date().getDate() % ANTI_LAZINESS_QUOTES.length]
  const pct = goal ? Math.min(100, Math.round((summary.balance / goal.price) * 100)) : 0

  return (
    <header className="greeting-cockpit">
      <div className="greeting-top">
        <div className="greeting-title-wrap">
          <span className="greeting-pulse-beacon" />
          <h2>
            {hello}
            {ui.name ? `, ${ui.name}` : ''}
          </h2>
          <span className="greeting-status-tag">SYSTEM ACTIVE · S-RANK</span>
        </div>
        <span
          className="greeting-life-badge"
          title="LIFE · Every real-life action fuels real human growth"
        >
          <span>🌱</span> LIFE · REAL GROWTH
        </span>
      </div>

      <div className="greeting-quote-row">
        <span className="greeting-quote-text">{quote}</span>
      </div>

      <div className="greeting-telemetry-row">
        <div className="telemetry-pill">
          <span className="telemetry-dot cyan" />
          <span><b>{blocksLeft}</b> Block{blocksLeft === 1 ? '' : 's'} Left</span>
        </div>
        <div className="telemetry-pill">
          <span className="telemetry-dot lime" />
          <span><b>{tasksLeft}</b> Open Task{tasksLeft === 1 ? '' : 's'}</span>
        </div>
        {goal && (
          <div className="telemetry-pill" title={goal.price - summary.balance > 0 ? `${goal.price - summary.balance} coins to go` : 'Ready to redeem!'}>
            <span className="telemetry-dot gold" />
            <span>🎯 <b>{goal.title}</b> ({pct}%)</span>
          </div>
        )}
        <div className="telemetry-pill">
          <span className="telemetry-dot purple" />
          <span>🔥 <b>+{summary.todayCoins}</b> 🪙 Harvested</span>
        </div>
      </div>
    </header>
  )
}

/** Sleek 5-Card Metric Strip combining Today Coins/Goal, Waky Sleep, Finance Spend, MAN Discipline, Sport Track */
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
          +{summary.todayXp} XP today
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
                {p.coins >= 0 ? '+' : ''}{p.coins} · +{p.xp} XP
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
            ? (discipline.checkedInToday ? `${discipline.rank} · checked in` : `${discipline.rank} · check in due`)
            : 'Spartan Citadel'}
        </div>
      </div>

      {/* 5. Hunter Athletics & Workout (Sport Track) */}
      <div
        className="metric-strip-card clickable"
        style={{ ['--accent' as string]: '#00F2FE' }}
        onClick={() => onOpenApp('body')}
        title="Sport Track: Hunter Athletics & Progressive Overload (Click to open)"
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
            ? '+10 🪙 & +25 XP awarded'
            : `${body?.workoutsThisWeek ?? 0} workouts this week · Ready to train`}
        </div>
      </div>
    </section>
  )
}

/** Unified Daily Quest Command Hub merging Quests + Daily Rituals without duplicate boxes */
function UnifiedQuestHub({
  summary,
  discipline,
  connections,
  body,
  onChange,
  onGo,
  onOpenApp
}: {
  summary: Summary
  discipline: DisciplineState | null
  connections: ConnectionsState | null
  body: BodyState | null
  onChange: (s?: Summary) => void
  onGo: (p: PageId) => void
  onOpenApp: (p: PageId) => void
}) {
  const act = useAction()
  const [q, setQ] = useState<QuestState | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    life.wallet.quests().then(setQ).catch(() => {})
  }, [summary])

  const directives = [
    {
      id: 'oath',
      label: 'Morning Spartan Oath',
      detail: 'Affirm your iron standard',
      coins: 3,
      xp: 5,
      color: '#FF8A3D',
      icon: 'shield' as const,
      done: Boolean(discipline?.oathToday || summary.todayRules?.includes('discipline.oath')),
      actionLabel: 'Take Oath',
      action: async () => {
        const d = await act(() => life.discipline.oath(), 'Morning oath sworn!')
        if (d) {
          soundSuccess()
          onChange()
        }
      }
    },
    {
      id: 'clean',
      label: 'Clean Day Check-in',
      detail: discipline?.setup ? `Day ${discipline.current} clean` : 'Zero dopamine slip',
      coins: 20,
      xp: 40,
      color: '#FF8A3D',
      icon: 'shield' as const,
      done: Boolean(discipline?.checkedInToday || summary.todayRules?.includes('discipline.clean_day')),
      actionLabel: 'Check In',
      action: async () => {
        const d = await act(() => life.discipline.checkIn(), 'Checked in clean!')
        if (d) {
          soundSuccess()
          onChange()
        }
      }
    },
    {
      id: 'workout',
      label: 'Physical Training',
      detail: body?.workoutDoneToday ? 'Workout logged today' : 'Heavy compound workout',
      coins: 10,
      xp: 25,
      color: '#FF6B8B',
      icon: 'bolt' as const,
      done: Boolean(body?.workoutDoneToday || summary.todayRules?.includes('body.workout_done')),
      actionLabel: 'Log Body',
      action: () => onGo('body')
    },
    {
      id: 'study',
      label: 'Deep Focus Session',
      detail: 'Finish planned study block',
      coins: 20,
      xp: 30,
      color: '#38BDF8',
      icon: 'spark' as const,
      done: Boolean(summary.todayRules?.includes('study.block_done')),
      actionLabel: 'Schedule',
      action: () => onGo('schedule')
    },
    {
      id: 'skincare',
      label: 'Skincare Routine',
      detail: 'Facial hygiene & defense',
      coins: 5,
      xp: 10,
      color: '#7CC4FF',
      icon: 'spark' as const,
      done: Boolean(summary.todayRules?.includes('face.routine_done')),
      actionLabel: 'Done',
      action: async () => {
        const s = await act(() => life.wallet.award('face.routine_done'), 'Skincare routine complete')
        if (s) {
          soundSuccess()
          onChange(s)
        }
      }
    },
    {
      id: 'spending',
      label: 'Spending Log',
      detail: connections?.finance.today?.logged ? 'Daily spending recorded' : 'Track expenses in Finance',
      coins: 3,
      xp: 5,
      color: '#F5C84B',
      icon: 'coin' as const,
      done: Boolean(connections?.finance.today?.logged || summary.todayRules?.includes('money.logged')),
      actionLabel: 'Log Expense',
      action: () => onOpenApp('money')
    }
  ]

  const doneCount = directives.filter((d) => d.done).length
  const pct = Math.round((doneCount / directives.length) * 100)
  const canClaimBonus = Boolean(q && q.allDone && !q.claimed)

  return (
    <section className={`panel unified-quest-hub solo-hud-frame ${canClaimBonus ? 'all' : ''}`} aria-label="Daily Directives">
      <div className="solo-corner-bottom-left" />
      <div className="solo-corner-bottom-right" />
      <div className="solo-scanline" />

      <header className="quest-hub-head">
        <div className="quest-hub-title-group">
          <div className="quest-hub-icon-shield">⚡</div>
          <div>
            <h2 className="quest-hub-title">[ DAILY QUEST COMMAND HUB: ACTIVE DIRECTIVES ]</h2>
            <span className="quest-hub-sub">
              {q?.claimed
                ? '✨ System Quests Claimed · All daily objectives accomplished. Reality is the dungeon.'
                : `${doneCount} of ${directives.length} Cleared (${pct}%) · Directives Payout: +${directives.reduce((s, d) => s + (d.done ? d.coins : 0), 0)} Coins`}
            </span>
          </div>
        </div>

        {canClaimBonus && (
          <motion.button
            className="btn solo-quest-claim-btn"
            whileTap={{ scale: 0.95 }}
            onClick={() => setModalOpen(true)}
          >
            ✦ CLAIM SYSTEM REWARDS (+{q!.bonus.coins} COINS, +{q!.bonus.xp} XP)
          </motion.button>
        )}

        {q?.claimed && (
          <button
            className="btn small ghost"
            style={{ borderColor: 'rgba(0, 210, 255, 0.3)', color: '#00d2ff', fontSize: 11 }}
            onClick={() => setModalOpen(true)}
            title="View Completed Daily Quest System Hologram"
          >
            View Quest Hologram
          </button>
        )}
      </header>

      <div className="quest-hub-overall-bar">
        <motion.i initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.3 }} />
      </div>

      <div className="quest-hub-grid">
        {directives.map((d) => (
          <div key={d.id} className={`quest-directive-card ${d.done ? 'done' : ''}`} style={{ ['--c' as string]: d.color }}>
            <div className="quest-directive-left">
              <span className="quest-directive-icon">
                <Icon name={d.done ? 'check' : d.icon} size={14} />
              </span>
              <div className="quest-directive-info">
                <b>{d.label}</b>
                <small>
                  <span>{d.detail}</span>
                  <span className="quest-directive-reward">+{d.coins}🪙</span>
                </small>
              </div>
            </div>
            {d.done ? (
              <span className="quest-directive-badge">
                <Icon name="check" size={11} /> Clear
              </span>
            ) : (
              <motion.button
                className="btn small primary quest-directive-btn"
                whileTap={{ scale: 0.94 }}
                onClick={d.action}
              >
                {d.actionLabel}
              </motion.button>
            )}
          </div>
        ))}
      </div>

      {q && (
        <SoloSystemModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          type="quest-complete"
          data={{
            coins: q.bonus.coins,
            xp: q.bonus.xp,
            objectives: directives.map((d) => ({ label: d.label, done: d.done })),
            onAction: async () => {
              if (!q.claimed) {
                const s = await act(() => life.wallet.claimQuests(), 'Daily Quest Rewards Accepted!')
                if (s) onChange(s)
              }
            }
          }}
        />
      )}
    </section>
  )
}

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


function DailyGrandSlamCard({
  summary,
  discipline,
  connections,
  body,
  onGo,
  onChange
}: {
  summary: Summary
  discipline: DisciplineState | null
  connections: ConnectionsState | null
  body: BodyState | null
  onGo: (p: PageId) => void
  onChange: (s?: Summary) => void
}) {
  const act = useAction()
  const todayRules = summary.todayRules || []
  const sleepDone = Boolean(todayRules.some((r) => r.startsWith('sleep.')) || connections?.waky?.today?.onTime)
  const discDone = Boolean(discipline?.checkedInToday || todayRules.some((r) => r.startsWith('discipline.')))
  const sportDone = Boolean(body?.workoutDoneToday || todayRules.some((r) => r.startsWith('body.')))
  const moneyDone = Boolean(connections?.finance?.today?.logged || todayRules.some((r) => r.startsWith('money.')))

  const pillars = [
    { id: 'sleep', name: 'Sleep', icon: '🌙', done: sleepDone, page: 'sleep' as PageId },
    { id: 'discipline', name: 'Discipline', icon: '🛡️', done: discDone, page: 'discipline' as PageId },
    { id: 'sport', name: 'Sport', icon: '⚔️', done: sportDone, page: 'body' as PageId },
    { id: 'money', name: 'Money', icon: '💰', done: moneyDone, page: 'money' as PageId }
  ]

  const count = pillars.filter((p) => p.done).length
  const allDone = count === 4
  const claimed = todayRules.includes('grand_slam.all_four')

  const handleClaim = async () => {
    const s = await act(() => life.wallet.award('grand_slam.all_four', 'Daily 4-Pillar Grand Slam (Sovereign Day)'))
    if (s) {
      soundSuccess()
      onChange(s)
    }
  }

  return (
    <section className={`grand-slam-card ${claimed || allDone ? 'completed' : ''}`}>
      <div className="grand-slam-header">
        <div className="grand-slam-title-group">
          <span className="grand-slam-crest">{claimed ? '👑' : allDone ? '🌟' : '🏛️'}</span>
          <div className="grand-slam-title">
            <span>4-Pillar Sovereign Day</span>
            <span className={`grand-slam-badge ${claimed ? 'achieved' : allDone ? 'achieved' : 'pending'}`}>
              {claimed ? 'CLAIMED (+50 🪙)' : `${count} / 4 CONQUERED`}
            </span>
          </div>
        </div>

        {allDone && !claimed && (
          <button className="grand-slam-claim-btn" onClick={handleClaim}>
            ⚡ CLAIM GRAND SLAM (+50 🪙 / +100 XP)
          </button>
        )}
      </div>

      <div className="grand-slam-pillars">
        {pillars.map((p) => (
          <div
            key={p.id}
            className={`grand-slam-pillar ${p.done ? 'done' : ''}`}
            onClick={() => onGo(p.page)}
            role="button"
            tabIndex={0}
            title={`Click to open ${p.name}`}
          >
            <span className="grand-slam-pillar-icon">{p.icon}</span>
            <div className="grand-slam-pillar-info">
              <span className="grand-slam-pillar-name">{p.name}</span>
              <span className="grand-slam-pillar-status">{p.done ? '✓ Complete' : 'Pending tap'}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
