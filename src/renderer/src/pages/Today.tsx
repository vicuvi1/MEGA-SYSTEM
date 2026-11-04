import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { isFlowRule } from '@core/rules'
import type { BodyState, ConnectionsState, DisciplineState, Rule, ScheduleState, ShopState, Summary, TasksState } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { MODULE_LABEL, MODULES, type PageId } from '../modules'
import { todayLayout, useUiPrefs, type TodaySectionId } from '../uiPrefs'
import { Coins, describeEntry, timeAgo, useAction } from '../ui'
import { DayFlow } from '../DayFlow'
import { SoloDailyQuestBanner } from '../SoloDailyQuestBanner'
import { ProgressCard } from './Progress'
import { FunCard } from '../FunCard'
import { DayStrip } from '../DayStrip'
import { localToday, reloadToday } from '../todayEvents'
import { useLive } from '../live'
import type { TodoTask } from '@core/todoist'
import { CoachPlan } from '../CoachPlan'
import { TodayHero } from '../TodayHero'

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
  // "More" stays as you left it (on this device).
  const [moreOpen, setMoreOpenState] = useState(() => {
    try {
      return localStorage.getItem('ls.todayMore') === '1'
    } catch {
      return false
    }
  })
  const setMoreOpen = (v: boolean) => {
    setMoreOpenState(v)
    try {
      localStorage.setItem('ls.todayMore', v ? '1' : '0')
    } catch {
      /* private window */
    }
  }
  const [repsOpen, setRepsOpenState] = useState(() => {
    try {
      return localStorage.getItem('ls.todayReps') !== '0'
    } catch {
      return true
    }
  })
  const setRepsOpen = (v: boolean) => {
    setRepsOpenState(v)
    try {
      localStorage.setItem('ls.todayReps', v ? '1' : '0')
    } catch {
      /* private window */
    }
  }
  // Your sections, in your order (Settings → Today screen).
  const sections: Record<TodaySectionId, () => ReactNode> = {
    reps: () => (
      <details className="td-fold" open={repsOpen} onToggle={(e) => setRepsOpen((e.target as HTMLDetailsElement).open)}>
        <summary>
          <span>Reps & water</span>
          <small>{repsOpen ? 'hide' : 'show'}</small>
        </summary>
        <SoloDailyQuestBanner body={body ?? null} summary={summary} onRefresh={() => onChange()} onGo={onGo} />
      </details>
    ),
    day: () => (
      <>
      <CoachPlan oneApprove hideReview onChange={() => onChange()} />
      <DayFlow summary={summary} discipline={discipline} connections={connections} body={body ?? null} onChange={onChange} onGo={onGo} onOpenApp={onOpenApp} rules={rules} />
      </>
    ),
    progress: () => <ProgressCard onOpen={() => onGo('progress')} />,
    timeline: () => null,
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

  // A calm cockpit: Ben and the one move on top; your day's timeline on the
  // right, full height; the lists on the left. On a big screen each column
  // scrolls on its own, so the page never feels endless.
  const on = todayLayout(ui).filter((x) => x.on)
  const MAIN: TodaySectionId[] = ['day']
  const SIDE: TodaySectionId[] = ['reps']
  const FOLDED = on.filter((x) => !MAIN.includes(x.id) && !SIDE.includes(x.id) && x.id !== 'timeline')
  return (
    <div className="today td2">
      <TodayHero name={ui.name} onGo={(p) => onGo(p)} />
      {on.some((x) => x.id === 'timeline') && <TodayStrip />}
      <div className="cmd">
        <div className="cmd-main">
          {on.filter((x) => MAIN.includes(x.id)).map((x) => (
            <Fragment key={x.id}>{sections[x.id]()}</Fragment>
          ))}
          {FOLDED.length > 0 && (
            <details className="td-more" open={moreOpen} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}>
              <summary>
                <span>More</span>
                <small>{FOLDED.map((x) => ({ progress: 'week score', fun: 'fun time', quicklog: 'quick log', day: '', timeline: '', reps: '' })[x.id]).filter(Boolean).join(' · ')}</small>
              </summary>
              <div className="td-more-body">
                {FOLDED.map((x) => (
                  <Fragment key={x.id}>{sections[x.id]()}</Fragment>
                ))}
              </div>
            </details>
          )}
        </div>
        <aside className="cmd-side">
          {on.filter((x) => SIDE.includes(x.id)).map((x) => (
            <Fragment key={x.id}>{sections[x.id]()}</Fragment>
          ))}
        </aside>
      </div>
    </div>
  )
}

/** The day strip with today's Todoist tasks; a task dropped on it gets a block there. */
function TodayStrip() {
  const act = useAction()
  const [tasks, setTasks] = useState<TodoTask[]>([])
  const load = () => void life.todoist?.today().then(setTasks).catch(() => {})
  useEffect(load, [])
  useLive(load, { external: true })
  const book = async (t: TodoTask, startMin: number) => {
    if (!t) return
    const day = localToday()
    const minutes = t.duration && t.duration >= 10 ? Math.min(t.duration, 240) : 50
    const at = (m: number) => new Date(`${day}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`).toISOString()
    const hm = `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`
    const ok = await act(async () => {
      await life.google!.create({ title: t.content, start: at(startMin), end: at(Math.min(24 * 60 - 1, startMin + minutes)), description: 'Todoist task · planned in Life System' })
      await life.todoist?.update?.(t.id, { due: `${day} ${hm}` })
      return true
    }, `Booked ${hm}: ${t.content}`)
    if (ok) {
      void reloadToday()
      window.dispatchEvent(new CustomEvent('life-external-changed'))
    }
  }
  return <DayStrip tasks={tasks} onBook={(t, m) => void book(t, m)} />
}
