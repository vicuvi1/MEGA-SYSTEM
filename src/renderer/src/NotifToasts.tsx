// New notifications that reach you right away: a Windows notification (the
// desktop app; a browser notification on the website when allowed and the
// tab is in the background), a soft chime, a card that slides in at the top
// right, and the bell rings. Quiet hours and focus hold all of that back;
// everything still lands in the inbox. Each device pops a notification once.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Notif } from '@core/notify'
import { freshNotifs, interrupt } from '@core/notifyRules'
import { life } from './bridge'
import { Icon, type IconName } from './Icon'
import { useLive } from './live'
import type { PageId } from './modules'
import { soundNotify } from './sound'
import { DEFAULT_NOTIF, getUiPrefs } from './uiPrefs'

const POPPED = 'ls.notif.popped'
const KIND_ICON: Record<string, IconName> = { ben: 'spark', plan: 'sun', block: 'calendar', review: 'moon', health: 'shield', reminder: 'bell', water: 'bolt', training: 'bolt', week: 'trophy' }

const readPopped = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(POPPED) || '[]'))
  } catch {
    return new Set()
  }
}
const savePopped = (s: Set<string>) => {
  try {
    localStorage.setItem(POPPED, JSON.stringify([...s].slice(-200)))
  } catch {
    /* private window: may pop again after a reload */
  }
}

/** Runs a notification's action (also used by the bell and Windows clicks). */
export async function runNotif(n: Notif, onGo: (p: PageId) => void): Promise<void> {
  void life.notifications?.read([n.id]).catch(() => {})
  const a = n.action
  if (!a) return onGo('coach' as PageId)
  if (a.kind === 'focus') {
    await life.focus.start(a.subject, a.minutes).catch(() => null)
    onGo('today' as PageId)
  } else onGo(a.page as PageId)
}

/** Try it from Settings: a sample notification through the same path. */
export function testNotification() {
  window.dispatchEvent(new CustomEvent('life-notif-test'))
}

export function NotifToasts({ onGo }: { onGo: (p: PageId) => void }) {
  const [cards, setCards] = useState<Notif[]>([])
  const known = useRef<Map<string, Notif>>(new Map())
  const goRef = useRef(onGo)
  goRef.current = onGo

  const deliver = useCallback(async (list: Notif[], force = false) => {
    const prefs = { ...DEFAULT_NOTIF, ...(getUiPrefs().notif ?? {}) }
    const now = new Date()
    const popped = readPopped()
    const fresh = force ? list : freshNotifs(list, popped, now)
    if (!fresh.length) return
    for (const n of fresh) {
      popped.add(n.id)
      known.current.set(n.id, n)
    }
    savePopped(popped)
    const running = force ? false : await life.focus.state().then((f) => !!f.running).catch(() => false)
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const how = force ? { popup: true, sound: prefs.sound } : interrupt(prefs, time, running)
    window.dispatchEvent(new CustomEvent('life-notif-new', { detail: { count: fresh.length, quiet: !how.popup } }))
    if (how.sound) soundNotify()
    if (!how.popup) return
    const visible = document.visibilityState === 'visible' && document.hasFocus()
    for (const n of fresh) {
      if (window.desktop?.notify) void window.desktop.notify({ id: n.id, title: n.title, body: n.body })
      else if (!visible && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        // Phones (Android, installed app) only allow notifications through the offline helper (M6).
        const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => undefined)
        if (reg?.showNotification) {
          await reg.showNotification(n.title, { body: n.body ?? '', icon: '/icon.png', tag: n.id, silent: true, data: { id: n.id } }).catch(() => null)
          continue
        }
        const w = new Notification(n.title, { body: n.body ?? '', icon: '/icon.png', tag: n.id, silent: true })
        w.onclick = () => {
          window.focus()
          void runNotif(n, goRef.current)
          w.close()
        }
      }
    }
    // The card in the app: always when you're looking at it, so nothing is missed.
    setCards((c) => [...c.filter((x) => !fresh.some((f) => f.id === x.id)), ...fresh].slice(-3))
  }, [])

  // A tap on a phone notification (from the offline helper) opens its action here.
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.data?.type !== 'notif-click') return
      const n = known.current.get(String(e.data.id))
      if (n) void runNotif(n, goRef.current)
    }
    navigator.serviceWorker?.addEventListener?.('message', on)
    return () => navigator.serviceWorker?.removeEventListener?.('message', on)
  }, [])

  const check = useCallback(() => {
    life.notifications?.list().then((l) => void deliver(l)).catch(() => {})
  }, [deliver])

  // On start, only remember what's there (no burst of old ones), then watch.
  useEffect(() => {
    life.notifications
      ?.list()
      .then((l) => {
        const popped = readPopped()
        const now = Date.now()
        for (const n of l) if (now - Date.parse(n.at) > 15 * 60000) popped.add(n.id)
        savePopped(popped)
        void deliver(l)
      })
      .catch(() => {})
    const t = setInterval(check, 20_000)
    return () => clearInterval(t)
  }, [check, deliver])
  useLive(check)

  // A click on a Windows notification.
  useEffect(() => {
    window.desktop?.onNotifClick?.((id) => {
      const n = known.current.get(id)
      if (n) void runNotif(n, goRef.current)
      setCards((c) => c.filter((x) => x.id !== id))
    })
  }, [])
  // "Send a test notification" in Settings.
  useEffect(() => {
    const on = () =>
      void deliver(
        [{ id: `test:${Date.now()}`, at: new Date().toISOString(), kind: 'ben', title: '🎯 This is how Ben reaches you', body: 'A chime, a card here, and a Windows notification on the desktop.', action: { kind: 'page', page: 'coach', label: 'Open Ben' }, readAt: null }],
        true
      )
    window.addEventListener('life-notif-test', on)
    return () => window.removeEventListener('life-notif-test', on)
  }, [deliver])

  const close = (id: string) => setCards((c) => c.filter((x) => x.id !== id))
  return (
    <div className="nt-stack" aria-live="polite">
      <AnimatePresence initial={false}>
        {cards.map((n) => (
          <Toast key={n.id} n={n} onClose={() => close(n.id)} onRun={() => (close(n.id), void runNotif(n, goRef.current))} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function Toast({ n, onClose, onRun }: { n: Notif; onClose: () => void; onRun: () => void }) {
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused) return
    const t = setTimeout(onClose, 8000)
    return () => clearTimeout(t)
  }, [paused, onClose])
  return (
    <motion.div
      layout
      className={`nt-card k-${n.kind}`}
      role="status"
      initial={{ opacity: 0, x: 60, scale: 0.92 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className="nt-icon">
        <Icon name={KIND_ICON[n.kind] ?? 'spark'} size={16} />
      </span>
      <div className="nt-body">
        <b>{n.title}</b>
        {n.body && <small>{n.body}</small>}
        {n.action && (
          <button className="nt-act" onClick={onRun}>
            {n.action.label}
          </button>
        )}
      </div>
      <button className="nt-x" aria-label="Close" onClick={onClose}>
        ✕
      </button>
      {!paused && <i className="nt-timer" />}
    </motion.div>
  )
}
