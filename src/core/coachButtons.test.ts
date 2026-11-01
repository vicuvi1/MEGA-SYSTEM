import { describe, expect, it } from 'vitest'
import { readButtons, readDo, readShow, sparkline, telegramKeyboard } from './coachButtons'

describe('interactive replies', () => {
  it('reads what a button does, and refuses the rest', () => {
    expect(readDo('focus:25:Algebra')).toEqual({ k: 'focus', minutes: 25, subject: 'Algebra' })
    expect(readDo('focus:CV')).toEqual({ k: 'focus', minutes: 25, subject: 'CV' })
    expect(readDo('approve')).toEqual({ k: 'approve' })
    expect(readDo('book:Pass the algebra exam')).toEqual({ k: 'book', goal: 'Pass the algebra exam' })
    expect(readDo('say:Done ✅')).toEqual({ k: 'say', text: 'Done ✅' })
    expect(readDo('open:goals')).toEqual({ k: 'open', tab: 'goals' })
    expect(readDo('delete:everything')).toBeNull()
    expect(readDo('open:settings')).toBeNull()
    expect(readButtons([{ label: '▶ 25 min', do: 'focus:25:Algebra' }, { label: 'Hack', do: 'rm -rf' }, { label: '', do: 'plan' }])).toEqual([{ label: '▶ 25 min', do: 'focus:25:Algebra' }])
    expect(readShow(['goals', 'nope', 'focus-week', 'water'])).toEqual(['goals', 'focus-week'])
  })
  it('maps to Telegram buttons within 64 bytes', () => {
    const kb = telegramKeyboard([{ label: '▶ 25 min', do: 'focus:25:Algebra' }, { label: 'Approve', do: 'approve' }, { label: 'Goals', do: 'open:goals' }, { label: 'Done', do: `say:${'é'.repeat(80)}` }])!
    expect(kb.inline_keyboard.map((r) => r[0].callback_data.slice(0, 3))).toEqual(['fo|', 'rb|', 'cs|'])
    expect(kb.inline_keyboard.every((r) => new TextEncoder().encode(r[0].callback_data).length <= 64)).toBe(true)
    expect(sparkline([0, 30, 60, 120])).toBe('·▃▅█')
  })
})
