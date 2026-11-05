// After a reset: the 72-hour comeback plan as real things (pure). If-then
// plans from your top trigger become Ben's check-ins at the right times, and
// the concrete steps become Todoist tasks.
export interface ComebackStep { kind: 'task' | 'checkin'; text: string; at: string; due?: 'today' | 'tomorrow' | 'in 2 days' | 'in 3 days' }

const IF_THEN: Record<string, string> = {
  'late night, tired': 'If it is 23:00 and I am tired, then the phone goes to the kitchen and I go to bed.',
  'phone in bed': 'If I reach for the phone in bed, then it goes on the desk across the room.',
  bored: 'If I feel bored, then I start a 25-minute focus block or go for a walk.',
  stress: 'If stress hits, then 20 push-ups and 10 slow breaths before anything else.',
  alone: 'If I am alone and restless, then I text a friend or go outside.',
  'social media': 'If I open social media without a reason, then I close it and stand up.'
}

/** The plan for the 72 hours after a reset at `now`, with times. */
export function comebackPlan(now: Date, topTrigger: string | null, bedTarget = '23:00'): ComebackStep[] {
  const ifThen = IF_THEN[String(topTrigger ?? '').toLowerCase()] ?? 'If the urge hits, then I open the urge crusher right away.'
  const at = (hoursFromNow: number) => new Date(now.getTime() + hoursFromNow * 3600_000).toISOString()
  const tonight = new Date(now)
  const [bh, bm] = bedTarget.split(':').map(Number)
  tonight.setHours((bh || 23) - 1, bm || 0, 0, 0)
  if (tonight.getTime() <= now.getTime()) tonight.setTime(now.getTime() + 2 * 3600_000)
  return [
    { kind: 'task', text: 'Comeback: water, then 5 minutes outside', at: at(0), due: 'today' },
    { kind: 'checkin', text: `Tonight's plan: ${ifThen}`, at: tonight.toISOString() },
    { kind: 'task', text: 'Comeback day 1: check in to MAN', at: at(18), due: 'tomorrow' },
    { kind: 'checkin', text: 'Day 1 of the comeback: did you check in, and how strong were the urges?', at: at(26) },
    { kind: 'checkin', text: `Day 2: keep the plan. ${ifThen}`, at: at(50) },
    { kind: 'task', text: 'Comeback day 3: check in (pays the comeback bonus)', at: at(66), due: 'in 3 days' },
    { kind: 'checkin', text: '72 hours done. What helped most? Keep that one.', at: at(72) }
  ]
}
