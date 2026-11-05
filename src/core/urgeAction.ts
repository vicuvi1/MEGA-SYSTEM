// The urge crusher's one action, picked from your most common trigger (pure).
export type UrgeActionKind = 'pushups' | 'cold' | 'focus' | 'walk'
export interface UrgeAction { kind: UrgeActionKind; title: string; how: string; reps?: number; minutes?: number }

export function pickUrgeAction(topTrigger: string | null | undefined): UrgeAction {
  const t = String(topTrigger ?? '').toLowerCase()
  if (/late night|tired|phone in bed/.test(t)) return { kind: 'cold', title: 'Cold water, phone out of the room', how: 'Splash cold water on your face, put the phone in another room, then breathe with the circle.' }
  if (/bored|social media/.test(t)) return { kind: 'focus', title: 'Start a 25-minute focus block', how: 'Give the energy a job: one small task, timer on, phone face down.', minutes: 25 }
  if (/alone/.test(t)) return { kind: 'walk', title: 'Go outside for 10 minutes', how: 'Shoes on, door open, walk around the block. Text a friend on the way.' }
  return { kind: 'pushups', title: 'Drop and do 20 push-ups', how: 'Hard and fast, then breathe. They go into Sport Track.', reps: 20 }
}

/** How much the urge dropped, for the log ("8 → 3"). */
export const urgeDrop = (before: number | null, after: number | null) => (before != null && after != null ? before - after : null)
