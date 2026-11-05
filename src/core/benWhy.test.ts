import { describe, expect, it } from 'vitest'
import { addWhy, whyText } from './benWhy'
import { parseTelegramText } from './botCommands'

describe('/why', () => {
  it('keeps each action with your words and its source (not warnings)', () => {
    const l = addWhy([], ['🗓 In your calendar: Gym · 11-06 18:00', "⚠️ Google Calendar isn't connected"], 'book gym tomorrow 6pm', 'your Telegram message', '2026-11-05T10:00:00')
    expect(l).toHaveLength(1)
    expect(whyText(l)).toMatch(/Gym[\s\S]*because you said:<\/i> “book gym tomorrow 6pm” · 10:00 · your Telegram message/)
    expect(whyText([])).toMatch(/Nothing to explain/)
  })
  it('/why is a command', () => {
    expect(parseTelegramText('/why').type).toBe('why')
  })
})
