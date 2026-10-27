import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { AuthStatus, BackupStatus, BodyState, ConnectionsState, DisciplineState, Rule, ScheduleState, ShopState, Summary, TasksState } from '@shared/api'
import { isDemo, life } from './bridge'
import { Icon } from './Icon'
import { MODULES, SYSTEM_PAGES, type PageId } from './modules'
import { Coins, ToastProvider, useToast } from './ui'
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
import { Body } from './pages/Body'
import { Sleep } from './pages/Sleep'
import { Money } from './pages/Money'
import { Connected } from './pages/Connected'
import { BotCenter } from './pages/BotCenter'
import { Journey } from './pages/Journey'
import { SystemOracleDrawer } from './SystemOracleDrawer'
import { SoloSystemModal } from './SoloSystemModal'
import { SoloPlayerModal } from './SoloPlayerModal'
import { EMBED_LABEL, EmbedHost, type EmbedKind } from './EmbedHost'
import { UpdateChip, useUpdates } from './updates'
import { buildCommands, Palette, type Command } from './Palette'
import { Notifications, type Alert } from './Notifications'
import { Sidebar } from './Sidebar'
import { ErrorBoundary, installWindowErrorHandlers } from './ErrorBoundary'
import { useUiPrefs } from './uiPrefs'
import { tierUnlocked } from '@core/shop'
import { describeEntry, useAction } from './ui'
import { loadLastPlace, saveLastPlace } from './uiPrefs'
import { soundTick, stopAllSounds, soundSystemOracle } from './sound'

// Sections that hold one of the apps living inside Life System.
const EMBED_OF: Partial<Record<PageId, { kind: EmbedKind; system: string }>> = {
  money: { kind: 'finance', system: 'Coins & budget' },
  sleep: { kind: 'waky', system: 'Coins & stats' },
  discipline: { kind: 'man', system: 'Streak & coins' }
}

export function App() {
  return (
    <ToastProvider>
      <ErrorBoundary area="Life System">
        <WindowErrors />
        <Gate />
      </ErrorBoundary>
    </ToastProvider>
  )
}

/** Errors outside React become a short note and a log entry. */
function WindowErrors() {
  const toast = useToast()
  useEffect(() => installWindowErrorHandlers((t) => toast(t, 'bad')), [toast])
  return null
}

const UNLOCKED_AUTH: AuthStatus = { pinSet: false, locked: false }

function Gate() {
  return <Shell auth={UNLOCKED_AUTH} onAuth={() => {}} />
}

function Shell({ auth, onAuth }: { auth: AuthStatus; onAuth: (a: AuthStatus) => void }) {
  const last = useRef(loadLastPlace()).current
  const known = [...MODULES, ...SYSTEM_PAGES].find((m) => m.id === last?.page && m.phase === 0)
  const [page, setPage] = useState<PageId>(known ? known.id : 'today')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [rules, setRules] = useState<Rule[]>([])
  const [oracleOpen, setOracleOpen] = useState(false)
  const [systemModal, setSystemModal] = useState<{ open: boolean; type: 'quest-complete' | 'level-up' | 'penalty-warning'; data?: any }>({ open: false, type: 'quest-complete' })
  const [playerModalOpen, setPlayerModalOpen] = useState(false)
  const [backup, setBackup] = useState<BackupStatus | null>(null)
  const [shop, setShop] = useState<ShopState | null>(null)
  const [tasks, setTasks] = useState<TasksState | null>(null)
  const [schedule, setSchedule] = useState<ScheduleState | null>(null)
  const [discipline, setDiscipline] = useState<DisciplineState | null>(null)
  const [body, setBody] = useState<BodyState | null>(null)
  const [connections, setConnections] = useState<ConnectionsState | null>(null)
  // Stealth reveal lasts until the app locks or restarts.
  const [revealed, setRevealed] = useState(false)
  const [urgeOpen, setUrgeOpen] = useState(false)
  // Which tab each app section shows: the app itself, or Life System's view.
  const [view, setView] = useState<Partial<Record<PageId, 'app' | 'system'>>>(last?.view ?? {})
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [fullScreen, setFullScreen] = useState(false)
  const [pops, setPops] = useState<{ id: number; coins: number; label: string }[]>([])
  const act = useAction()

  useEffect(() => saveLastPlace({ page, view: view as Record<string, 'app' | 'system'> }), [page, view])
  useEffect(() => life.onFullScreen(setFullScreen), [])
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
    life.body.state().then(setBody)
    life.connections.state().then(setConnections)
    life.body.state().then(setBody)
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

  // Coins flying into the wallet whenever the balance changes, from anywhere.
  const lastBalance = useRef<number | null>(null)
  useEffect(() => {
    if (!summary) return
    const prev = lastBalance.current
    lastBalance.current = summary.balance
    if (prev === null || prev === summary.balance) return
    const delta = summary.balance - prev
    const latest = summary.recent.find((e) => e.kind !== 'undo')
    const titles = Object.fromEntries(rules.map((r) => [r.id, r.title]))
    const pop = { id: Date.now() + Math.random(), coins: delta, label: latest ? describeEntry(latest, titles) : '' }
    setPops((p) => [...p.slice(-2), pop])
    setTimeout(() => setPops((p) => p.filter((x) => x.id !== pop.id)), 2600)
  }, [summary, rules])

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
      if (key === 'palette') {
        soundTick()
        setPaletteOpen((o) => !o)
      }
      if (key === 'fullscreen') life.app.toggleFullScreen()
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
      } else if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        run('palette')
      } else if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') || (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'j')) {
        e.preventDefault()
        setOracleOpen((o) => !o)
      } else if (e.key === 'F11') {
        e.preventDefault()
        run('fullscreen')
      }
    }
    window.addEventListener('keydown', onKey)
    const off = life.onUiKey(run)
    return () => {
      window.removeEventListener('keydown', onKey)
      off()
    }
  }, [toggleSidebar, embed, page, tab])

  const go = useCallback((p: PageId, v?: 'app' | 'system') => {
    if (v) setView((cur) => ({ ...cur, [p]: v }))
    setPage(p)
  }, [])
  const commands: Command[] = buildCommands({
    rules,
    tasks,
    schedule,
    shop,
    go,
    award: (r) => act(() => life.wallet.award(r.id), `${r.title} logged`).then((x) => x && onWallet()),
    completeTask: (id) => act(() => life.tasks.complete(id), 'Task done').then((x) => x && onWallet()),
    startBlock: (id) => act(() => life.schedule.start(id), 'Timer started').then((x) => {
      if (x) setSchedule(x)
      go('schedule')
    }),
    actions: [
      { id: 'a:oracle', label: 'Summon Solo Leveling System Oracle', hint: 'Ctrl+Shift+A', group: 'Actions', icon: 'bolt', color: '#00d2ff', run: () => setOracleOpen(true) },
      { id: 'a:sidebar', label: 'Collapse or expand the sidebar', hint: 'Ctrl+B', group: 'Actions', icon: 'list', run: toggleSidebar },
      { id: 'a:full', label: 'Full screen', hint: 'F11', group: 'Actions', icon: 'spark', run: () => life.app.toggleFullScreen() },
      { id: 'a:urge', label: 'Urge crusher', hint: 'Ctrl+Alt+U', group: 'Actions', icon: 'bolt', color: '#FF8A3D', run: () => {
        setView((v) => ({ ...v, discipline: 'system' }))
        setPage('discipline')
        setRevealed(true)
        setUrgeOpen(true)
      } },
      { id: 'a:backup', label: 'Back up now', group: 'Actions', icon: 'cloud', run: () => act(() => life.backup.runNow(), 'Backup written').then((b) => b && setBackup(b)) },
      { id: 'a:update', label: 'Check for updates', group: 'Actions', icon: 'spark', run: () => act(() => life.updates.check()).then((u) => u && setUpdate(u)) },
      { id: 'a:sync', label: 'Check connected apps now', group: 'Actions', icon: 'link', run: () => act(() => life.connections.sync()).then((r) => r && onWallet()) },
      { id: 'a:system-quest', label: 'Summon Quest Complete Hologram', hint: 'Solo Leveling', group: 'Actions', icon: 'spark', color: '#00d2ff', run: () => setSystemModal({ open: true, type: 'quest-complete', data: { coins: 50, xp: 100 } }) },
      { id: 'a:system-level', label: 'Summon Level Advancement Hologram', hint: 'Solo Leveling', group: 'Actions', icon: 'spark', color: '#c8f135', run: () => setSystemModal({ open: true, type: 'level-up', data: { level: summary?.level.level ?? 1, prevLevel: Math.max(1, (summary?.level.level ?? 2) - 1), statPoints: 3, onAction: () => setPage('journey') } }) },
      { id: 'a:system-warning', label: 'Summon Penalty Warning Hologram', hint: 'Solo Leveling', group: 'Actions', icon: 'shield', color: '#f43f5e', run: () => setSystemModal({ open: true, type: 'penalty-warning', data: { onAction: () => { setView((v) => ({ ...v, discipline: 'system' })); setPage('discipline'); setRevealed(true); setUrgeOpen(true); } } }) },

    ]
  })

  // Small counts on the sidebar and the "needs you" list in the bell.
  const [ui, setUiPrefs] = useUiPrefs()
  const blocksLeft = schedule && schedule.day === schedule.today ? schedule.blocks.filter((b) => b.status === 'pending' || b.status === 'running').length : 0
  const tasksLeft = tasks?.tasks.filter((t) => !t.done).length ?? 0
  const overdue = tasks?.tasks.filter((t) => t.overdue).length ?? 0
  const checkInDue = !!discipline?.setup && !discipline.checkedInToday && !discipline.resetToday && !discipline.stealth
  const shopReady = !!shop && (shop.chests.length > 0 || shop.rewards.some((r) => r.price <= shop.balance && tierUnlocked(r.tier, shop.level)))
  const updateReady = !!update && ['available', 'ready'].includes(update.state)
  const badges: Partial<Record<PageId, { n?: number; dot?: 'lime' | 'warn' }>> = {
    tasks: tasksLeft ? { n: tasksLeft, dot: overdue ? 'warn' : undefined } : undefined,
    schedule: blocksLeft ? { n: blocksLeft } : undefined,
    discipline: checkInDue ? { dot: 'lime' } : undefined,
    shop: shopReady ? { dot: 'lime' } : undefined,
    settings: updateReady || backup?.lastError ? { dot: updateReady ? 'lime' : 'warn' } : undefined
  }
  const alerts: Alert[] = []
  if (updateReady) alerts.push({ id: 'update', tone: 'good', icon: 'spark', title: `Version ${update!.latest} is ready`, body: 'Settings > Updates > Update now', page: 'settings' })
  if (backup?.lastError) alerts.push({ id: 'backup', tone: 'warn', icon: 'cloud', title: 'Backups are off', body: backup.lastError, page: 'settings' })
  if (checkInDue) alerts.push({ id: 'checkin', tone: 'info', icon: 'shield', title: 'Check in for today', body: `Day ${discipline!.current} · +20 coins`, page: 'discipline' })
  if (overdue) alerts.push({ id: 'overdue', tone: 'warn', icon: 'tasks', title: `${overdue} task${overdue > 1 ? 's are' : ' is'} overdue`, page: 'tasks' })
  const nextBlock = schedule && schedule.day === schedule.today ? schedule.blocks.find((b) => b.status === 'pending' && Date.parse(b.startsAt) > Date.now()) : undefined
  if (nextBlock && Date.parse(nextBlock.startsAt) - Date.now() < 60 * 60_000) {
    alerts.push({ id: `block-${nextBlock.id}`, tone: 'info', icon: 'calendar', title: `${nextBlock.title} at ${nextBlock.start}`, body: 'Starts within the hour', page: 'schedule' })
  }
  if (shop?.chests.length) alerts.push({ id: 'chest', tone: 'good', icon: 'gift', title: `${shop.chests.length} chest${shop.chests.length > 1 ? 's' : ''} to open`, page: 'shop' })

  // Sidebar: full, or a slim icon rail. "auto" turns it into a rail while an
  // app is open, so the app gets the room; hovering the rail slides it out.
  const collapsed = sidebarMode === 'closed' || (sidebarMode === 'auto' && !!activeEmbed)
  const compact = !!embed
  const focus = fullScreen && !!activeEmbed

  return (
    <div className={`shell ${collapsed ? 'rail' : ''} ${focus ? 'focus' : ''}`}>
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      {focus && (
        <div className="focus-reveal">
          <div className="focus-bar">
            <span>{current.label}</span>
            <button className="btn small" onClick={() => life.app.toggleFullScreen()}>
              Exit full screen <kbd>F11</kbd>
            </button>
          </div>
        </div>
      )}
      <Sidebar
        page={page}
        onPage={setPage}
        collapsed={collapsed}
        onToggle={toggleSidebar}
        badges={badges}
        level={lv ?? null}
        balance={summary?.balance ?? 0}
        name={ui.name}
      />

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
          <button className="search-btn" onClick={() => { soundTick(); setPaletteOpen(true) }} title="Search and run anything (Ctrl+K)">
            <Icon name="search" size={14} />
            <span className="chip-text">Search or run…</span>
            <kbd>Ctrl K</kbd>
          </button>
          {activeEmbed && (
            <button className="icon-btn" aria-label="Full screen" title="Full screen (F11)" onClick={() => life.app.toggleFullScreen()}>
              <Icon name="expand" size={15} />
            </button>
          )}
          <button
            className="system-oracle-header-btn"
            onClick={() => setOracleOpen(true)}
            title="Summon Solo Leveling System Oracle (Ctrl+Shift+A)"
          >
            <span className="oracle-dot" />
            <span className="oracle-text">SYSTEM ORACLE</span>
            <kbd>Ctrl+Shift+A</kbd>
          </button>
          <button
            className="game-rules-header-btn"
            onClick={() => setPage('rules')}
            title="Solo Leveling System Codex & Game Rules"
          >
            <span style={{ fontSize: 13 }}>📜</span>
            <span>GAME RULES</span>
          </button>

          <div className="top-actions">
            <button
              className={`icon-btn ${!ui.sound ? 'muted' : ''}`}
              aria-label={ui.sound ? 'Mute sound effects' : 'Unmute sound effects'}
              title={ui.sound ? `Cyberpunk SFX Active (${ui.volume ?? 80}%) — Click to mute` : 'SFX Muted — Click to unmute'}
              onClick={() => {
                const next = !ui.sound
                setUiPrefs({ sound: next })
                if (next) soundTick()
                else stopAllSounds()
              }}
              style={{
                opacity: ui.sound ? 1 : 0.6
              }}
            >
              <span style={{ fontSize: 16 }}>{ui.sound ? '🔊' : '🔇'}</span>
            </button>
            <Notifications alerts={alerts} summary={summary} rules={rules} onGo={(p) => go(p, EMBED_OF[p] ? 'system' : undefined)} />
            <UpdateChip status={update} onClick={() => setPage('settings')} />
            {backup && (
              <button className={`chip ${backup.lastError ? 'warn' : 'ok'}`} onClick={() => setPage('settings')} title={backup.lastError ?? `Last backup ${backup.last?.at ?? ''}`}>
                <Icon name="cloud" size={15} />
                <span className="chip-text">{backup.lastError ? 'Backup off' : 'Backed up'}</span>
              </button>
            )}
            {isDemo && <span className="chip">Demo</span>}

          </div>

          {lv && summary && (
            <div
              className="player player-interactive solo-hud-chip"
              role="button"
              tabIndex={0}
              onClick={() => {
                soundSystemOracle()
                setPlayerModalOpen(true)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  soundSystemOracle()
                  setPlayerModalOpen(true)
                }
              }}
              title="⚡ Hunter Status Window · Click to view level progression, attributes & combat power"
            >
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
                <div className="wallet-pops" aria-live="polite">
                  <AnimatePresence>
                    {pops.map((p) => (
                      <motion.span
                        key={p.id}
                        className={`wallet-pop ${p.coins < 0 ? 'neg' : ''}`}
                        initial={{ opacity: 0, y: 14, scale: 0.8 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                      >
                        <b>
                          {p.coins > 0 ? '+' : ''}
                          {p.coins}
                        </b>
                        {p.label && <small>{p.label}</small>}
                      </motion.span>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          )}
        </header>

        <EmbedHost active={activeEmbed} />

        <AnimatePresence mode="wait">
          {!activeEmbed && <motion.main key={page} className="content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
            <ErrorBoundary key={page} area={current.label} onHome={page === 'today' ? undefined : () => setPage('today')}>
            {page === 'today' && summary && (
              <Today summary={summary} rules={rules} shop={shop} tasks={tasks} schedule={schedule} discipline={discipline} connections={connections} body={body} onChange={onWallet} onTasks={setTasks} onSchedule={setSchedule} onGo={setPage} onOpenApp={(p) => { setView((v) => ({ ...v, [p]: 'app' })); setPage(p) }} />
            )}
            {page === 'body' && body && <Body state={body} onState={setBody} onWallet={onWallet} />}
            {page === 'discipline' && discipline && (
              <Discipline state={discipline} man={connections?.man.suggestion ?? null} onState={setDiscipline} onWallet={onWallet} revealed={revealed} onReveal={() => setRevealed(true)} urgeOpen={urgeOpen} onUrgeOpen={setUrgeOpen} />
            )}
            {page === 'sleep' && connections && <Sleep state={connections} onState={setConnections} onWallet={onWallet} />}
            {page === 'money' && connections && <Money state={connections} onState={setConnections} onWallet={onWallet} />}
            {page === 'connected' && connections && <Connected state={connections} onState={setConnections} onWallet={onWallet} />}
            {page === 'bots' && <BotCenter />}
            {page === 'tasks' && tasks && <Tasks state={tasks} onState={setTasks} onWallet={onWallet} />}
            {page === 'schedule' && schedule && <Schedule state={schedule} rules={rules} onState={setSchedule} onWallet={onWallet} />}
            {page === 'shop' && shop && <Shop state={shop} onState={setShop} onWallet={onWallet} />}
            {page === 'journey' && summary && <Journey summary={summary} rules={rules} />}
            {page === 'history' && <History rules={rules} onChange={onWallet} />}
            {page === 'rules' && <Rules rules={rules} onChange={setRules} summary={summary} onGo={setPage} onOracle={() => setOracleOpen(true)} onModal={(type, data) => setSystemModal({ open: true, type, data })} />}
            {page === 'settings' && <Settings auth={auth} onAuth={onAuth} backup={backup} onBackup={setBackup} onRestored={refresh} update={update} onUpdate={setUpdate} />}
            {current.phase > 0 && <Soon module={current} />}
            </ErrorBoundary>
          </motion.main>}
        </AnimatePresence>
        <SystemOracleDrawer
          open={oracleOpen}
          onClose={() => setOracleOpen(false)}
          summary={summary}
        />
        <SoloSystemModal
          open={systemModal.open}
          onClose={() => setSystemModal((s) => ({ ...s, open: false }))}
          type={systemModal.type}
          data={systemModal.data}
        />
        <SoloPlayerModal
          open={playerModalOpen}
          onClose={() => setPlayerModalOpen(false)}
          summary={summary}
          onGo={go}
        />
      </div>
    </div>
  )
}
