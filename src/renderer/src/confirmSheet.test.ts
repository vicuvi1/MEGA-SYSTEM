import { describe, expect, it } from 'vitest'
import { askConfirm } from './confirmSheet'

describe('confirm sheet', () => {
  it('a new question answers the open one "no"', async () => {
    const first = askConfirm('Delete it?')
    void askConfirm('Something else?')
    expect(await first).toBe(false)
  })
})
