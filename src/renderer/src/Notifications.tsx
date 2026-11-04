import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { groupNotifs, type Notif } from '@core/notify'
import { useLive } from './live'
import { runNotif } from './NotifToasts'
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

const KIND_ICON: Record<string, IconName> = {
  ben: 'spark', plan: 'sun', block: 'calendar', review: 'moon', health: 'shield', reminder: 'bell', water: 'bolt', training: 'bolt', week: 'trophy'
}
const hm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/**
 * The notification center: what needs you now (live), Ben's messages and
 * what he did (synced: read on one device is read everywhere), and the
 * coins in and out under Activity.
 */
export function Notifications({ alerts, summary, rules, onGo }: { alerts: Alert[]; summary: Summary | null; rules: Rule[]; onGo: (p: PageId) => void }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'inbox' | 'activity'>('inbox')
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [inbox, setInbox] = useState<Notif[]>([])
  const [seen, setSeen] = useState(loadSeen)
  const box = useRef<HTMLDivElement>(null)
  const titles = useMemo(() => Object.fromEntries(rules.map((r) => [r.id, r.title])), [rules])
  const loadInbox = useCallback(() => {
    life.notifications?.list().then(setInbox).catch(() => {})
  }, [])

  // Reload the activity whenever the wallet changes, the inbox whenever data changes.
  useEffect(() => {
    life.wallet.history(40).then(setEntries).catch(() => {})
  }, [summary])
  useEffect(() => loadInbox(), [loadInbox])
  useLive(loadInbox)
  // Something new arrived: the bell rings for a moment.
  const [ring, setRing] = useState(false)
  useEffect(() => {
    let t: number | undefined
    const on = () => {
      loadInbox()
      setRing(false)
      requestAnimationFrame(() => setRing(true))
      clearTimeout(t)
      t = window.setTimeout(() => setRing(false), 1400)
    }
    window.addEventListener('life-notif-new', on)
    return () => {
      window.removeEventListener('life-notif-new', on)
      clearTimeout(t)
    }
  }, [loadInbox])

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
  const unreadInbox = inbox.filter((n) => !n.readAt).length
  const newActivity = activity.filter((e) => Date.parse(e.ts) > seen).length
  const unread = unreadInbox + alerts.length

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && tab === 'activity') markActivitySeen()
  }
  function markActivitySeen() {
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
  function go(p: PageId) {
    setOpen(false)
    onGo(p)
  }
  const markRead = async (ids: string[] | null) => {
    setInbox((l) => l.map((n) => (ids === null || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)))
    await life.notifications?.read(ids).catch(() => {})
  }
  const dismiss = async (id: string) => {
    setInbox((l) => l.filter((n) => n.id !== id))
    await life.notifications?.dismiss(id).catch(() => {})
  }
  const run = async (n: Notif) => {
    void markRead([n.id])
    await runNotif(n, go)
  }

  return (
    <div className="notif" ref={box}>
      <button className={`icon-btn bell ${unread ? 'has' : ''} ${ring ? 'ring' : ''}`} aria-label={`Notifications${unread ? `, ${unread} new` : ''}`} title="Notifications" onClick={toggle}>
        <Icon name="bell" size={16} duo={open} />
        {unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="notif-panel nc" role="dialog" aria-label="Notifications" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.18 }}>
            <header className="nc-head">
              <h3>Notifications</h3>
              {tab === 'inbox' && unreadInbox > 0 && (
                <button className="link" onClick={() => void markRead(null)}>
                  Mark all read
                </button>
              )}
              <button className="icon-btn nc-close" aria-label="Close" onClick={() => setOpen(false)}>
                ✕
              </button>
            </header>
            <div className="nc-tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'inbox'} className={tab === 'inbox' ? 'on' : ''} onClick={() => setTab('inbox')}>
                Inbox{unread ? <i>{unread}</i> : null}
              </button>
              <button role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'on' : ''} onClick={() => (setTab('activity'), markActivitySeen())}>
                Activity{newActivity ? <i>{newActivity}</i> : null}
              </button>
            </div>
            <div className="notif-scroll">
              {tab === 'inbox' && (
                <>
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
                  {groupNotifs(inbox, new Date()).map((g) => (
                    <div key={g.label}>
                      <div className="notif-group">{g.label}</div>
                      {g.items.map((n) => (
                        <div key={n.id} className={`nc-item ${n.readAt ? '' : 'unread'}`} onMouseEnter={() => !n.readAt && void markRead([n.id])}>
                          <span className={`ni-icon k-${n.kind}`}>
                            <Icon name={KIND_ICON[n.kind] ?? 'spark'} size={15} />
                          </span>
                          <div className="ni-body">
                            <b>{n.title}</b>
                            {n.body && <small>{n.body}</small>}
                            <span className="nc-meta">
                              {g.label === 'Today' ? hm(n.at) : `${new Date(n.at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${hm(n.at)}`}
                              {n.action && (
                                <button className="nc-act" onClick={() => void run(n)}>
                                  {n.action.label}
                                </button>
                              )}
                            </span>
                          </div>
                          <button className="nc-x" aria-label="Dismiss" title="Dismiss" onClick={() => void dismiss(n.id)}>
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                  {!alerts.length && !inbox.length && (
                    <div className="notif-empty nc-empty">
                      <Icon name="bell" size={22} />
                      <b>You're all caught up</b>
                      <small>Ben's messages, plans he made and anything that needs you show up here.</small>
                    </div>
                  )}
                </>
              )}
              {tab === 'activity' && (
                <>
                  {activity.length === 0 && <div className="notif-empty">No coins in or out yet.</div>}
                  {activity.slice(0, 30).map((e) => {
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
                  <button className="link nc-history" onClick={() => go('history')}>
                    Full history
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
