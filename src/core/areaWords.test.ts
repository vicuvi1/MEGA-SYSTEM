import { describe, expect, it } from 'vitest'
import { areaFromWords, learnAreaWords } from './areaWords'

describe('remember where tasks go (B17)', () => {
  it('learns from picks and only answers when sure', () => {
    const names = ['University', 'Home', 'Career']
    let m = learnAreaWords({}, 'Algebra homework chapter 4', 'University')
    expect(areaFromWords(m, 'algebra exercises', names)).toBeNull() // seen once
    m = learnAreaWords(m, 'Algebra exam prep', 'University')
    expect(areaFromWords(m, 'algebra exercises', names)).toBe('University')
    m = learnAreaWords(learnAreaWords(m, 'kitchen clean', 'Home'), 'kitchen sink', 'Home')
    expect(areaFromWords(m, 'clean the kitchen', names)).toBe('Home')
    expect(areaFromWords(m, 'something brand new', names)).toBeNull()
    expect(areaFromWords(m, 'algebra', ['Home'])).toBeNull() // area no longer exists
  })
})
