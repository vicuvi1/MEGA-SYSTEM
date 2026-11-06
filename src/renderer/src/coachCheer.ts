// Something good happened on the Coach page (a task ticked, a block started,
// water logged): the chat answers with a burst of colour and a happy Ben.
export const CHEER_EVENT = 'life-coach-cheer'
export type CheerKind = 'done' | 'focus' | 'water'
export function coachCheer(kind: CheerKind = 'done'): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHEER_EVENT, { detail: kind }))
}
