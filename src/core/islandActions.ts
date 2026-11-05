// The island's fast actions (phase 3), pure and tested:
// - clipboard catch: copied text with a date or a deadline in it → offer to
//   save it as a task or a note (never URLs, code, passwords or long text)
// - book a dropped task in the next free slot today.
import { DEFAULT_TASK_MIN } from './booking'
import type { IslandAlert, IslandBlock } from './islandModel'

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|ian|ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie|янв|фев|мар|апр|май|июн|июл|авг|сен|окт|ноя|дек'
const DAYS = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|luni|marți|marti|miercuri|joi|vineri|sâmbătă|sambata|duminică|duminica|today|tomorrow|tonight|azi|mâine|maine|astăzi|astazi|сегодня|завтра'
const DATE_CUE = new RegExp(`(\\b\\d{1,2}[./-]\\d{1,2}(?:[./-]\\d{2,4})?\\b|\\b\\d{1,2}\\s+(?:${MONTHS})\\b|\\b(?:${MONTHS})\\s+\\d{1,2}\\b|\\b(?:${DAYS})\\b|\\b\\d{1,2}:\\d{2}\\b|\\b(?:deadline|due|exam|examen|test|colocviu|interview|interviu|meeting|appointment|programare)\\b)`, 'i')

/** Copied text worth offering to save (a dated thing), cleaned; else null. */
export function clipWorthSaving(raw: string): string | null {
  const t = String(raw ?? '').trim()
  if (t.length < 6 || t.length > 200) return null
  if (t.split('\n').length > 3) return null
  if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return null
  if (/[{};<>]|=>|function\s|const\s|\bimport\b/.test(t)) return null
  // One long token with mixed characters: a key or a password, never shown.
  if (!/\s/.test(t) && t.length > 12) return null
  if (/\b(password|parola|pin|cvv|iban|card number)\b/i.test(t)) return null
  if (!DATE_CUE.test(t)) return null
  return t.replace(/\s+/g, ' ')
}

export function clipAlert(text: string, at: number, dismissed: Record<string, number>, now: number): IslandAlert | null {
  if (now - at > 10 * 60_000) return null
  const id = `clip:${at}`
  if ((dismissed[id] ?? 0) > now) return null
  return {
    id,
    kind: 'clip',
    title: 'Save this?',
    text: `“${text.length > 110 ? `${text.slice(0, 107)}…` : text}”`,
    face: '📋',
    actions: [
      { label: '+ Task', action: { kind: 'clipSave', to: 'task', text, alertId: id }, primary: true },
      { label: '📓 Notebook', action: { kind: 'clipSave', to: 'note', text, alertId: id } },
      { label: 'No', action: { kind: 'dismiss', id } }
    ]
  }
}

/** The next free slot today (from now, on the quarter hour) of `minutes`, before 22:00; null if none. */
export function nextFreeSlot(blocks: IslandBlock[], now: number, minutes = 30): { start: number; end: number } | null {
  const q = 15 * 60_000
  let t = Math.ceil((now + 5 * 60_000) / q) * q
  const endOfDay = new Date(now)
  endOfDay.setHours(22, 0, 0, 0)
  const busy = [...blocks].sort((a, b) => a.start - b.start)
  while (t + minutes * 60_000 <= endOfDay.getTime()) {
    const clash = busy.find((b) => b.start < t + minutes * 60_000 && b.end > t)
    if (!clash) return { start: t, end: t + minutes * 60_000 }
    t = Math.ceil(clash.end / q) * q
  }
  return null
}

/** "Read chapter 4 45m" → 45 minutes; default 30. */
export function taskMinutes(text: string): number {
  const m = /(\d{1,3})\s*(?:m|min|mins|minutes)\b/i.exec(text) ?? /(\d)\s*(?:h|hr|hours?)\b/i.exec(text)
  if (!m) return DEFAULT_TASK_MIN
  const n = Number(m[1])
  return Math.max(15, Math.min(180, /h/i.test(m[0]) ? n * 60 : n))
}
