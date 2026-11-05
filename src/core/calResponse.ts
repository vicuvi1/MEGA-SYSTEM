// Which calendar events are really yours (IS6): only what you said yes to
// can be "Now", alert you or start a timer. A "maybe" (tentative) shows
// greyed and still takes the time in planning; an invite you haven't
// answered (needsAction) is only shown in the calendar as "Invite: accept?".
// Pure: the app, the island, the bots and Ben share it.
import type { CalEvent } from './dayTime'

export type CalResponse = NonNullable<CalEvent['response']> | null
type Ev = Pick<CalEvent, 'declined' | 'response' | 'eventType'> & Partial<Pick<CalEvent, 'free' | 'meet' | 'attendees' | 'allDay'>>

/** Your answer from a Google event: the self attendee's responseStatus; null when you made it or nobody is invited. */
export function selfResponse(e: { organizer?: { self?: boolean } | null; attendees?: { self?: boolean; responseStatus?: string }[] | null }): CalResponse {
  if (e.organizer?.self) return null
  if (!Array.isArray(e.attendees) || !e.attendees.length) return null
  const me = e.attendees.find((a) => a?.self)
  const r = me?.responseStatus
  return r === 'accepted' || r === 'tentative' || r === 'needsAction' || r === 'declined' ? r : null
}

export const isDeclined = (e: Ev) => !!e.declined || e.response === 'declined'
/** An invite you haven't answered yet. */
export const isInvite = (e: Ev) => e.response === 'needsAction'
/** You said "maybe". */
export const isTentative = (e: Ev) => e.response === 'tentative'
/** Not a thing you do: a working-location or out-of-office marker. */
export const isMarker = (e: Ev) => e.eventType === 'workingLocation' || e.eventType === 'outOfOffice'
/** Yours for sure: made by you, nobody else invited, or you said yes. */
export const isAccepted = (e: Ev) => !isDeclined(e) && !isInvite(e) && !isTentative(e)
/** Takes your time in planning and Ben's picture of the day: yes or maybe (not unanswered invites, not markers). */
export const takesTime = (e: Ev) => !isDeclined(e) && !isInvite(e) && e.eventType !== 'workingLocation'
/** Can be what's on "Now", alert you, or start a focus timer by itself. */
export const canBeNow = (e: Ev) => isAccepted(e) && !e.free && !isMarker(e)
/** A real meeting by its data (accepted, a call link or other people), whatever its name. */
export const isRealMeeting = (e: Ev) => canBeNow(e) && e.eventType !== 'focusTime' && (!!e.meet || (e.attendees ?? 0) > 1)
