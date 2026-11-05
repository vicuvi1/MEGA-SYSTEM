// Small pieces the bots' commands and buttons share: keyboards, the sleep tip,
// the reply after a focus session, and the link between a Telegram expense and
// the Life System record it made (for Undo). Split out of webBots.ts (LT6).
import { getSetting, setSetting } from '../../../../main/settings'
import { hm, type DayPlan } from '@core/focus'
import type { FocusTask } from '@shared/api'
import { esc } from './telegram'

/** Which Life System expense a Finance Helper record from Telegram made (for Undo). */
export function linkExpense(db: any, txId: string, expenseId: number): void {
  let links: Record<string, number> = {}
  try {
    links = JSON.parse(getSetting(db, 'tg_expense_links') || '{}')
  } catch {
    /* start over */
  }
  links[txId] = expenseId
  const keys = Object.keys(links)
  for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete links[k]
  setSetting(db, 'tg_expense_links', JSON.stringify(links))
}

export function takeLink(db: any, txId: string): number | null {
  try {
    const links = JSON.parse(getSetting(db, 'tg_expense_links') || '{}')
    const id = links[txId]
    if (id == null) return null
    delete links[txId]
    setSetting(db, 'tg_expense_links', JSON.stringify(links))
    return Number(id)
  } catch {
    return null
  }
}

/** 1–5 under the wake-up message: how you slept. */
export const sleepKeyboard = (day: string) => ({ inline_keyboard: [[1, 2, 3, 4, 5].map((n) => ({ text: ['😫', '😕', '😐', '🙂', '😄'][n - 1] + ' ' + n, callback_data: `sq|${day}|${n}` }))] })

/** The sleep coach's word after a rating. */
export function sleepTip(n: number, bed: string): string {
  if (n <= 2) return `Rough night. Today: no caffeine after 15:00, and tonight lights out at <b>${bed}</b>. I'll remind you.`
  if (n === 3) return `Okay night. Same bedtime tonight (${bed}) keeps it improving.`
  return 'Great. Keep the same rhythm tonight.'
}

/** Under "Focus started": one tap stops and logs it. */
export const STOP_KEYBOARD = { inline_keyboard: [[{ text: '⏹ Stop & log', callback_data: 'fx|' }]] }

/** "▶ 50 min: …" buttons that start a focus session (subject kept short for Telegram's 64 bytes). */
export function focusKeyboard(subjects: string[]): any {
  const rows = subjects
    .filter(Boolean)
    .slice(0, 3)
    .map((t) => {
      const short = t.split(/\s+/).slice(0, 4).join(' ').slice(0, 28)
      return [{ text: `▶ 50 min: ${short}`, callback_data: `fo|${short}` }]
    })
  return rows.length ? { inline_keyboard: rows } : undefined
}

/** After a session: what was logged, and for a must-do or Todoist task, a "Done" button. */
export function stoppedReply(r: { session: { minutes: number; subject: string }; coins: number; state: { todayMin: number }; task?: FocusTask | null }, plan: DayPlan): { reply: string; keyboard?: any } {
  const head = `✅ <b>${r.session.minutes} min of ${esc(r.session.subject)}</b> logged.${r.coins ? `\n🪙 +${r.coins} points` : ''}\nToday: ${hm(r.state.todayMin)}`
  // How did it go? (1–5): a low one asks what got in the way.
  const rate = [1, 2, 3, 4, 5].map((n) => ({ text: ['😣', '😕', '😐', '🙂', '🔥'][n - 1], callback_data: `fq|${plan.day}|${n}|${r.session.minutes}` }))
  const t = r.task
  if (t?.kind === 'mustdo') {
    const i = plan.items.findIndex((p) => !p.done && p.text === t.ref)
    if (i >= 0) return { reply: `${head}\n\nFinished “${esc(t.title)}”? And how did it go?`, keyboard: { inline_keyboard: [[{ text: '✅ Yes, tick it', callback_data: `pp|${plan.day}|${i}` }], rate] } }
  }
  if (t?.kind === 'todoist') return { reply: `${head}\n\nFinished “${esc(t.title)}”? And how did it go?`, keyboard: { inline_keyboard: [[{ text: '✅ Yes, done in Todoist', callback_data: `td|${t.ref}`.slice(0, 64) }], rate] } }
  return { reply: `${head}\n\nHow did it go?`, keyboard: { inline_keyboard: [rate] } }
}

/** A rule's points right now (labels never promise a stale amount). */
export const ruleCoins = (svc: any, id: string, fallback: number): number => {
  try {
    return svc.wallet.rule(id).coins
  } catch {
    return fallback
  }
}
