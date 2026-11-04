// The coach's "Do this now": the one move that matters most right now, from
// your open promises, today's plan, a running timer, goals and must-dos.
// Pinned at the top of the coach chat. Pure and tested.

export type Move =
  | { kind: 'answer'; title: string; sub: string; promise: string }
  | { kind: 'approve'; title: string; sub: string }
  | { kind: 'running'; title: string; sub: string; endsAt: number }
  | { kind: 'focus'; title: string; sub: string; subject: string; minutes: number }
  | { kind: 'plan'; title: string; sub: string }
  | { kind: 'ask'; title: string; sub: string }

export interface MoveInput {
  hour: number
  /** Check-ins sent and waiting for your answer (newest last). */
  awaiting: string[]
  planStatus: 'none' | 'proposed' | 'approved'
  running: { subject: string; endsAt: number } | null
  /** Goals with minutes still to do today, most urgent first. */
  goals: { title: string; subject: string; todayLeftMin: number; behind: boolean }[]
  openMustDos: string[]
  evening: boolean
}

export function nextMove(m: MoveInput, now = Date.now()): Move {
  if (m.running) {
    const left = Math.max(0, Math.round((m.running.endsAt - now) / 60000))
    return { kind: 'running', title: `Focus on ${m.running.subject}`, sub: left ? `${left} min left. Phone away, stay on it.` : 'Time is up: stop and log it.', endsAt: m.running.endsAt }
  }
  const promise = m.awaiting[m.awaiting.length - 1]
  if (promise) return { kind: 'answer', title: promise, sub: 'You promised this. Did you do it?', promise }
  if (m.planStatus === 'proposed' && m.hour < 18) return { kind: 'approve', title: "Approve today's plan", sub: 'Blocks go in your calendar, must-dos on Today.' }
  const goal = m.goals.find((g) => g.todayLeftMin >= 20 && g.behind) ?? m.goals.find((g) => g.todayLeftMin >= 20)
  if (goal && !m.evening) {
    const minutes = Math.min(50, Math.max(25, goal.todayLeftMin))
    return { kind: 'focus', title: `${minutes} min on ${goal.subject}`, sub: `${goal.title}: ${goal.todayLeftMin} min still today${goal.behind ? ', and you are behind' : ''}.`, subject: goal.subject, minutes }
  }
  if (m.openMustDos.length && !m.evening) {
    const t = m.openMustDos[0]
    return { kind: 'focus', title: `25 min: ${t}`, sub: `Your must-do${m.openMustDos.length > 1 ? ` (${m.openMustDos.length} open)` : ''}. Start, the rest follows.`, subject: t.split(/\s+/).slice(0, 3).join(' ').slice(0, 40), minutes: 25 }
  }
  if (m.planStatus === 'none' && m.hour >= 5 && m.hour < 14) return { kind: 'plan', title: 'Plan my day', sub: 'Must-dos, blocks in your free time, training, water.' }
  return { kind: 'ask', title: m.evening ? 'How did today go?' : "What's next?", sub: m.evening ? 'Tell your coach, it writes the review.' : 'Ask your coach for the one thing that matters now.' }
}
