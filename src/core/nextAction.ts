// "Now": the one thing to do next, from where your day stands (pure, tested).
// Order: a running focus session, the wake-up, the plan, the evening review,
// the first unfinished must-do (as focus time for a goal you're behind on),
// a late or urgent Todoist task, your habits, then a goal you're behind on.

export interface NowInput {
  hour: number
  running: { subject: string; startedAt: string; planned: number } | null
  wakeLogged: boolean
  plan: { text: string; done: boolean }[]
  reviewDone: boolean
  goalsBehind: { title: string; subject: string; aheadH: number }[]
  todo: { id: string; content: string; priority: number; due: string | null }[]
  habits: { id: string; label: string; done: boolean }[]
  today: string
}

export type NowAction =
  | { kind: 'stop-focus'; title: string; detail: string }
  | { kind: 'log-wake'; title: string; detail: string }
  | { kind: 'plan'; title: string; detail: string }
  | { kind: 'review'; title: string; detail: string }
  | { kind: 'mustdo'; title: string; detail: string; index: number; subject: string }
  | { kind: 'focus-goal'; title: string; detail: string; subject: string }
  | { kind: 'todo'; title: string; detail: string; id: string }
  | { kind: 'habit'; title: string; detail: string; id: string }
  | { kind: 'done'; title: string; detail: string }

/** Every suggestion in order; the card shows the first one you didn't skip. */
export function nowActions(i: NowInput): NowAction[] {
  const out: NowAction[] = []
  if (i.running) {
    out.push({ kind: 'stop-focus', title: `Focusing on ${i.running.subject}`, detail: `Stay with it. Stop when the ${i.running.planned} minutes are up.` })
    return out
  }
  if (i.hour < 12 && !i.wakeLogged) out.push({ kind: 'log-wake', title: 'Log your wake-up', detail: 'One tap. If you got up earlier, fix the time on Sleep.' })
  if (!i.plan.length && i.hour < 20) out.push({ kind: 'plan', title: 'Plan your day', detail: 'Write the 1–3 things that would make today a good day.' })
  if (i.hour >= 20 && i.plan.length && !i.reviewDone) {
    const done = i.plan.filter((p) => p.done).length
    out.push({ kind: 'review', title: '2-minute review', detail: `${done}/${i.plan.length} must-dos done. Tick what you finished, note what got in the way.` })
  }
  const behind = i.goalsBehind.slice().sort((a, b) => a.aheadH - b.aheadH)
  i.plan.forEach((p, index) => {
    if (p.done) return
    const goal = behind.find((g) => [g.subject, g.title].some((w) => p.text.toLowerCase().includes(w.toLowerCase())))
    out.push({
      kind: 'mustdo',
      index,
      subject: goal?.subject ?? p.text.split(/\s+/).slice(0, 3).join(' '),
      title: p.text,
      detail: goal ? `${goal.title}: ${-goal.aheadH}h behind. Start a 50-minute focus on it.` : 'Your next must-do. Start a focus session, or tick it if it is done.'
    })
  })
  const urgent = i.todo
    .filter((t) => (t.due && t.due < i.today) || t.priority >= 4)
    .sort((a, b) => b.priority - a.priority)
  for (const t of urgent.slice(0, 2)) out.push({ kind: 'todo', id: t.id, title: t.content, detail: t.due && t.due < i.today ? 'Late in Todoist. Do it, or move it in Todoist.' : 'Urgent (P1) in Todoist.' })
  const order = i.hour < 12 ? ['oath', 'workout', 'skincare', 'clean', 'spending'] : i.hour >= 18 ? ['clean', 'spending', 'skincare', 'workout', 'oath'] : ['workout', 'spending', 'skincare', 'clean', 'oath']
  for (const id of order) {
    const h = i.habits.find((x) => x.id === id && !x.done)
    if (h) out.push({ kind: 'habit', id: h.id, title: h.label, detail: 'A daily habit, not done yet.' })
  }
  for (const g of behind.slice(0, 1)) {
    if (!out.some((a) => a.kind === 'mustdo' && a.subject === g.subject)) out.push({ kind: 'focus-goal', subject: g.subject, title: `Focus on ${g.subject}`, detail: `${g.title}: ${-g.aheadH}h behind a steady pace.` })
  }
  if (!out.length) out.push({ kind: 'done', title: 'All done for today 🎉', detail: 'You earned it. Rest, or spend some coins on fun.' })
  return out
}
