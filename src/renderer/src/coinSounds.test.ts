import { describe, expect, it } from 'vitest'
import { coinSoundHidden } from './soundKit'

describe('coin sounds when coins are hidden', () => {
  it('coin, spend and reward are skipped', () => {
    for (const n of ['coin', 'spend', 'reward'] as const) expect(coinSoundHidden(n, false)).toBe(true)
  })
  it('other sounds still play', () => {
    for (const n of ['success', 'habit', 'tick', 'focusEnd'] as const) expect(coinSoundHidden(n, false)).toBe(false)
  })
  it('turning coins on restores them; previews always play', () => {
    expect(coinSoundHidden('coin', true)).toBe(false)
    expect(coinSoundHidden('coin', false, true)).toBe(false)
  })
})
