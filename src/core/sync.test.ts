import { describe, expect, it } from 'vitest'
import {
  calculateStreakRestoration,
  deduplicateEvents,
  validateSyncEvent,
  type SyncEvent
} from './sync'

describe('core/sync', () => {
  describe('validateSyncEvent', () => {
    it('accepts valid checkin event', () => {
      const valid = {
        id: 'evt_1',
        type: 'checkin',
        day: '2026-10-28',
        ts: '2026-10-28T14:30:00.000Z',
        payload: { note: 'Telegram mobile' },
        source: 'telegram_bot'
      }
      const parsed = validateSyncEvent(valid)
      expect(parsed.id).toBe('evt_1')
      expect(parsed.type).toBe('checkin')
      expect(parsed.day).toBe('2026-10-28')
      expect(parsed.source).toBe('telegram_bot')
    })

    it('rejects invalid or missing types', () => {
      expect(() => validateSyncEvent(null)).toThrow()
      expect(() => validateSyncEvent({ id: '1', type: 'hologram', day: '2026-10-28', ts: '2026-10-28T14:00:00Z' })).toThrow('Unsupported sync event type')
    })

    it('rejects malformed date and timestamp', () => {
      expect(() => validateSyncEvent({ id: '1', type: 'checkin', day: '28-10-2026', ts: '2026-10-28T14:00:00Z' })).toThrow('Invalid date format')
      expect(() => validateSyncEvent({ id: '1', type: 'checkin', day: '2026-10-28', ts: 'invalid-time' })).toThrow('Invalid timestamp')
    })
  })

  describe('deduplicateEvents', () => {
    it('filters out already applied events and duplicates in batch, returning chronological order', () => {
      const existing = new Set(['evt_1', 'evt_2'])
      const incoming: SyncEvent[] = [
        { id: 'evt_4', type: 'checkin', day: '2026-10-29', ts: '2026-10-29T10:00:00Z', payload: {}, source: 'telegram_bot' },
        { id: 'evt_1', type: 'checkin', day: '2026-10-27', ts: '2026-10-27T10:00:00Z', payload: {}, source: 'telegram_bot' },
        { id: 'evt_3', type: 'expense', day: '2026-10-28', ts: '2026-10-28T09:00:00Z', payload: { amountBani: 3500 }, source: 'telegram_bot' },
        { id: 'evt_3', type: 'expense', day: '2026-10-28', ts: '2026-10-28T09:00:00Z', payload: { amountBani: 3500 }, source: 'telegram_bot' }
      ]

      const deduped = deduplicateEvents(existing, incoming)
      expect(deduped.map((e) => e.id)).toEqual(['evt_3', 'evt_4'])
    })
  })

  describe('calculateStreakRestoration', () => {
    it('correctly calculates healed streak when missing days are restored', () => {
      // Existing days had gap on 2026-10-27 and 2026-10-28
      const existingDays = ['2026-10-25', '2026-10-26']
      const today = '2026-10-29'

      // Without mobile logs, streak ending today is 0 (since neither yesterday nor today is done)
      // With mobile logs covering 2026-10-27, 2026-10-28, and 2026-10-29:
      const newEvents: SyncEvent[] = [
        { id: 'e1', type: 'checkin', day: '2026-10-27', ts: '2026-10-27T12:00:00Z', payload: {}, source: 'telegram_bot' },
        { id: 'e2', type: 'checkin', day: '2026-10-28', ts: '2026-10-28T12:00:00Z', payload: {}, source: 'telegram_bot' },
        { id: 'e3', type: 'checkin', day: '2026-10-29', ts: '2026-10-29T12:00:00Z', payload: {}, source: 'telegram_bot' }
      ]

      const res = calculateStreakRestoration(existingDays, newEvents, today)
      expect(res.previousStreak).toBe(0)
      expect(res.restoredStreak).toBe(5) // 25, 26, 27, 28, 29 = 5 days consecutive!
      expect(res.streakHealed).toBe(true)
      expect(res.restoredDays).toEqual(['2026-10-27', '2026-10-28', '2026-10-29'])
    })
  })
})
