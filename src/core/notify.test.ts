import { describe, expect, it } from 'vitest'
import { groupNotifs, notifFromMessage, type Notif } from './notify'

const at = new Date('2026-11-04T15:00:00Z')

describe('notification center entries', () => {
  it('a moved block offers Start; a plan opens Today; a health alert opens Settings', () => {
    const moved = notifFromMessage('🔁 <b>Deep block 1</b> slipped, no problem. I moved it to <b>15:20–16:10</b>.\nStart now instead, or drop it?', { inline_keyboard: [[{ text: '▶ Start now: Deep block 1', callback_data: 'fo|Deep block 1' }, { text: '✕ Drop it', callback_data: 'bd|0' }]] }, at)!
    expect(moved).toMatchObject({ kind: 'block', title: '🔁 Deep block 1 slipped, no problem. I moved it to 15:20–16:10.', action: { kind: 'focus', subject: 'Deep block 1', minutes: 50 } })
    expect(notifFromMessage("✅ <b>I locked in today's plan</b> so the day doesn't drift: 2 must-dos.", null, at)).toMatchObject({ kind: 'plan', action: { kind: 'page', page: 'today' } })
    expect(notifFromMessage('🔧 <b>Something needs a look</b>\n• Telegram: refused', null, at)).toMatchObject({ kind: 'health', body: '• Telegram: refused', action: { page: 'settings' } })
    expect(notifFromMessage('🎯 Smallest next step', { inline_keyboard: [[{ callback_data: 'fo|25|Lab report' }]] }, at)!.action).toMatchObject({ subject: 'Lab report', minutes: 25 })
    expect(notifFromMessage('   ', null, at)).toBeNull()
  })

  it('groups today and earlier, newest first', () => {
    const n = (id: string, iso: string): Notif => ({ id, at: iso, kind: 'ben', title: id, body: null, action: null, readAt: null })
    const now = new Date(2026, 10, 4, 18, 0)
    const g = groupNotifs([n('a', new Date(2026, 10, 4, 9).toISOString()), n('b', new Date(2026, 10, 3, 9).toISOString()), n('c', new Date(2026, 10, 4, 12).toISOString())], now)
    expect(g.map((x) => [x.label, x.items.map((i) => i.id)])).toEqual([['Today', ['c', 'a']], ['Earlier', ['b']]])
  })
})
