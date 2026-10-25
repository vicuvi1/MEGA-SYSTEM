import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { AuthStatus, BackupStatus, Rule, ShopState, Summary } from '@shared/api'
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

const IDLE_LOCK_MS = 10 * 60_000

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

  const refresh = useCallback(async () => {
    const [s, r, b, sh] = await Promise.all([life.wallet.summary(), life.rules.list(), life.backup.status(), life.shop.state()])
    setSummary(s)
    setRules(r)
    setBackup(b)
    setShop(sh)
  }, [])

  // Coins moved: refresh the wallet and the shop together.
  const onWallet = useCallback(async () => {
    const [s, sh] = await Promise.all([life.wallet.summary(), life.shop.state()])
    setSummary(s)
    setShop(sh)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const current = [...MODULES, ...SYSTEM_PAGES].find((m) => m.id === page)!
  const lv = summary?.level

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
            <button key={m.id} className={`nav ${page === m.id ? 'on' : ''}`} onClick={() => setPage(m.id)} style={{ ['--c' as string]: m.color }}>
              <Icon name={m.icon} />
              <span>{m.label}</span>
              {m.phase > 0 && <em className="soon">soon</em>}
            </button>
          ))}
        </nav>
        <nav aria-label="System" className="nav-system">
          {SYSTEM_PAGES.map((m) => (
            <button key={m.id} className={`nav small ${page === m.id ? 'on' : ''}`} onClick={() => setPage(m.id)}>
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

        <AnimatePresence mode="wait">
          <motion.main key={page} className="content" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {page === 'today' && summary && <Today summary={summary} rules={rules} shop={shop} onChange={onWallet} onOpenShop={() => setPage('shop')} />}
            {page === 'shop' && shop && <Shop state={shop} onState={setShop} onWallet={onWallet} />}
            {page === 'history' && <History rules={rules} onChange={onWallet} />}
            {page === 'rules' && <Rules rules={rules} onChange={setRules} />}
            {page === 'settings' && <Settings auth={auth} onAuth={onAuth} backup={backup} onBackup={setBackup} onRestored={refresh} />}
            {current.phase > 0 && <Soon module={current} />}
          </motion.main>
        </AnimatePresence>
      </div>
    </div>
  )
}
