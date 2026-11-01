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
  projectId?: string | null
  sectionId?: string | null
  description?: string | null
}

/**
 * One of your life areas: a section (in the Inbox or a project) or a project
 * without sections. The key is how the app remembers its color.
 */
export interface Area {
  key: string
  name: string
  kind: 'section' | 'project'
  id: string
  projectId: string
  /** Todoist's own color name for projects (e.g. "berry_red"), sections have none. */
  todoistColor?: string | null
}

/** "s:<id>" for a section, "p:<id>" for a project (its tasks outside sections). */
export const areaKey = (t: { projectId?: string | null; sectionId?: string | null }) => (t.sectionId ? `s:${t.sectionId}` : `p:${t.projectId ?? ''}`)

/** The area name without its emoji: "🎓 University" → "University". */
export const plainName = (name: string) => name.replace(/[^\p{L}\p{N}&\s'-]/gu, '').replace(/\s+/g, ' ').trim()

/** The colors you can pick for an area (they read well in dark and light). */
export const AREA_COLORS = ['#7CC4FF', '#C8F135', '#FF8A3D', '#FF6B8B', '#B892FF', '#6EE7D8', '#F5C84B', '#4ADE80', '#F472B6', '#94A3B8'] as const

/** A color for an area with none chosen yet: from Todoist's project color, else by name. */
export function defaultAreaColor(a: Pick<Area, 'name' | 'todoistColor'>): string {
  const tc: Record<string, string> = { berry_red: '#FF6B8B', red: '#FF6B8B', orange: '#FF8A3D', yellow: '#F5C84B', olive_green: '#C8F135', lime_green: '#C8F135', green: '#4ADE80', mint_green: '#6EE7D8', teal: '#6EE7D8', sky_blue: '#7CC4FF', light_blue: '#7CC4FF', blue: '#7CC4FF', grape: '#B892FF', violet: '#B892FF', lavender: '#B892FF', magenta: '#F472B6', salmon: '#FF8A3D' }
  if (a.todoistColor && tc[a.todoistColor]) return tc[a.todoistColor]
  let h = 0
  for (const c of plainName(a.name)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AREA_COLORS[h % AREA_COLORS.length]
}

/** Words that point to an area, matched against the area's name. */
const AREA_WORDS: { area: RegExp; words: RegExp }[] = [
  { area: /univ|study|school|facult/i, words: /\b(univ\w*|lab\w*|exam\w*|curs\w*|course\w*|lecture\w*|seminar\w*|homework|teza|referat\w*|colloq\w*|coloc\w*|etica|thesis|assignment|professor|prof|teacher|grade)\b/i },
  { area: /cyber|secur|hack/i, words: /\b(ctf\w*|picoctf|rust|crypto\w*|hack\w*|secur\w*|cyber\w*|pentest\w*|linux|tryhackme|htb|exploit\w*|reverse|malware|ctftime)\b/i },
  { area: /job|career|work/i, words: /\b(cv|resume|linkedin|job\w*|interview\w*|intern\w*|career|portfolio|apply|application|recruiter|salary|freelance)\b/i },
  { area: /sport|gym|fit|train/i, words: /\b(gym|workout\w*|run|running|sport\w*|train\w*|push-?ups?|squats?|swim\w*|football|box\w*)\b/i },
  { area: /health|medic/i, words: /\b(doctor|dentist|teeth|tooth|health|pharmac\w*|medic\w*|pills?|vitamin\w*|blood|clinic|hospital|eyes?)\b/i },
  { area: /skin|look|beauty|groom/i, words: /\b(skin\w*|hair\w*|face|barber|beard|shave\w*|cream|serum|acne|nails?)\b/i },
  { area: /idea/i, words: /\b(idea\w*|maybe|someday|think about|brainstorm|business)\b/i },
  { area: /admin|life|home|errand/i, words: /\b(bank|revolut|maib|pay|bill\w*|buy|order|fix|repair|call|mouse|buds|phone|laptop|documents?|passport|clean\w*|wash|groceries)\b/i }
]

/** The area a new task most likely belongs to, by its words (null when unclear). */
export function guessArea(text: string, areas: Area[]): Area | null {
  for (const rule of AREA_WORDS) {
    if (!rule.words.test(text)) continue
    const hit = areas.find((a) => rule.area.test(plainName(a.name)))
    if (hit) return hit
  }
  // A task that names an area directly ("university: read chapter 3").
  const lower = text.toLowerCase()
  return areas.find((a) => plainName(a.name).length > 2 && lower.includes(plainName(a.name).toLowerCase())) ?? null
}

/** Late first, then most urgent, then soonest, then without a date. */
export function sortTasks(tasks: TodoTask[], today: string): TodoTask[] {
  const rank = (t: TodoTask) => (t.due && t.due < today ? 0 : t.due === today ? 1 : t.due ? 2 : 3)
  return tasks.slice().sort((a, b) => rank(a) - rank(b) || b.priority - a.priority || String(a.due ?? '9999').localeCompare(String(b.due ?? '9999')) || String(a.dueTime ?? '99').localeCompare(String(b.dueTime ?? '99')))
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
