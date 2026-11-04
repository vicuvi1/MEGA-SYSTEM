// Settings → Notifications: how new things reach you on this device.
import { useState } from 'react'
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
      <Row title="Quiet hours" hint={n.quiet ? `Nothing pops or rings from ${n.quietFrom} to ${n.quietTo}` : 'Off'}>
        {n.quiet && (
          <span className="nq-times">
            <input type="time" value={n.quietFrom} onChange={(e) => e.target.value && set({ quietFrom: e.target.value })} aria-label="Quiet from" />
            <span>to</span>
            <input type="time" value={n.quietTo} onChange={(e) => e.target.value && set({ quietTo: e.target.value })} aria-label="Quiet until" />
          </span>
        )}
        <Switch label="Quiet hours" on={n.quiet} onChange={(v) => set({ quiet: v })} />
      </Row>
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
