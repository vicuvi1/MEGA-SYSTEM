// The notification center's entries, pure and tested: what kind a message
// is, its title and one-line body, and the one action it offers. Ben's
// server adds one for every message it sends on its own; the app shows them
// in the bell (synced, so read on one device is read everywhere).

export type NotifKind = 'ben' | 'plan' | 'block' | 'review' | 'health' | 'reminder' | 'water' | 'training' | 'week'

export type NotifAction =
  | { kind: 'page'; page: string; label: string }
  | { kind: 'focus'; subject: string; minutes: number; label: string }

export interface Notif {
  id: string
  at: string
  kind: NotifKind
  title: string
  body: string | null
  action: NotifAction | null
  readAt: string | null
}

const plainOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()

/** A Telegram message Ben sent on his own → an inbox entry (null: not worth one). */
export function notifFromMessage(html: string, markup: unknown, at: Date): Omit<Notif, 'readAt'> | null {
  const plain = plainOf(html)
  if (!plain) return null
  const lines = plain.split('\n').map((l) => l.trim()).filter(Boolean)
  const title = lines[0].slice(0, 110)
  const body = lines.slice(1).join(' ').slice(0, 240) || null
  const buttons: { text?: string; callback_data?: string }[] = ((markup as any)?.inline_keyboard ?? []).flat()
  const focus = buttons.map((b) => /^fo\|(?:(\d+)\|)?(.+)$/.exec(String(b.callback_data ?? ''))).find(Boolean)
  const action: NotifAction | null = focus
    ? { kind: 'focus', subject: focus[2].slice(0, 40), minutes: Number(focus[1]) || 50, label: `Start: ${focus[2].slice(0, 24)}` }
    : null
  const kind: NotifKind = /^☀️/.test(plain) || /locked in today's plan/i.test(plain)
    ? 'plan'
    : /^🔁|^📚/.test(plain)
      ? 'block'
      : /^🌙/.test(plain)
        ? 'review'
        : /^🔧|^✅ Working again|^🩺/.test(plain)
          ? 'health'
          : /^💧/.test(plain)
            ? 'water'
            : /^🏋|💪/.test(plain.slice(0, 4))
              ? 'training'
              : /^📊|^💌/.test(plain)
                ? 'week'
                : /^🔔|^⏰/.test(plain)
                  ? 'reminder'
                  : 'ben'
  const page: Record<NotifKind, [string, string]> = {
    plan: ['today', 'Open Today'],
    block: ['today', 'Open Today'],
    review: ['coach', 'Open with Ben'],
    health: ['settings', 'See what to fix'],
    water: ['body', 'Log water'],
    training: ['body', 'Open Sport'],
    week: ['progress', 'See the week'],
    reminder: ['coach', 'Answer Ben'],
    ben: ['coach', 'Reply to Ben']
  }
  return {
    id: `${kind}:${at.getTime().toString(36)}`,
    at: at.toISOString(),
    kind,
    title,
    body,
    action: action ?? { kind: 'page', page: page[kind][0], label: page[kind][1] }
  }
}

/** Today / Earlier, newest first. */
export function groupNotifs(list: Notif[], now: Date): { label: string; items: Notif[] }[] {
  const day = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  const today = day(now)
  const sorted = [...list].sort((a, b) => b.at.localeCompare(a.at))
  const t = sorted.filter((n) => day(new Date(n.at)) === today)
  const e = sorted.filter((n) => day(new Date(n.at)) !== today)
  return [
    ...(t.length ? [{ label: 'Today', items: t }] : []),
    ...(e.length ? [{ label: 'Earlier', items: e }] : [])
  ]
}
