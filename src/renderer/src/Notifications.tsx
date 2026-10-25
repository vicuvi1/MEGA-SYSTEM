import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { LedgerEntry, Rule, Summary } from '@shared/api'
import { life } from './bridge'
import { Icon, type IconName } from './Icon'
import { MODULE_LABEL, type PageId } from './modules'
import { Coins, describeEntry, timeAgo } from './ui'

export interface Alert {
  id: string
  tone: 'warn' | 'info' | 'good'
  icon: IconName
  title: string
  body?: string
  page: PageId
}

const SEEN_KEY = 'ls.notif.seen'
const MODULE_ICON: Record<string, IconName> = {
  sleep: 'moon', schedule: 'calendar', discipline: 'shield', body: 'bolt', tasks: 'tasks', money: 'coin', shop: 'gift'
}

function loadSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY) ?? 0)
  } catch {
    return 0
  }
}

/**
 * Bell in the header: things that need you, and the latest coins in and out.
 * Everything since you last opened it counts as unread.
 */
export function Notifications({ alerts, summary, rules, onGo }: { alerts: Alert[]; summary: Summary | null; rules: Rule[]; onGo: (p: PageId) => void }) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [seen, setSeen] = useState(loadSeen)
  const box = useRef<HTMLDivElement>(null)
  const titles = useMemo(() => Object.fromEntries(rules.map((r) => [r.id, r.title])), [rules])

  // Reload the activity whenever the wallet changes.
  useEffect(() => {
    life.wallet.history(40).then(setEntries).catch(() => {})
  }, [summary])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const activity = entries.filter((e) => e.kind !== 'undo')
  const unread = activity.filter((e) => Date.parse(e.ts) > seen).length + alerts.length

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) {
      // Opening marks the activity as read; alerts stay until they are dealt with.
      const now = Date.now()
      setTimeout(() => {
        setSeen(now)
        try {
          localStorage.setItem(SEEN_KEY, String(now))
        } catch {
          // not critical
        }
      }, 1200)
    }
  }

  function go(p: PageId) {
    setOpen(false)
    onGo(p)
  }

  return (
    <div className="notif" ref={box}>
      <button className={`icon-btn bell ${unread ? 'has' : ''}`} aria-label={`Notifications${unread ? `, ${unread} new` : ''}`} title="Notifications" onClick={toggle}>
        <Icon name="bell" size={16} duo={open} />
        {unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="notif-panel" role="dialog" aria-label="Notifications" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.14 }}>
            <header>
              <h3>Notifications</h3>
              <button className="link" onClick={() => go('history')}>
                Full history
              </button>
            </header>
            <div className="notif-scroll">
              {alerts.length > 0 && (
                <>
                  <div className="notif-group">Needs you</div>
                  {alerts.map((a) => (
                    <button key={a.id} className={`notif-item alert ${a.tone}`} onClick={() => go(a.page)}>
                      <span className="ni-icon">
                        <Icon name={a.icon} size={15} />
                      </span>
                      <span className="ni-body">
                        <b>{a.title}</b>
                        {a.body && <small>{a.body}</small>}
                      </span>
                      <span className="ni-go" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  ))}
                </>
              )}
              <div className="notif-group">Activity</div>
              {activity.length === 0 && <div className="notif-empty">No coins in or out yet.</div>}
              {activity.slice(0, 25).map((e) => {
                const isNew = Date.parse(e.ts) > seen
                return (
                  <button key={e.id} className={`notif-item ${isNew ? 'new' : ''}`} onClick={() => go((MODULE_LABEL[e.module] ? e.module : 'history') as PageId)}>
                    <span className={`ni-icon ${e.coins < 0 ? 'neg' : ''}`}>
                      <Icon name={MODULE_ICON[e.module] ?? 'spark'} size={15} />
                    </span>
                    <span className="ni-body">
                      <b>{describeEntry(e, titles)}</b>
                      <small>
                        {MODULE_LABEL[e.module] ?? e.module} · {timeAgo(e.ts)}
                        {e.xp > 0 ? ` · +${e.xp} XP` : ''}
                      </small>
                    </span>
                    {e.coins !== 0 && <Coins n={e.coins} sign />}
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
