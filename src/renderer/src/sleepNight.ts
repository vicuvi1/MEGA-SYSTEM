// Sleep at night on the desktop (owner, 2026-11-12). The desktop's own clock
// (src/desktop/main.ts) sends a tick every minute, even with the window hidden
// in the tray:
//  - the PC's idle seconds, for the "Going to bed" check (core/bedSense.ts):
//    still on the PC 30+ minutes after the tap takes the bed points back, and
//    the bedtime becomes the last moment the PC was used;
//  - at 23:15 and 00:00 the sleep reminder that is due, shown as a Windows
//    notification only when the Sleep module is on and bed isn't logged
//    (core/notifyBudget.ts: 23:15 is one of the day's 4, 00:00 the exception).
import { dayKey } from '@core/dates'
import { isOn } from '@core/modules'
import { sleepReminderShows, slotNotifId, slotText, type SleepReminder } from '@core/notifyBudget'
import { life } from './bridge'
import { modulesNow } from './useModules'

let started = false
let busy = false

async function onTick(t: { idleSec: number; remind: SleepReminder | null }): Promise<void> {
  if (busy || !isOn(modulesNow(), 'sleep')) return
  busy = true
  try {
    const st = await life.sleep.state().catch(() => null)
    if (!st) return
    // The "Going to bed" check: only while one is running (no write every minute otherwise).
    if (st.bedCheck && !st.bedCheck.done && life.sleep.bedActivity) {
      const r = await life.sleep.bedActivity(t.idleSec).catch(() => null)
      if (r?.said) {
        const now = new Date()
        // In the bell only (not a push): what happened, in plain words.
        await life.notifications?.add?.({ id: `bedcheck:${st.bedCheck.day}:${st.bedCheck.lines.length}`, at: now.toISOString(), kind: 'bedtime', title: r.said.slice(0, 110), body: null, action: { kind: 'page', page: 'sleep', label: 'Open Sleep' } }).catch(() => null)
        window.dispatchEvent(new Event('life-sleep-changed'))
        window.dispatchEvent(new Event('life-wallet-changed'))
      }
    }
    if (!t.remind) return
    const now = new Date()
    const day = dayKey(now)
    const bedLogged = !!st.tonight?.bedTime
    const led = await life.notifications?.budget?.().catch(() => null)
    const alreadySent = !!led?.sent?.includes(t.remind)
    const claimed = bedLogged || alreadySent ? false : ((await life.notifications?.claimSlot?.(t.remind, day, new Date(`${day}T12:00:00`).getDay()).catch(() => false)) ?? false)
    if (!sleepReminderShows({ slot: t.remind, sleepOn: true, bedLogged, claimed, alreadySent })) return
    const id = slotNotifId(t.remind, day)
    const title = slotText(t.remind, { mustDone: 0, mustTotal: 0 })
    await life.notifications?.add?.({ id, at: now.toISOString(), kind: 'bedtime', title, body: null, action: { kind: 'page', page: 'sleep', label: 'Open Sleep' } }).catch(() => null)
    await window.desktop?.notify?.({ id, title, body: null }).catch(() => false)
  } finally {
    busy = false
  }
}

/** Starts listening to the desktop's sleep tick (once; nothing on the web). */
export function startSleepNight(): void {
  if (started || !window.desktop?.onSleepTick) return
  started = true
  window.desktop.onSleepTick((t) => void onTick(t))
}
