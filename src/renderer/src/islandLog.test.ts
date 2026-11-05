import { describe, expect, it } from 'vitest'
import { storageWakesApp } from './islandLog'

describe('what wakes the app window', () => {
  it("an embedded app's data and a full clear do; the island's logs and small settings don't", () => {
    expect(storageWakesApp('life_sport_tracker_v1')).toBe(true)
    expect(storageWakesApp('finance-helper.state')).toBe(true)
    expect(storageWakesApp(null)).toBe(true)
    expect(storageWakesApp('ls.islandUiLog')).toBe(false)
    expect(storageWakesApp('ls.islandLog')).toBe(false)
  })
})
