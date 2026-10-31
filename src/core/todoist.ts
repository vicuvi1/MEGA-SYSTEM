// Todoist, connected to Life System: your Todoist tasks show on Today and in
// the bots; completing one (here, in Telegram, or in Todoist itself) pays
// coins once. Pure helpers shared by the app, the bot and the server.

/** A Todoist task, the few fields Life System uses. */
export interface TodoTask {
  id: string
  content: string
  /** Todoist's API: 4 is the most urgent (shown as P1), 1 is none (P4). */
  priority: number
  due: string | null // YYYY-MM-DD
  dueTime: string | null // HH:MM, when it has a time
  project: string | null
  /** The section it sits in (your areas: University, Cyber, …), when any. */
  section?: string | null
  recurring: boolean
  /** Todoist's deadline (a date that can't move), when set. */
  deadline?: string | null
}

export interface RadarItem {
  task: TodoTask
  /** The date that matters: the deadline, else the due date. */
  date: string
  daysLeft: number
}

const IMPORTANT = /univ|lab|exam|examen|curs|course|test|colloq|deadline|essay|referat|proiect|project|cv|interview/i
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)

/**
 * Deadlines worth a warning: due (or with a deadline) in the next `within`
 * days, not today's routine. Important means a deadline set in Todoist, P1/P2,
 * or a study/career word in the task or its area (University, lab, exam…).
 */
export function deadlineRadar(tasks: TodoTask[], today: string, within = 3): RadarItem[] {
  return tasks
    .filter((t) => !t.recurring)
    .map((t) => {
      const date = t.deadline || t.due
      return date ? { task: t, date, daysLeft: dayDiff(today, date) } : null
    })
    .filter((x): x is RadarItem => !!x && x.daysLeft >= 1 && x.daysLeft <= within)
    .filter((x) => !!x.task.deadline || x.task.priority >= 3 || IMPORTANT.test(`${x.task.content} ${x.task.section ?? ''} ${x.task.project ?? ''}`))
    .sort((a, b) => a.daysLeft - b.daysLeft || b.task.priority - a.task.priority)
}

/** "tomorrow", "in 3 days (Tue)". */
export function whenText(daysLeft: number, date: string): string {
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${date}T12:00:00Z`).getUTCDay()]
  return daysLeft === 1 ? `tomorrow (${wd})` : `in ${daysLeft} days (${wd})`
}

export interface TodoCompleted {
  id: string
  content: string
  priority: number
  completedAt: string // ISO
}

/** The point rule that pays for a completed Todoist task. */
export const TODOIST_RULE = 'tasks.todoist_done'

/** Shown as P1…P4 (Todoist's own labels). */
export const pLabel = (priority: number) => `P${5 - Math.min(4, Math.max(1, priority || 1))}`

/** Overdue first, then most urgent, then by time. The bot's /done N uses this order. */
export function sortToday(tasks: TodoTask[], today: string): TodoTask[] {
  return tasks.slice().sort((a, b) => {
    const ao = a.due && a.due < today ? 0 : 1
    const bo = b.due && b.due < today ? 0 : 1
    if (ao !== bo) return ao - bo
    if (a.priority !== b.priority) return b.priority - a.priority
    return String(a.dueTime ?? '99').localeCompare(String(b.dueTime ?? '99'))
  })
}

const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))
const P_ICON: Record<number, string> = { 4: '🔴', 3: '🟠', 2: '🔵', 1: '⚪' }

/** The bot's /todo reply. */
export function todayText(tasks: TodoTask[], today: string): string {
  const list = sortToday(tasks, today)
  if (!list.length) return '✅ <b>Nothing left in Todoist for today.</b>\n\nAdd one: <code>/task call Leo tomorrow 17:00 p1</code>'
  const lines = list.slice(0, 15).map((t, i) => {
    const late = t.due && t.due < today ? ' <i>(late)</i>' : ''
    const time = t.dueTime ? ` · ${t.dueTime}` : ''
    const proj = t.project ? ` · #${esc(t.project)}` : ''
    return `${i + 1}. ${P_ICON[t.priority] ?? '⚪'} <b>${esc(t.content)}</b>${time}${proj}${late}`
  })
  return `📋 <b>Todoist today</b> (${list.length})\n\n${lines.join('\n')}${list.length > 15 ? `\n…and ${list.length - 15} more` : ''}\n\n<i>Done one? Send</i> <code>/done 1</code> · <i>add:</i> <code>/task …</code>`
}
