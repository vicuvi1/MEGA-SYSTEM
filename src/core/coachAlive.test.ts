import { describe, expect, it } from 'vitest'
import { benFeel, bigMoment, dayPhase, goodNews, greeting, willHint, wordStep } from './coachAlive'

describe('dayPhase', () => {
  it('follows the clock', () => {
    expect(dayPhase(6)).toBe('dawn')
    expect(dayPhase(12)).toBe('day')
    expect(dayPhase(19)).toBe('dusk')
    expect(dayPhase(23)).toBe('night')
    expect(dayPhase(2)).toBe('night')
    expect(dayPhase(-1)).toBe('night')
  })
})

describe('benFeel', () => {
  it('a finished thing beats everything, then focus, then late night', () => {
    expect(benFeel({ hour: 23, cheering: true, focusing: true })).toBe('happy')
    expect(benFeel({ hour: 23, cheering: false, focusing: true })).toBe('focused')
    expect(benFeel({ hour: 23, cheering: false, focusing: false })).toBe('sleepy')
    expect(benFeel({ hour: 10, cheering: false, focusing: false })).toBe('calm')
  })
  it('takes his mood from a hard or a proud reply', () => {
    expect(benFeel({ hour: 10, cheering: false, focusing: false, replyMood: 'angry' })).toBe('stern')
    expect(benFeel({ hour: 10, cheering: false, focusing: false, replyMood: 'proud' })).toBe('happy')
  })
})

describe('willHint', () => {
  it('reads water in ml and litres', () => {
    expect(willHint('water 500')).toBe('Log 500 ml of water')
    expect(willHint('water 1.5 l')).toBe('Log 1.5 L of water')
    expect(willHint('500 ml water')).toBe('Log 500 ml of water')
    expect(willHint('/water 300')).toBe('Log 300 ml of water')
    expect(willHint('water 2')).toBe('Log 2 L of water')
  })
  it('reads reps, focus, tasks, goals, money and sleep', () => {
    expect(willHint('20 pushups')).toBe('Log 20 push-ups')
    expect(willHint('squats 30')).toBe('Log 30 squats')
    expect(willHint('focus 25 algebra')).toBe('Start 25 min of focus on algebra')
    expect(willHint('task call the dentist')).toBe('Add a task: call the dentist')
    expect(willHint('goal: read 12 books by June')).toBe('Draft a goal: read 12 books by June')
    expect(willHint('spent 45 on lunch')).toBe('Log 45 spent on lunch')
    expect(willHint('slept 7h')).toBe('Log 7 h of sleep')
    expect(willHint('/plan')).toBe('Plan your day around your calendar')
    expect(willHint('approve the plan')).toBe("Approve today's plan")
  })
  it('stays quiet for normal talk', () => {
    expect(willHint('how was my week?')).toBeNull()
    expect(willHint('w')).toBeNull()
    expect(willHint('/nope')).toBeNull()
  })
})

describe('bigMoment', () => {
  it('plan approved, streaks and goal milestones are moments', () => {
    expect(bigMoment({ done: ['✅ Plan approved: 3 blocks in your calendar'] })?.kind).toBe('plan')
    expect(bigMoment({ text: "That's a 7-day streak. Respect." })?.title).toBe('7-day streak')
    expect(bigMoment({ done: ['🎯 Goal "Read 12 books" 50% done'] })?.kind).toBe('goal')
  })
  it('small logs and warnings are not', () => {
    expect(bigMoment({ done: ['💧 Water +250 ml · 1.0/2.7 L'] })).toBeNull()
    expect(bigMoment({ done: ['⚠️ Plan approved? no'] })).toBeNull()
    expect(bigMoment({ text: 'a 2-day streak' })).toBeNull()
  })
  it('goodNews skips warnings', () => {
    expect(goodNews(['⚠️ Nothing changed'])).toBe(false)
    expect(goodNews(['💧 Water +250 ml'])).toBe(true)
    expect(goodNews(undefined)).toBe(false)
  })
})

describe('greeting and word steps', () => {
  it('greets by the part of the day with the first name', () => {
    expect(greeting(8, 'Alex Morgan')).toBe('Morning, Alex')
    expect(greeting(14, '')).toBe('Afternoon')
    expect(greeting(19, null)).toBe('Evening')
    expect(greeting(1, 'Alex')).toBe('Up late, Alex')
  })
  it('reveals a long reply faster per word', () => {
    expect(wordStep(10)).toBe(34)
    expect(wordStep(200)).toBe(10)
  })
})
