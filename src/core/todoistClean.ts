// "Clean up my Todoist": the model reads your open tasks and suggests fixes
// (typos, a short title with the rest moved to details, the right area,
// priority or date, duplicates and stale tasks). You approve each one; the
// app applies it. Pure: the prompt, a strict parser, and a fallback that
// needs no AI (duplicates and long-overdue tasks).
import { plainName, type Area, type TodoTask } from './todoist'
import { addDays } from './dates'

export interface CleanChange {
  /** Todoist task id. */
  id: string
  /** The task as it is now (for the before → after view). */
  before: string
  title?: string
  details?: string
  /** Area key ("s:<id>" / "p:<id>"). */
  area?: string
  /** Todoist priority: 4 = P1 … 1 = P4. */
  priority?: number
  /** A Todoist date string ("today", "next monday", "2026-11-20", "no date"). */
  due?: string
  /** Delete it: a duplicate of another task, or stale. */
  remove?: 'duplicate' | 'stale'
  duplicateOf?: string
  why: string
}

const MAX_TASKS = 150
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** The prompt: compact task lines (numbered, so the model never copies ids). */
export function cleanupPrompt(tasks: TodoTask[], areas: Area[], today: string): string {
  const areaName = (t: TodoTask) => {
    const key = t.sectionId ? `s:${t.sectionId}` : `p:${t.projectId ?? ''}`
    return areas.find((a) => a.key === key)?.name ?? t.section ?? t.project ?? 'Inbox'
  }
  const lines = tasks.slice(0, MAX_TASKS).map((t, i) =>
    JSON.stringify({
      i,
      t: t.content,
      ...(t.description ? { d: t.description.slice(0, 160) } : {}),
      a: plainName(areaName(t)) || 'Inbox',
      p: `P${5 - t.priority}`,
      ...(t.due ? { due: t.due } : {}),
      ...(t.recurring ? { r: 1 } : {})
    })
  )
  return `You tidy a student's Todoist. Today is ${today}.
Areas: ${areas.map((a) => plainName(a.name) || a.name).join(', ')}.
Tasks (one JSON per line; i = number, t = title, d = details, a = area, p = priority, due, r = repeats):
${lines.join('\n')}

Suggest changes ONLY where they clearly help. Rules:
- Fix typos, wrong capitalization and messy wording; keep the user's language and meaning. Never invent facts.
- Titles short and actionable (max ~60 characters, start with a verb when natural). Move extra info (names, notes, links) into "details".
- "area": only when the task is clearly in the wrong area or sits in Inbox and one area clearly fits. Use an area name from the list.
- "priority": only when clearly off (an exam or deadline at P4, a someday idea at P1). P1 = urgent ... P4 = none.
- "due": only for tasks overdue by more than 7 days (suggest a realistic new date like "tomorrow", "next monday" or "no date"). Never change repeating tasks' dates.
- "remove": "duplicate" when two tasks mean the same thing (keep the better one, set "dup" to its i), or "stale" for vague tasks overdue 30+ days that nobody will do.
- "why": a few plain words.
Reply with JSON only: {"changes":[{"i":0,"title":"...","details":"...","area":"...","priority":"P2","due":"tomorrow","remove":"duplicate","dup":3,"why":"..."}]}. Leave out fields you don't change. At most 40 changes. If nothing needs fixing: {"changes":[]}.`
}

function jsonFrom(text: string): any {
  const s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    return JSON.parse(s)
  } catch {
    const m = s.match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
      return JSON.parse(m[0])
    } catch {
      return null
    }
  }
}

/** The model's answer → checked changes (unknown tasks, areas and empty changes dropped). */
export function parseCleanup(text: string, tasks: TodoTask[], areas: Area[]): CleanChange[] {
  const j = jsonFrom(text)
  const list: any[] = Array.isArray(j?.changes) ? j.changes : Array.isArray(j) ? j : []
  const sent = tasks.slice(0, MAX_TASKS)
  const out: CleanChange[] = []
  const seen = new Set<string>()
  for (const c of list.slice(0, 60)) {
    const t = sent[Number(c?.i)]
    if (!t || seen.has(t.id)) continue
    const ch: CleanChange = { id: t.id, before: t.content, why: String(c.why ?? '').trim().slice(0, 120) || 'Tidier' }
    const title = typeof c.title === 'string' ? c.title.trim().slice(0, 200) : ''
    if (title && title !== t.content) ch.title = title
    const details = typeof c.details === 'string' ? c.details.trim().slice(0, 1000) : ''
    if (details && details !== (t.description ?? '')) ch.details = t.description && !details.includes(t.description) ? `${details}\n\n${t.description}` : details
    if (typeof c.area === 'string') {
      const want = norm(c.area)
      const a = areas.find((x) => norm(plainName(x.name) || x.name) === want) ?? areas.find((x) => want && norm(x.name).includes(want))
      const cur = t.sectionId ? `s:${t.sectionId}` : `p:${t.projectId ?? ''}`
      if (a && a.key !== cur) ch.area = a.key
    }
    const pm = String(c.priority ?? '').match(/^P?([1-4])$/i)
    if (pm) {
      const p = 5 - Number(pm[1])
      if (p !== t.priority) ch.priority = p
    }
    if (typeof c.due === 'string' && c.due.trim() && !t.recurring) ch.due = c.due.trim().slice(0, 40)
    if (c.remove === 'duplicate' || c.remove === 'stale') {
      ch.remove = c.remove
      const dup = sent[Number(c.dup)]
      if (c.remove === 'duplicate') {
        if (!dup || dup.id === t.id) continue // a duplicate of nothing: skip
        ch.duplicateOf = dup.content
      }
    }
    if (!ch.title && !ch.details && !ch.area && !ch.priority && !ch.due && !ch.remove) continue
    seen.add(t.id)
    out.push(ch)
  }
  return out
}

/** Without AI: exact duplicates (same words) and tasks overdue for 30+ days. */
export function localCleanup(tasks: TodoTask[], today: string): CleanChange[] {
  const out: CleanChange[] = []
  const first = new Map<string, TodoTask>()
  for (const t of tasks) {
    const k = norm(t.content)
    if (!k) continue
    const prev = first.get(k)
    if (prev) out.push({ id: t.id, before: t.content, remove: 'duplicate', duplicateOf: prev.content, why: 'Same task twice' })
    else first.set(k, t)
  }
  const old = addDays(today, -30)
  for (const t of tasks) {
    if (t.recurring || !t.due || t.due >= old || out.some((c) => c.id === t.id)) continue
    out.push({ id: t.id, before: t.content, due: 'no date', why: `Overdue since ${t.due}: give it a real date or drop it` })
  }
  return out
}
