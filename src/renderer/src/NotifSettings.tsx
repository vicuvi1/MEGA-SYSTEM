// Settings → Notifications: how new things reach you on this device.
import { useEffect, useState } from 'react'
import { DEFAULT_NOTIF_SETTINGS, type NotifSettings as Synced } from '@core/eventAlerts'
import { life } from './bridge'
import { PushRow } from './pushNotify'
import { Icon } from './Icon'
import { testNotification } from './NotifToasts'
import { Row, Saved, Switch, useSaved } from './settingsUi'
import { DEFAULT_NOTIF, useUiPrefs, type NotifPrefs } from './uiPrefs'

export function NotifSettings() {
  const [ui, setUi] = useUiPrefs()
  const [flash, saved] = useSaved()
  const n: NotifPrefs = { ...DEFAULT_NOTIF, ...(ui.notif ?? {}) }
  const set = (patch: Partial<NotifPrefs>) => {
    setUi({ notif: { ...n, ...patch } })
    saved()
  }
  // Synced (every device and Telegram): quiet hours, event warnings, travel times, bedtime, water.
  const [sy, setSy] = useState<Synced | null>(null)
  useEffect(() => {
    life.notifications?.settings?.().then(setSy).catch(() => setSy(DEFAULT_NOTIF_SETTINGS))
  }, [])
  const setSynced = async (patch: Partial<Synced>) => {
    if (!sy) return
    setSy({ ...sy, ...patch })
    const r = await life.notifications?.saveSettings?.(patch).catch(() => null)
    if (r) setSy(r)
    saved()
  }
  const [place, setPlace] = useState('')
  const [mins, setMins] = useState('15')
  const web = !window.desktop
  const [perm, setPerm] = useState(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission))
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="bell" /> How notifications reach you
        </h2>
        <Saved show={flash} />
      </header>
      <p className="hint block">Everything lands in the bell's inbox. These decide what may interrupt you on this device.</p>
      <Row title={web ? 'Pop-ups' : 'Windows notifications'} hint={web ? 'A card slides in; in the background, a browser notification (if allowed)' : 'A Windows notification even when Life System is hidden in the tray; click it to act'}>
        <Switch label="Pop-ups" on={n.popups} onChange={(v) => set({ popups: v })} />
      </Row>
      {web && perm === 'default' && (
        <Row title="Allow browser notifications" hint="So they reach you while this tab is in the background">
          <button className="btn small primary" onClick={() => void Notification.requestPermission().then(setPerm)}>
            Allow
          </button>
        </Row>
      )}
      {web && perm === 'denied' && <Row title="Browser notifications are blocked" hint="Allow them in your browser's site settings (the lock icon next to the address)." />}
      <Row title="Sound" hint="A soft chime, even when other sound effects are off">
        <Switch label="Sound" on={n.sound} onChange={(v) => set({ sound: v })} />
      </Row>
      {sy && (
        <>
          <Row title="Quiet hours" hint={sy.quiet.on ? `On every device and on Telegram: nothing pops or rings from ${sy.quiet.from} to ${sy.quiet.to} (reminders you set still come)` : 'Off'}>
            {sy.quiet.on && (
              <span className="nq-times">
                <input type="time" value={sy.quiet.from} onChange={(e) => e.target.value && void setSynced({ quiet: { ...sy.quiet, from: e.target.value } })} aria-label="Quiet from" />
                <span>to</span>
                <input type="time" value={sy.quiet.to} onChange={(e) => e.target.value && void setSynced({ quiet: { ...sy.quiet, to: e.target.value } })} aria-label="Quiet until" />
              </span>
            )}
            <Switch label="Quiet hours" on={sy.quiet.on} onChange={(v) => void setSynced({ quiet: { ...sy.quiet, on: v } })} />
          </Row>
          <Row title="Before an event" hint="A warning before classes and meetings in your calendar, with the room and Join">
            <select className="sx-select" value={sy.lead} onChange={(e) => void setSynced({ lead: Number(e.target.value) })} aria-label="Warn before an event">
              {[0, 5, 10, 15, 30].map((m) => (
                <option key={m} value={m}>
                  {m ? `${m} min before` : 'Off'}
                </option>
              ))}
            </select>
          </Row>
          <Row title="Bedtime" hint="30 minutes before your bedtime target">
            <Switch label="Bedtime reminder" on={sy.bedtime} onChange={(v) => void setSynced({ bedtime: v })} />
          </Row>
          <Row title="Water" hint="In the afternoon, when you're well behind for the time of day">
            <Switch label="Water reminder" on={sy.water} onChange={(v) => void setSynced({ water: v })} />
          </Row>
          <Row title="Travel times" hint='"Leave now" alerts and a travel band on Today for events at these places (matched by name)' />
          <div className="nq-travel">
            {sy.travel.map((t, i) => (
              <span key={t.place + i} className="nq-place">
                {t.place} · {t.minutes} min
                <button type="button" aria-label={`Remove ${t.place}`} onClick={() => void setSynced({ travel: sy.travel.filter((_, k) => k !== i) })}>
                  ✕
                </button>
              </span>
            ))}
            <form
              className="nq-add"
              onSubmit={(e) => {
                e.preventDefault()
                if (!place.trim()) return
                void setSynced({ travel: [...sy.travel, { place: place.trim(), minutes: Number(mins) || 15 }] })
                setPlace('')
              }}
            >
              <input id="nq-place" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Place (e.g. University, Gym)" aria-label="Place" />
              <input id="nq-mins" type="number" min={1} max={240} value={mins} onChange={(e) => setMins(e.target.value)} aria-label="Minutes to get there" />
              <span className="hint small">min</span>
              <button className="btn small" disabled={!place.trim()}>
                Add
              </button>
            </form>
          </div>
        </>
      )}
      <PushRow />
      <Row title="Don't disturb while I focus" hint="While a focus timer runs, they wait in the inbox">
        <Switch label="Don't disturb while I focus" on={n.focusQuiet} onChange={(v) => set({ focusQuiet: v })} />
      </Row>
      <Row title="Try it" hint="Sends a sample through the same path">
        <button className="btn small" onClick={testNotification}>
          Send a test notification
        </button>
      </Row>
    </section>
  )
}
