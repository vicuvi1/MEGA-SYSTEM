// The plan as the plan store holds it right now (the editor's edits and what
// came in from Todoist and Google), for the parts of a plan card that are not
// the editor: must-dos, "Also today" and "Moved to tomorrow". Falls back to
// the plan the card loaded when the store has none for that day.
import { useEffect, useState } from 'react'
import type { DayProposal } from '@core/rhythm'
import { subscribe, type PlanSnap } from './planStore'

export function useLivePlan<T extends DayProposal | null | undefined>(plan: T): T {
  const [s, set] = useState<PlanSnap | null>(null)
  useEffect(() => subscribe(set), [])
  return (s && plan && s.plan.day === plan.day ? s.plan : plan) as T
}
