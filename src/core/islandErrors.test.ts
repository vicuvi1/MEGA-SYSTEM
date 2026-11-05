import { describe, expect, it } from 'vitest'
import { plainError, todoistErrorText } from './islandErrors'

describe('island errors in plain words (IS19)', () => {
  it('never shows a raw server message', () => {
    expect(plainError('TypeError: Failed to fetch')).toBe("Couldn't reach the internet — try again in a moment")
    expect(plainError('Turso 503: upstream')).toBe('The server had a hiccup — try again in a moment')
    expect(plainError("Cannot read properties of undefined (reading 'x')")).toBe('Something went wrong — it was noted in the log')
    expect(plainError(undefined)).toBe('It did not work')
    // Our own plain messages pass through.
    expect(plainError('Only blocks from Google Calendar can be moved')).toBe('Only blocks from Google Calendar can be moved')
  })
  it('Todoist: done elsewhere, signed out, busy, offline', () => {
    expect(todoistErrorText(new Error('Todoist 404: task not found'))).toBe('That task was already done or moved — refreshing')
    expect(todoistErrorText(new Error('401 Unauthorized'))).toContain('connected again')
    expect(todoistErrorText(new Error('429'))).toContain('busy')
    expect(todoistErrorText(new Error('Failed to fetch'))).toContain("Couldn't reach Todoist")
  })
})
