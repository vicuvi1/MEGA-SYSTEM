// LS2: Ben says exactly what he did. Pure and tested (benReceipt.test.ts).
//
// After any action Ben ends with one compact receipt built from the real
// result lines (never from what the model claimed):
//   "Added 'Read 10 min' at 21:40 · Calendar ✓ Todoist ✓"
// Several things in one message become one receipt, each part separated by
// "; ", and the reply carries one Undo that takes all of it back. Something
// that failed shows ✗ with the place it failed in.

import { normalize } from './benNormalize'
import { calendarDay } from './dates'

export interface ReceiptPart {
  verb: string
  title: string
  /** "21:40", "tomorrow 18:00"… */
  when?: string
  /** Where it landed: Calendar, Todoist, Reminders, Plan, Memory… with ✓ or ✗. */
  where: { name: string; ok: boolean }[]
  /** A line that isn't a thing with a name ("💧 +250 ml · 1.5 of 2.5 L today"). */
  plain?: string
}

const LEAD = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*/u
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const short = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const dayWord = (mmdd: string, now: Date) => {
  const p = (d: Date) => calendarDay(d).slice(5)
  const t = new Date(now)
  if (mmdd === p(t)) return ''
  t.setDate(t.getDate() + 1)
  if (mmdd === p(t)) return 'tomorrow '
  return `${mmdd} `
}

/** One result line read back as a part of the receipt (null for lines that say nothing done). */
export function partOf(line: string, now = new Date()): ReceiptPart | null {
  const raw = clean(String(line ?? ''))
  if (!raw || raw === '(nothing saved)') return null
  const failed = raw.startsWith('⚠️') || raw.startsWith('❌') || raw.startsWith('🚫')
  const body = raw.replace(LEAD, '')
  let m: RegExpExecArray | null
  if (failed) {
    const where = /calendar/i.test(body) ? 'Calendar' : /todoist/i.test(body) ? 'Todoist' : 'Not done'
    return { verb: 'Not done', title: short(body.replace(/^⚠️\s*/, ''), 60), where: [{ name: where, ok: false }] }
  }
  if ((m = /^In your calendar: (.+?) · (\d{2}-\d{2}) (\d{2}:\d{2})/.exec(body))) return { verb: 'Added', title: m[1], when: `${dayWord(m[2], now)}${m[3]}`.trim(), where: [{ name: 'Calendar', ok: true }] }
  if ((m = /^Todoist: (.+?)(?: · [^()]+)?(?: \((\d{4}-\d{2}-\d{2})\))?$/.exec(body))) return { verb: 'Added', title: m[1], where: [{ name: 'Todoist', ok: true }] }
  if ((m = /^Reminder (\d{2}:\d{2})(?: \((\d{2}-\d{2})\))?: (.+)$/.exec(body))) return { verb: 'Reminder', title: m[3], when: `${m[2] ? dayWord(m[2], now) : ''}${m[1]}`.trim(), where: [{ name: 'Reminders', ok: true }] }
  if ((m = /^Moved: (.+?) (?:\(\d{2}:\d{2}\) )?→ (?:(\d{2}-\d{2}) )?(\d{2}:\d{2})/.exec(body))) return { verb: 'Moved', title: m[1], when: `${m[2] ? dayWord(m[2], now) : ''}${m[3]}`.trim(), where: [{ name: /\(\d{2}:\d{2}\)/.test(body) ? 'Plan' : 'Calendar', ok: true }] }
  if ((m = /^Renamed: (.+?) (?:\([^)]*\) )?→ (.+)$/.exec(body))) return { verb: 'Renamed', title: m[1], when: `to '${short(m[2], 30)}'`, where: [{ name: 'Calendar', ok: true }] }
  if ((m = /^Done in Todoist: (.+?)(?: · \+\d+)?$/.exec(body))) return { verb: 'Done', title: m[1], where: [{ name: 'Todoist', ok: true }] }
  if ((m = /^Deleted from Todoist: (.+)$/.exec(body))) return { verb: 'Deleted', title: m[1], where: [{ name: 'Todoist', ok: true }] }
  if ((m = /^Removed from your calendar: (.+)$/.exec(body))) return { verb: 'Removed', title: m[1], where: [{ name: 'Calendar', ok: true }] }
  if ((m = /^Must-do added: (.+?)(?: \(⭐ in Todoist\))?$/.exec(body))) return { verb: 'Must-do', title: m[1], where: [{ name: 'Today', ok: true }, ...(/⭐ in Todoist/.test(body) ? [{ name: 'Todoist', ok: true }] : [])] }
  if ((m = /^Focus started: (.+?) · (\d+) min/.exec(body))) return { verb: 'Focus', title: m[1], when: `${m[2]} min`, where: [{ name: 'Timer', ok: true }] }
  if ((m = /^Remembered: (.+)$/.exec(body))) return { verb: 'Remembered', title: m[1], where: [{ name: 'Memory', ok: true }] }
  if ((m = /^Promise noted: (.+?)(?: · I'll ask (.+))?$/.exec(body))) return { verb: 'Promise', title: m[1], ...(m[2] ? { when: m[2] } : {}), where: [{ name: 'Reminders', ok: true }] }
  if ((m = /^Bought: (.+?) · /.exec(body))) return { verb: 'Bought', title: m[1], where: [{ name: 'Rewards', ok: true }] }
  return { verb: '', title: '', where: [], plain: short(body, 64) }
}

/** A title without the day and time words a task may still carry ("Gym tomorrow 18:00" → "Gym"). */
export const baseTitle = (t: string) =>
  t
    .replace(/(?:\s+(?:@?today|tomorrow|tonight|\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}))+\s*$/i, '')
    .trim() || t

/** Parts about the same thing (the calendar block and the Todoist task of one "add") become one. */
export function mergeParts(parts: ReceiptPart[]): ReceiptPart[] {
  const out: ReceiptPart[] = []
  for (const p0 of parts) {
    const p = p0.plain ? p0 : { ...p0, title: baseTitle(p0.title) }
    const same = !p.plain && out.find((o) => !o.plain && o.verb === p.verb && normalize(o.title) === normalize(p.title))
    if (same) {
      same.when ??= p.when
      for (const w of p.where) if (!same.where.some((x) => x.name === w.name)) same.where.push(w)
    } else out.push({ ...p, where: [...p.where] })
  }
  return out
}

const partText = (p: ReceiptPart) => {
  if (p.plain) return p.plain
  if (p.verb === 'Not done') return `✗ ${p.title}`
  const where = p.where.map((w) => `${w.name} ${w.ok ? '✓' : '✗'}`).join(' ')
  const day = p.when ? /^(tomorrow|\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(p.when) : null
  const when = !p.when ? '' : day ? ` ${day[1]} at ${day[2]}` : /^(to |\d+ min|after |when )/.test(p.when) ? ` ${p.when}` : ` at ${p.when}`
  return `${p.verb} '${short(p.title)}'${when}${where ? ` · ${where}` : ''}`
}

/**
 * The whole receipt for one reply, or null when nothing was done.
 * "Added 'Read 10 min' at 21:40 · Calendar ✓ Todoist ✓; Reminder 'Call mom' at 20:00 · Reminders ✓"
 */
export function receiptOf(done: string[], now = new Date()): string | null {
  const parts = mergeParts((done ?? []).map((l) => partOf(l, now)).filter((p): p is ReceiptPart => !!p))
  if (!parts.length) return null
  return parts.map(partText).join('; ')
}

/** The Undo button's label: one thing or all of them. */
export function undoLabel(undoable: number): string {
  return undoable > 1 ? `↩ Undo all ${undoable}` : '↩ Undo'
}
