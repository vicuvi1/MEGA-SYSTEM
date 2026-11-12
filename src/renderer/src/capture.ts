// The one capture pipeline (see core/capture.ts): a focus timer, a task, the
// bot's rules (money, water, reps, sleep: free and instant), then Ben, then
// Todoist when Ben isn't there. Every capture box calls this.
import { parseCapture } from '@core/capture'
import { life } from './bridge'
import { OFF_REPLY, moduleDef, type ModuleId } from '@core/modules'
import { moduleOn } from './useModules'

export interface CaptureResult {
  ok: boolean
  /** One short line for a toast. */
  said: string
  via: 'focus' | 'task' | 'rule' | 'ben' | 'todoist' | 'discipline' | 'goal'
}

/** Opens Goals with a draft from words (the sheet reads it once). */
export function openGoalDraft(text: string): void {
  try {
    sessionStorage.setItem('ls.goalDraft', text.slice(0, 200))
  } catch {
    /* the event still carries it */
  }
  window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'goals' }))
  window.dispatchEvent(new CustomEvent('life-goal-draft', { detail: text.slice(0, 200) }))
}

const changed = (...names: string[]) => names.forEach((n) => window.dispatchEvent(new CustomEvent(n)))

export async function capture(text: string, onStep?: (step: string) => void): Promise<CaptureResult> {
  const c = parseCapture(text)
  if (!c) throw new Error('Type something first')
  if (c.kind === 'focus') {
    await life.focus.start(c.subject, c.minutes, null)
    changed('life-focus-changed')
    return { ok: true, said: `⏱ Focus: ${c.subject} · ${c.minutes} min`, via: 'focus' }
  }
  // The module switch (core/modules.ts): what belongs to a part that is off says so and does nothing.
  const off = (id: ModuleId): CaptureResult => ({ ok: true, said: `${moduleDef(id).label}: ${OFF_REPLY}`, via: 'rule' })
  if (c.kind === 'task' && !moduleOn('tasks')) return off('tasks')
  if (c.kind === 'goal' && !moduleOn('goals')) return off('goals')
  if (c.kind === 'task') {
    if (!life.todoist) throw new Error('Connect Todoist to add tasks')
    const t = await life.todoist.quickAdd(c.text)
    changed('life-external-changed')
    return { ok: true, said: `Added to Todoist: ${t.content}`, via: 'task' }
  }
  if (c.kind === 'clean') {
    await life.discipline.checkIn()
    changed('life-external-changed')
    return { ok: true, said: 'Clean day checked in', via: 'discipline' }
  }
  if (c.kind === 'goal') {
    // A draft to confirm: the Goals page opens its New goal sheet with these words.
    openGoalDraft(c.text)
    return { ok: true, said: `🎯 Goal draft: confirm it on Goals`, via: 'goal' }
  }
  if (c.kind === 'oath') {
    await life.discipline.oath()
    return { ok: true, said: 'Morning oath sworn', via: 'discipline' }
  }
  // The rules first: free and instant.
  const q = await life.coach?.quick?.(c.text).catch(() => null)
  if (q && !('unknown' in q)) {
    if (!q.ok) throw new Error(q.reply.replace(/^⚠️\s*/, ''))
    changed('life-body-changed', 'life-external-changed')
    return { ok: true, said: q.reply.split('\n').slice(0, 3).join(' · ').slice(0, 160), via: 'rule' }
  }
  if (life.coach?.chat && moduleOn('coach')) {
    const r = await life.coach.chat(c.text, onStep)
    const did = r.done?.filter(Boolean) ?? []
    changed('life-external-changed')
    return { ok: r.ok, said: (did.length ? did.join(' · ') : r.reply.replace(/^\p{Extended_Pictographic}\s*/u, '')).slice(0, 160), via: 'ben' }
  }
  if (life.todoist && moduleOn('tasks')) {
    const t = await life.todoist.quickAdd(c.text)
    changed('life-external-changed')
    return { ok: true, said: `Added to Todoist: ${t.content}`, via: 'todoist' }
  }
  throw new Error(`Not sure what "${c.text.slice(0, 40)}" means. Try: "45 lunch", "water 500", "focus 50 algebra", "task read 10 pages".`)
}
