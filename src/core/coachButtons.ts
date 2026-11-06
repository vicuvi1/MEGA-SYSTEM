// Interactive replies: buttons and mini-widgets the coach can put under its
// message. Pure: what's allowed, how it reads, and how it looks on Telegram.

export type ButtonDo =
  | { k: 'focus'; minutes: number; subject: string }
  | { k: 'approve' }
  /** BQ2: change today's plan (Telegram asks what to change; the app opens the plan). */
  | { k: 'change' }
  | { k: 'plan' }
  | { k: 'book'; goal: string }
  | { k: 'say'; text: string }
  | { k: 'open'; tab: 'plan' | 'goals' | 'score' | 'about' }
  | { k: 'workout' }
  | { k: 'water' }

export interface ReplyButton {
  label: string
  do: string
}

export const WIDGETS = ['focus-week', 'goals', 'plan', 'day', 'tasks', 'water', 'mustdos', 'promises'] as const
export type Widget = (typeof WIDGETS)[number]

/**
 * BQ2: what the "day" and "tasks" cards show, saved with the reply when it was
 * written (the app draws them; Telegram gets them as text). Times are "HH:MM".
 */
export interface ReplyCards {
  day?: { start: string; end: string; title: string }[]
  tasks?: { text: string; due?: string; late?: boolean }[]
}

/** "focus:25:Algebra", "approve", "plan", "book:Algebra exam", "say:Done ✅", "open:goals". */
export function readDo(d: string): ButtonDo | null {
  const s = String(d ?? '').trim()
  const m = /^(focus|approve|change|plan|book|say|open|workout|water)(?::([\s\S]*))?$/i.exec(s)
  if (!m) return null
  const k = m[1].toLowerCase()
  const rest = (m[2] ?? '').trim()
  if (k === 'approve') return { k: 'approve' }
  if (k === 'change') return { k: 'change' }
  if (k === 'workout') return { k: 'workout' }
  if (k === 'water') return { k: 'water' }
  if (k === 'plan') return { k: 'plan' }
  if (k === 'focus') {
    const f = /^(\d{1,3})\s*:\s*(.+)$/.exec(rest)
    const minutes = Number(f?.[1] ?? 25)
    const subject = (f?.[2] ?? rest).trim().slice(0, 40)
    return subject && minutes >= 5 && minutes <= 180 ? { k: 'focus', minutes, subject } : null
  }
  if (k === 'book') return rest ? { k: 'book', goal: rest.slice(0, 80) } : null
  if (k === 'say') return rest ? { k: 'say', text: rest.slice(0, 120) } : null
  const tab = rest.toLowerCase()
  return tab === 'plan' || tab === 'goals' || tab === 'score' || tab === 'about' ? { k: 'open', tab } : null
}

export function readButtons(raw: unknown): ReplyButton[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((b: any) => ({ label: String(b?.label ?? '').trim().slice(0, 32), do: String(b?.do ?? '').trim() }))
    .filter((b) => b.label && readDo(b.do))
    .slice(0, 3)
}

export function readShow(raw: unknown): Widget[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.map((x) => String(x).toLowerCase().trim()).filter((x): x is Widget => (WIDGETS as readonly string[]).includes(x)))].slice(0, 2)
}

const bytes = (s: string) => new TextEncoder().encode(s).length
const fit = (prefix: string, s: string) => {
  let t = s
  while (bytes(prefix + t) > 64) t = t.slice(0, -1)
  return prefix + t
}

/** The same buttons on Telegram (inline keyboard); "open" has no Telegram form. */
export function telegramKeyboard(buttons: ReplyButton[]): { inline_keyboard: { text: string; callback_data: string }[][] } | null {
  const row = buttons
    .map((b) => {
      const d = readDo(b.do)
      if (!d) return null
      const data = d.k === 'focus' ? fit(`fo|${d.minutes}|`, d.subject) : d.k === 'approve' ? 'rb|a' : d.k === 'change' ? 'rb|e' : d.k === 'plan' ? 'rb|p' : d.k === 'book' ? fit('gb|', d.goal) : d.k === 'say' ? fit('cs|', d.text) : d.k === 'workout' ? 'wk|show' : d.k === 'water' ? 'wa|show' : null
      return data ? { text: b.label, callback_data: data } : null
    })
    .filter((x): x is { text: string; callback_data: string } => !!x)
  return row.length ? { inline_keyboard: row.map((b) => [b]) } : null
}

const BARS = '▁▂▃▄▅▆▇█'
/** "▁▃▅▇▂▁▄" for a week of minutes. */
export function sparkline(values: number[]): string {
  const max = Math.max(1, ...values)
  return values.map((v) => (v <= 0 ? '·' : BARS[Math.min(7, Math.round((v / max) * 7))])).join('')
}
