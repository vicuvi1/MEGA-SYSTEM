import { describe, expect, it } from 'vitest'
import { EMPTY_ISLAND, type IslandSnapshot } from './islandModel'
import { matchMustdo, parseVoiceCommand, voiceAnswer } from './voiceCommands'

const NOW = new Date(2026, 10, 5, 13, 30).getTime()
const chips = { water: [250, 500], reps: [10], focus: [25] }
const snap = (x: Partial<IslandSnapshot> = {}): IslandSnapshot => ({
  ...EMPTY_ISLAND,
  at: NOW,
  locked: false,
  water: { ml: 750, target: 2500 },
  reps: [{ id: 'pu', name: 'Push-ups', done: 10, target: 50 }],
  mustdos: [
    { i: 0, text: 'Read chapter 4', done: false },
    { i: 1, text: 'Gym session', done: true },
    { i: 2, text: 'Call the bank', done: false }
  ],
  ...x
})
const running = { subject: 'Algebra', startedAt: NOW - 10 * 60_000, endsAt: NOW + 15 * 60_000 }
const parse = (t: string, x: Partial<IslandSnapshot> = {}) => parseVoiceCommand(t, { snap: snap(x), chips, now: NOW })

describe('voice commands: focus', () => {
  it('starts focus with your length and subject', () => {
    expect(parse('start focus twenty five')).toMatchObject({ kind: 'action', action: { kind: 'start', minutes: 25, subject: 'Focus', flow: true } })
    expect(parse('Start focus 50 on algebra')).toMatchObject({ kind: 'action', action: { kind: 'start', minutes: 50, subject: 'algebra' } })
    expect(parse('start a 50 minute timer')).toMatchObject({ kind: 'action', action: { kind: 'start', minutes: 50 } })
    expect(parse('focus on rust for 25 minutes')).toMatchObject({ kind: 'action', action: { kind: 'start', minutes: 25, subject: 'rust' } })
  })
  it('"start focus" alone takes your first focus chip and the block on now', () => {
    const now = { title: 'CTF practice', start: NOW - 60_000, end: NOW + 3600_000 }
    expect(parse('start focus', { now })).toMatchObject({ kind: 'action', action: { kind: 'start', minutes: 25, subject: 'CTF practice' } })
  })
  it('a timer already running is said, not started twice', () => {
    expect(parse('start focus 25', { running })).toEqual({ kind: 'say', text: 'Your timer is already running.' })
  })
  it('stops, pauses, resumes and extends the running timer', () => {
    expect(parse('stop focus', { running })).toMatchObject({ kind: 'action', action: { kind: 'stop' } })
    expect(parse("I'm done", { running })).toMatchObject({ kind: 'action', action: { kind: 'stop' } })
    expect(parse('pause the timer', { running })).toMatchObject({ kind: 'action', action: { kind: 'pause' } })
    expect(parse('resume', { running: { ...running, pausedAt: NOW - 60_000 } })).toMatchObject({ kind: 'action', action: { kind: 'resume' } })
    expect(parse('add five minutes', { running })).toMatchObject({ kind: 'action', action: { kind: 'extend', minutes: 5 } })
  })
  it('with no timer: says so', () => {
    expect(parse('stop focus')).toEqual({ kind: 'say', text: 'No timer is running.' })
    expect(parse('add 5 minutes')).toEqual({ kind: 'say', text: 'No timer is running.' })
  })
})

describe('voice commands: logging only what you say you did', () => {
  it('water: your chip, or the amount you said', () => {
    expect(parse('add water')).toMatchObject({ kind: 'action', action: { kind: 'water', ml: 250 } })
    expect(parse('log five hundred ml of water')).toMatchObject({ kind: 'action', action: { kind: 'water', ml: 500 } })
    expect(parse('I drank two glasses of water')).toMatchObject({ kind: 'action', action: { kind: 'water', ml: 500 } })
  })
  it('sleep: bed and wake, with a time when said', () => {
    expect(parse('going to bed')).toMatchObject({ kind: 'action', action: { kind: 'bed' } })
    expect(parse('going to bed at 23:40')).toMatchObject({ kind: 'action', action: { kind: 'bed', time: '23:40' } })
    expect(parse("I'm up")).toMatchObject({ kind: 'action', action: { kind: 'wake' } })
  })
  it('reps, money and tasks go through the command bar rules', () => {
    expect(parse('I did thirty push ups')).toMatchObject({ kind: 'action', action: { kind: 'chat', text: '30 pushups' } })
    expect(parse('add task call mom tomorrow')).toMatchObject({ kind: 'action', action: { kind: 'chat', text: 'task call mom tomorrow' } })
    expect(parse('remind me to pay rent friday')).toMatchObject({ kind: 'action', action: { kind: 'chat', text: 'task pay rent friday' } })
    expect(parse('I spent 40 lei on a taxi')).toMatchObject({ kind: 'action', action: { kind: 'chat', text: 'spent 40 taxi' } })
  })
  it('a nap has no log of its own: Ben hears it (no points)', () => {
    expect(parse('log nap 20 minutes')).toEqual({ kind: 'ben', text: 'I took a 20 minute nap.' })
    expect(parse('I took a twenty minute nap')).toEqual({ kind: 'ben', text: 'I took a 20 minute nap.' })
  })
  it('a must-do only when it clearly matches and is not done yet', () => {
    expect(parse('I finished reading chapter 4')).toMatchObject({ kind: 'action', action: { kind: 'mustdo', i: 0 } })
    expect(parse('done with the gym session').kind).not.toBe('action')
    expect(matchMustdo('something else', snap().mustdos)).toBeNull()
  })
})

describe('voice commands: spoken-only and Ben', () => {
  it('answers what is next from the island', () => {
    expect(parse("what's next")).toEqual({ kind: 'answer', topic: 'next' })
    const next = { title: 'Networks lecture', start: NOW + 30 * 60_000, end: NOW + 120 * 60_000 }
    expect(voiceAnswer('next', snap({ next }), NOW)).toBe('Next: Networks lecture, at 14:00, in 30 minutes.')
    expect(voiceAnswer('next', snap(), NOW)).toBe('Nothing else in your calendar today.')
    expect(voiceAnswer('focus', snap({ running }), NOW)).toBe('15 minutes left on Algebra.')
    expect(voiceAnswer('water', snap(), NOW)).toBe('750 of 2500 millilitres today.')
    expect(voiceAnswer('time', snap(), NOW)).toBe("It's 13:30.")
  })
  it('media keys, quiet, open a page, never mind', () => {
    expect(parse('pause music')).toMatchObject({ kind: 'media', key: 'playpause' })
    expect(parse('next song')).toMatchObject({ kind: 'media', key: 'next' })
    expect(parse('volume down')).toMatchObject({ kind: 'media', key: 'voldown' })
    expect(parse('be quiet for 30 minutes')).toMatchObject({ kind: 'quiet', minutes: 30 })
    expect(parse('open calendar')).toMatchObject({ kind: 'action', action: { kind: 'open', page: 'calendar' } })
    expect(parse('never mind')).toEqual({ kind: 'cancel' })
  })
  it('anything else goes to Ben as you said it', () => {
    expect(parse('How did my week go?')).toEqual({ kind: 'ben', text: 'How did my week go?' })
    expect(parse('I feel lazy today, push me')).toEqual({ kind: 'ben', text: 'I feel lazy today, push me' })
    // A loose word never ticks a Todoist task by itself.
    expect(parse('call mom').kind).toBe('ben')
  })
})
