import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { isFlowRule } from '@core/rules'
import type { BodyState, CalendarEvent, ConnectionsState, DisciplineState, LevelInfo, Rule, ScheduleState, ShopState, Summary, TasksState } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { MODULE_LABEL, MODULES, type PageId } from '../modules'
import { clock } from './planUi'
import { KIND } from './Schedule'
import { DualTimeline } from '../DualTimeline'
import { useUiPrefs } from '../uiPrefs'
import type { QuestState } from '@shared/api'
import { Coins, describeEntry, timeAgo, useAction } from '../ui'
import { soundSuccess } from '../sound'

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

  async function award(rule: Rule) {
    const s = await act(() => life.wallet.award(rule.id))
    if (!s) return
    const coins = s.balance - summary.balance
    const pop = { id: Date.now(), coins, xp: s.totalXp - summary.totalXp }
    setPops((p) => [...p, pop])
    setTimeout(() => setPops((p) => p.filter((x) => x.id !== pop.id)), 1400)
    onChange(s)
  }

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="today">
      <Greeting summary={summary} shop={shop} tasks={tasks} schedule={schedule} />
      <HunterDashboardBanner level={summary.level} onGo={onGo} />
      <Quests summary={summary} onChange={onChange} />
      <section className="stats">
        <div className="stat hero">
          <span className="label">{dateLabel}</span>
          <div className="big">
            <Coins n={summary.todayCoins} sign />
          </div>
          <span className="sub">coins today · +{summary.todayXp} XP</span>
          <div className="pops" aria-hidden="true">
            <AnimatePresence>
              {pops.map((p) => (
                <motion.span key={p.id} className={`pop ${p.coins < 0 ? 'neg' : ''}`} initial={{ opacity: 0, y: 10, scale: 0.8 }} animate={{ opacity: 1, y: -28, scale: 1 }} exit={{ opacity: 0, y: -48 }} transition={{ duration: 0.6 }}>
                  {p.coins >= 0 ? '+' : ''}
                  {p.coins} · +{p.xp} XP
                </motion.span>
              ))}
            </AnimatePresence>
          </div>
        </div>
        <NextReward balance={summary.balance} shop={shop} onOpenShop={onOpenShop} />
        <DisciplineCard state={discipline} onGo={onGo} />
      </section>

      <AppTiles connections={connections} discipline={discipline} body={body ?? null} onOpenApp={onOpenApp} />
      <DailyRituals summary={summary} discipline={discipline} connections={connections} body={body ?? null} onChange={onChange} onGo={onGo} onOpenApp={onOpenApp} />

      <div className="cols even">
        <TodaySchedule schedule={schedule} onSchedule={onSchedule} onGo={onGo} />
        <TodayTasks tasks={tasks} onTasks={onTasks} onWallet={() => onChange()} onGo={onGo} />
      </div>

      <div className="cols">
        <section className="panel">
          <header className="panel-head">
            <h2>Quick log</h2>
            <span className="hint">Tap what you just did. Limits and cooldowns apply.</span>
          </header>
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
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function NextReward({ balance, shop, onOpenShop }: { balance: number; shop: ShopState | null; onOpenShop: () => void }) {
  const target = shop?.rewards.find((r) => r.pinned) ?? shop?.rewards.find((r) => r.price > balance) ?? null
  if (!target) {
    return (
      <button className="stat clickable" onClick={onOpenShop}>
        <span className="label">Next reward</span>
        <div className="big">
          <Coins n={balance} />
        </div>
        <span className="sub">Pick a main goal in the Shop</span>
      </button>
    )
  }
  const pct = Math.min(1, balance / target.price)
  const left = target.price - balance
  return (
    <button className={`stat clickable ${target.imageUrl ? 'next-reward-stat' : ''}`} onClick={onOpenShop}>
      {target.imageUrl && (
        <div className="next-reward-thumb-wrap">
          <img
            src={target.imageUrl}
            alt={target.title}
            className="next-reward-thumb"
            onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none' }}
          />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="label">Main goal · {target.title}</span>
        <div className="big">{Math.round(pct * 100)}%</div>
        <div className="bar goal">
          <motion.i initial={false} animate={{ width: `${pct * 100}%` }} />
        </div>
        <span className="sub">{left > 0 ? `${left} coins to go` : 'Ready to redeem!'}</span>
      </div>
    </button>
  )
}

function TodaySchedule({ schedule, onSchedule, onGo }: { schedule: ScheduleState | null; onSchedule: (s: ScheduleState) => void; onGo: (p: PageId) => void }) {
  return <DualTimeline schedule={schedule} onSchedule={onSchedule} onGo={onGo} />
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
              <span className="task-title">{t.title}</span>
              <Coins n={t.coins} sign />
            </li>
          ))}
        </ul>
      )}
      {tasks.tasks.length > 0 && <p className="hint block-hint">{doneCount} of {tasks.tasks.length} done</p>}
    </section>
  )
}

function DisciplineCard({ state, onGo }: { state: DisciplineState | null; onGo: (p: PageId) => void }) {
  if (!state) return <div className="stat" />
  const hidden = state.stealth
  return (
    <button className="stat clickable disc-card" onClick={() => onGo('discipline')}>
      <span className="label">Discipline</span>
      {!state.setup ? (
        <>
          <div className="big small-big">Set up</div>
          <span className="sub">Start your private streak</span>
        </>
      ) : (
        <>
          <div className="big">{hidden ? '••' : state.current} <small>days</small></div>
          <span className="sub">{hidden ? 'Hidden' : state.checkedInToday ? `${state.rank} · checked in today` : state.resetToday ? 'Fresh start. Check in tomorrow.' : `${state.rank} · check in today`}</span>
        </>
      )}
    </button>
  )
}

/** Live glance at the apps inside Life System; a click opens the app. */
function AppTiles({ connections, discipline, body, onOpenApp }: { connections: ConnectionsState | null; discipline: DisciplineState | null; body: BodyState | null; onOpenApp: (p: PageId) => void }) {
  if (!connections) return null
  const w = connections.waky
  const f = connections.finance
  const man = connections.man.data
  const hidden = !!discipline?.stealth
  const money = (bani: number) => (bani / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })
  const tiles = [
    {
      page: 'sleep' as PageId,
      icon: 'moon' as const,
      color: '#6EE7D8',
      app: 'Waky',
      value: w.today ? w.today.time : '–',
      sub: w.today ? (w.today.onTime ? `Up on time · streak ${w.streak}` : `Up late (target ${w.today.target})`) : w.found ? 'No check-in yet today' : 'Waky not found'
    },
    {
      page: 'money' as PageId,
      icon: 'coin' as const,
      color: '#F5C84B',
      app: 'Finance Helper',
      value: f.today ? `${money(f.today.everydaySpent)} ${f.currency}` : '–',
      sub: f.today ? (f.today.logged ? `spent today · ${money(f.month?.spent ?? 0)} this month` : 'Nothing logged today') : 'Open Money once to load it'
    },
    {
      page: 'discipline' as PageId,
      icon: 'shield' as const,
      color: '#FF8A3D',
      app: 'MAN',
      value: hidden ? '••' : discipline?.setup ? `Day ${discipline.current}` : man ? `Day ${man.streakDays}` : '–',
      sub: hidden ? 'Hidden' : discipline?.setup ? discipline.rank : man ? `best ${man.longestStreak}` : 'Not set up'
    }
  ]
  return (
    <section className="app-tiles" aria-label="Your apps">
      {tiles.map((t) => (
        <motion.button key={t.page} className="app-tile" style={{ ['--c' as string]: t.color }} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} onClick={() => onOpenApp(t.page)}>
          <span className="app-tile-icon">
            <Icon name={t.icon} size={18} />
          </span>
          <span className="app-tile-body">
            <span className="label">{t.app}</span>
            <b>{t.value}</b>
            <small>{t.sub}</small>
          </span>
          <span className="app-tile-go" aria-hidden="true">
            ›
          </span>
        </motion.button>
      ))}
    </section>
  )
}


function DailyRituals({
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
  const rituals = [
    {
      id: 'oath',
      label: 'Morning Oath',
      detail: 'Affirm your standard today',
      coins: 3,
      xp: 5,
      color: '#FF8A3D',
      icon: 'shield' as const,
      done: Boolean(discipline?.oathToday || summary.todayRules?.includes('discipline.oath')),
      actionLabel: 'Take Oath',
      action: async () => {
        const d = await act(() => life.discipline.oath(), 'Morning oath taken')
        if (d) {
          soundSuccess()
          onChange()
        }
      }
    },
    {
      id: 'clean',
      label: 'Clean Day',
      detail: discipline?.setup ? `Day ${discipline.current} clean` : 'Daily discipline check-in',
      coins: 20,
      xp: 40,
      color: '#FF8A3D',
      icon: 'shield' as const,
      done: Boolean(discipline?.checkedInToday || summary.todayRules?.includes('discipline.clean_day')),
      actionLabel: 'Check in',
      action: async () => {
        const d = await act(() => life.discipline.checkIn(), 'Checked in clean')
        if (d) {
          soundSuccess()
          onChange()
        }
      }
    },
    {
      id: 'body',
      label: 'Body Workout',
      detail: body?.workoutDoneToday ? 'Workout logged today' : 'Daily physical training',
      coins: 10,
      xp: 25,
      color: '#FF6B8B',
      icon: 'bolt' as const,
      done: Boolean(body?.workoutDoneToday || summary.todayRules?.includes('body.workout_done')),
      actionLabel: 'Log',
      action: () => onGo('body')
    },
    {
      id: 'face',
      label: 'Skincare Routine',
      detail: 'Face care & protection',
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
      id: 'money',
      label: 'Spending Log',
      detail: connections?.finance.today?.logged ? 'Daily spending recorded' : 'Log today expenses',
      coins: 3,
      xp: 5,
      color: '#F5C84B',
      icon: 'coin' as const,
      done: Boolean(connections?.finance.today?.logged || summary.todayRules?.includes('money.logged')),
      actionLabel: 'Open',
      action: () => onOpenApp('money')
    }
  ]

  const doneCount = rituals.filter((r) => r.done).length
  const allDone = doneCount === rituals.length

  return (
    <section className="panel rituals-panel" aria-label="Daily Rituals">
      <header className="panel-head">
        <h2>
          <Icon name="bolt" /> Daily Rituals
        </h2>
        <span className="hint">
          {allDone
            ? 'All 5 daily rituals completed! Supreme discipline today.'
            : `${doneCount} of ${rituals.length} done · ${rituals.reduce((s, r) => s + (r.done ? r.coins : 0), 0)} coins earned`}
        </span>
      </header>
      <div className="ritual-progress-bar">
        <motion.i initial={false} animate={{ width: `${(doneCount / rituals.length) * 100}%` }} transition={{ duration: 0.3 }} />
      </div>
      <div className="rituals-grid">
        {rituals.map((r) => (
          <div key={r.id} className={`ritual-card ${r.done ? 'done' : ''}`} style={{ ['--c' as string]: r.color }}>
            <div className="ritual-header">
              <span className="ritual-icon">
                <Icon name={r.done ? 'check' : r.icon} size={15} />
              </span>
              <span className="ritual-reward">+{r.coins}</span>
            </div>
            <div className="ritual-info">
              <b>{r.label}</b>
              <small>{r.detail}</small>
            </div>
            <div className="ritual-action">
              {r.done ? (
                <span className="ritual-badge">
                  <Icon name="check" size={12} /> Done
                </span>
              ) : (
                <motion.button className="btn small ritual-btn" whileTap={{ scale: 0.94 }} onClick={r.action}>
                  {r.actionLabel}
                </motion.button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function HunterDashboardBanner({ level, onGo }: { level?: LevelInfo; onGo: (p: PageId) => void }) {
  if (!level || !level.hunterGrade) return null
  const { rankBadge, rankColor, hunterGrade, hunterTitle, rankPerk, attributes, level: lvl } = level
  const cp = attributes?.totalCombatPower ?? (lvl * 150)

  return (
    <div
      className="hunter-system-banner"
      onClick={() => onGo('journey')}
      role="button"
      tabIndex={0}
      title="Click to view full Hunter Status Window & Awakening Codex"
    >
      <div className="hunter-banner-left">
        <div
          className="hunter-badge-circle"
          style={{
            background: `${rankColor}22`,
            borderColor: rankColor,
            color: rankColor
          }}
        >
          {rankBadge}
        </div>
        <div className="hunter-title-group">
          <div className="hunter-header-row">
            <span
              className="hunter-grade-tag"
              style={{
                background: rankColor,
                color: '#050811'
              }}
            >
              {hunterGrade}
            </span>
            <span className="hunter-title-text">{hunterTitle}</span>
            <span style={{ fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>Lv.{lvl}</span>
          </div>
          <span className="hunter-perk-hint">
            <Icon name="spark" size={13} />
            <span>Passive Perk: {rankPerk}</span>
          </span>
        </div>
      </div>

      <div className="hunter-banner-stats">
        <div className="stat-pill cp-pill">
          <span>COMBAT POWER</span>
          <b style={{ color: '#00d2ff' }}>{cp.toLocaleString()} CP</b>
        </div>
        {attributes && (
          <>
            {attributes.unallocatedPoints > 0 && (
              <div
                className="stat-pill unallocated-pill"
                title={`${attributes.unallocatedPoints} Stat Points Ready for Allocation! Click to invest in Journey.`}
                onClick={(e) => {
                  e.stopPropagation()
                  onGo('journey')
                }}
              >
                <span style={{ color: '#fbbf24' }}>✦ POINTS</span>
                <b style={{ color: '#fbbf24' }}>+{attributes.unallocatedPoints}</b>
              </div>
            )}
            <div className="stat-pill">
              <span style={{ color: '#fb7185' }}>STR</span>
              <b>{attributes.str}</b>
            </div>
            <div className="stat-pill">
              <span style={{ color: '#38bdf8' }}>AGI</span>
              <b>{attributes.agi}</b>
            </div>
            <div className="stat-pill">
              <span style={{ color: '#34d399' }}>VIT</span>
              <b>{attributes.vit}</b>
            </div>
            <div className="stat-pill">
              <span style={{ color: '#a78bfa' }}>INT</span>
              <b>{attributes.int}</b>
            </div>
            <div className="stat-pill">
              <span style={{ color: '#fbbf24' }}>SEN</span>
              <b>{attributes.sen}</b>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Greeting({ summary, shop, tasks, schedule }: { summary: Summary; shop: ShopState | null; tasks: TasksState | null; schedule: ScheduleState | null }) {
  const [ui] = useUiPrefs()
  const h = new Date().getHours()
  const hello = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  const blocksLeft = schedule && schedule.day === schedule.today ? schedule.blocks.filter((b) => b.status === 'pending' || b.status === 'running').length : 0
  const tasksLeft = tasks?.tasks.filter((t) => !t.done).length ?? 0
  const goal = shop?.rewards.find((r) => r.pinned)
  const bits: string[] = []
  if (blocksLeft) bits.push(`${blocksLeft} block${blocksLeft > 1 ? 's' : ''} left`)
  if (tasksLeft) bits.push(`${tasksLeft} task${tasksLeft > 1 ? 's' : ''} open`)
  if (goal) bits.push(goal.price > summary.balance ? `${goal.price - summary.balance} coins to ${goal.title.toLowerCase()}` : `${goal.title} is ready to redeem`)
  return (
    <header className="greeting">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <h2>
          {hello}
          {ui.name ? `, ${ui.name}` : ''}
        </h2>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 10px',
            borderRadius: 6,
            fontSize: 11,
            fontFamily: 'var(--mono)',
            fontWeight: 700,
            letterSpacing: '0.12em',
            color: '#c8f135',
            background: 'rgba(200, 241, 53, 0.08)',
            border: '1px solid rgba(200, 241, 53, 0.25)'
          }}
          title="LIFE · Every real-life action fuels real human growth"
        >
          <span>🌱</span> LIFE · REAL GROWTH
        </span>
      </div>
      <p>{bits.length ? bits.join(' · ') : 'A clean slate. Pick one thing and conquer your day.'}</p>
    </header>
  )
}

function Quests({ summary, onChange }: { summary: Summary; onChange: (s?: Summary) => void }) {
  const act = useAction()
  const [q, setQ] = useState<QuestState | null>(null)
  useEffect(() => {
    life.wallet.quests().then(setQ).catch(() => {})
  }, [summary])
  if (!q) return null
  const doneCount = q.quests.filter((x) => x.done).length
  return (
    <section className={`panel quests ${q.allDone ? 'all' : ''}`}>
      <header className="panel-head">
        <h2>
          <Icon name="trophy" /> Daily quests
        </h2>
        <span className="hint">
          {q.claimed ? 'Bonus claimed. New quests tomorrow.' : `${doneCount}/3 done · all three pay +${q.bonus.coins} coins and +${q.bonus.xp} XP`}
        </span>
      </header>
      <div className="quest-row">
        {q.quests.map((x) => (
          <div key={x.id} className={`quest ${x.done ? 'done' : ''}`}>
            <span className="quest-check">{x.done ? <Icon name="check" size={14} /> : null}</span>
            <span className="quest-body">
              <b>{x.title}</b>
              <span className="bar">
                <i style={{ width: `${(x.progress / x.goal) * 100}%` }} />
              </span>
              <small>
                {x.progress} / {x.goal}
              </small>
            </span>
          </div>
        ))}
        {q.allDone && !q.claimed && (
          <motion.button className="btn primary quest-claim" whileTap={{ scale: 0.95 }} onClick={async () => { const s = await act(() => life.wallet.claimQuests(), 'Quests complete!'); if (s) onChange(s) }}>
            Claim +{q.bonus.coins}
          </motion.button>
        )}
      </div>
    </section>
  )
}
