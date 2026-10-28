import { describe, expect, it } from 'vitest'
import {
  detectExpenseCategory,
  formatBalanceResponse,
  formatCleanCheckinResponse,
  formatExpenseResponse,
  formatHelpMessage,
  formatMetricResponse,
  formatSportResponse,
  formatSportStatusResponse,
  formatTodayStatus,
  formatUrgeResponse,
  formatWorkoutResponse,
  parseTelegramText,
  tryParseNaturalExpense
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

  it('parses natural language expenses like "coffee 35", "35 coffee", "taxi 50"', () => {
    // Note first, amount last
    const coffeeRes = parseTelegramText('coffee 35')
    expect(coffeeRes.type).toBe('expense')
    expect(coffeeRes.expenseAmount).toBe(35)
    expect(coffeeRes.expenseCategory).toBe('food')
    expect(coffeeRes.expenseNote).toBe('coffee')

    // Amount first, note last
    const taxiRes = parseTelegramText('50 taxi')
    expect(taxiRes.type).toBe('expense')
    expect(taxiRes.expenseAmount).toBe(50)
    expect(taxiRes.expenseCategory).toBe('transport')
    expect(taxiRes.expenseNote).toBe('taxi')

    // With currency suffix
    const lunchRes = parseTelegramText('lunch with alex 120 mdl')
    expect(lunchRes.type).toBe('expense')
    expect(lunchRes.expenseAmount).toBe(120)
    expect(lunchRes.expenseCategory).toBe('food')
    expect(lunchRes.expenseNote).toBe('lunch with alex')

    // Income
    const incomeRes = parseTelegramText('+500 freelance project')
    expect(incomeRes.type).toBe('expense')
    expect(incomeRes.expenseAmount).toBe(500)
    expect(incomeRes.expenseCategory).toBe('income')
    expect(incomeRes.expenseNote).toBe('freelance project')

    // Groceries
    const grocRes = parseTelegramText('groceries 250 lei')
    expect(grocRes.type).toBe('expense')
    expect(grocRes.expenseAmount).toBe(250)
    expect(grocRes.expenseCategory).toBe('food')
  })

  it('parses /balance and /accounts commands', () => {
    expect(parseTelegramText('/balance').type).toBe('balance')
    expect(parseTelegramText('balance').type).toBe('balance')
    expect(parseTelegramText('/accounts').type).toBe('balance')
  })

  it('formats expense response with finance sync info', () => {
    const formatted = formatExpenseResponse('35.00 MDL', 'food', 'coffee', '115.00 MDL', 3, {
      synced: true,
      totalBalance: '14,250.00 MDL',
      accountName: 'Main Card'
    })
    expect(formatted).toContain('Expense Recorded & Synced to Finance Helper!')
    expect(formatted).toContain('35.00 MDL · <i>coffee</i>')
    expect(formatted).toContain('<b>Finance App Ledger:</b> Synced ✅ [Main Card] (Total: <b>14,250.00 MDL</b>)')
  })

  it('formats comprehensive multi-account balance response', () => {
    const balanceReply = formatBalanceResponse({
      currency: 'MDL',
      walletCoins: 1250,
      walletCoinsValueMdl: 125,
      vaultSurplusMdl: 2800,
      financeAccountsTotalMdl: 15400,
      financeAccounts: [
        { name: 'MAIB Card', balanceMdl: 12400, currency: 'MDL' },
        { name: 'Cash Wallet', balanceMdl: 3000, currency: 'MDL' }
      ],
      dailyBudgetLeftMdl: 180
    })
    expect(balanceReply).toContain('FINANCIAL BALANCE & ASSET OVERVIEW')
    expect(balanceReply).toContain('<b>MAIB Card:</b> 12400.00 MDL')
    expect(balanceReply).toContain('<b>Accounts Total:</b> <b>15400.00 MDL</b>')
    expect(balanceReply).toContain('1250 Coins')
    expect(balanceReply).toContain('2800.00 MDL')
  })
})
