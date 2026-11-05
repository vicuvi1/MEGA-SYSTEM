import { describe, expect, it } from 'vitest'
import { startsNow } from './startNow'

describe('focus starts only when you mean now (X10)', () => {
  it('now', () => {
    for (const t of ['start', "let's go", 'start 50 min algebra', 'focus now', 'ok start the timer']) expect(startsNow(t), t).toBe(true)
  })
  it('not now', () => {
    for (const t of ["I'll start at 5", 'going to start studying later', 'start tomorrow', 'I want to begin after lunch', 'how are you', 'will start in 20 min']) expect(startsNow(t), t).toBe(false)
  })
})
