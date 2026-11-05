// Warnings before your day's events (pure, N2, N3, N8), the same on every
// device and on the server: "Lecture in 10 min · Room 204 · Join", "Leave
// now for Gym (15 min)", "Bed in 30 min", water behind pace. Each warning has
// a fixed id per event and day, so many devices (and the server) add it once.
import type { CalEvent } from './dayTime'
import type { Notif } from './notify'
import { inQuietHours } from './notifyRules'

/** Synced notification settings (settings.notif_settings). */
export interface NotifSettings {
  /** Quiet hours on every device and on Telegram (N6): only reminders you set get through. */
  quiet: { on: boolean; from: string; to: string }
  /** Minutes before a timed event to warn (0 = off). */
  lead: number
  /** Travel time to places (N3, E6): an event whose place contains `place` gets a "leave now" alert. */
  travel: { place: string; minutes: number }[]
  /** Bedtime and water reminders made by the app (N8). */
  bedtime: boolean
  water: boolean
}
export const NOTIF_SETTINGS_KEY = 'notif_settings'
export const DEFAULT_NOTIF_SETTINGS: NotifSettings = { quiet: { on: true, from: '23:00', to: '07:00' }, lead: 10, travel: [], bedtime: true, water: true }

const hm = (t: unknown) => (typeof t === 'string' && /^\d{2}:\d{2}$/.test(t) ? t : null)
export function cleanNotifSettings(p: any): NotifSettings {
  const d = DEFAULT_NOTIF_SETTINGS
  return {
    quiet: { on: typeof p?.quiet?.on === 'boolean' ? p.quiet.on : d.quiet.on, from: hm(p?.quiet?.from) ?? d.quiet.from, to: hm(p?.quiet?.to) ?? d.quiet.to },
    lead: [0, 5, 10, 15, 30].includes(Number(p?.lead)) ? Number(p.lead) : d.lead,
    travel: Array.isArray(p?.travel)
      ? p.travel
          .map((t: any) => ({ place: String(t?.place ?? '').trim().slice(0, 60), minutes: Math.max(1, Math.min(240, Math.round(Number(t?.minutes) || 0))) }))
          .filter((t: { place: string; minutes: number }) => t.place && t.minutes)
          .slice(0, 20)
      : [],
    bedtime: typeof p?.bedtime === 'boolean' ? p.bedtime : d.bedtime,
    water: typeof p?.water === 'boolean' ? p.water : d.water
  }
}

/** Quiet hours now? */
export function quietNow(s: NotifSettings, now: Date): boolean {
  const t = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return s.quiet.on && inQuietHours(t, s.quiet.from, s.quiet.to)
}

/** Minutes to get to an event's place, from your travel list (case-insensitive "contains"). */
export function travelFor(location: string | null | undefined, travel: NotifSettings['travel']): number | null {
  const loc = String(location ?? '').toLowerCase()
  if (!loc) return null
  return travel.find((t) => loc.includes(t.place.toLowerCase()))?.minutes ?? null
}

const hhmm = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('sv-SE')

/** Events that count: timed, not yours (focus blocks warn on their own), not declined or free. */
export const warnable = (e: CalEvent) => !e.allDay && !e.ours && !e.declined && !e.free

/**
 * The warnings due now (from their time until 10 minutes after, so a device
 * that checks every minute or the server every few minutes catches each once).
 */
export function eventAlerts(events: CalEvent[], now: Date, s: NotifSettings): Omit<Notif, 'readAt'>[] {
  const out: Omit<Notif, 'readAt'>[] = []
  const t = now.getTime()
  const due = (at: number) => t >= at && t < at + 10 * 60_000
  for (const e of events.filter(warnable)) {
    const start = Date.parse(e.start)
    if (!Number.isFinite(start) || start <= t) continue
    const place = e.location ? ` · ${e.location}` : ''
    const action = e.meet ? { kind: 'link' as const, url: e.meet, label: 'Join' } : { kind: 'page' as const, page: 'today', label: 'Open Today', anchor: `event-${e.id}` }
    const travel = travelFor(e.location, s.travel)
    // Leave now (N3): your travel time + 5 minutes to spare.
    if (travel != null && due(start - (travel + 5) * 60_000)) {
      out.push({ id: `leave:${e.id}:${dayOf(e.start)}`, at: now.toISOString(), kind: 'leave', title: `Leave now for ${e.title}`, body: `${travel} min to ${e.location} · starts ${hhmm(e.start)}`, action: { kind: 'page', page: 'today', label: 'Open Today', anchor: `event-${e.id}` } })
    }
    if (s.lead > 0 && due(start - s.lead * 60_000)) {
      const mins = Math.max(1, Math.round((start - t) / 60_000))
      out.push({ id: `event:${e.id}:${dayOf(e.start)}`, at: now.toISOString(), kind: 'event', title: `${e.title} in ${mins} min`, body: `${hhmm(e.start)}–${hhmm(e.end)}${place}`, action })
    }
  }
  return out
}

/** Bedtime in 30 minutes (N8), once a day. */
export function bedtimeAlert(bedTarget: string, now: Date, s: NotifSettings): Omit<Notif, 'readAt'> | null {
  if (!s.bedtime || !hm(bedTarget)) return null
  const [h, m] = bedTarget.split(':').map(Number)
  const bed = new Date(now)
  bed.setHours(h, m, 0, 0)
  if (h < 4 && now.getHours() >= 12) bed.setDate(bed.getDate() + 1)
  const at = bed.getTime() - 30 * 60_000
  if (now.getTime() < at || now.getTime() >= at + 10 * 60_000) return null
  return { id: `bedtime:${bed.toLocaleDateString('sv-SE')}`, at: now.toISOString(), kind: 'bedtime', title: `Bed in 30 min (${bedTarget})`, body: 'Screens off soon. Tomorrow starts tonight.', action: { kind: 'page', page: 'today', label: 'Close my day' } }
}

/**
 * Water behind pace (N8): from 13:00, when you're 600 ml+ under where you'd
 * be drinking evenly 08:00–21:00. At most once per 3-hour window.
 */
export function waterAlert(ml: number, target: number, now: Date, s: NotifSettings): Omit<Notif, 'readAt'> | null {
  if (!s.water || target <= 0) return null
  const h = now.getHours() + now.getMinutes() / 60
  if (h < 13 || h >= 21) return null
  const expected = (target * (h - 8)) / 13
  if (expected - ml < 600) return null
  const slot = Math.floor(now.getHours() / 3)
  return { id: `water:${now.toLocaleDateString('sv-SE')}:${slot}`, at: now.toISOString(), kind: 'water', title: `💧 Water: ${(ml / 1000).toFixed(1)} of ${(target / 1000).toFixed(1)} L`, body: `About ${Math.round((expected - ml) / 50) * 50} ml behind for this time of day.`, action: { kind: 'page', page: 'body', label: 'Log water' } }
}
