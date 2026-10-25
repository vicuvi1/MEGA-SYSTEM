import { addDays, dayKey } from '@core/dates'
import type { ConnectionsState, LifeApi } from '@shared/api'

/** Browser demo: pretend Waky, Finance Helper and MAN were found on this PC. */
export function createMockConnections(): Pick<LifeApi, 'connections'> {
  const today = dayKey(new Date())
  let wakySince: string | null = null
  let finSince: string | null = null
  let budget = 150
  const times = ['06:32', '06:28', '06:51', '06:30', '06:25', '07:10', '06:33', '06:29', '06:40', '06:31']
  const mornings = times.map((time, i) => {
    const target = '06:30'
    const [h, m] = time.split(':').map(Number)
    return { day: addDays(today, -i), time, target, onTime: h * 60 + m <= 6 * 60 + 40, sleptMin: 400 + ((i * 37) % 80) }
  })
  const spend = [7000, 18000, 0, 9500, 31000, 12000, 0, 8800, 14000, 6000, 0, 22000, 9000, 11000]

  const state = (): ConnectionsState => ({
    today,
    lastSync: new Date().toISOString(),
    waky: {
      path: 'C:\\Users\\you\\Waky-\\data\\waky.json',
      found: true,
      error: null,
      connectedSince: wakySince,
      weekday: '06:30',
      weekend: '07:30',
      today: { time: '06:32', target: '06:30', onTime: true },
      streak: 4,
      best: 6,
      onTimeRate: mornings.filter((m) => m.onTime).length / mornings.length,
      mornings,
      avgSleepMin: 431
    },
    finance: {
      path: 'G:\\My Drive\\Finance Helper\\finance-helper-sync.json',
      found: true,
      error: null,
      connectedSince: finSince,
      currency: 'MDL',
      savedAt: new Date(Date.now() - 3600_000).toISOString(),
      staleDays: 0,
      dailyBudget: budget,
      today: { logged: true, everydaySpent: 7000 },
      month: { spent: 482000, everyday: 168000, income: 900000, days: 19 },
      days: spend.map((s, i) => ({ day: addDays(today, -i), logged: s > 0, everydaySpent: s, judged: i > 0 }))
    },
    man: {
      path: 'C:\\Users\\you\\ManDesktop\\profile',
      found: true,
      error: null,
      data: { streakDays: 10, longestStreak: 10, totalVictories: 9, lastCheckin: today, urgesCrushed: 4, oathsSworn: 6 },
      suggestion: { start: addDays(today, -10), showsDays: 10, lastTapDaysAgo: 0, note: 'MAN once added a day to fix a bug (9 check-ins for a 10-day streak). If that is not right, start one day later.' }
    }
  })

  return {
    connections: {
      state: async () => state(),
      connect: async (kind) => {
        if (kind === 'waky') wakySince = today
        else finSince = today
        return state()
      },
      disconnect: async (kind) => {
        if (kind === 'waky') wakySince = null
        else finSince = null
        return state()
      },
      sync: async () => ({ awarded: 0, state: state() }),
      choosePath: async () => state(),
      setDailyBudget: async (amount) => {
        budget = amount
        return state()
      }
    }
  }
}
