import { addDays, daysBetween } from './dates'
import { dayStreak } from './streaks'

export type SyncEventType =
  | 'checkin'
  | 'expense'
  | 'workout'
  | 'task_done'
  | 'wake'
  | 'bed'
  | 'oath'
  | 'metric'

export interface SyncEvent {
  id: string
  type: SyncEventType
  day: string // "YYYY-MM-DD"
  ts: string // ISO UTC timestamp
  payload: Record<string, any>
  source: 'telegram_bot' | 'mobile_web'
}

export interface SyncResult {
  eventsProcessed: number
  restoredDays: string[]
  restoredStreak: number
  previousStreak: number
  errors: string[]
}

/**
 * Validates an arbitrary object to ensure it conforms strictly to SyncEvent.
 */
export function validateSyncEvent(raw: any): SyncEvent {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Sync event must be an object')
  }

  const { id, type, day, ts, payload, source } = raw

  if (!id || typeof id !== 'string') {
    throw new Error('Sync event missing valid id')
  }

  const validTypes: SyncEventType[] = [
    'checkin',
    'expense',
    'workout',
    'task_done',
    'wake',
    'bed',
    'oath',
    'metric'
  ]
  if (!validTypes.includes(type)) {
    throw new Error(`Unsupported sync event type: ${type}`)
  }

  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`Invalid date format for event: ${day} (expected YYYY-MM-DD)`)
  }

  if (!ts || isNaN(Date.parse(ts))) {
    throw new Error(`Invalid timestamp for event: ${ts}`)
  }

  return {
    id: String(id),
    type,
    day,
    ts,
    payload: (payload && typeof payload === 'object') ? payload : {},
    source: source === 'mobile_web' ? 'mobile_web' : 'telegram_bot'
  }
}

/**
 * Deduplicates incoming events against a known set of applied event IDs.
 */
export function deduplicateEvents(existingIds: Set<string>, incoming: SyncEvent[]): SyncEvent[] {
  const seenInBatch = new Set<string>()
  const result: SyncEvent[] = []

  for (const event of incoming) {
    if (!existingIds.has(event.id) && !seenInBatch.has(event.id)) {
      seenInBatch.add(event.id)
      result.push(event)
    }
  }

  // Ensure chronological order
  return result.sort((a, b) => a.ts.localeCompare(b.ts))
}

/**
 * Calculates streak restoration metrics given existing checkin days and new incoming events.
 */
export function calculateStreakRestoration(
  existingCheckinDays: Iterable<string>,
  newEvents: SyncEvent[],
  today: string
): {
  restoredDays: string[]
  previousStreak: number
  restoredStreak: number
  streakHealed: boolean
} {
  const existingSet = new Set(existingCheckinDays)
  const previousStreak = dayStreak(existingSet, today)

  const restoredDays: string[] = []
  const updatedSet = new Set(existingSet)

  for (const ev of newEvents) {
    if (ev.type === 'checkin') {
      if (!existingSet.has(ev.day)) {
        restoredDays.push(ev.day)
        updatedSet.add(ev.day)
      }
    }
  }

  const restoredStreak = dayStreak(updatedSet, today)
  const streakHealed = restoredStreak > previousStreak

  return {
    restoredDays: [...new Set(restoredDays)].sort(),
    previousStreak,
    restoredStreak,
    streakHealed
  }
}
