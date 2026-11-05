import { describe, expect, it } from 'vitest'
import { SentenceStream, keywordsFile, readPieces, speakable, spellWithPieces, stripWake, tidySpeech, wordsToNumbers } from './voiceText'

describe('wordsToNumbers', () => {
  it('reads spoken numbers', () => {
    expect(wordsToNumbers('start focus twenty five')).toBe('start focus 25')
    expect(wordsToNumbers('log five hundred ml')).toBe('log 500 ml')
    expect(wordsToNumbers('a hundred and fifty')).toBe('150')
    expect(wordsToNumbers('two fifty ml of water')).toBe('250 ml of water')
    expect(wordsToNumbers('ninety')).toBe('90')
  })
  it('keeps "a" and "an" as words, and reads hours', () => {
    expect(wordsToNumbers('add a task')).toBe('add a task')
    expect(wordsToNumbers('focus for half an hour')).toBe('focus for 30 minutes')
    expect(wordsToNumbers('focus for an hour')).toBe('focus for 60 minutes')
    expect(wordsToNumbers('an hour and a half')).toBe('90 minutes')
  })
})

describe('tidySpeech', () => {
  it('drops fillers and end marks, numbers as digits', () => {
    expect(tidySpeech('Um, can you start focus twenty five minutes please?')).toBe('start focus 25 min')
    expect(tidySpeech('Log five hundred millilitres.')).toBe('log 500 ml')
  })
})

describe('stripWake', () => {
  it('finds "Hey Ben" the ways speech-to-text writes it', () => {
    expect(stripWake('Hey Ben, start focus 25')).toEqual({ woke: true, rest: 'start focus 25' })
    expect(stripWake('hey been what is next')).toEqual({ woke: true, rest: 'what is next' })
    expect(stripWake('Hi Ben.')).toEqual({ woke: true, rest: '' })
    expect(stripWake('Ben, add water')).toEqual({ woke: true, rest: 'add water' })
  })
  it('is not fooled by ordinary sentences', () => {
    expect(stripWake('Hey, been there done that').woke).toBe(false)
    expect(stripWake('Been there').woke).toBe(false)
    expect(stripWake('hey you').woke).toBe(false)
    expect(stripWake('then we went home').woke).toBe(false)
  })
})

describe('speakable', () => {
  it('strips emoji, links, markup and tags', () => {
    expect(speakable('😤 <b>Victor</b>, 2/3 done → *one* more! https://x.y/z')).toBe('Victor, 2/3 done to one more! the link')
    expect(speakable('Water 1500 ml · focus 50 min')).toBe('Water 1500 millilitres, focus 50 minutes')
    expect(speakable('🔥🔥')).toBe('')
  })
})

describe('SentenceStream', () => {
  it('gives whole sentences as the reply grows', () => {
    const s = new SentenceStream()
    expect(s.push('Good')).toEqual([])
    expect(s.push('Good job, Victor. You did')).toEqual(['Good job, Victor.'])
    expect(s.push('Good job, Victor. You did 3 blocks! Now')).toEqual(['You did 3 blocks!'])
    expect(s.end('Good job, Victor. You did 3 blocks! Now rest')).toEqual(['Now rest'])
  })
  it('does not cut at "e.g." or decimals', () => {
    const s = new SentenceStream()
    expect(s.push('Drink 2.5 l today, e.g. now. Then')).toEqual(['Drink 2.5 l today, e.g. now.'])
  })
  it('cuts a very long sentence at a comma so speaking starts fast', () => {
    const s = new SentenceStream(80)
    const long = 'This is a long line about your day and your plan, with many parts and more words after it that keep going'
    const out = s.push(long)
    expect(out.length).toBe(1)
    expect(out[0].endsWith(',')).toBe(true)
  })
  it('skips pieces with nothing to say (emoji only)', () => {
    const s = new SentenceStream()
    expect(s.push('😎! Nice work. ')).toEqual(['Nice work.'])
  })
})

describe('wake word pieces', () => {
  const pieces = readPieces('<blk> 0\n▁HE 1\nY 2\n▁BEN 3\n▁B 4\nE 5\nN 6\n▁HEY 7\n▁O 8\nK 9\n')
  it('spells with the fewest pieces', () => {
    expect(spellWithPieces('hey ben', pieces)).toEqual(['▁HEY', '▁BEN'])
    expect(spellWithPieces('hey ben', new Set(['▁HE', 'Y', '▁B', 'E', 'N']))).toEqual(['▁HE', 'Y', '▁B', 'E', 'N'])
    expect(spellWithPieces('zed', pieces)).toBeNull()
  })
  it('writes the keywords file', () => {
    expect(keywordsFile(['hey ben', 'zed'], pieces, { boost: 1.5, threshold: 0.25 })).toBe('▁HEY ▁BEN :1.5 #0.25 @HEY_BEN')
  })
})
