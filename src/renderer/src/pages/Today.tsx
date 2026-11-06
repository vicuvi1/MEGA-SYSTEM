import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { bookMinutes, bookTask } from '../booking'
import { isFlowRule } from '@core/rules'
import type { BodyState, ConnectionsState, DisciplineState, Rule, ScheduleState, ShopState, Summary, TasksState } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { MODULE_LABEL, MODULES, type PageId } from '../modules'
import { todayLayout, useUiPrefs, type TodaySectionId } from '../uiPrefs'
import { Coins, describeEntry, timeAgo, useAction } from '../ui'
import { DayFlow } from '../DayFlow'
import { SoloDailyQuestBanner } from '../SoloDailyQuestBanner'
import { ProgressCard } from './ProgressCard'
import { YearOffer, openYear } from './Reviews'
import { LifeModeCard } from '../LifeMode'
import { FunCard } from '../FunCard'
import { DayStrip } from '../DayStrip'
import { localToday, calendarToday, reloadToday } from '../todayEvents'
import { useLive } from '../live'
import type { TodoTask } from '@core/todoist'
import { CoachPlan } from '../CoachPlan'
import { TodayHero } from '../TodayHero'
import { DeepWork, MissTwiceCard, NextUpBar, WeekStrip } from '../TodayExtras'
import { PageTabs, TabPanel, usePageTab, type PageTab } from '../PageTabs'
import { HealthyToday, SleepToday, useHealthyToday } from '../TodayBody'
import '../todayTabs.css'
import { PluginCards } from '../../../plugins/cards'
import { MoneyPill } from '../MoneyQuick'

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
  // Your sections, in your order (Settings → Today screen).
  const sections: Record<TodaySectionId, () => ReactNode> = {
    reps: () => null,
    day: () => null,
    progress: () => <ProgressCard onOpen={() => onGo('progress')} />,
    timeline: () => null,
    fun: () => <FunCard onWallet={() => onChange()} onOpenShop={onOpenShop} />,
    quicklog: () => (
        <>
      <div className="cols">
        <section className="panel">
          <header className="panel-head">
            <h2>Quick log</h2>
            <button className="btn small ghost" onClick={() => onGo('shop')} title="What each thing pays (Rewards → How you earn)">
              <Icon name="coin" size={13} /> How points work
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
                      <button key={r.id} className={`action ${r.coins < 0 ? 'penalty' : ''}`} onClick={() => award(r)}>
                        <span>{r.title}</span>
                        <Coins n={r.coins} sign />
                      </button>
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
                    <button className="icon-btn feed-undo" title="Undo this (the points go back)" aria-label="Undo" onClick={() => undo(e.id)}>
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

  // Today's switch (the teacher's "too much scrolling"): Now, Plan, Tasks,
  // Body and Week, each about one laptop screen. Your day stays on the right
  // on a wide screen; on a narrow one or the phone it is its own tab.
  const on = todayLayout(ui).filter((x) => x.on)
  const has = (id: TodaySectionId) => on.some((x) => x.id === id)
  const narrow = useNarrow(1100)
  const [tasksEl, setTasksEl] = useState<HTMLDivElement | null>(null)
  const [weekEl, setWeekEl] = useState<HTMLDivElement | null>(null)
  const [counts, setCounts] = useState<{ tasks: number; late: number; mustDone: number; mustTotal: number } | null>(null)
  const { health, sleep } = useHealthyToday()
  const showDay = narrow && has('timeline')
  const tabs: PageTab[] = [
    // Must-dos are counted on the Now tab itself (the top row and the list), so its tab has no number.
    { id: 'now', label: 'Now', title: "What's on now, your must-dos and habits (1)" },
    { id: 'plan', label: 'Plan', title: "Ben's plan for today (2)" },
    { id: 'tasks', label: 'Tasks', count: counts ? counts.tasks : null, title: `Everything else today${counts?.late ? `, ${counts.late} late` : ''}, and coming up (3)` },
    { id: 'body', label: 'Body', count: health ? `${health.met}/4` : null, title: 'Reps, water, sleep and your healthy day (4)' },
    { id: 'week', label: 'Week', title: 'This week, the week score and more (5)' },
    ...(showDay ? [{ id: 'day', label: 'Day', title: 'Your day, hour by hour (6)' }] : [])
  ]
  const [tab, setTab] = usePageTab('today', tabs.map((t) => t.id), 'now')
  // Things that need the Now tab (closing the day, logging spending) bring it up.
  useEffect(() => {
    const toNow = () => setTab('now')
    const toPlan = () => setTab('plan')
    window.addEventListener('life-close-day', toNow)
    window.addEventListener('life-open-spend', toNow)
    window.addEventListener('life-show-plan', toPlan)
    return () => {
      window.removeEventListener('life-close-day', toNow)
      window.removeEventListener('life-open-spend', toNow)
      window.removeEventListener('life-show-plan', toPlan)
    }
  }, [setTab])
  const FOLDED = on.filter((x) => x.id === 'fun' || x.id === 'quicklog')
  const day = (
    <>
      {has('timeline') && <TodayStrip />}
      <PluginCards />
    </>
  )
  return (
    <div className="today td2 td-tabs">
      <div className="cmd">
        <div className="cmd-main">
          <PageTabs page="today" label="Today views" tabs={tabs} value={tab} onChange={setTab} />
          <TabPanel page="today" id="now" value={tab}>
            <TodayHero name={ui.name} onGo={(p) => onGo(p)} />
            <MoneyPill />
            <NextUpBar />
            {has('day') && (
              <>
                <LifeModeCard compact />
                <YearOffer onOpen={() => openYear(onGo)} />
                <MissTwiceCard />
                <DayFlow summary={summary} discipline={discipline} connections={connections} body={body ?? null} onChange={onChange} onGo={onGo} onOpenApp={onOpenApp} rules={rules} tasksSlot={tasksEl} weekSlot={weekEl} onCounts={setCounts} />
              </>
            )}
          </TabPanel>
          <TabPanel page="today" id="plan" value={tab} className="td-plan">
            <CoachPlan oneApprove hideReview onChange={() => onChange()} />
            <p className="hint td-plan-none">No plan for today. Ben plans the morning; ask him on the Coach page.</p>
          </TabPanel>
          <TabPanel page="today" id="tasks" value={tab}>
            <div ref={setTasksEl} className="td-slot" />
            {!has('day') && <p className="hint">Today's list is off in Settings → Look → Today screen.</p>}
          </TabPanel>
          <TabPanel page="today" id="body" value={tab} className="td-body">
            <div className="td-body-top">
              <HealthyToday health={health} />
              <SleepToday sleep={sleep} onOpen={() => onGo('sleep')} />
            </div>
            {has('reps') && <SoloDailyQuestBanner body={body ?? null} summary={summary} onRefresh={() => onChange()} onGo={onGo} />}
          </TabPanel>
          <TabPanel page="today" id="week" value={tab}>
            <WeekStrip />
            <div ref={setWeekEl} className="td-slot" />
            {has('progress') && <ProgressCard onOpen={() => onGo('progress')} />}
            {FOLDED.length > 0 && (
              <details className="td-more" open={moreOpen} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}>
                <summary>
                  <span>More</span>
                  <small>{FOLDED.map((x) => (x.id === 'fun' ? 'fun time' : 'quick log')).join(' · ')}</small>
                </summary>
                <div className="td-more-body">
                  {FOLDED.map((x) => (
                    <Fragment key={x.id}>{sections[x.id]()}</Fragment>
                  ))}
                </div>
              </details>
            )}
          </TabPanel>
          {showDay && (
            <TabPanel page="today" id="day" value={tab} className="td-day">
              {day}
            </TabPanel>
          )}
        </div>
        {!narrow && <aside className="cmd-side">{day}</aside>}
      </div>
      <DeepWork />
    </div>
  )
}

/** True while the window is narrower than `px` (Today's Day tab). */
function useNarrow(px: number): boolean {
  const q = `(max-width: ${px - 0.02}px)`
  const [v, setV] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const m = matchMedia(q)
    const on = () => setV(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [q])
  return v
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
    const day = calendarToday()
    const hmOf = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    const hm = hmOf(startMin)
    const ok = await act(async () => {
      await bookTask(t, day, hm, hmOf(Math.min(24 * 60 - 1, startMin + bookMinutes(t))))
      return true
    }, `Booked ${hm}: ${t.content}`)
    if (ok) {
      void reloadToday()
      window.dispatchEvent(new CustomEvent('life-external-changed'))
    }
  }
  return <DayStrip tasks={tasks} onBook={(t, m) => void book(t, m)} />
}
