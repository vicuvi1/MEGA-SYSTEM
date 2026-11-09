import { Suspense, createElement, lazy, useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { MotionRoot, viewSwitch } from './motionKit'
import type { AuthStatus, BackupStatus, BodyState, ConnectionsState, DisciplineState, Rule, ScheduleState, ShopState, Summary, TasksState } from '@shared/api'
import { features, isDemo, life } from './bridge'
import { Icon } from './Icon'
import { MODULES, SYSTEM_PAGES, type PageId } from './modules'
import { Coins, ToastProvider, useToast } from './ui'
import { CoinFlight } from './rewards/CoinFlight'
import { ConfirmHost } from './confirmSheet'
import { LockScreen } from './pages/LockScreen'
import { Today } from './pages/Today'
import { Soon } from './pages/Soon'
import { EMBED_LABEL, EmbedHost, type EmbedKind } from './EmbedHost'
import { UpdateChip, useUpdates } from './updates'
import { buildCommands, Palette, type Command } from './Palette'
import { Notifications, type Alert } from './Notifications'
import { NotifToasts } from './NotifToasts'
import { RestDayButton } from './RestDay'
import { Sidebar } from './Sidebar'
import { MobileBottomBar } from './MobileBottomBar'
import { PwaInstallBanner } from './PwaInstallBanner'
import { PageSkeleton } from './blocks'
import { ErrorBoundary, installWindowErrorHandlers } from './ErrorBoundary'
import { useUiPrefs } from './uiPrefs'
import { useCoachUnread } from './coachUnread'
import { NewVersionBar } from './newVersion'
import { FocusIsland } from './FocusIsland'
import { DisciplineMoments } from './DisciplineMoments'
import { BenBubble } from './BenBubble'
import { DeepLinks } from './DeepLinks'
import { describeEntry, useAction } from './ui'
import { loadLastPlace, saveLastPlace } from './uiPrefs'
import { reloadToday } from './todayEvents'
import { capture } from './capture'
import { useAddMoney } from './MoneyQuick'
import type { TodoTask } from '@core/todoist'
import { play, soundTick, stopAllSounds, soundFanfare, soundCoin, soundWarning } from './soundKit'
import { countdown, nextUp } from '@core/dayGlance'
import { rankUp } from '@core/levelCine'
import { useTodayEvents } from './todayEvents'
import { storageWakesApp } from './islandLog'
import { watchDayTurn } from './dayTurn'
import { MusicHost } from './musicHost'
import { FocusBoost } from './boost/FocusBoost'
import { winMoment } from './boost/boostBus'
import { startZoom, ZoomToast } from './zoom'
import { WallpaperLayer } from './wallpaper/WallpaperLayer'
import { CustomBackground } from './custom/CustomBackground'

// Pages and pop-ups load when first opened (Today and the lock screen come at
// once), and every page is fetched in the background once Today is up
// (preloadPages). A page whose code is already here draws at once, without
// the loading skeleton (React holds a skeleton at least 300 ms).
const preloaders: (() => Promise<unknown>)[] = []
function lazyNamed<M extends Record<K, ComponentType<any>>, K extends keyof M>(load: () => Promise<M>, name: K) {
  let Loaded: M[K] | null = null
  let loading: Promise<M[K]> | null = null
  const get = () => (loading ??= load().then((m) => (Loaded = m[name])).catch((e) => ((loading = null), Promise.reject(e))))
  const Lazy = lazy(() => get().then((c) => ({ default: c })))
  // Chosen once per mount, so a page never swaps under itself (that would reset it).
  const Page = (props: any) => {
    const [Ready] = useState(() => Loaded)
    return Ready ? createElement(Ready, props) : createElement(Lazy, props)
  }
  preloaders.push(get)
  return Page as unknown as M[K]
}
let preloaded = false
/** Fetches every page's code, one at a time while the page is idle. */
function preloadPages(): void {
  if (preloaded) return
  preloaded = true
  const queue = [...preloaders]
  const next = () => {
    const load = queue.shift()
    if (load) whenIdle(() => void load().catch(() => {}).finally(next), 3000)
  }
  next()
}
const History = lazyNamed(() => import('./pages/History'), 'History')
const Settings = lazyNamed(() => import('./pages/Settings'), 'Settings')
const Rewards = lazyNamed(() => import('./pages/Rewards'), 'Rewards')
const TodoTasks = lazyNamed(() => import('./pages/TodoTasks'), 'TodoTasks')
const Discipline = lazyNamed(() => import('./pages/Discipline'), 'Discipline')
const Body = lazyNamed(() => import('./pages/Body'), 'Body')
const Sleep = lazyNamed(() => import('./pages/Sleep'), 'Sleep')
const Money = lazyNamed(() => import('./pages/Money'), 'Money')
const Connected = lazyNamed(() => import('./pages/Connected'), 'Connected')
const BotCenter = lazyNamed(() => import('./pages/BotCenter'), 'BotCenter')
const Notebook = lazyNamed(() => import('./pages/Notebook'), 'Notebook')
const Music = lazyNamed(() => import('./pages/Music'), 'Music')
const Progress = lazyNamed(() => import('./pages/Progress'), 'Progress')
const Goals = lazyNamed(() => import('./pages/Goals'), 'Goals')
const Season = lazyNamed(() => import('./pages/Season'), 'Season')
const CinematicHost = lazyNamed(() => import('./saga/Cinematics'), 'CinematicHost')
const Career = lazyNamed(() => import('./pages/Career'), 'Career')
const CalendarPage = lazyNamed(() => import('./pages/CalendarPage'), 'CalendarPage')
const Coach = lazyNamed(() => import('./pages/Coach'), 'Coach')
const CustomCenter = lazyNamed(() => import('./pages/CustomCenter'), 'CustomCenter')
const PhotoLocker = lazyNamed(() => import('./vault/PhotoLocker'), 'PhotoLocker')
const QuickHost = lazyNamed(() => import('./quick/QuickHost'), 'QuickHost')


/** Runs `fn` once the page is idle (at the latest after `ms`); returns a cancel. */
function whenIdle(fn: () => void, ms = 2000): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: ms })
    return () => w.cancelIdleCallback?.(id)
  }
  const id = setTimeout(fn, Math.min(ms, 1200))
  return () => clearTimeout(id)
}

// Below this window width the sidebar folds to icons by itself (unless you opened it with Ctrl+B).
const SIDEBAR_FOLD_PX = 1180

// Sections that hold one of the apps living inside Life System.
const EMBED_OF: Partial<Record<PageId, { kind: EmbedKind; system: string }>> = {
  money: { kind: 'finance', system: 'Money hub' },
  sleep: { kind: 'waky', system: 'Points & stats' },
  // MN24: Discipline is one page (the built-in one); the MAN app isn't a second copy.
  body: { kind: 'sport', system: 'Metrics & Workouts' }
}

export function App() {
  return (
    <MotionRoot>
      <ToastProvider>
        <ErrorBoundary area="Life System">
          <WindowErrors />
          <ConfirmHost />
          <NewVersionBar />
          <Gate />
        </ErrorBoundary>
      </ToastProvider>
    </MotionRoot>
  )
}

/** Errors outside React become a short note and a log entry. */
function WindowErrors() {
  const toast = useToast()
  useEffect(() => installWindowErrorHandlers((t) => toast(t, 'bad')), [toast])
  // Zoom: the desktop window's own (Ctrl + / - / 0, Ctrl + wheel), told to the page.
  useEffect(() => startZoom(), [])
  // Back from the Google sign-in (/?google=connected): say how it went, open Calendar.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('google')
    if (!q) return
    const msg: Record<string, [string, 'good' | 'bad']> = {
      connected: ['Google Calendar connected ✓', 'good'],
      cancelled: ['Google sign-in cancelled', 'bad'],
      expired: ['That sign-in link expired: try Connect again', 'bad'],
      failed: ['Google sign-in failed: try Connect again', 'bad'],
      'not-configured': ['Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel first', 'bad']
    }
    // Back from "Connect Google Drive" (Photo Locker) rather than the calendar's Connect.
    let after: string | null = null
    try {
      after = localStorage.getItem('ls.afterGoogle')
      localStorage.removeItem('ls.afterGoogle')
    } catch {
      after = null
    }
    const [text, kind] = after === 'locker' && q === 'connected' ? ['Google Drive connected ✓', 'good' as const] : (msg[q] ?? ['Google: ' + q, 'bad'])
    toast(text, kind)
    // Shell opens the Calendar page (or Photo Locker) (it may mount a moment later).
    if (q === 'connected') setTimeout(() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: after === 'locker' ? 'locker' : 'calendar' })), 800)
    window.history.replaceState(null, '', window.location.pathname)
  }, [toast])

  // Tasks you ticked in the Todoist app itself, paid when this page checks.
  useEffect(() => {
    const on = (e: Event) => {
      const n = Number((e as CustomEvent).detail?.paid) || 0
      if (n) toast(`✅ ${n} Todoist task${n > 1 ? 's' : ''} done: points added`, 'good')
    }
    window.addEventListener('life-todoist-paid', on)
    return () => window.removeEventListener('life-todoist-paid', on)
  }, [toast])
  return null
}

function Gate() {
  const [auth, setAuth] = useState<AuthStatus | null>(null)

  useEffect(() => {
    life.auth.status().then(setAuth)
    return life.onLocked ? life.onLocked(() => setAuth((a) => (a ? { ...a, locked: true } : a))) : undefined
  }, [])

  if (!auth) return null

  if (auth.pinSet && auth.locked) {
    return <LockScreen onUnlocked={setAuth} />
  }

  return <Shell auth={auth} onAuth={setAuth} />
}

function Shell({ auth, onAuth }: { auth: AuthStatus; onAuth: (a: AuthStatus) => void }) {
  const last = useRef(loadLastPlace()).current
  // A home-screen shortcut (/?page=tasks) opens that page; else where you left off.
  const asked = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('page') : null
  const known = [...MODULES, ...SYSTEM_PAGES].find((m) => m.id === (asked ?? last?.page) && m.phase === 0)
  const [page, setPageNow] = useState<PageId>(known ? known.id : 'today')
  // Page changes cross-fade with a short view transition (AF4); same page: nothing to do.
  const pageRef = useRef(page)
  pageRef.current = page
  const setPage = useCallback((p: PageId) => {
    if (p === pageRef.current) return
    viewSwitch(() => setPageNow(p))
  }, [])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [rules, setRules] = useState<Rule[]>([])
  const [quickCommandOpen, setQuickCommandOpen] = useState(false)
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
  // Ctrl+K lists today's Todoist (the one task system), loaded when it opens.
  const [paletteTodo, setPaletteTodo] = useState<TodoTask[] | null>(null)
  useEffect(() => {
    if (paletteOpen && life.todoist) life.todoist.today().then(setPaletteTodo).catch(() => setPaletteTodo(null))
  }, [paletteOpen])
  const [fullScreen, setFullScreen] = useState(false)
  const [pops, setPops] = useState<{ id: number; coins: number; label: string }[]>([])
  const act = useAction()
  const toast = useToast()
  const [isSyncingMobile, setIsSyncingMobile] = useState(false)
  useEffect(() => {
    const on = (e: Event) => setPage((e as CustomEvent).detail as PageId)
    window.addEventListener('life-open-page', on)
    // An embedded app asks for Life System's own view of a page (e.g. Sport Track → Body → Food).
    const sys = (e: Event) => {
      const p = (e as CustomEvent).detail as PageId
      setView((v) => ({ ...v, [p]: 'system' }))
    }
    window.addEventListener('life-open-system', sys)
    return () => {
      window.removeEventListener('life-open-page', on)
      window.removeEventListener('life-open-system', sys)
    }
  }, [])
  const [wakeEdit, setWakeEdit] = useState(0) // "Fix wake-up" taps: opens the editor on Sleep

  // The ⟳ in the top bar: a real sync of everything, not just phone events:
  // your data (cloud database), Todoist, Google Calendar and phone events.
  const triggerMobileSync = async () => {
    if (isSyncingMobile) return
    setIsSyncingMobile(true)
    soundTick()
    try {
      window.dispatchEvent(new Event('life-desktop-retry'))
      const [res, todo, cal] = await Promise.all([
        life.sync.pull(),
        life.todoist?.sync ? life.todoist.sync().then(() => true, () => false) : Promise.resolve(null),
        reloadToday().then(() => true, () => false)
      ])
      window.dispatchEvent(new CustomEvent('life-external-changed'))
      onWallet()
      const failed = [todo === false && 'Todoist', cal === false && 'Google Calendar', ...(res.errors ?? [])].filter(Boolean)
      if (failed.length) toast(`Synced, except: ${failed.join(', ')}`, 'bad')
      else {
        const streakInfo = res.restoredStreak > res.previousStreak ? ` · streak healed: ${res.previousStreak} → ${res.restoredStreak} days` : ''
        toast(`Synced: data${todo ? ', Todoist' : ''}, calendar${res.eventsProcessed ? `, ${res.eventsProcessed} phone events` : ''}${streakInfo}`, 'good')
        if (res.eventsProcessed > 0) soundFanfare()
        else soundCoin()
      }
    } catch (e: any) {
      toast(`Sync failed: ${e?.message || 'Check connection'}`, 'bad')
    } finally {
      setIsSyncingMobile(false)
    }
  }

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
  // A narrow window (a laptop with a half-screen window) folds the sidebar to
  // icons by itself, so it never covers the page. Your own choice (Ctrl+B) wins.
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < SIDEBAR_FOLD_PX)
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < SIDEBAR_FOLD_PX)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

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
    const [s, r, b, sh, t, sc, d, bd, c] = await Promise.all([
      life.wallet.summary(),
      life.rules.list(),
      life.backup.status(),
      life.shop.state(),
      life.tasks.state(),
      life.schedule.state(),
      life.discipline.state(),
      life.body.state(),
      life.connections.state()
    ])
    setDiscipline(d)
    setConnections(c)
    setBody(bd)
    setSummary(s)
    setRules(r)
    setBackup(b)
    setShop(sh)
    setTasks(t)
    setSchedule(sc)
  }, [])

  // Coins moved: debounced refresh so rapid actions don't lag the UI
  const walletDebounceTimer = useRef<any>(null)
  const onWallet = useCallback(() => {
    if (walletDebounceTimer.current) clearTimeout(walletDebounceTimer.current)
    walletDebounceTimer.current = setTimeout(async () => {
      const [s, sh, t, d, c, bd] = await Promise.all([
        life.wallet.summary(),
        life.shop.state(),
        life.tasks.state(),
        life.discipline.state(),
        life.connections.state(),
        life.body.state()
      ])
      setDiscipline(d)
      setConnections(c)
      setBody(bd)
      setSummary(s)
      setShop(sh)
      setTasks(t)
    }, 35)
  }, [])

  // Pick up a new day, missed blocks and backup state while the app stays open.
  useEffect(() => {
    const t = setInterval(() => {
      // CL2: nothing to redraw while the tab is hidden (coming back refreshes everything).
      if (document.visibilityState === 'hidden') return
      life.schedule.state().then((sc) => setSchedule((cur) => (cur && cur.day !== cur.today ? cur : sc)))
      life.backup.status().then(setBackup)
    }, 60_000)
    return () => clearInterval(t)
  }, [])

  // Auto-refresh when user switches back to the tab/app on phone or PC, or when any module emits a change
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        life.bots?.pollOnce?.().then((res) => {
          if (res && res.processedCount > 0) refresh()
        }).catch(() => {})
        refresh()
      }
    }
    const onModuleSync = () => refresh()
    // IC7: only data changes made by another window (an embedded app), not the island's logs.
    const onStorage = (e: StorageEvent) => { if (storageWakesApp(e.key)) refresh() }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onVisibilityChange)
    window.addEventListener('life-body-changed', onModuleSync)
    window.addEventListener('life-discipline-changed', onModuleSync)
    window.addEventListener('life-wallet-changed', onModuleSync)
    window.addEventListener('storage', onStorage)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onVisibilityChange)
      window.removeEventListener('life-body-changed', onModuleSync)
      window.removeEventListener('life-discipline-changed', onModuleSync)
      window.removeEventListener('life-wallet-changed', onModuleSync)
      window.removeEventListener('storage', onStorage)
    }
  }, [refresh])

  // Periodic real-time background Telegram sync (every 12 seconds when visible)
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        life.bots?.pollOnce?.().then((res) => {
          if (res && res.processedCount > 0) refresh()
        }).catch(() => {})
      }
    }, 12_000)
    return () => clearInterval(interval)
  }, [refresh])

  // Today first; the bots' check runs beside it (it loads their code and asks
  // the server) and redraws only if it handled something. The daily backup
  // (the whole database, zipped) waits until the page is idle.
  useEffect(() => {
    refresh()
    life.bots?.pollOnce?.().then((res) => {
      if (res && res.processedCount > 0) refresh()
    }).catch(() => {})
    return whenIdle(() => void life.data.saveDailySnapshot?.().catch(() => {}), 4000)
  }, [refresh])
  // Photo Locker: uploads that were waiting (or cut off by a reload) carry on once the page is idle.
  useEffect(() => whenIdle(() => void import('./vault/driveSync').then((m) => m.vaultBoot()).catch(() => {}), 20_000), [])

  // A connected app paid something in the background.
  useEffect(() => {
    life.onWalletChanged(() => onWallet())
  }, [onWallet])

  // CL10: at 04:00 the app's day turns: Today shows the new day without waiting for a change.
  useEffect(() => watchDayTurn(() => refresh()), [refresh])
  // Which day Today shows (the soak test checks it after 04:00).
  useEffect(() => {
    if (summary?.today) document.documentElement.dataset.lifeToday = summary.today
  }, [summary?.today])

  // Listen to discipline changes from the main process / background bots
  useEffect(() => {
    const unsub = life.onDisciplineChanged?.(() => {
      life.discipline.state().then((d) => {
        setDiscipline(d)
        window.dispatchEvent(new CustomEvent('life-discipline-state', { detail: d }))
      })
    })
    return () => unsub?.()
  }, [])

  // Sync to MAN whenever discipline state changes in the renderer. Its own
  // event: 'life-discipline-changed' makes this page reload, which set new
  // state, which sent the event again: an endless reload loop.
  useEffect(() => {
    if (discipline) {
      window.dispatchEvent(new CustomEvent('life-discipline-state', { detail: discipline }))
    }
  }, [discipline])

  // Refresh wallet & summary when MAN app triggers a checkin/oath sync
  useEffect(() => {
    const handleDisciplineSynced = () => {
      onWallet()
    }
    window.addEventListener('life-discipline-synced', handleDisciplineSynced)
    return () => window.removeEventListener('life-discipline-synced', handleDisciplineSynced)
  }, [onWallet])

  // Today is up: fetch the other pages' code in the background.
  useEffect(() => {
    if (summary) preloadPages()
  }, [summary])

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

  // Level up: the fanfare, once per new level.
  const lastLevel = useRef<number | null>(null)
  useEffect(() => {
    const lv = summary?.level?.level
    if (typeof lv !== 'number') return
    const prev = lastLevel.current
    lastLevel.current = lv
    // LF7: a new rank gets the full cinematic (it has its own sound); other levels keep the fanfare.
    if (prev !== null && lv > prev && !rankUp(prev, lv)) play('levelUp')
    // LF20: your victory clip on any level up, if you switched it on.
    if (prev !== null && lv > prev) winMoment('levelUp')
  }, [summary?.level?.level])

  // A page that no longer exists (Schedule, Journey, Game Rules) opens Today.
  const current = [...MODULES, ...SYSTEM_PAGES].find((m) => m.id === (page === 'focus' ? 'progress' : page)) ?? MODULES[0]
  useEffect(() => {
    if (![...MODULES, ...SYSTEM_PAGES].some((m) => m.id === page)) setPage('today')
  }, [page])
  const embed = EMBED_OF[page]
  // Stealth hides MAN too until the section is revealed.
  const hiddenByStealth = page === 'discipline' && !!discipline?.stealth && !revealed
  // Money opens on its own hub (Night 11); the full Finance Helper is one tap away.
  const tab = embed ? (hiddenByStealth ? 'system' : view[page] ?? (page === 'money' ? 'system' : 'app')) : 'system'
  const activeEmbed = embed && tab === 'app' ? embed.kind : null
  const { events: todayEvents } = useTodayEvents()

  const toggleSidebar = useCallback(() => {
    setSidebarMode((m) => {
      const isCollapsed = m === 'closed' || (m === 'auto' && (!!activeEmbed || narrow))
      const next = isCollapsed ? 'open' : 'closed'
      try {
        localStorage.setItem('ls.sidebar', next)
      } catch {
        // per-viewer convenience only
      }
      return next
    })
  }, [activeEmbed, narrow])

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
      if (key === 'quick-command') {
        soundTick()
        setQuickCommandOpen((o) => !o)
      }
      if (key === 'oracle' && features.ai) setPage('coach')
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
      } else if (e.ctrlKey && (e.code === 'Space' || e.key === ' ')) {
        e.preventDefault()
        setQuickCommandOpen((o) => !o)
      } else if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        run('palette')
      } else if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') || (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'j')) {
        e.preventDefault()
        setPage('coach')
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
  const bbHidden = page === 'coach' || page === 'today' || page === 'calendar' || !!embed
  /** Settings, opened on one section (the backup chip opens Backups & data). */
  const openSettingsTab = (id: string) => {
    try {
      localStorage.setItem('ls.settingsTab', id)
    } catch {
      /* private window */
    }
    setPage('settings')
    window.dispatchEvent(new CustomEvent('life-settings-tab', { detail: id }))
  }
  const commands: Command[] = buildCommands({
    rules,
    todo: paletteTodo,
    shop,
    go,
    award: (r) => act(() => life.wallet.award(r.id), `${r.title} logged`).then((x) => x && onWallet()),
    completeTodo: (t) => act(() => life.todoist!.complete(t), `Done: ${t.content}`).then((x) => {
      if (x) onWallet()
      setPaletteTodo((cur) => (cur ?? []).filter((y) => y.id !== t.id))
      window.dispatchEvent(new CustomEvent('life-external-changed'))
    }),
    actions: [
      ...(features.ai ? [{ id: 'a:oracle', label: 'Ask the coach', hint: 'Ctrl+J', group: 'Actions', icon: 'bolt', color: '#00d2ff', run: () => setPage('coach') } as const] : []),
      { id: 'a:year', label: 'Your year', hint: 'Insights', group: 'Actions', icon: 'trophy', run: () => {
        try {
          localStorage.setItem('ls.insightsTab', 'year')
        } catch {
          /* this visit only */
        }
        window.dispatchEvent(new CustomEvent('life-insights-tab', { detail: 'year' }))
        setPage('progress')
      } },
      { id: 'a:month', label: 'Month review', hint: 'Insights', group: 'Actions', icon: 'calendar', run: () => {
        try {
          localStorage.setItem('ls.insightsTab', 'month')
        } catch {
          /* this visit only */
        }
        window.dispatchEvent(new CustomEvent('life-insights-tab', { detail: 'month' }))
        setPage('progress')
      } },
      { id: 'a:sidebar', label: 'Collapse or expand the sidebar', hint: 'Ctrl+B', group: 'Actions', icon: 'list', run: toggleSidebar },
      { id: 'a:full', label: 'Full screen', hint: 'F11', group: 'Actions', icon: 'spark', run: () => life.app.toggleFullScreen() },
      { id: 'a:urge', label: 'Urge crusher', hint: 'Ctrl+Alt+U', group: 'Actions', icon: 'bolt', color: '#FF8A3D', run: () => {
        setView((v) => ({ ...v, discipline: 'system' }))
        setPage('discipline')
        setRevealed(true)
        setUrgeOpen(true)
      } },
      { id: 'a:backup', label: 'Back up now', group: 'Actions', icon: 'cloud', run: () => act(() => life.backup.runNow(), 'Backup written').then((b) => b && setBackup(b)) },
      ...(features.updates ? [{ id: 'a:update', label: 'Check for updates', group: 'Actions', icon: 'spark', run: () => act(() => life.updates.check()).then((u) => u && setUpdate(u)) } as const] : []),
      { id: 'a:sync', label: 'Check connected apps now', group: 'Actions', icon: 'link', run: () => act(() => life.connections.sync()).then((r) => r && onWallet()) },
      { id: 'a:mobile-sync', label: features.cloudflareSync ? 'Sync Mobile Telegram Logs (Heal Streaks)' : 'Sync now (get what other devices changed)', hint: features.cloudflareSync ? 'Cloudflare 24/7' : 'Turso', group: 'Actions', icon: 'cloud', color: '#00d2ff', run: triggerMobileSync },

    ]
  })

  // Small counts on the sidebar and the "needs you" list in the bell.
  const [ui, setUiPrefs] = useUiPrefs()
  const blocksLeft = schedule && schedule.day === schedule.today ? schedule.blocks.filter((b) => b.status === 'pending' || b.status === 'running').length : 0
  const tasksLeft = tasks?.tasks.filter((t) => !t.done).length ?? 0
  const overdue = tasks?.tasks.filter((t) => t.overdue).length ?? 0
  const checkInDue = !!discipline?.setup && !discipline.checkedInToday && !discipline.resetToday && !discipline.stealth
  const shopReady = !!shop && shop.rewards.some((r) => !r.archived && r.price <= shop.balance)
  const updateReady = !!update && ['available', 'ready'].includes(update.state)
  const coachUnread = useCoachUnread(page === 'coach', ui.sound !== false)
  const badges: Partial<Record<PageId, { n?: number; dot?: 'lime' | 'warn' }>> = {
    coach: coachUnread ? { n: coachUnread } : undefined,
    discipline: checkInDue ? { dot: 'lime' } : undefined,
    shop: shopReady ? { dot: 'lime' } : undefined,
    settings: updateReady || backup?.lastError ? { dot: updateReady ? 'lime' : 'warn' } : undefined
  }
  const alerts: Alert[] = []
  // On the desktop the title bar offers 'Restart to update' itself.
  if (updateReady && !window.desktop) alerts.push({ id: 'update', tone: 'good', icon: 'spark', title: `Version ${update!.latest} is ready`, body: 'Settings > Updates > Update now', page: 'settings' })
  if (backup?.lastError) alerts.push({ id: 'backup', tone: 'warn', icon: 'cloud', title: 'Today’s cloud backup didn’t save', body: backup.lastError, page: 'settings' })
  if (checkInDue) alerts.push({ id: 'checkin', tone: 'info', icon: 'shield', title: 'Check in for today', body: `Day ${discipline!.day ?? discipline!.current}`, page: 'discipline' })
  if (overdue) alerts.push({ id: 'overdue', tone: 'warn', icon: 'tasks', title: `${overdue} task${overdue > 1 ? 's are' : ' is'} overdue`, page: 'tasks' })
  // The next thing in your real calendar within the hour (T2; it read an old, empty schedule).
  const nextEv = nextUp(todayEvents, Date.now())
  if (nextEv && Date.parse(nextEv.start) - Date.now() < 60 * 60_000) {
    alerts.push({ id: `event-${nextEv.id}`, tone: 'info', icon: 'calendar', title: `${nextEv.title} at ${new Date(nextEv.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, body: `Starts ${countdown(Date.parse(nextEv.start) - Date.now())}${nextEv.location ? ` · ${nextEv.location}` : ''}`, page: 'calendar' })
  }
  // No "chests to open" alert: the Rewards page can't open chests yet (FX7). Bring it back with a chest UI.

  // Ctrl+K: a money line ("45 food", "+500 salary") goes straight to Finance Helper (MF1).
  const addMoney = useAddMoney()
  const paletteLive = useCallback(
    async (q: string): Promise<Command | null> => {
      const p = await life.finance?.preview(q).catch(() => null)
      if (!p) return null
      const amt = (p.amount / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })
      return { id: 'money:quick', label: `${p.type === 'income' ? 'Income' : 'Spent'} ${amt} lei · ${p.category}`, hint: `${p.account}${p.daysAgo ? ' · yesterday' : ''} · Finance Helper`, group: 'Log', icon: 'coin', color: '#F5C84B', run: () => void addMoney(q).then((r) => r && onWallet()) }
    },
    [addMoney, onWallet]
  )

  // Sidebar: full, or a slim icon rail. "auto" turns it into a rail while an
  // app is open or the window is narrow, so the page gets the room. The open
  // sidebar always takes its own column: it pushes the page, never covers it.
  const collapsed = sidebarMode === 'closed' || (sidebarMode === 'auto' && (!!activeEmbed || narrow))
  const compact = !!embed
  const focus = fullScreen && !!activeEmbed

  return (
    <div className={`shell ${collapsed ? 'rail' : ''} ${focus ? 'focus' : ''}`}>
      <WallpaperLayer page={page} />
      <CustomBackground />
      <Palette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
        live={paletteLive}
        onFreeText={(t) =>
          void capture(t)
            .then((r) => {
              toast(r.said, r.ok ? 'good' : 'info')
              onWallet()
              void reloadToday()
            })
            .catch((e) => toast((e as Error).message, 'bad'))
        }
      />
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
      />

      <div className="main">
        {/* The desktop app has its own island at the top of the screen: one is enough. */}
        {!window.desktop?.islandState && <FocusIsland hideNext={page === 'today'} />}
        <DeepLinks onGo={setPage} />
        {/* UI7: not on pages with their own full-screen app or a floating + button. */}
        <ZoomToast />
        <BenBubble hidden={bbHidden} where={page} unread={coachUnread} onOpenChat={() => setPage('coach')} />
        <DisciplineMoments onOpenChat={() => setPage('coach')} />
        <header className={`topbar ${compact ? 'compact' : ''}`}>
          <div className="title">
            <h1>{current.label}</h1>
            {!compact && <p>{page === 'today' ? new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : current.blurb}</p>}
          </div>
          {embed && !hiddenByStealth && (
            <div className="seg-switch" role="tablist" aria-label={`${current.label} views`}>
              <span className={`seg-thumb ${tab === 'app' ? '' : 'second'}`} aria-hidden="true" />
              <button role="tab" aria-selected={tab === 'app'} className={tab === 'app' ? 'on' : ''} onClick={() => setView((v) => ({ ...v, [page]: 'app' }))}>
                <Icon name={embed.kind === 'finance' ? 'coin' : embed.kind === 'waky' ? 'moon' : embed.kind === 'sport' ? 'tasks' : 'shield'} size={14} />
                {/* The page title already says "Sport Track": its app tab doesn't repeat it. */}
                {embed.kind === 'sport' ? 'Tracker' : EMBED_LABEL[embed.kind]}
              </button>
              <button role="tab" aria-selected={tab === 'system'} className={tab === 'system' ? 'on' : ''} onClick={() => setView((v) => ({ ...v, [page]: 'system' }))}>
                <Icon name="spark" size={14} />
                {embed.system}
              </button>
            </div>
          )}
          {page === 'sleep' && (
            <button
              className="btn small"
              title="Forgot to log when you got up? Set the real time"
              onClick={() => {
                setWakeEdit((n) => n + 1)
                setView((v) => ({ ...v, sleep: 'system' }))
              }}
            >
              <Icon name="edit" size={13} /> Fix wake-up
            </button>
          )}
          <span className="spacer" />
          {/* One search box for pages, actions and quick logging (Ctrl K); ＋ Log opens quick capture. */}
          <button className="tb-search" onClick={() => { soundTick(); setPaletteOpen(true) }} title="Search pages and actions (Ctrl K)">
            <Icon name="search" size={15} />
            <span>Search or go to…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button className="tb-log" onClick={() => { soundTick(); setQuickCommandOpen(true) }} title="Log something: 45 lunch, 50 pushups, focus 50 math… (Ctrl Space)">
            <Icon name="plus" size={15} />
            <span>Log</span>
          </button>
          {activeEmbed && (
            <button className="tb-icon" aria-label="Full screen" title="Full screen (F11)" onClick={() => life.app.toggleFullScreen()}>
              <Icon name="expand" size={16} />
            </button>
          )}
          {page === 'body' && <RestDayButton />}
          <button
            className={`tb-icon ${isSyncingMobile ? 'spinning' : ''}`}
            onClick={triggerMobileSync}
            disabled={isSyncingMobile}
            aria-label="Sync now"
            title={features.cloudflareSync ? 'Sync Telegram mobile logs' : 'Sync now: get what your other devices and the bots changed'}
          >
            <Icon name="refresh" size={16} />
          </button>
          <Notifications alerts={alerts} summary={summary} rules={rules} onGo={(p) => go(p, EMBED_OF[p] ? 'system' : undefined)} />
          <NotifToasts onGo={(p) => go(p, EMBED_OF[p] ? 'system' : undefined)} />
          {!window.desktop && <UpdateChip status={update} onClick={() => setPage('settings')} />}
          {backup && !isDemo && (
            <button
              className={`chip ${backup.lastError ? 'warn' : 'ok'}`}
              onClick={() => openSettingsTab('backups')}
              aria-label={backup.lastError ? 'Today’s cloud backup didn’t save: open Backups & data' : 'Backed up: open Backups & data'}
              title={
                backup.lastError
                  ? `Today’s cloud backup didn’t save.\n${backup.lastError}\nYour data is safe; only today’s copy is missing. Click to open Backups & data.`
                  : `Cloud backup saved${backup.last?.at ? ` (${backup.last.at})` : ''}. Click to open Backups & data.`
              }
            >
              <Icon name="cloud" size={15} />
              <span className="chip-text">{backup.lastError ? 'Backup missed' : 'Backed up'}</span>
            </button>
          )}
          {/* The one Settings button (the sidebar has none); a dot when an update or a missed backup waits there. */}
          <button className={`tb-icon tb-settings ${page === 'settings' ? 'active' : ''}`} aria-label="Settings" title="Settings" onClick={() => setPage('settings')}>
            <Icon name="gear" size={16} />
            {badges.settings && <i className={`tb-dot ${badges.settings.dot ?? ''}`} aria-hidden="true" />}
          </button>

          {/* Your points: tap to spend them (Shop). */}
          {summary && (
            <button className="tb-me" onClick={() => setPage('shop')} title="Your points: spend them on fun time and rewards">
              <span className="tb-coins">
                <Coins n={summary.balance} />
              </span>
              <CoinFlight balance={summary.balance} recent={summary.recent} />
              <span className="wallet-pops" aria-live="polite">
                <AnimatePresence>
                  {pops.map((p) => (
                    <m.span
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
                    </m.span>
                  ))}
                </AnimatePresence>
              </span>
            </button>
          )}
        </header>

        <PwaInstallBanner />

        <EmbedHost active={activeEmbed} soundEnabled={ui.sound} />
        {/* MU: the website's SoundCloud player (hidden, only after you press play) and Ben's "now playing" line. */}
        <MusicHost />
        {/* Focus boost: session goal and verdict, launch kits, Dojo mode, "why I'm stalling", win music. */}
        <FocusBoost />

        {!activeEmbed && (
          <main className={`content ${bbHidden || !life.coach ? '' : 'has-bb'}`}>
            <ErrorBoundary key={page} area={current.label} onHome={page === 'today' ? undefined : () => setPage('today')}>
            <Suspense fallback={<PageSkeleton />}>
            {page === 'today' && !summary && <PageSkeleton />}
            {page === 'today' && summary && (
              <Today summary={summary} rules={rules} shop={shop} tasks={tasks} schedule={schedule} discipline={discipline} connections={connections} body={body} onChange={onWallet} onTasks={setTasks} onSchedule={setSchedule} onGo={setPage} onOpenApp={(p) => { setView((v) => ({ ...v, [p]: 'app' })); setPage(p) }} />
            )}
            {page === 'body' && body && <Body state={body} onState={setBody} onWallet={onWallet} onOpenSportApp={() => setView((v) => ({ ...v, body: 'app' }))} />}
            {page === 'discipline' && discipline && (
              <Discipline state={discipline} man={connections?.man.suggestion ?? null} onState={setDiscipline} onWallet={onWallet} revealed={revealed} onReveal={() => setRevealed(true)} urgeOpen={urgeOpen} onUrgeOpen={setUrgeOpen} />
            )}
            {page === 'sleep' && connections && <Sleep state={connections} onState={setConnections} onWallet={onWallet} openEditor={wakeEdit} />}
            {page === 'money' && connections && <Money state={connections} onState={setConnections} onWallet={onWallet} onOpenApp={() => setView((v) => ({ ...v, money: 'app' }))} />}
            {page === 'connected' && connections && <Connected state={connections} onState={setConnections} onWallet={onWallet} />}
            {page === 'bots' && <BotCenter />}
            {page === 'notebook' && <Notebook />}
            {page === 'music' && <Music />}
            {page === 'tasks' && <TodoTasks onWallet={onWallet} />}
            {page === 'shop' && shop && <Rewards state={shop} onState={setShop} onWallet={onWallet} />}
            {(page === 'progress' || page === 'focus') && <Progress onGo={setPage} onWallet={onWallet} />}
            {page === 'calendar' && <CalendarPage onGo={setPage} />}
            {page === 'goals' && <Goals onGo={setPage} />}
            {page === 'season' && <Season />}
            {page === 'career' && <Career onGo={setPage} />}
            {page === 'coach' && <Coach onWallet={onWallet} />}
            {page === 'custom' && <CustomCenter />}
            {page === 'locker' && <PhotoLocker />}
            {page === 'history' && <History rules={rules} onChange={onWallet} />}
            {page === 'settings' && <Settings auth={auth} onAuth={onAuth} backup={backup} onBackup={setBackup} onRestored={refresh} update={update} onUpdate={setUpdate} onGo={setPage} />}
            {current.phase > 0 && <Soon module={current} />}
            </Suspense>
            </ErrorBoundary>
          </main>
        )}
        {/* LF7: the level-up cinematic (new ranks and season moments, once each). */}
        <Suspense fallback={null}>{summary && life.saga && <CinematicHost level={summary.level?.level ?? null} />}</Suspense>
        <Suspense fallback={null}>
          <QuickHost open={quickCommandOpen} onClose={() => setQuickCommandOpen(false)} />
        </Suspense>
        <MobileBottomBar page={page} onGo={go} onQuickCommand={() => setQuickCommandOpen(true)} />
      </div>
    </div>
  )
}
