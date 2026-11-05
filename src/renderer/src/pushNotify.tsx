// Push notifications on this phone or browser (N11): alerts with no tab open.
// The server sends an empty wake-up; the offline helper (sw.js) shows the
// newest unread notifications. Needs the server's VAPID key (Vercel).
import { useEffect, useState } from 'react'
import { currentSession } from './web/session'
import { Row, Switch } from './settingsUi'

const api = (body: object) => fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentSession()}` }, body: JSON.stringify(body) })
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))

export function PushRow() {
  const supported = typeof window !== 'undefined' && !window.desktop && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined'
  const [key, setKey] = useState<string | null | undefined>(undefined)
  const [on, setOn] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (!supported) return
    fetch('/api/config', { headers: { Authorization: `Bearer ${currentSession()}` } })
      .then((r) => (r.ok ? r.json() : {}))
      .then((j: { vapidPublicKey?: string | null }) => setKey(j.vapidPublicKey ?? null))
      .catch(() => setKey(null))
    navigator.serviceWorker.getRegistration().then((reg) => reg?.pushManager.getSubscription().then((s) => setOn(!!s))).catch(() => {})
  }, [supported])
  if (!supported) return null
  if (key === null) return <Row title="Push notifications" hint="Not set up on the server yet: add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Vercel (node scripts/vapid-keys.mjs makes them)." />
  if (!key) return null
  const toggle = async (v: boolean) => {
    setMsg('')
    try {
      const reg = await navigator.serviceWorker.ready
      if (v) {
        if ((await Notification.requestPermission()) !== 'granted') return setMsg('Allow notifications for this site first.')
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(key) })
        const r = await api({ pushSubscribe: sub.endpoint })
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'The server said no')
        setOn(true)
      } else {
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          await api({ pushUnsubscribe: sub.endpoint }).catch(() => null)
          await sub.unsubscribe()
        }
        setOn(false)
      }
    } catch (e) {
      setMsg((e as Error).message || 'Push did not turn on')
    }
  }
  return (
    <Row title="Push notifications" hint={msg || (on ? 'On: alerts reach this device even with no tab open' : 'Alerts reach this phone or browser even when Life System is closed')}>
      <Switch label="Push notifications" on={on} onChange={(v) => void toggle(v)} />
    </Row>
  )
}
