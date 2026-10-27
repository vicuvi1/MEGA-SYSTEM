import { describe, expect, it } from 'vitest'
import {
  formatCleanCheckinResponse,
  formatHelpMessage,
  formatTodayStatus,
  formatUrgeResponse,
  formatWorkoutResponse,
  parseTelegramText
} from './botCommands'

describe('botCommands core parser', () => {
  it('parses commands with or without slash and handles bot handles', () => {
    expect(parseTelegramText('/today').type).toBe('today')
    expect(parseTelegramText('today').type).toBe('today')
    expect(parseTelegramText('/status@LifeSystemBot').type).toBe('today')
    expect(parseTelegramText('/help').type).toBe('help')
    expect(parseTelegramText('/start').type).toBe('help')
  })

  it('parses exercise shortcuts like /pushups 50', () => {
    const res = parseTelegramText('/pushups 40')
    expect(res.type).toBe('workout')
    expect(res.exerciseName).toBe('pushups')
    expect(res.exerciseAmount).toBe(40)
  })

  it('parses workout with args like /workout 50 squats', () => {
    const res = parseTelegramText('/workout 50 squats')
    expect(res.type).toBe('workout')
    expect(res.exerciseName).toBe('squats')
    expect(res.exerciseAmount).toBe(50)
  })

  it('parses expense command with amount, category and note', () => {
    const res = parseTelegramText('/expense 45.50 food lunch at cafe')
    expect(res.type).toBe('expense')
    expect(res.expenseAmount).toBe(45.5)
    expect(res.expenseCategory).toBe('food')
    expect(res.expenseNote).toBe('lunch at cafe')
  })

  it('parses tasks and done commands', () => {
    expect(parseTelegramText('/tasks').type).toBe('tasks')
    const doneRes = parseTelegramText('/done 3')
    expect(doneRes.type).toBe('done')
    expect(doneRes.taskIndex).toBe(3)
  })

  it('formats rich responses with HTML formatting', () => {
    const help = formatHelpMessage()
    expect(help).toContain('Life System')
    expect(help).toContain('/checkin')

    const status = formatTodayStatus({
      balance: 150,
      level: 10,
      rank: 'Spartan',
      totalXp: 850,
      ritualsDone: 5,
      totalRituals: 5,
      cleanStreak: 12,
      workoutStreak: 4,
      tasksLeft: 0
    })
    expect(status).toContain('150 coins')
    expect(status).toContain('All daily rituals complete')

    const workout = formatWorkoutResponse('pushups', 50, 5, 10)
    expect(workout).toContain('50 pushups')
    expect(workout).toContain('+10 coins')

    const urge = formatUrgeResponse()
    expect(urge).toContain('URGE CRUSHER')
  })
})
