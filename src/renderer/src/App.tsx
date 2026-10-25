import { useCallback, useEffect, useState } from 'react'
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

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="spark" size={16} />
          </span>
          <span>
            LIFE<b>SYSTEM</b>
          </span>
        </div>
        <nav aria-label="Sections">
          {MODULES.map((m) => (
            <button key={m.id} aria-label={m.label} className={`nav ${page === m.id ? 'on' : ''}`} onClick={() => setPage(m.id)} style={{ ['--c' as string]: m.color }}>
              <Icon name={m.icon} />
              <span>{m.label}</span>
              {m.phase > 0 && <em className="soon">soon</em>}
            </button>
          ))}
        </nav>
        <nav aria-label="System" className="nav-system">
          {SYSTEM_PAGES.map((m) => (
            <button key={m.id} aria-label={m.label} className={`nav small ${page === m.id ? 'on' : ''}`} onClick={() => setPage(m.id)}>
              <Icon name={m.icon} size={16} />
              <span>{m.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="title">
            <h1>{current.label}</h1>
            <p>{current.blurb}</p>
          </div>
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
            {backup && (
              <button className={`chip ${backup.lastError ? 'warn' : 'ok'}`} onClick={() => setPage('settings')} title={backup.lastError ?? `Last backup ${backup.last?.at ?? ''}`}>
                <Icon name="cloud" size={15} />
                {backup.lastError ? 'Backup off' : 'Backed up'}
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

        {embed && !hiddenByStealth && (
          <div className="app-tabs" role="tablist" aria-label={`${current.label} views`}>
            <button role="tab" aria-selected={tab === 'app'} className={tab === 'app' ? 'on' : ''} onClick={() => setView((v) => ({ ...v, [page]: 'app' }))}>
              {EMBED_LABEL[embed.kind]}
            </button>
            <button role="tab" aria-selected={tab === 'system'} className={tab === 'system' ? 'on' : ''} onClick={() => setView((v) => ({ ...v, [page]: 'system' }))}>
              {embed.system}
            </button>
          </div>
        )}

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
            {page === 'settings' && <Settings auth={auth} onAuth={onAuth} backup={backup} onBackup={setBackup} onRestored={refresh} />}
            {current.phase > 0 && <Soon module={current} />}
          </motion.main>}
        </AnimatePresence>
      </div>
    </div>
  )
}
