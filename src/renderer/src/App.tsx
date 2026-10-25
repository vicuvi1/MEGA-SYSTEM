import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { AuthStatus, BackupStatus, ConnectionsState, DisciplineState, Rule, ScheduleState, ShopState, Summary, TasksState } from '@shared/api'
import { isDemo, life } from './bridge'
import { Icon } from './Icon'
import { MODULES, SYSTEM_PAGES, type PageId } from './modules'
import { Coins, ToastProvider } from './ui'
import { LockScreen } from './pages/LockScreen'
import { Today } from './pages/Today'
import { History } from './pages/History'
import { Rules } from './pages/Rules'
import { Settings } from './pages/Settings'
import { Soon } from './pages/Soon'
import { Shop } from './pages/Shop'
import { Tasks } from './pages/Tasks'
import { Schedule } from './pages/Schedule'
import { Discipline } from './pages/Discipline'
import { Sleep } from './pages/Sleep'
import { Money } from './pages/Money'
import { Connected } from './pages/Connected'
import { EMBED_LABEL, EmbedHost, type EmbedKind } from './EmbedHost'
import { UpdateChip, useUpdates } from './updates'

const IDLE_LOCK_MS = 10 * 60_000

// Sections that hold one of the apps living inside Life System.
const EMBED_OF: Partial<Record<PageId, { kind: EmbedKind; system: string }>> = {
  money: { kind: 'finance', system: 'Coins & budget' },
  sleep: { kind: 'waky', system: 'Coins & stats' },
  discipline: { kind: 'man', system: 'Streak & coins' }
}

export function App() {
  return (
    <ToastProvider>
      <Gate />
    </ToastProvider>
  )
}

function Gate() {
  const [auth, setAuth] = useState<AuthStatus | null>(null)

  useEffect(() => {
    life.auth.status().then(setAuth)
    life.onLocked(() => life.auth.status().then(setAuth))
  }, [])

  // Lock after a while without input, if a PIN is set.
  useEffect(() => {
    if (!auth?.pinSet || auth.locked) return
    let timer = setTimeout(lock, IDLE_LOCK_MS)
    function lock() {
      life.auth.lock().then(setAuth)
    }
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(lock, IDLE_LOCK_MS)
    }
    const events = ['mousemove', 'keydown', 'mousedown', 'wheel'] as const
    events.forEach((e) => window.addEventListener(e, reset))
    return () => {
      clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [auth])

  if (!auth) return <div className="boot" />
  if (auth.locked) return <LockScreen onUnlocked={setAuth} />
  return <Shell auth={auth} onAuth={setAuth} />
}

function Shell({ auth, onAuth }: { auth: AuthStatus; onAuth: (a: AuthStatus) => void }) {
  const [page, setPage] = useState<PageId>('today')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [rules, setRules] = useState<Rule[]>([])
  const [backup, setBackup] = useState<BackupStatus | null>(null)
  const [shop, setShop] = useState<ShopState | null>(null)
  const [tasks, setTasks] = useState<TasksState | null>(null)
  const [schedule, setSchedule] = useState<ScheduleState | null>(null)
  const [discipline, setDiscipline] = useState<DisciplineState | null>(null)
  const [connections, setConnections] = useState<ConnectionsState | null>(null)
  // Stealth reveal lasts until the app locks or restarts.
  const [revealed, setRevealed] = useState(false)
  const [urgeOpen, setUrgeOpen] = useState(false)
  // Which tab each app section shows: the app itself, or Life System's view.
  const [view, setView] = useState<Partial<Record<PageId, 'app' | 'system'>>>({})
  const [update, setUpdate] = useUpdates()
  const [sidebarMode, setSidebarMode] = useState<'auto' | 'open' | 'closed'>(() => {
    try {
      return (localStorage.getItem('ls.sidebar') as 'auto' | 'open' | 'closed') || 'auto'
    } catch {
      return 'auto'
    }
  })
  const [peek, setPeek] = useState(false)
  const peekTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    life.onNavigate((p) => {
      setPage(p as PageId)
      setView((v) => ({ ...v, [p]: 'app' }))
    })
    life.onUrge(() => {
      setView((v) => ({ ...v, discipline: 'system' }))
      setPage('discipline')
      setRevealed(true)
      setUrgeOpen(true)
    })
  }, [])

  const refresh = useCallback(async () => {
    const [s, r, b, sh, t, sc, d] = await Promise.all([
      life.wallet.summary(), life.rules.list(), life.backup.status(), life.shop.state(), life.tasks.state(), life.schedule.state(), life.discipline.state()
    ])
    setDiscipline(d)
    life.connections.state().then(setConnections)
    setSummary(s)
    setRules(r)
    setBackup(b)
    setShop(sh)
    setTasks(t)
    setSchedule(sc)
  }, [])

  // Coins moved: refresh everything that shows coins or completion.
  const onWallet = useCallback(async () => {
    const [s, sh, t, d, c] = await Promise.all([life.wallet.summary(), life.shop.state(), life.tasks.state(), life.discipline.state(), life.connections.state()])
    setDiscipline(d)
    setConnections(c)
    setSummary(s)
    setShop(sh)
    setTasks(t)
  }, [])

  // Pick up a new day, missed blocks and backup state while the app stays open.
  useEffect(() => {
    const t = setInterval(() => {
      life.schedule.state().then((sc) => setSchedule((cur) => (cur && cur.day !== cur.today ? cur : sc)))
      life.backup.status().then(setBackup)
    }, 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // A connected app paid something in the background.
  useEffect(() => {
    life.onWalletChanged(() => onWallet())
  }, [onWallet])

  const current = [...MODULES, ...SYSTEM_PAGES].find((m) => m.id === page)!
  const lv = summary?.level
  const embed = EMBED_OF[page]
  // Stealth hides MAN too until the section is revealed.
  const hiddenByStealth = page === 'discipline' && !!discipline?.stealth && !revealed
  const tab = embed ? (hiddenByStealth ? 'system' : view[page] ?? 'app') : 'system'
  const activeEmbed = embed && tab === 'app' ? embed.kind : null

  const toggleSidebar = useCallback(() => {
    setPeek(false)
    setSidebarMode((m) => {
      const isCollapsed = m === 'closed' || (m === 'auto' && !!activeEmbed)
      const next = isCollapsed ? 'open' : 'closed'
      try {
        localStorage.setItem('ls.sidebar', next)
      } catch {
        // per-viewer convenience only
      }
      return next
    })
  }, [activeEmbed])

  // Shortcuts, also while an app inside is focused (main forwards them).
  useEffect(() => {
    const run = (key: string) => {
      if (key === 'toggle-sidebar') toggleSidebar()
      const n = /^go:(\d)$/.exec(key)
      if (n && MODULES[Number(n[1]) - 1]) setPage(MODULES[Number(n[1]) - 1].id)
      if (key === 'switch-view' && embed) setView((v) => ({ ...v, [page]: tab === 'app' ? 'system' : 'app' }))
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        run('toggle-sidebar')
      } else if (e.altKey && !e.ctrlKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        run(`go:${e.key}`)
      } else if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        run('switch-view')
      }
    }
    window.addEventListener('keydown', onKey)
    const off = life.onUiKey(run)
    return () => {
      window.removeEventListener('keydown', onKey)
      off()
    }
  }, [toggleSidebar, embed, page, tab])

  // Sidebar: full, or a slim icon rail. "auto" turns it into a rail while an
  // app is open, so the app gets the room; hovering the rail slides it out.
  const collapsed = sidebarMode === 'closed' || (sidebarMode === 'auto' && !!activeEmbed)
  const compact = !!embed

  return (
    <div className={`shell ${collapsed ? 'rail' : ''}`}>
      <div className="side-cell">
        <aside
          className={`sidebar ${collapsed ? 'collapsed' : ''} ${collapsed && peek ? 'peek' : ''}`}
          onMouseEnter={() => {
            if (!collapsed) return
            clearTimeout(peekTimer.current)
            peekTimer.current = window.setTimeout(() => setPeek(true), 160)
          }}
          onMouseLeave={() => {
            clearTimeout(peekTimer.current)
            setPeek(false)
          }}
        >
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <Icon name="spark" size={16} />
            </span>
            <span className="label">
              LIFE<b>SYSTEM</b>
            </span>
          </div>
          <nav aria-label="Sections">
            {MODULES.map((m, i) => (
              <button
                key={m.id}
                aria-label={m.label}
                title={collapsed && !peek ? `${m.label}  (Alt+${i + 1})` : undefined}
                className={`nav ${page === m.id ? 'on' : ''}`}
                onClick={() => {
                  setPage(m.id)
                  setPeek(false)
                }}
                style={{ ['--c' as string]: m.color }}
              >
                <Icon name={m.icon} />
                <span className="label">{m.label}</span>
                {m.phase > 0 && <em className="soon label">soon</em>}
              </button>
            ))}
          </nav>
          <nav aria-label="System" className="nav-system">
            {SYSTEM_PAGES.map((m) => (
              <button
                key={m.id}
                aria-label={m.label}
                title={collapsed && !peek ? m.label : undefined}
                className={`nav small ${page === m.id ? 'on' : ''}`}
                onClick={() => {
                  setPage(m.id)
                  setPeek(false)
                }}
              >
                <Icon name={m.icon} size={16} />
                <span className="label">{m.label}</span>
              </button>
            ))}
            <button className="nav small side-toggle" onClick={toggleSidebar} title="Collapse or expand the sidebar (Ctrl+B)" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              <span className={`chev ${collapsed ? 'right' : ''}`} aria-hidden="true">
                ‹
              </span>
              <span className="label">{collapsed ? 'Keep open' : 'Collapse'}</span>
              <kbd className="label">Ctrl B</kbd>
            </button>
          </nav>
        </aside>
      </div>

      <div className="main">
        <header className={`topbar ${compact ? 'compact' : ''}`}>
          <div className="title">
            <h1>{current.label}</h1>
            {!compact && <p>{current.blurb}</p>}
          </div>
          {embed && !hiddenByStealth && (
            <div className="seg-switch" role="tablist" aria-label={`${current.label} views`}>
              <span className={`seg-thumb ${tab === 'app' ? '' : 'second'}`} aria-hidden="true" />
              <button role="tab" aria-selected={tab === 'app'} className={tab === 'app' ? 'on' : ''} onClick={() => setView((v) => ({ ...v, [page]: 'app' }))}>
                <Icon name={embed.kind === 'finance' ? 'coin' : embed.kind === 'waky' ? 'moon' : 'shield'} size={14} />
                {EMBED_LABEL[embed.kind]}
              </button>
              <button role="tab" aria-selected={tab === 'system'} className={tab === 'system' ? 'on' : ''} onClick={() => setView((v) => ({ ...v, [page]: 'system' }))}>
                <Icon name="spark" size={14} />
                {embed.system}
              </button>
            </div>
          )}
          <span className="spacer" />
          {lv && summary && (
            <div className="player">
              <div className="lvl-badge" title={`${summary.totalXp} XP total`}>
                <small>LV</small>
                {lv.level}
              </div>
              <div className="xp">
                <div className="xp-row">
                  <span className="rank">{lv.rank}</span>
                  <span className="xp-num">
                    {lv.xpIntoLevel} / {lv.xpForNext} XP
                  </span>
                </div>
                <div className="bar">
                  <motion.i initial={false} animate={{ width: `${Math.round(lv.progress * 100)}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
                </div>
              </div>
              <div className="wallet" title="Coins you can spend">
                <Coins n={summary.balance} />
              </div>
            </div>
          )}
          <div className="top-actions">
            <UpdateChip status={update} onClick={() => setPage('settings')} />
            {backup && (
              <button className={`chip ${backup.lastError ? 'warn' : 'ok'}`} onClick={() => setPage('settings')} title={backup.lastError ?? `Last backup ${backup.last?.at ?? ''}`}>
                <Icon name="cloud" size={15} />
                <span className="chip-text">{backup.lastError ? 'Backup off' : 'Backed up'}</span>
              </button>
            )}
            {isDemo && <span className="chip">Demo</span>}
            {auth.pinSet && (
              <button className="icon-btn" aria-label="Lock now" title="Lock now" onClick={() => life.auth.lock().then(onAuth)}>
                <Icon name="lock" />
              </button>
            )}
          </div>
        </header>

        <EmbedHost active={activeEmbed} />

        <AnimatePresence mode="wait">
          {!activeEmbed && <motion.main key={page} className="content" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {page === 'today' && summary && (
              <Today summary={summary} rules={rules} shop={shop} tasks={tasks} schedule={schedule} discipline={discipline} onChange={onWallet} onTasks={setTasks} onSchedule={setSchedule} onGo={setPage} />
            )}
            {page === 'discipline' && discipline && (
              <Discipline state={discipline} man={connections?.man.suggestion ?? null} onState={setDiscipline} onWallet={onWallet} revealed={revealed} onReveal={() => setRevealed(true)} urgeOpen={urgeOpen} onUrgeOpen={setUrgeOpen} />
            )}
            {page === 'sleep' && connections && <Sleep state={connections} onState={setConnections} onWallet={onWallet} />}
            {page === 'money' && connections && <Money state={connections} onState={setConnections} onWallet={onWallet} />}
            {page === 'connected' && connections && <Connected state={connections} onState={setConnections} onWallet={onWallet} />}
            {page === 'tasks' && tasks && <Tasks state={tasks} onState={setTasks} onWallet={onWallet} />}
            {page === 'schedule' && schedule && <Schedule state={schedule} rules={rules} onState={setSchedule} onWallet={onWallet} />}
            {page === 'shop' && shop && <Shop state={shop} onState={setShop} onWallet={onWallet} />}
            {page === 'history' && <History rules={rules} onChange={onWallet} />}
            {page === 'rules' && <Rules rules={rules} onChange={setRules} />}
            {page === 'settings' && <Settings auth={auth} onAuth={onAuth} backup={backup} onBackup={setBackup} onRestored={refresh} update={update} onUpdate={setUpdate} />}
            {current.phase > 0 && <Soon module={current} />}
          </motion.main>}
        </AnimatePresence>
      </div>
    </div>
  )
}
