import { describe, expect, it } from 'vitest'
import { bookMinutes, DEFAULT_TASK_MIN } from './booking'
import { taskMinutes } from './islandActions'

describe('one way to book a task', () => {
  it("uses the task's own Todoist length, else 50 minutes", () => {
    expect(bookMinutes({ duration: 90 })).toBe(90)
    expect(bookMinutes({ duration: 600 })).toBe(240)
    expect(bookMinutes({ duration: 5 })).toBe(DEFAULT_TASK_MIN)
    expect(bookMinutes({})).toBe(50)
  })
  it('the island uses the same default when the text has no length', () => {
    expect(taskMinutes('Call mom')).toBe(bookMinutes({}))
  })
})
