import { describe, expect, it } from 'vitest'
import {
  formatCleanCheckinResponse,
  formatHelpMessage,
  formatMetricResponse,
  formatSportResponse,
  formatSportStatusResponse,
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

  it('parses sport shortcuts and commands', () => {
    const runRes = parseTelegramText('/run 5km')
    expect(runRes.type).toBe('sport')
    expect(runRes.exerciseName).toBe('Running')
    expect(runRes.exerciseAmount).toBe(5)
    expect(runRes.exerciseUnit).toBe('km')

    const boxRes = parseTelegramText('/boxing 45m')
    expect(boxRes.type).toBe('sport')
    expect(boxRes.exerciseName).toBe('Boxing')
    expect(boxRes.exerciseAmount).toBe(45)
    expect(boxRes.exerciseUnit).toBe('minutes')

    const sportGen = parseTelegramText('/sport football 90m')
    expect(sportGen.type).toBe('sport')
    expect(sportGen.exerciseName).toBe('Football')
    expect(sportGen.exerciseAmount).toBe(90)

    const sportStatus = parseTelegramText('/sport status')
    expect(sportStatus.type).toBe('sport_status')
  })

  it('parses body weight, waist and PR commands', () => {
    const weightRes = parseTelegramText('/weight 74.5kg')
    expect(weightRes.type).toBe('weight')
    expect(weightRes.metricWeight).toBe(74.5)

    const waistRes = parseTelegramText('/waist 82')
    expect(waistRes.type).toBe('waist')
    expect(waistRes.metricWaist).toBe(82)

    const prRes = parseTelegramText('/pr bench 100kg')
    expect(prRes.type).toBe('pr')
    expect(prRes.prExercise).toBe('bench')
    expect(prRes.prValue).toBe('100kg')
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
    expect(help).toContain('/sport')

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

    const sportRes = formatSportResponse('Running', 5, 'km', 4, 15, 35)
    expect(sportRes).toContain('HUNTER ATHLETIC LOG')
    expect(sportRes).toContain('Running (5 km)')
    expect(sportRes).toContain('+15 🪙 Coins')

    const metricRes = formatMetricResponse('weight', 74.5, 'kg', 5, 15)
    expect(metricRes).toContain('BODY COMPOSITION LOGGED')
    expect(metricRes).toContain('74.5 kg')

    const sportStatus = formatSportStatusResponse({
      streak: 5,
      totalWorkouts: 24,
      thisWeek: 3,
      latestWeight: 75,
      latestWaist: 82
    })
    expect(sportStatus).toContain('HUNTER ATHLETIC STATUS')
    expect(sportStatus).toContain('75 kg')

    const workout = formatWorkoutResponse('pushups', 50, 5, 10)
    expect(workout).toContain('50 pushups')
    expect(workout).toContain('+10 coins')

    const urge = formatUrgeResponse()
    expect(urge).toContain('URGE CRUSHER')
  })
})
