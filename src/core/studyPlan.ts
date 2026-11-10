// Study Time planning (pure, tested in studyPlan.test.ts): the quick add bar
// ("Math lab 4 50m #practice tomorrow"), the tomato dots (pomodoros planned
// against done) and your study tasks pulled from Todoist as blocks.
import { addDays } from './dates'
import { cleanTag, MAX_TAGS, prefsOf, saveBlock, type Repeat, type StudyBlock, type StudySession, type StudyStore, type TodoLite } from './studyTime'

// ---------------------------------------------------------------- the quick add bar

export interface QuickAdd {
  name: string
  category: string
  tags: string[]
  plannedMin: number | null
  estPomos: number | null
  due: string | null
  repeat: Repeat | null
  quick: boolean
  /** The parts it understood, for the chips under the bar. */
  parts: { kind: 'length' | 'pomos' | 'tag' | 'category' | 'day' | 'repeat' | 'quick'; text: string }[]
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const dayIndex = (w: string) => DAYS.findIndex((d) => d === w || d.slice(0, 3) === w || (w.length >= 3 && d.startsWith(w)))
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay()

/** The next day with that weekday (today counts). */
function nextWeekday(today: string, idx: number): string {
  return addDays(today, (idx - weekday(today) + 7) % 7)
}

/** "50m", "50min", "1h", "1h30", "1h30m", "1.5h", "90 min" → minutes (1–600), or null. */
export function parseLength(t: string): number | null {
  const s = t.toLowerCase()
  let m = /^(\d+(?:[.,]\d+)?)h(?:(\d{1,2})m?)?$/.exec(s)
  if (m) return clampMin(parseFloat(m[1].replace(',', '.')) * 60 + (m[2] ? Number(m[2]) : 0))
  m = /^(\d{1,3})(?:m|min|mins|minutes?)$/.exec(s)
  if (m) return clampMin(Number(m[1]))
  return null
}
const clampMin = (n: number) => (n >= 1 ? Math.min(600, Math.round(n)) : null)

/**
 * Reads the quick add bar. Understands, anywhere in the line:
 * a length (50m, 1h30, 1.5h), pomodoros (3p, 3🍅, 3 pomos), #tags, @subject,
 * a day (today, tomorrow, tmr, a weekday, next week, 2026-11-20), a repeat
 * (daily, weekdays, weekly, every monday) and * for a quick block.
 * The rest is the name. With no @subject, a subject you already have whose
 * name is a word in the name is used ("Math lab 4" → Math).
 */
export function parseQuickAdd(text: string, today: string, store?: Pick<StudyStore, 'categories'>): QuickAdd {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const out: QuickAdd = { name: '', category: '', tags: [], plannedMin: null, estPomos: null, due: null, repeat: null, quick: false, parts: [] }
  const rest: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const lw = w.toLowerCase()
    const next = words[i + 1]?.toLowerCase() ?? ''
    // A length: "50m", "1h30", or "90 min" (two words).
    const len = parseLength(lw) ?? (/^\d{1,3}$/.test(lw) && /^(m|min|mins|minutes?)$/.test(next) ? clampMin(Number(lw)) : null)
    if (len != null && out.plannedMin == null) {
      out.plannedMin = len
      if (!parseLength(lw)) i++
      out.parts.push({ kind: 'length', text: len >= 60 ? `${Math.floor(len / 60)}h${len % 60 ? ` ${len % 60}m` : ''}` : `${len}m` })
      continue
    }
    const pomo = /^(\d{1,2})(?:p|🍅|pomos?|pomodoros?)$/u.exec(lw) ?? /^🍅(\d{1,2})$/u.exec(lw)
    const pomoTwo = /^\d{1,2}$/.test(lw) && /^(pomos?|pomodoros?|🍅)$/u.test(next)
    if ((pomo || pomoTwo) && out.estPomos == null) {
      out.estPomos = Math.max(1, Math.min(20, Number(pomo ? pomo[1] : lw)))
      if (pomoTwo) i++
      out.parts.push({ kind: 'pomos', text: `${out.estPomos} 🍅` })
      continue
    }
    if (/^#\S/.test(w)) {
      const t = cleanTag(w)
      if (t && !out.tags.includes(t) && out.tags.length < MAX_TAGS) {
        out.tags.push(t)
        out.parts.push({ kind: 'tag', text: `#${t}` })
      }
      continue
    }
    if (/^@\S/.test(w) && !out.category) {
      const raw = w.slice(1).replace(/_/g, ' ')
      out.category = store?.categories.find((c) => c.name.toLowerCase() === raw.toLowerCase())?.name ?? raw.slice(0, 40)
      out.parts.push({ kind: 'category', text: out.category })
      continue
    }
    if (w === '*' || lw === '!quick') {
      out.quick = true
      out.parts.push({ kind: 'quick', text: 'quick' })
      continue
    }
    // Repeats: daily, weekdays, weekly, every day / weekday / week / monday.
    const rep = lw === 'daily' || (lw === 'every' && next === 'day') ? 'daily' : lw === 'weekdays' || (lw === 'every' && (next === 'weekday' || next === 'weekdays')) ? 'weekdays' : lw === 'weekly' || (lw === 'every' && next === 'week') ? 'weekly' : null
    if (rep && !out.repeat) {
      out.repeat = rep
      if (lw === 'every') i++
      out.parts.push({ kind: 'repeat', text: rep === 'daily' ? 'every day' : rep === 'weekdays' ? 'weekdays' : 'every week' })
      continue
    }
    if (lw === 'every' && dayIndex(next) >= 0 && next.length >= 3 && !out.repeat) {
      out.repeat = 'weekly'
      out.due = nextWeekday(today, dayIndex(next))
      i++
      out.parts.push({ kind: 'repeat', text: `every ${DAYS[dayIndex(next)]}` })
      continue
    }
    // A day.
    let due: string | null = null
    let eat = 0
    if (lw === 'today' || lw === 'tod') due = today
    else if (lw === 'tomorrow' || lw === 'tmr' || lw === 'tom' || lw === 'tmrw') due = addDays(today, 1)
    else if (lw === 'next' && next === 'week') (due = addDays(today, ((8 - weekday(today)) % 7) || 7)), (eat = 1)
    else if (lw === 'in' && /^\d{1,2}$/.test(next) && /^days?$/.test(words[i + 2]?.toLowerCase() ?? '')) (due = addDays(today, Number(next))), (eat = 2)
    else if (/^\d{4}-\d{2}-\d{2}$/.test(lw)) due = lw
    else if (lw.length >= 3 && dayIndex(lw) >= 0 && /^[A-Za-z][a-z]+$/.test(w)) due = nextWeekday(today, dayIndex(lw))
    if (due && !out.due) {
      out.due = due
      i += eat
      out.parts.push({ kind: 'day', text: due === today ? 'today' : due === addDays(today, 1) ? 'tomorrow' : due })
      continue
    }
    rest.push(w)
  }
  out.name = rest.join(' ').slice(0, 60)
  if (!out.category && store) {
    const lower = ` ${out.name.toLowerCase()} `
    const hit = store.categories.find((c) => c.name && lower.includes(` ${c.name.toLowerCase()} `))
    if (hit) {
      out.category = hit.name
      out.parts.push({ kind: 'category', text: hit.name })
    }
  }
  return out
}

/** The block a quick add makes (estimated pomodoros from the length when not given, in pomodoro mode). */
export function quickAddBlock(q: QuickAdd, id: string, store: StudyStore): Partial<StudyBlock> & { id: string; name: string } {
  const p = prefsOf(store)
  const est = q.estPomos ?? (q.plannedMin && p.mode === 'pomodoro' ? Math.max(1, Math.round(q.plannedMin / p.work)) : null)
  const planned = q.plannedMin ?? (q.estPomos && p.mode === 'pomodoro' ? q.estPomos * p.work : null)
  return { id, name: q.name, category: q.category, tags: q.tags, plannedMin: planned, estPomos: est, due: q.due, repeat: q.repeat, quick: q.quick, done: false }
}

// ---------------------------------------------------------------- the tomato dots

/**
 * Pomodoros done per block: what pomodoro sessions counted, else a session's
 * minutes in whole pomodoros. A repeating block counts since it was last done.
 */
export function pomosByBlock(sessions: StudySession[], store: Pick<StudyStore, 'blocks' | 'prefs'>): Map<string, number> {
  const work = prefsOf(store).work
  const since = new Map(store.blocks.map((b) => [b.id, b.repeat && b.lastDone ? b.lastDone : '']))
  const m = new Map<string, number>()
  for (const s of sessions) {
    if (!s.blockId || !since.has(s.blockId)) continue
    if (s.day <= (since.get(s.blockId) ?? '') && since.get(s.blockId)) continue
    const n = s.pomos ?? Math.floor(s.minutes / work)
    if (n > 0) m.set(s.blockId, (m.get(s.blockId) ?? 0) + n)
  }
  return m
}

/** The dots to draw: done (filled) and planned (outline), at most 12 shown. */
export function tomatoDots(est: number | null | undefined, done: number): { done: number; left: number; extra: number } {
  const e = Math.max(0, est ?? 0)
  const d = Math.max(0, done)
  const shownDone = Math.min(d, 12)
  return { done: shownDone, left: Math.max(0, Math.min(12 - shownDone, e - d)), extra: Math.max(0, d - Math.max(e, 12)) }
}

// ---------------------------------------------------------------- Todoist

/** Does a task belong to your study tasks (a chosen project, or a chosen label)? */
export function isStudyTask(t: Pick<TodoLite, 'project' | 'labels'>, rule: { projects: string[]; labels: string[] }): boolean {
  const projects = rule.projects.map((p) => p.toLowerCase())
  const labels = rule.labels.map((l) => l.toLowerCase())
  if (t.project && projects.includes(t.project.toLowerCase())) return true
  return (t.labels ?? []).some((l) => labels.includes(l.toLowerCase()))
}

export const todoistBlockId = (taskId: string) => `td-${taskId}`.slice(0, 40)

/**
 * Your study tasks from Todoist as blocks (linked by task id, never copied
 * into Todoist again). A new task becomes a block (its section or project as
 * the subject, its labels as tags, its duration as the length, its date as
 * the day). A linked block follows the task's name and day. A pulled block
 * whose task is no longer open (done or deleted in Todoist) is done here; a
 * repeating task that came back open with a new day opens again.
 */
export function todoistBlocks(store: StudyStore, tasks: TodoLite[], now: Date): StudyStore {
  const rule = prefsOf(store).todoist
  if (!rule.projects.length && !rule.labels.length) return store
  const study = tasks.filter((t) => t.id && t.content && isStudyTask(t, rule))
  const open = new Map(study.map((t) => [String(t.id), t]))
  let next: StudyStore = store
  const linked = new Set<string>()
  for (const b of store.blocks) {
    if (!b.taskId) continue
    linked.add(b.taskId)
    const t = open.get(b.taskId)
    if (!t) {
      if (b.fromTodoist && !b.done) next = { ...next, blocks: next.blocks.map((x) => (x.id === b.id ? { ...x, done: true } : x)) }
      continue
    }
    const name = t.content.slice(0, 60)
    const reopen = b.done && !!t.recurring && !!t.due && (!b.due || t.due > b.due)
    if (name !== b.name || (t.due ?? null) !== b.due || reopen)
      next = { ...next, blocks: next.blocks.map((x) => (x.id === b.id ? { ...x, name: b.fromTodoist ? name : x.name, taskTitle: t.content.slice(0, 120), due: t.due ?? null, ...(reopen ? { done: false } : {}) } : x)) }
  }
  for (const t of study) {
    if (linked.has(String(t.id))) continue
    const id = todoistBlockId(String(t.id))
    if (next.blocks.some((b) => b.id === id)) continue
    try {
      next = saveBlock(
        next,
        {
          id,
          name: t.content.slice(0, 60),
          category: (t.section || t.project || '').slice(0, 40),
          tags: (t.labels ?? []).filter((l) => !rule.labels.includes(l.toLowerCase())),
          plannedMin: t.duration && t.duration > 0 ? t.duration : null,
          quick: false,
          due: t.due ?? null,
          done: false,
          taskId: String(t.id),
          taskTitle: t.content.slice(0, 120),
          fromTodoist: true
        },
        now
      )
    } catch {
      break // full: the rest waits
    }
  }
  return next
}

/** The projects and labels your open Todoist tasks use (for the "which tasks are study" picker). */
export function todoistChoices(tasks: Pick<TodoLite, 'project' | 'labels'>[]): { projects: string[]; labels: string[] } {
  const projects = [...new Set(tasks.map((t) => t.project).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b))
  const labels = [...new Set(tasks.flatMap((t) => t.labels ?? []).map((l) => l.toLowerCase()))].sort()
  return { projects, labels }
}
