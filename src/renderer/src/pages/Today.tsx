import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Rule, ScheduleState, ShopState, Summary, TasksState } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { MODULE_LABEL, MODULES, type PageId } from '../modules'
import { clock } from './planUi'
import { KIND } from './Schedule'
import { Coins, describeEntry, timeAgo, useAction } from '../ui'

type Pop = { id: number; coins: number; xp: number }

interface Props {
  summary: Summary
  rules: Rule[]
  shop: ShopState | null
  tasks: TasksState | null
  schedule: ScheduleState | null
  onChange: (s?: Summary) => void
  onTasks: (t: TasksState) => void
  onSchedule: (s: ScheduleState) => void
  onGo: (page: PageId) => void
}

export function Today({ summary, rules, shop, tasks, schedule, onChange, onTasks, onSchedule, onGo }: Props) {
  const onOpenShop = () => onGo('shop')
  const act = useAction()
  const [pops, setPops] = useState<Pop[]>([])
  const titles = useMemo(() => Object.fromEntries(rules.map((r) => [r.id, r.title])), [rules])
  const groups = useMemo(() => {
    const g: Record<string, Rule[]> = {}
    for (const r of rules.filter((r) => r.enabled)) (g[r.module] ??= []).push(r)
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
        <div className="stat">
          <span className="label">Level</span>
          <div className="big">{summary.level.level}</div>
          <span className="sub">
            {summary.level.rank} · {summary.level.xpForNext - summary.level.xpIntoLevel} XP to next
          </span>
        </div>
      </section>

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
    <button className="stat clickable" onClick={onOpenShop}>
      <span className="label">Main goal · {target.title}</span>
      <div className="big">{Math.round(pct * 100)}%</div>
      <div className="bar goal">
        <motion.i initial={false} animate={{ width: `${pct * 100}%` }} />
      </div>
      <span className="sub">{left > 0 ? `${left} coins to go` : 'Ready to redeem!'}</span>
    </button>
  )
}

function TodaySchedule({ schedule, onSchedule, onGo }: { schedule: ScheduleState | null; onSchedule: (s: ScheduleState) => void; onGo: (p: PageId) => void }) {
  const act = useAction()
  const today = schedule && schedule.day === schedule.today ? schedule.blocks : []
  const left = today.filter((b) => b.status === 'pending' || b.status === 'running')
  const running = today.find((b) => b.status === 'running')
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Schedule today</h2>
        <button className="link" onClick={() => onGo('schedule')}>
          Open schedule
        </button>
      </header>
      {today.length === 0 ? (
        <div className="empty small-empty">
          <p>No blocks today. Plan a study block in Schedule.</p>
        </div>
      ) : (
        <ul className="mini-tl">
          {today.slice(0, 6).map((b) => (
            <li key={b.id} className={b.status} style={{ ['--c' as string]: KIND[b.kind].color }}>
              <span className="when">{clock(b.startsAt)}</span>
              <span className="what">{b.title}</span>
              {b.status === 'pending' && !running ? (
                <button className="btn small" onClick={async () => { const s = await act(() => life.schedule.start(b.id)); if (s) { onSchedule(s); onGo('schedule') } }}>
                  Start
                </button>
              ) : (
                <span className={`status s-${b.status}`}>{b.status === 'pending' ? 'Planned' : b.status === 'running' ? 'Running' : b.status[0].toUpperCase() + b.status.slice(1)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {today.length > 0 && <p className="hint block-hint">{left.length ? `${left.length} block${left.length > 1 ? 's' : ''} left today` : 'All blocks closed for today.'}</p>}
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
          <p>No tasks for today. Add some in Tasks.</p>
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
