import { describe, expect, it } from 'vitest'
import { messageKind, sendOnce } from './benOnce'

describe('Ben says each kind of thing once a day', () => {
  it('sees the same message with new numbers as the same kind', () => {
    expect(messageKind('💧 Water <b>0.0</b> of 2.7 L and the day is going. Drink 4 glasses now.')).toBe(messageKind('💧 Water 0.5 of 2.7 L and the day is going. Drink 3 glasses now.'))
    expect(messageKind('😤 Nothing done for 4h 29m. Focus today: 0 min.')).toBe(messageKind('😤 Nothing done for 1h 5m. Your must-do: <b>etica</b>.'))
  })
  it('sends the first, holds back the second the same day, sends again tomorrow', () => {
    const a = sendOnce(null, '💧 Water 0.0 of 2.7 L and the day', '2026-11-04')
    expect(a.send).toBe(true)
    const b = sendOnce(a.next, '💧 Water 0.5 of 2.7 L and the day', '2026-11-04')
    expect(b.send).toBe(false)
    expect(sendOnce(b.next, '💧 Water 0.0 of 2.7 L and the day', '2026-11-05').send).toBe(true)
  })
  it('different messages both go', () => {
    const a = sendOnce(null, '💧 Water 0.0 of 2.7 L', '2026-11-04')
    expect(sendOnce(a.next, '💪 No training today yet', '2026-11-04').send).toBe(true)
  })
  it('never holds back your own reminders', () => {
    const a = sendOnce(null, '🔔 Call mom', '2026-11-04')
    expect(sendOnce(a.next, '🔔 Call mom', '2026-11-04').send).toBe(true)
  })
})
