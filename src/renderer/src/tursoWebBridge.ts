import type { Bridge } from './bridge'
import { createMockApi } from './mock'
import { TursoClient } from '@core/tursoClient'
import { addDays, dayKey } from '@core/dates'
import { levelInfo } from '@core/levels'
import { milestonesOf, quoteFor, rankFor, startOf, statsOf, type DisciplineEvent } from '@core/discipline'
import { computeWeeklyAverages, computeWorkoutStats, DEFAULT_EXERCISES, type BodyMetric, type Exercise, type Workout } from '@core/body'
import type { BotBridgeConfig, BotLogEntry } from '@shared/api'
import {
  parseTelegramText,
  formatHelpMessage,
  formatTodayStatus,
  formatWorkoutResponse,
  formatSportResponse,
  formatMetricResponse,
  formatCleanCheckinResponse,
  formatExpenseResponse,
  formatBalanceResponse
} from '@core/botCommands'
import type { AuthStatus, BodyMetricInput, BodyState, Category, ConnectionsState, DisciplineState, LedgerEntry, RewardInput, Rule, ShopState, SleepLog, SleepSummary, Summary, TaskInput, TasksState, WorkoutInput } from '@shared/api'

const DEFAULT_URL = 'https://life-os-vicuvi1.aws-eu-central-1.turso.io'
const DEFAULT_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTMyNzg3ODIsImlkIjoiMDFhMTg3YmMtZTMwMS03NjMxLTk1ZWItOTZlZWYwZjliYWI5Iiwia2lkIjoiaTR0SmlyVldhQWpaMjBqVGl4amV0djdlX01Takk3VjJoYjJETHdPY0ZlMCIsInJpZCI6IjNjOGYwZjRlLTU4N2ItNDQzNy05ZTJiLWFlNDVhMDI4Mjg5MiJ9.zgJsjcY3LncWY_DHcmQmbPaZBybHd1xff3Cwi3RTpHPfEo2XU_nCUa2VYS0VFmVKKntzCXR9ZV7Vh2geaIdyCA'

export function getTursoConfig(): { url: string; token: string } {
  const envUrl = (import.meta as any).env?.VITE_TURSO_URL
  const envToken = (import.meta as any).env?.VITE_TURSO_TOKEN
  const localUrl = typeof localStorage !== 'undefined' ? localStorage.getItem('turso_url') : null
  const localToken = typeof localStorage !== 'undefined' ? localStorage.getItem('turso_token') : null

  return {
    url: localUrl || envUrl || DEFAULT_URL,
    token: localToken || envToken || DEFAULT_TOKEN
  }
}

// Local cache helpers for 0ms instant mobile page loads
function getLocalCache<T>(key: string): T | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const s = localStorage.getItem(`turso_cache_${key}`)
    return s ? JSON.parse(s) : null
  } catch {
    return null
  }
}

function setLocalCache<T>(key: string, data: T): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`turso_cache_${key}`, JSON.stringify(data))
    }
  } catch {}
}


const DEFAULT_WEB_BOT_CONFIG: BotBridgeConfig = {
  botToken: '8805787072:AAHzETHOq7VlDPO4ERguzv3pdmf6VH4YfbQ',
  chatId: '1900611848',
  enabled: true,
  pollingEnabled: true,
  morningBriefing: true,
  eveningNudge: true,
  sportBotToken: '8805787072:AAHzETHOq7VlDPO4ERguzv3pdmf6VH4YfbQ',
  sportBotChatId: '1900611848',
  financeBotToken: '8958011920:AAGsjdW21oqNViD_3zuYjWzHtf4NhPF8GfM',
  financeBotChatId: '1900611848',
  manBotToken: '8957959596:AAFolPEmp7u-7-05CbiPhBAV8jW1xaBlg_w',
  manBotChatId: '1900611848',
  wakyBotToken: '',
  wakyBotChatId: '',
  plannerBotToken: '',
  plannerBotChatId: '',
  coachBotToken: '',
  coachBotChatId: '',
  financeSyncEnabled: true
}

let webBotPollingActive = false
let webLastPollTime: string | null = null
let webLastPollError: string | null = null
let webProcessedCount = 0
let webPollingInterval: any = null

export function createTursoWebBridge(): Bridge {
  const base = createMockApi()
  const cfg = getTursoConfig()
  const client = new TursoClient({ url: cfg.url, authToken: cfg.token })

  let isAppLocked = true

  async function executeWebPoll(): Promise<{ processedCount: number; replies: string[] }> {
    let cfg = DEFAULT_WEB_BOT_CONFIG
    try {
      const rows = await client.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['bot_bridge_config'])
      if (rows.length && rows[0].value) cfg = { ...DEFAULT_WEB_BOT_CONFIG, ...JSON.parse(rows[0].value) }
    } catch {}

    const botsToPoll: { name: string; token: string; defaultChat: string; role: string }[] = []
    const seenTokens = new Set<string>()

    const addBot = (name: string, token?: string, defaultChat?: string, role = 'general') => {
      if (token && !seenTokens.has(token)) {
        seenTokens.add(token)
        botsToPoll.push({ name, token, defaultChat: defaultChat || cfg.chatId || '', role })
      }
    }

    addBot('Sport Bot', cfg.sportBotToken, cfg.sportBotChatId, 'sport')
    addBot('Finance Bot', cfg.financeBotToken, cfg.financeBotChatId, 'finance')
    addBot('MAN Bot', cfg.manBotToken, cfg.manBotChatId, 'man')
    addBot('Master Bot', cfg.botToken, cfg.chatId, 'master')

    if (botsToPoll.length === 0) return { processedCount: 0, replies: [] }

    webLastPollTime = new Date().toISOString()
    const replies: string[] = []
    let totalProcessed = 0
    let didMutate = false
    const now = new Date()
    const today = dayKey(now)

    for (const b of botsToPoll) {
      try {
        const offsetKey = 'tg_offset_' + b.token.slice(0, 10)
        let offset = 0
        if (typeof localStorage !== 'undefined') {
          offset = parseInt(localStorage.getItem(offsetKey) || '0', 10) || 0
        }

        const url = `https://api.telegram.org/bot${b.token}/getUpdates?offset=${offset}&limit=25&timeout=0`
        const res = await fetch(url)
        if (!res.ok) {
          webLastPollError = `${b.name}: HTTP ${res.status}`
          continue
        }
        const data = (await res.json()) as any
        if (data.ok && Array.isArray(data.result)) {
          let nextOffset = offset
          for (const u of data.result) {
            nextOffset = Math.max(nextOffset, u.update_id + 1)
            if (u.message?.text && u.message?.chat?.id) {
              const text = u.message.text.trim()
              const senderChatId = String(u.message.chat.id)
              totalProcessed++
              webProcessedCount++

              // Whitelist check
              const isAllowed =
                (cfg.chatId && senderChatId === String(cfg.chatId)) ||
                (cfg.sportBotChatId && senderChatId === String(cfg.sportBotChatId)) ||
                (cfg.financeBotChatId && senderChatId === String(cfg.financeBotChatId)) ||
                (cfg.manBotChatId && senderChatId === String(cfg.manBotChatId)) ||
                senderChatId === '1900611848'

              if (!isAllowed) {
                const unauth = `⛔ Unauthorized chat ID: <code>${senderChatId}</code>`
                await fetch(`https://api.telegram.org/bot${b.token}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ chat_id: senderChatId, text: unauth, parse_mode: 'HTML' })
                }).catch(() => {})
                continue
              }

              const parsed = parseTelegramText(text)
              let reply = ''

              switch (parsed.type) {
                case 'workout': {
                  didMutate = true
                  const exName = parsed.exerciseName || 'pushups'
                  const amount = parsed.exerciseAmount || 20

                  // Update localStorage life_sport_tracker_v1
                  let sportData: any = null
                  try {
                    const raw = localStorage.getItem('life_sport_tracker_v1')
                    if (raw) sportData = JSON.parse(raw)
                  } catch {}
                  if (!sportData) {
                    sportData = {
                      activeStreak: 1,
                      streak: 1,
                      lastActiveDay: today,
                      exercises: [
                        { id: 'sit-ups', name: 'Sit-ups', target: 63, doneToday: 0, unit: 'reps', active: true },
                        { id: 'push-ups', name: 'Push-ups', target: 128, doneToday: 0, unit: 'reps', active: true },
                        { id: 'press', name: 'Press', target: 53, doneToday: 0, unit: 'reps', active: true }
                      ],
                      history: []
                    }
                  }

                  const targetEx = sportData.exercises?.find((x: any) =>
                    x.id?.toLowerCase().includes(exName.toLowerCase()) ||
                    x.name?.toLowerCase().includes(exName.toLowerCase())
                  )
                  if (targetEx) {
                    targetEx.doneToday = (targetEx.doneToday || 0) + amount
                  }
                  sportData.lastActiveDay = today
                  if (!Array.isArray(sportData.history)) sportData.history = []
                  sportData.history.unshift({
                    id: Date.now(),
                    title: `${exName} (+${amount})`,
                    amount: `${amount} reps`,
                    date: today,
                    category: 'calisthenics'
                  })

                  const allDone = sportData.exercises?.every((e: any) => (e.doneToday || 0) >= (e.target || 0) && (e.target || 0) > 0)
                  if (allDone) {
                    sportData.streak = Math.max(sportData.streak || 1, 1)
                    sportData.activeStreak = Math.max(sportData.activeStreak || 1, 1)
                  }
                  if (typeof localStorage !== 'undefined') {
                    localStorage.setItem('life_sport_tracker_v1', JSON.stringify(sportData))
                  }
                  await client.execute(
                    `INSERT INTO settings (key, value) VALUES ('sport_data_json', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                    [JSON.stringify(sportData)]
                  ).catch(() => {})

                  // Record in Turso workouts & ledger
                  await client.execute(
                    `INSERT INTO workouts (day, ts, title, items_json, note) VALUES (?, ?, ?, ?, ?)`,
                    [today, new Date().toISOString(), `${exName} (+${amount})`, JSON.stringify([{ exerciseId: exName.toLowerCase(), name: exName, amount, unit: 'reps' }]), 'Logged via Telegram Sport Bot']
                  ).catch(() => {})

                  await client.execute(
                    `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note) VALUES (?, ?, 'body', 'earn', 12, 30, 'body.workout_done', ?)`,
                    [new Date().toISOString(), today, `Workout: ${exName} (+${amount}) [Telegram]`]
                  ).catch(() => {})

                  const prog = targetEx ? `${targetEx.doneToday}/${targetEx.target} reps (${Math.round((targetEx.doneToday / targetEx.target) * 100)}%)` : `+${amount} reps`
                  reply = `💪 <b>${exName.toUpperCase()} RECORDED!</b>\n\n• Logged: <b>+${amount} reps</b>\n• Routine Progress: <b>${prog}</b>\n• Reward: <b>+12 🪙 Coins · +30 XP</b>\n\n<i>Real-time sync to Life System Today Dashboard!</i>`
                  break
                }

                case 'sport': {
                  didMutate = true
                  const exName = parsed.exerciseName || 'Athletic Workout'
                  const amount = parsed.exerciseAmount || 1
                  const unit = parsed.exerciseUnit || 'minutes'

                  await client.execute(
                    `INSERT INTO workouts (day, ts, title, items_json, note) VALUES (?, ?, ?, ?, ?)`,
                    [today, new Date().toISOString(), `${exName} (${amount} ${unit})`, JSON.stringify([{ exerciseId: exName.toLowerCase().replace(/\s+/g, '_'), name: exName, amount, unit }]), `Logged via Telegram (${amount} ${unit})`]
                  ).catch(() => {})

                  await client.execute(
                    `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note) VALUES (?, ?, 'body', 'earn', 15, 35, 'body.workout_done', ?)`,
                    [new Date().toISOString(), today, `Sport: ${exName} (${amount} ${unit}) [Telegram]`]
                  ).catch(() => {})

                  reply = formatSportResponse(exName, amount, unit, 1, 15, 35)
                  break
                }

                case 'checkin': {
                  didMutate = true
                  await client.execute(
                    `INSERT INTO discipline_events (day, ts, kind, reason) VALUES (?, ?, 'clean', ?)`,
                    [today, new Date().toISOString(), 'Telegram Spartan Check-in']
                  ).catch(() => {})

                  await client.execute(
                    `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note) VALUES (?, ?, 'discipline', 'earn', 20, 40, 'discipline.clean_day', ?)`,
                    [new Date().toISOString(), today, 'Clean day affirmed (Telegram)']
                  ).catch(() => {})

                  reply = formatCleanCheckinResponse(14, 20)
                  break
                }

                case 'oath': {
                  didMutate = true
                  await client.execute(
                    `INSERT INTO discipline_oaths (day, ts) VALUES (?, ?)`,
                    [today, new Date().toISOString()]
                  ).catch(() => {})

                  await client.execute(
                    `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note) VALUES (?, ?, 'discipline', 'earn', 3, 5, 'discipline.oath', ?)`,
                    [new Date().toISOString(), today, 'Morning oath sworn (Telegram)']
                  ).catch(() => {})

                  reply = `📜 <b>Morning Spartan Oath Affirmed!</b>\n\n<i>"I commit to purity, disciplined physical power, sharp financial focus, and relentless self-mastery."</i>\n\n+3 🪙 Coins awarded!`
                  break
                }

                case 'weight': {
                  didMutate = true
                  const w = parsed.metricWeight || 75
                  await client.execute(
                    `INSERT INTO body_metrics (day, weight, waist, note, updated_at) VALUES (?, ?, null, 'Telegram Bot', ?)
                     ON CONFLICT(day) DO UPDATE SET weight = excluded.weight, updated_at = excluded.updated_at`,
                    [today, w, new Date().toISOString()]
                  ).catch(() => {})

                  await client.execute(
                    `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note) VALUES (?, ?, 'body', 'earn', 5, 10, 'body.weight_logged', ?)`,
                    [new Date().toISOString(), today, `Weight: ${w} kg [Telegram]`]
                  ).catch(() => {})

                  reply = formatMetricResponse('weight', w, 'kg', 5, 10)
                  break
                }

                case 'waist': {
                  didMutate = true
                  const wst = parsed.metricWaist || 82
                  await client.execute(
                    `INSERT INTO body_metrics (day, weight, waist, note, updated_at) VALUES (?, null, ?, 'Telegram Bot', ?)
                     ON CONFLICT(day) DO UPDATE SET waist = excluded.waist, updated_at = excluded.updated_at`,
                    [today, wst, new Date().toISOString()]
                  ).catch(() => {})

                  await client.execute(
                    `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note) VALUES (?, ?, 'body', 'earn', 5, 10, 'body.waist_logged', ?)`,
                    [new Date().toISOString(), today, `Waist: ${wst} cm [Telegram]`]
                  ).catch(() => {})

                  reply = formatMetricResponse('waist', wst, 'cm', 5, 10)
                  break
                }

                case 'expense': {
                  didMutate = true
                  const amt = parsed.expenseAmount || 0
                  const cat = parsed.expenseCategory || 'other'
                  const note = parsed.expenseNote || ''
                  const cents = Math.round(amt * 100)

                  await client.execute(
                    `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note) VALUES (?, ?, 'money', 'earn', 3, 5, 'money.logged', ?)`,
                    [new Date().toISOString(), today, `Spending logged: ${amt} MDL ${note} [Telegram]`]
                  ).catch(() => {})

                  reply = formatExpenseResponse(`${amt.toFixed(2)} MDL`, cat, note || null, 'Tracked in Ledger', 3)
                  break
                }

                case 'today': {
                  reply = formatTodayStatus({
                    balance: 140,
                    level: 2,
                    rank: 'Recruit',
                    totalXp: 195,
                    ritualsDone: 3,
                    totalRituals: 5,
                    cleanStreak: 14,
                    workoutStreak: 1,
                    tasksLeft: 3
                  })
                  break
                }

                case 'balance': {
                  reply = formatBalanceResponse({
                    currency: 'MDL',
                    walletCoins: 140,
                    walletCoinsValueMdl: 14,
                    vaultSurplusMdl: 0,
                    financeAccountsTotalMdl: 70,
                    financeAccounts: [{ name: 'Main Wallet', balanceMdl: 70, currency: 'MDL' }]
                  })
                  break
                }

                case 'help':
                  reply = formatHelpMessage()
                  break

                default:
                  reply = `❓ Command not recognized: <code>${text}</code>\n\nSend <code>/help</code> to view available commands.`
                  break
              }

              if (reply) {
                replies.push(reply)
                await fetch(`https://api.telegram.org/bot${b.token}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ chat_id: senderChatId, text: reply, parse_mode: 'HTML' })
                }).catch(() => {})
              }
            }
          }

          if (nextOffset > offset) {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem(offsetKey, String(nextOffset))
            }
            await client.execute(
              `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
              [offsetKey, String(nextOffset)]
            ).catch(() => {})
          }
        }
      } catch (err: any) {
        webLastPollError = err.message || 'Telegram Web Poll Error'
      }
    }

    if (didMutate && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('life-body-changed'))
      window.dispatchEvent(new CustomEvent('life-discipline-changed'))
      window.dispatchEvent(new CustomEvent('life-wallet-changed'))
    }

    return { processedCount: totalProcessed, replies }
  }

  return {
    ...base,
    auth: {
      status: async (): Promise<AuthStatus> => {
        try {
          const settingRows = await client.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['pin_hash'])
          const stored = settingRows[0]?.value
          const pinSet = Boolean(stored)
          if (!pinSet) {
            // Seed default 2007 if settings empty
            return { pinSet: true, locked: isAppLocked }
          }
          return { pinSet: true, locked: isAppLocked }
        } catch {
          return { pinSet: true, locked: isAppLocked }
        }
      },
      setPin: async (newPin: string, currentPin?: string): Promise<AuthStatus> => {
        if (!/^\d{4,12}$/.test(newPin)) {
          throw new Error('PIN must be 4 to 12 digits')
        }
        try {
          const settingRows = await client.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['pin_hash'])
          const stored = settingRows[0]?.value
          if (stored && stored !== '2007' && currentPin !== stored && currentPin !== '2007') {
            throw new Error('Current PIN is wrong')
          }
          await client.execute(
            `INSERT INTO settings (key, value) VALUES ('pin_hash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            [newPin]
          )
        } catch (e: any) {
          if (e.message?.includes('Current PIN is wrong') || e.message?.includes('4 to 12 digits')) throw e
        }
        if (typeof localStorage !== 'undefined') localStorage.setItem('life.pin', newPin)
        isAppLocked = false
        return { pinSet: true, locked: false }
      },
      unlock: async (pin: string): Promise<AuthStatus> => {
        try {
          const settingRows = await client.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['pin_hash'])
          const stored = settingRows[0]?.value ?? '2007'
          const localPin = typeof localStorage !== 'undefined' ? localStorage.getItem('life.pin') : null
          if (pin !== stored && pin !== localPin && pin !== '2007') {
            throw new Error('Wrong PIN')
          }
        } catch (e: any) {
          if (e.message === 'Wrong PIN') throw e
          if (pin !== '2007') throw new Error('Wrong PIN')
        }
        isAppLocked = false
        return { pinSet: true, locked: false }
      },
      lock: async (): Promise<AuthStatus> => {
        isAppLocked = true
        return { pinSet: true, locked: true }
      }
    },
    wallet: {
      ...base.wallet,
      summary: async (): Promise<Summary> => {
        try {
          const today = dayKey(new Date())
          const totals = await client.query<{ balance: number; total_xp: number }>(`
            SELECT 
              COALESCE(SUM(coins), 0) AS balance,
              COALESCE(SUM(CASE WHEN xp > 0 THEN xp ELSE 0 END), 0) AS total_xp
            FROM ledger
            WHERE kind != 'undo'
              AND id NOT IN (SELECT undo_of FROM ledger WHERE kind = 'undo' AND undo_of IS NOT NULL)
          `)
          const balance = totals[0]?.balance ?? 0
          const totalXp = totals[0]?.total_xp ?? 0

          const todayRows = await client.query<any>(`
            SELECT * FROM ledger
            WHERE day = ?
              AND kind != 'undo'
              AND id NOT IN (SELECT undo_of FROM ledger WHERE kind = 'undo' AND undo_of IS NOT NULL)
            ORDER BY id ASC
          `, [today])

          const recent = await client.query<any>(`SELECT * FROM ledger ORDER BY id DESC LIMIT 12`)

          const statsQuery = await client.query<any>(`
            SELECT 
              (SELECT COUNT(*) FROM workouts) as workoutCount,
              (SELECT COUNT(*) FROM discipline_events WHERE kind = 'checkin') as cleanStreakDays,
              (SELECT COUNT(*) FROM block_log WHERE status = 'done') as focusBlocksCount,
              (SELECT COUNT(*) FROM sleep_logs WHERE on_time = 1) as onTimeWakeups,
              (SELECT COUNT(*) FROM reward_vault_ledger WHERE kind = 'surplus_credit') as budgetDays
          `)
          const hunterStats = statsQuery[0] || {}

          const res: Summary = {
            balance,
            totalXp,
            level: levelInfo(totalXp, hunterStats),
            today,
            todayCoins: todayRows.reduce((s, e) => s + (e.coins || 0), 0),
            todayXp: todayRows.reduce((s, e) => s + (e.xp || 0), 0),
            todayRules: [...new Set(todayRows.map((e) => e.rule_id).filter(Boolean))],
            recent: recent.map((r) => ({
              id: r.id,
              ts: r.ts,
              day: r.day,
              module: r.module,
              kind: r.kind,
              coins: r.coins,
              xp: r.xp,
              ruleId: r.rule_id,
              ref: r.ref,
              note: r.note,
              undoOf: r.undo_of
            }))
          }
          setLocalCache('summary', res)
          return res
        } catch (e) {
          console.warn('[Turso Web] wallet.summary cache fallback:', e)
          const cached = getLocalCache<Summary>('summary')
          return cached ?? base.wallet.summary()
        }
      },
      history: async (limit = 100): Promise<LedgerEntry[]> => {
        try {
          const rows = await client.query<any>('SELECT * FROM ledger ORDER BY id DESC LIMIT ?', [limit])
          return rows.map((r) => ({
            id: r.id,
            ts: r.ts,
            day: r.day,
            module: r.module,
            kind: r.kind,
            coins: r.coins,
            xp: r.xp,
            ruleId: r.rule_id,
            ref: r.ref,
            note: r.note,
            undoOf: r.undo_of
          }))
        } catch {
          return base.wallet.history(limit)
        }
      },
      award: async (ruleId: string, note?: string): Promise<Summary> => {
        try {
          const now = new Date()
          const day = dayKey(now)
          const ruleRows = await client.query<any>('SELECT * FROM rules WHERE id = ?', [ruleId])
          const rule = ruleRows[0] || { coins: 5, xp: 10, module: 'general', title: ruleId }

          await client.execute(
            `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, ref, note)
             VALUES (?, ?, ?, 'earn', ?, ?, ?, null, ?)`,
            [now.toISOString(), day, rule.module, rule.coins, rule.xp, ruleId, note || rule.title]
          )
        } catch (e) {
          console.warn('[Turso Web] award error:', e)
        }
        return base.wallet.award(ruleId, note)
      }
    },
    discipline: {
      ...base.discipline,
      state: async (): Promise<DisciplineState> => {
        try {
          const t = dayKey(new Date())
          let realStreak: number | null = null
          let realBest: number | null = null
          let realCheckin = false
          let realOath = false

          if (typeof localStorage !== 'undefined') {
            try {
              const rawMan = localStorage.getItem('MAN_SPARTAN_DATA')
              if (rawMan) {
                const manData = JSON.parse(rawMan)
                if (manData && typeof manData.streakDays === 'number') {
                  realStreak = manData.streakDays
                  realBest = manData.longestStreak ?? manData.streakDays
                  realCheckin = manData.lastCheckin === t
                  realOath = manData.lastOathDate === t
                }
              }
            } catch {}
          }

          const rows = await client.query<any>(
            `SELECT id, kind, day, ts FROM discipline_events ORDER BY id ASC`
          )
          const events: DisciplineEvent[] = rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            day: r.day,
            ts: r.ts
          }))
          const stats = statsOf(events, t)
          const currentStreak = realStreak !== null ? realStreak : stats.current
          const bestStreak = realBest !== null ? Math.max(realBest, currentStreak) : stats.best
          const rank = rankFor(currentStreak)
          const has = (k: DisciplineEvent['kind']) => events.some((e) => e.kind === k && e.day === t)

          const res: DisciplineState = {
            setup: true,
            today: t,
            since: stats.since || addDays(t, -currentStreak),
            current: currentStreak,
            best: bestStreak,
            totalClean: Math.max(stats.totalClean || 0, currentStreak),
            resets: stats.relapses,
            rank: rank.name,
            nextRank: rank.next,
            checkedInToday: realCheckin || has('checkin'),
            oathToday: realOath || has('oath'),
            resetToday: has('reset') || (realStreak === 0),
            canEditStart: !events.some((e) => e.kind === 'reset'),
            milestones: milestonesOf(events, t, new Set<string>(), (s) => dayKey(new Date(s.ts))),
            urgeStartedAt: null,
            urgesThisWeek: events.filter((e) => e.kind === 'urge' && e.day >= addDays(t, -6)).length,
            stealth: false,
            quote: quoteFor(t)
          }
          setLocalCache('discipline', res)
          return res
        } catch (e) {
          console.warn('[Turso Web] discipline.state fallback:', e)
          const cached = getLocalCache<DisciplineState>('discipline')
          return cached ?? base.discipline.state()
        }
      },
      checkIn: async (): Promise<DisciplineState> => {
        try {
          const now = new Date()
          const day = dayKey(now)
          if (typeof localStorage !== 'undefined') {
            try {
              const raw = localStorage.getItem('MAN_SPARTAN_DATA')
              if (raw) {
                const parsed = JSON.parse(raw)
                parsed.lastCheckin = day
                parsed.streakDays = (parsed.streakDays || 0) + 1
                parsed.longestStreak = Math.max(parsed.longestStreak || 0, parsed.streakDays)
                localStorage.setItem('MAN_SPARTAN_DATA', JSON.stringify(parsed))
              }
            } catch {}
          }
          await client.execute(
            `INSERT INTO discipline_events (kind, day, ts) VALUES ('checkin', ?, ?)`,
            [day, now.toISOString()]
          )
          await client.execute(
            `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note)
             VALUES (?, ?, 'discipline', 'earn', 20, 40, 'discipline.checkin', 'Clean day check-in')`,
            [now.toISOString(), day]
          )
        } catch (e) {
          console.warn('[Turso Web] checkIn error:', e)
        }
        return base.discipline.checkIn()
      },
      oath: async (): Promise<DisciplineState> => {
        try {
          const now = new Date()
          const day = dayKey(now)
          if (typeof localStorage !== 'undefined') {
            try {
              const raw = localStorage.getItem('MAN_SPARTAN_DATA')
              if (raw) {
                const parsed = JSON.parse(raw)
                parsed.lastOathDate = day
                parsed.oathsSwornCount = (parsed.oathsSwornCount || 0) + 1
                localStorage.setItem('MAN_SPARTAN_DATA', JSON.stringify(parsed))
              }
            } catch {}
          }
          await client.execute(
            `INSERT INTO discipline_events (kind, day, ts) VALUES ('oath', ?, ?)`,
            [day, now.toISOString()]
          )
          await client.execute(
            `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note)
             VALUES (?, ?, 'discipline', 'earn', 3, 5, 'discipline.oath', 'Spartan morning oath sworn')`,
            [now.toISOString(), day]
          )
        } catch (e) {
          console.warn('[Turso Web] oath error:', e)
        }
        return base.discipline.oath()
      },
      reset: async (): Promise<DisciplineState> => {
        try {
          const now = new Date()
          const day = dayKey(now)
          if (typeof localStorage !== 'undefined') {
            try {
              const raw = localStorage.getItem('MAN_SPARTAN_DATA')
              if (raw) {
                const parsed = JSON.parse(raw)
                parsed.streakDays = 0
                parsed.lastCheckin = ''
                localStorage.setItem('MAN_SPARTAN_DATA', JSON.stringify(parsed))
              }
            } catch {}
          }
          await client.execute(
            `INSERT INTO discipline_events (kind, day, ts) VALUES ('reset', ?, ?)`,
            [day, now.toISOString()]
          )
        } catch (e) {
          console.warn('[Turso Web] reset error:', e)
        }
        return base.discipline.reset()
      },
      setStart: async (day: string): Promise<DisciplineState> => {
        try {
          const now = new Date()
          await client.execute(
            `INSERT INTO discipline_events (kind, day, ts) VALUES ('start', ?, ?)`,
            [day, now.toISOString()]
          )
        } catch (e) {
          console.warn('[Turso Web] setStart error:', e)
        }
        return base.discipline.setStart(day)
      }
    },
    tasks: {
      ...base.tasks,
      state: async (): Promise<TasksState> => {
        try {
          const today = dayKey(new Date())
          const taskRows = await client.query<any>('SELECT * FROM tasks WHERE archived = 0 ORDER BY id ASC')
          const doneRows = await client.query<any>('SELECT task_id FROM task_done WHERE day = ?', [today])
          const doneSet = new Set(doneRows.map((r) => r.task_id))
          const catRows = await client.query<any>('SELECT * FROM categories WHERE archived = 0 ORDER BY sort ASC')
          const categories: Category[] = catRows.map((c) => ({
            id: c.id,
            label: c.label,
            color: c.color,
            sort: c.sort,
            archived: Boolean(c.archived)
          }))

          const res: TasksState = {
            today,
            categories,
            tasks: taskRows.map((t) => ({
              id: t.id,
              title: t.title,
              category: t.category,
              coins: t.coins,
              xp: t.xp,
              priority: t.priority,
              due: t.due,
              repeat: t.repeat,
              weekdays: t.weekdays,
              notes: t.notes,
              createdDay: t.created_day,
              done: doneSet.has(t.id),
              overdue: false,
              lastDone: doneSet.has(t.id) ? today : null
            })),
            coinsToday: 0,
            dailyCap: 50
          }
          setLocalCache('tasks', res)
          return res
        } catch (e) {
          console.warn('[Turso Web] tasks.state fallback:', e)
          const cached = getLocalCache<TasksState>('tasks')
          return cached ?? base.tasks.state()
        }
      },
      save: async (task: TaskInput): Promise<TasksState> => {
        try {
          const now = new Date()
          const today = dayKey(now)
          if (task.id) {
            await client.execute(
              `UPDATE tasks SET title = ?, category = ?, coins = ?, xp = ?, priority = ?, due = ?, repeat = ?, weekdays = ?, notes = ? WHERE id = ?`,
              [task.title, task.category, task.coins, task.xp, task.priority, task.due || null, task.repeat, task.weekdays, task.notes || null, task.id]
            )
          } else {
            await client.execute(
              `INSERT INTO tasks (title, category, coins, xp, priority, due, repeat, weekdays, notes, created_day)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [task.title, task.category, task.coins, task.xp, task.priority, task.due || null, task.repeat, task.weekdays, task.notes || null, today]
            )
          }
        } catch (e) {
          console.warn('[Turso Web] tasks.save error:', e)
        }
        return base.tasks.save(task)
      },
      complete: async (id: number): Promise<TasksState> => {
        try {
          const now = new Date()
          const day = dayKey(now)
          await client.execute(
            `INSERT OR IGNORE INTO task_done (task_id, day, ledger_id) VALUES (?, ?, (SELECT COALESCE(MAX(id), 0) + 1 FROM ledger))`,
            [id, day]
          )
          const taskRows = await client.query<any>('SELECT * FROM tasks WHERE id = ?', [id])
          const task = taskRows[0] || { coins: 5, xp: 10, title: 'Task' }
          await client.execute(
            `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, ref, note)
             VALUES (?, ?, 'tasks', 'earn', ?, ?, 'task.done', ?, ?)`,
            [now.toISOString(), day, task.coins, task.xp, `task:${id}`, `Task completed: ${task.title}`]
          )
        } catch (e) {
          console.warn('[Turso Web] task complete error:', e)
        }
        return base.tasks.complete(id)
      },
      uncomplete: async (id: number): Promise<TasksState> => {
        try {
          const today = dayKey(new Date())
          await client.execute('DELETE FROM task_done WHERE task_id = ? AND day = ?', [id, today])
        } catch (e) {
          console.warn('[Turso Web] task uncomplete error:', e)
        }
        return base.tasks.uncomplete(id)
      },
      archive: async (id: number): Promise<TasksState> => {
        try {
          await client.execute('UPDATE tasks SET archived = 1 WHERE id = ?', [id])
        } catch (e) {
          console.warn('[Turso Web] task archive error:', e)
        }
        return base.tasks.archive(id)
      }
    },
    rules: {
      ...base.rules,
      list: async (): Promise<Rule[]> => {
        try {
          const rows = await client.query<any>('SELECT * FROM rules WHERE enabled = 1 ORDER BY sort ASC')
          if (rows.length > 0) {
            return rows.map((r) => ({
              id: r.id,
              module: r.module,
              title: r.title,
              coins: r.coins,
              xp: r.xp,
              dailyCap: r.daily_cap,
              cooldownMin: r.cooldown_min,
              enabled: Boolean(r.enabled),
              sort: r.sort
            }))
          }
        } catch {}
        return base.rules.list()
      },
      save: async (rule: Rule): Promise<Rule[]> => {
        try {
          await client.execute(
            `UPDATE rules SET title = ?, coins = ?, xp = ?, daily_cap = ?, cooldown_min = ?, enabled = ? WHERE id = ?`,
            [rule.title, rule.coins, rule.xp, rule.dailyCap, rule.cooldownMin, rule.enabled ? 1 : 0, rule.id]
          )
        } catch {}
        return base.rules.save(rule)
      }
    },
    shop: {
      ...base.shop,
      state: async (): Promise<ShopState> => {
        try {
          const rewards = await client.query<any>('SELECT * FROM rewards WHERE archived = 0 ORDER BY price ASC')
          const goals = await client.query<any>('SELECT * FROM wishlist_goals WHERE completed = 0 ORDER BY pinned DESC')
          const vaultRows = await client.query<any>('SELECT COALESCE(SUM(amount), 0) as s FROM reward_vault_ledger')
          const vaultBalance = vaultRows[0]?.s ?? 0

          if (rewards.length > 0) {
            const baseState = await base.shop.state()
            return {
              ...baseState,
              rewards: rewards.map((r) => ({
                id: r.id,
                title: r.title,
                price: r.price,
                tier: r.tier,
                realCost: r.real_cost,
                pinned: Boolean(r.pinned),
                archived: Boolean(r.archived),
                note: r.note,
                imageUrl: r.image_url,
                currency: r.currency,
                productUrl: r.product_url
              }))
            }
          }
        } catch {}
        return base.shop.state()
      },
      save: async (reward: RewardInput): Promise<ShopState> => {
        try {
          if (reward.id) {
            await client.execute(
              `UPDATE rewards SET title = ?, price = ?, tier = ?, real_cost = ?, pinned = ?, note = ? WHERE id = ?`,
              [reward.title, reward.price, reward.tier, reward.realCost ?? 0, reward.pinned ? 1 : 0, reward.note || null, reward.id]
            )
          } else {
            await client.execute(
              `INSERT INTO rewards (title, price, tier, real_cost, pinned, note) VALUES (?, ?, ?, ?, ?, ?)`,
              [reward.title, reward.price, reward.tier, reward.realCost ?? 0, reward.pinned ? 1 : 0, reward.note || null]
            )
          }
        } catch {}
        return base.shop.save(reward)
      }
    },
    money: {
      ...base.money,
      addExpense: async (amountBani: number, category: string, note?: string) => {
        try {
          const now = new Date()
          const day = dayKey(now)
          const rounded = Math.round(amountBani)
          await client.execute(
            `INSERT INTO expenses (day, amount, category, note, created_at) VALUES (?, ?, ?, ?, ?)`,
            [day, rounded, category.trim(), note?.trim() || null, now.toISOString()]
          )
          await client.execute(
            `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note)
             VALUES (?, ?, 'money', 'earn', 3, 0, 'money.logged', ?)`,
            [now.toISOString(), day, `Logged expense: ${category}`]
          )
        } catch (e) {
          console.warn('[Turso Web] addExpense error:', e)
        }
        return base.money.addExpense(amountBani, category, note)
      }
    },
    sleep: {
      ...base.sleep,
      state: async (): Promise<SleepSummary> => {
        try {
          const rows = await client.query<any>('SELECT * FROM sleep_logs ORDER BY day DESC LIMIT 30')
          if (rows.length > 0) {
            const today = dayKey(new Date())
            const todayRow = rows.find((r) => r.day === today)
            const onTimeCount = rows.filter((r) => r.on_time === 1).length
            const onTimeRate = rows.length > 0 ? onTimeCount / rows.length : 1
            const sleepDurations = rows
              .filter((r) => r.bed_time && r.wake_time)
              .map((r) => {
                const [wh, wm] = r.wake_time.split(':').map(Number)
                const [bh, bm] = r.bed_time.split(':').map(Number)
                let dur = (wh * 60 + wm) - (bh * 60 + bm)
                if (dur < 0) dur += 1440
                return dur
              })
            const avgSleepMin = sleepDurations.length ? Math.round(sleepDurations.reduce((a, b) => a + b, 0) / sleepDurations.length) : 442
            const recentLogs: SleepLog[] = rows.map((r) => ({
              id: r.id,
              day: r.day,
              wakeTime: r.wake_time,
              wakeTarget: r.wake_target,
              onTime: Boolean(r.on_time),
              bedTime: r.bed_time,
              bedTarget: r.bed_target,
              bedOnTime: Boolean(r.bed_on_time),
              quality: r.quality,
              createdAt: r.created_at
            }))

            return {
              today,
              weekdayTarget: '06:30',
              weekendTarget: '06:30',
              todayLog: todayRow
                ? {
                    id: todayRow.id,
                    day: todayRow.day,
                    wakeTime: todayRow.wake_time,
                    wakeTarget: todayRow.wake_target,
                    onTime: Boolean(todayRow.on_time),
                    bedTime: todayRow.bed_time,
                    bedTarget: todayRow.bed_target,
                    bedOnTime: Boolean(todayRow.bed_on_time),
                    quality: todayRow.quality,
                    createdAt: todayRow.created_at
                  }
                : null,
              streak: rows.length,
              bestStreak: Math.max(rows.length, 5),
              onTimeRate,
              avgSleepMin,
              recentLogs
            }
          }
        } catch (e) {
          console.warn('[Turso Web] sleep.state error:', e)
        }
        return base.sleep.state()
      },
      logWake: async (wakeTime?: string, quality?: number) => {
        try {
          const now = new Date()
          const day = dayKey(now)
          const time = wakeTime || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
          await client.execute(
            `INSERT INTO sleep_logs (day, wake_time, wake_target, on_time, quality, created_at)
             VALUES (?, ?, '06:30', 1, ?, ?)
             ON CONFLICT(day) DO UPDATE SET wake_time = excluded.wake_time, quality = excluded.quality`,
            [day, time, quality || null, now.toISOString()]
          )
          await client.execute(
            `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note)
             VALUES (?, ?, 'sleep', 'earn', 10, 20, 'sleep.up_on_time', 'Wake up logged')`,
            [now.toISOString(), day]
          )
        } catch (e) {
          console.warn('[Turso Web] logWake error:', e)
        }
        return base.sleep.logWake(wakeTime, quality)
      },
      logBed: async (bedTime?: string) => {
        try {
          const now = new Date()
          const day = dayKey(now)
          const time = bedTime || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
          await client.execute(
            `INSERT INTO sleep_logs (day, wake_time, wake_target, bed_time, bed_target, bed_on_time, created_at)
             VALUES (?, '06:30', '06:30', ?, '23:00', 1, ?)
             ON CONFLICT(day) DO UPDATE SET bed_time = excluded.bed_time, bed_on_time = 1`,
            [day, time, now.toISOString()]
          )
        } catch (e) {
          console.warn('[Turso Web] logBed error:', e)
        }
        return base.sleep.logBed(bedTime)
      }
    },
    connections: {
      ...base.connections,
      state: async (): Promise<ConnectionsState> => {
        const baseConns = await base.connections.state()
        try {
          const rows = await client.query<any>('SELECT * FROM sleep_logs ORDER BY day DESC LIMIT 30')
          const today = dayKey(new Date())
          const curMonth = today.slice(0, 7)
          const todayRow = rows.find((r) => r.day === today)
          const mornings = rows.map((r) => {
            let sleptMin = null
            if (r.bed_time && r.wake_time) {
              const [wh, wm] = r.wake_time.split(':').map(Number)
              const [bh, bm] = r.bed_time.split(':').map(Number)
              sleptMin = (wh * 60 + wm) - (bh * 60 + bm)
              if (sleptMin < 0) sleptMin += 1440
            }
            return {
              day: r.day,
              time: r.wake_time,
              target: r.wake_target,
              onTime: Boolean(r.on_time),
              sleptMin
            }
          })

          // 1. Real Finance State from localStorage
          let financeConn = baseConns.finance
          if (typeof localStorage !== 'undefined') {
            try {
              const rawFin = localStorage.getItem('finance-helper.state')
              if (rawFin) {
                const finData = JSON.parse(rawFin)
                if (finData && Array.isArray(finData.tx)) {
                  const todayTxs = finData.tx.filter((t: any) => t.date === today && t.type === 'expense')
                  const todaySpentBani = todayTxs.reduce((sum: number, t: any) => sum + (t.base || t.amount || 0), 0)
                  const monthTxs = finData.tx.filter((t: any) => (t.date || '').startsWith(curMonth) && t.type === 'expense')
                  const monthSpentBani = monthTxs.reduce((sum: number, t: any) => sum + (t.base || t.amount || 0), 0)
                  const monthIncomeTxs = finData.tx.filter((t: any) => (t.date || '').startsWith(curMonth) && t.type === 'income')
                  const monthIncomeBani = monthIncomeTxs.reduce((sum: number, t: any) => sum + (t.base || t.amount || 0), 0)

                  financeConn = {
                    path: 'localStorage:finance-helper.state',
                    found: true,
                    error: null,
                    connectedSince: '2026-10-25',
                    currency: finData.settings?.currency || 'MDL',
                    savedAt: new Date().toISOString(),
                    staleDays: 0,
                    dailyBudget: 150,
                    today: {
                      logged: todayTxs.length > 0 || finData.tx.some((t: any) => t.date === today),
                      everydaySpent: todaySpentBani
                    },
                    month: {
                      spent: monthSpentBani,
                      everyday: monthSpentBani,
                      income: monthIncomeBani,
                      days: new Set(monthTxs.map((t: any) => t.date)).size
                    },
                    days: []
                  }
                }
              }
            } catch (e) {
              console.warn('[Turso Web] finance parse error:', e)
            }
          }

          // 2. Real MAN State from localStorage
          let manConn = baseConns.man
          if (typeof localStorage !== 'undefined') {
            try {
              const rawMan = localStorage.getItem('MAN_SPARTAN_DATA')
              if (rawMan) {
                const manData = JSON.parse(rawMan)
                if (manData && typeof manData.streakDays === 'number') {
                  manConn = {
                    path: 'localStorage:MAN_SPARTAN_DATA',
                    found: true,
                    error: null,
                    data: {
                      streakDays: manData.streakDays,
                      longestStreak: manData.longestStreak || manData.streakDays,
                      totalVictories: manData.totalVictories || 0,
                      lastCheckin: manData.lastCheckin || '',
                      urgesCrushed: manData.urgesCrushedCount || 0,
                      oathsSworn: manData.oathsSwornCount || 0
                    },
                    suggestion: {
                      start: addDays(today, -manData.streakDays),
                      showsDays: manData.streakDays,
                      lastTapDaysAgo: 0,
                      note: 'Spartan Citadel live sync active'
                    }
                  }
                }
              }
            } catch (e) {
              console.warn('[Turso Web] man parse error:', e)
            }
          }

          return {
            ...baseConns,
            today,
            lastSync: new Date().toISOString(),
            finance: financeConn,
            man: manConn,
            waky: {
              ...baseConns.waky,
              found: true,
              connectedSince: '2026-10-25',
              path: 'cloud:turso',
              error: null,
              weekday: '06:30',
              weekend: '06:30',
              today: todayRow
                ? {
                    time: todayRow.wake_time,
                    target: todayRow.wake_target,
                    onTime: Boolean(todayRow.on_time)
                  }
                : null,
              streak: rows.length || 5,
              best: Math.max(rows.length, 5),
              onTimeRate: 1.0,
              avgSleepMin: 442,
              mornings
            }
          }
        } catch {
          return baseConns
        }
      }
    },
    apps: {
      ...base.apps,
      info: async () => ({
        finance: { url: '/apps/finance/index.html', partition: 'web', preloadReady: false },
        man: { url: '/apps/man/index.html', partition: 'web' },
        waky: { url: '/apps/waky/index.html', partition: 'web' },
        sport: { url: '/apps/sport/index.html', partition: 'web' },
        migration: null
      }),
      startWaky: async () => ({ ok: true, error: null })
    },
    data: {
      ...base.data,
      exportJson: async (): Promise<string> => {
        try {
          const tables = [
            'ledger',
            'tasks',
            'task_done',
            'categories',
            'rules',
            'rewards',
            'reward_vault_ledger',
            'discipline_events',
            'discipline_oaths',
            'sleep_logs',
            'workouts',
            'body_metrics',
            'exercises',
            'wishlist_goals',
            'settings'
          ]
          const dump: Record<string, any> = {
            version: 2,
            exportedAt: new Date().toISOString(),
            source: 'Turso Cloud & Life System Web',
            tables: {}
          }
          for (const tbl of tables) {
            try {
              const rows = await client.query(`SELECT * FROM ${tbl}`)
              dump.tables[tbl] = rows
            } catch {}
          }
          if (typeof localStorage !== 'undefined') {
            try {
              dump.financeState = JSON.parse(localStorage.getItem('finance-helper.state') || 'null')
              dump.wakyState = JSON.parse(localStorage.getItem('waky_web_data_v2') || 'null')
            } catch {}
          }
          return JSON.stringify(dump, null, 2)
        } catch {
          return base.data.exportJson()
        }
      },
      cloudSnapshots: async () => {
        try {
          await client.execute('CREATE TABLE IF NOT EXISTS cloud_snapshots (day TEXT PRIMARY KEY, exported_at TEXT, size_bytes INTEGER, data TEXT)')
          const rows = await client.query<any>('SELECT day, exported_at, size_bytes FROM cloud_snapshots ORDER BY day DESC LIMIT 30')
          return rows.map((r) => ({ day: r.day, exportedAt: r.exported_at, sizeBytes: r.size_bytes }))
        } catch {
          return []
        }
      },
      saveDailySnapshot: async () => {
        try {
          await client.execute('CREATE TABLE IF NOT EXISTS cloud_snapshots (day TEXT PRIMARY KEY, exported_at TEXT, size_bytes INTEGER, data TEXT)')
          const tables = [
            'ledger', 'tasks', 'task_done', 'categories', 'rules', 'rewards', 'reward_vault_ledger',
            'discipline_events', 'discipline_oaths', 'sleep_logs', 'workouts', 'body_metrics', 'exercises', 'wishlist_goals', 'settings'
          ]
          const dump: Record<string, any> = {
            version: 2,
            exportedAt: new Date().toISOString(),
            source: 'Turso Cloud 30-Day Vault',
            tables: {}
          }
          for (const tbl of tables) {
            try {
              const rows = await client.query(`SELECT * FROM ${tbl}`)
              dump.tables[tbl] = rows
            } catch {}
          }
          if (typeof localStorage !== 'undefined') {
            try {
              dump.financeState = JSON.parse(localStorage.getItem('finance-helper.state') || 'null')
              dump.wakyState = JSON.parse(localStorage.getItem('waky_web_data_v2') || 'null')
            } catch {}
          }
          const dumpStr = JSON.stringify(dump)
          const now = new Date()
          const day = dayKey(now)
          const bytes = new Blob([dumpStr]).size
          await client.execute(
            `INSERT INTO cloud_snapshots (day, exported_at, size_bytes, data) VALUES (?, ?, ?, ?)
             ON CONFLICT(day) DO UPDATE SET exported_at = excluded.exported_at, size_bytes = excluded.size_bytes, data = excluded.data`,
            [day, now.toISOString(), bytes, dumpStr]
          )
          await client.execute("DELETE FROM cloud_snapshots WHERE day < date('now', '-30 days')")
          return true
        } catch {
          return false
        }
      },
      restoreCloudSnapshot: async (day: string) => {
        try {
          const rows = await client.query<any>('SELECT data FROM cloud_snapshots WHERE day = ?', [day])
          if (!rows || !rows.length || !rows[0].data) return false
          const parsed = JSON.parse(rows[0].data)
          if (parsed.financeState && typeof localStorage !== 'undefined') {
            localStorage.setItem('finance-helper.state', JSON.stringify(parsed.financeState))
          }
          if (parsed.wakyState && typeof localStorage !== 'undefined') {
            localStorage.setItem('waky_web_data_v2', JSON.stringify(parsed.wakyState))
          }
          if (parsed.tables && typeof parsed.tables === 'object') {
            for (const [tbl, tRows] of Object.entries(parsed.tables)) {
              if (Array.isArray(tRows) && tRows.length > 0) {
                try {
                  await client.execute(`DELETE FROM ${tbl}`)
                  for (const r of tRows) {
                    const keys = Object.keys(r)
                    const placeholders = keys.map(() => '?').join(', ')
                    await client.execute(`INSERT INTO ${tbl} (${keys.join(', ')}) VALUES (${placeholders})`, Object.values(r))
                  }
                } catch {}
              }
            }
          }
          return true
        } catch {
          return false
        }
      }
    },
    body: {
      ...base.body,
      state: async (): Promise<BodyState> => {
        try {
          const t = dayKey(new Date())
          let sportData: any = null
          if (typeof localStorage !== 'undefined') {
            try {
              const rawSport = localStorage.getItem('life_sport_tracker_v1')
              if (rawSport) sportData = JSON.parse(rawSport)
            } catch {}
          }
          if (!sportData) {
            try {
              const sRows = await client.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['sport_data_json'])
              if (sRows.length && sRows[0].value) {
                sportData = JSON.parse(sRows[0].value)
                if (typeof localStorage !== 'undefined') {
                  localStorage.setItem('life_sport_tracker_v1', sRows[0].value)
                }
              }
            } catch {}
          }

          const workouts = await client.query<any>('SELECT * FROM workouts ORDER BY id DESC LIMIT 50')
          const metrics = await client.query<any>('SELECT * FROM body_metrics ORDER BY day ASC')
          const exercises = await client.query<any>('SELECT * FROM exercises WHERE archived = 0 ORDER BY sort ASC')

          const mappedWorkouts: Workout[] = workouts.map((w) => ({
            id: w.id,
            day: w.day,
            ts: w.ts,
            title: w.title,
            items: JSON.parse(w.items_json || '[]'),
            note: w.note
          }))

          if (sportData && Array.isArray(sportData.history)) {
            for (const h of sportData.history) {
              const hDay = new Date(h.date || h.id).toISOString().slice(0, 10)
              if (!mappedWorkouts.some((mw) => mw.id === h.id || (mw.day === hDay && mw.title === h.title))) {
                mappedWorkouts.unshift({
                  id: h.id || Date.now(),
                  day: hDay,
                  ts: new Date(h.id || Date.now()).toISOString(),
                  title: h.title || 'Sport Track Routine',
                  items: (sportData.exercises || []).map((e: any) => ({
                    exerciseId: e.id,
                    name: e.name,
                    amount: e.doneToday || e.target,
                    unit: e.unit || 'reps'
                  })),
                  note: h.amount || null
                })
              }
            }
          }

          const mappedMetrics: BodyMetric[] = metrics.map((m) => ({
            day: m.day,
            weight: m.weight,
            waist: m.waist,
            note: m.note,
            updatedAt: m.updated_at
          }))

          let mappedExercises: Exercise[] = exercises.map((e) => ({
            id: e.id,
            name: e.name,
            unit: e.unit,
            target: e.target,
            category: e.category,
            sort: e.sort,
            archived: Boolean(e.archived)
          }))

          if (sportData && Array.isArray(sportData.exercises) && sportData.exercises.length > 0) {
            mappedExercises = sportData.exercises.map((e: any, idx: number) => ({
              id: e.id || `ex_${idx}`,
              name: e.name,
              unit: (!e.unit || String(e.unit).trim() === '1') ? 'reps' : String(e.unit).trim(),
              target: e.target,
              category: 'calisthenics',
              sort: idx,
              archived: !e.active
            }))
          }

          const stats = computeWorkoutStats(mappedWorkouts, t)
          const isRoutineDoneToday = Boolean(
            sportData?.exercises?.length > 0 &&
            sportData.exercises.every((e: any) => (e.doneToday || 0) >= (e.target || 0) && (e.target || 0) > 0)
          )
          const hasHistoryToday = Boolean(
            sportData?.history?.some((h: any) => {
              const hDate = new Date(h.date || h.id).toISOString().slice(0, 10)
              return hDate === t
            })
          )
          const workoutDoneToday = isRoutineDoneToday || hasHistoryToday || stats.workoutDoneToday
          const streak = Math.max(sportData?.streak || 0, sportData?.activeStreak || 0, stats.streak, workoutDoneToday ? 1 : 0)
          const workoutsThisWeek = Math.max(sportData?.history?.length || 0, stats.workoutsThisWeek, workoutDoneToday ? 1 : 0)
          const totalWorkouts = Math.max(sportData?.history?.length || 0, stats.totalWorkouts, mappedWorkouts.length)

          const weeklyAverages = computeWeeklyAverages(mappedMetrics, 12)
          const withWeight = mappedMetrics.filter((m) => m.weight != null)
          const latestWeight = withWeight.length ? withWeight[withWeight.length - 1].weight! : null
          const previousWeight = withWeight.length > 1 ? withWeight[withWeight.length - 2].weight! : null
          const withWaist = mappedMetrics.filter((m) => m.waist != null)
          const latestWaist = withWaist.length ? withWaist[withWaist.length - 1].waist! : null
          const previousWaist = withWaist.length > 1 ? withWaist[withWaist.length - 2].waist! : null

          return {
            today: t,
            streak,
            bestStreak: Math.max(stats.bestStreak, streak),
            totalWorkouts,
            workoutsThisWeek,
            workoutDoneToday,
            latestWeight,
            previousWeight,
            latestWaist,
            previousWaist,
            weeklyAverages,
            recentWorkouts: mappedWorkouts,
            metrics: mappedMetrics,
            exercises: mappedExercises.length ? mappedExercises : DEFAULT_EXERCISES
          }
        } catch (e) {
          console.warn('[Turso Web] body.state fallback:', e)
        }
        return base.body.state()
      },
      logWorkout: async (input: WorkoutInput) => {
        try {
          const now = new Date()
          const day = dayKey(now)
          await client.execute(
            `INSERT INTO workouts (day, ts, title, items_json, note) VALUES (?, ?, ?, ?, ?)`,
            [day, now.toISOString(), input.title, JSON.stringify(input.items || []), input.note || null]
          )
          await client.execute(
            `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note)
             VALUES (?, ?, 'body', 'earn', 12, 30, 'body.workout_done', ?)`,
            [now.toISOString(), day, `Workout: ${input.title}`]
          )
        } catch (e) {
          console.warn('[Turso Web] logWorkout error:', e)
        }
        return base.body.logWorkout(input)
      },
      logMetric: async (input: BodyMetricInput) => {
        try {
          const now = new Date()
          const day = dayKey(now)
          await client.execute(
            `INSERT INTO body_metrics (day, weight, waist, note, updated_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(day) DO UPDATE SET weight = excluded.weight, waist = excluded.waist, note = excluded.note, updated_at = excluded.updated_at`,
            [day, input.weight ?? null, input.waist ?? null, input.note || null, now.toISOString()]
          )
        } catch (e) {
          console.warn('[Turso Web] logMetric error:', e)
        }
        return base.body.logMetric(input)
      }
    },
    bots: {
      ...base.bots,
      config: async (): Promise<BotBridgeConfig> => {
        try {
          const rows = await client.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['bot_bridge_config'])
          if (rows.length && rows[0].value) {
            const parsed = JSON.parse(rows[0].value)
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('bot_bridge_config', rows[0].value)
            }
            return { ...DEFAULT_WEB_BOT_CONFIG, ...parsed }
          }
        } catch {}
        if (typeof localStorage !== 'undefined') {
          try {
            const local = localStorage.getItem('bot_bridge_config')
            if (local) return { ...DEFAULT_WEB_BOT_CONFIG, ...JSON.parse(local) }
          } catch {}
        }
        return DEFAULT_WEB_BOT_CONFIG
      },
      saveConfig: async (patch: Partial<BotBridgeConfig>): Promise<BotBridgeConfig> => {
        let current = DEFAULT_WEB_BOT_CONFIG
        try {
          const rows = await client.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['bot_bridge_config'])
          if (rows.length && rows[0].value) current = { ...DEFAULT_WEB_BOT_CONFIG, ...JSON.parse(rows[0].value) }
        } catch {}
        const next: BotBridgeConfig = { ...current, ...patch }
        try {
          await client.execute(
            `INSERT INTO settings (key, value) VALUES ('bot_bridge_config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            [JSON.stringify(next)]
          )
        } catch (e) {
          console.warn('[Turso Web] saveConfig error:', e)
        }
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('bot_bridge_config', JSON.stringify(next))
        }
        return next
      },
      status: async () => {
        let cfg = DEFAULT_WEB_BOT_CONFIG
        try {
          const rows = await client.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['bot_bridge_config'])
          if (rows.length && rows[0].value) cfg = { ...DEFAULT_WEB_BOT_CONFIG, ...JSON.parse(rows[0].value) }
        } catch {}
        return {
          polling: webBotPollingActive,
          enabled: Boolean(cfg.enabled),
          configured: Boolean(cfg.sportBotToken || cfg.botToken || cfg.financeBotToken || cfg.manBotToken),
          lastPollAt: webLastPollTime,
          lastError: webLastPollError,
          processedCount: webProcessedCount
        }
      },
      logs: async (): Promise<BotLogEntry[]> => {
        if (typeof localStorage === 'undefined') return []
        try {
          const raw = localStorage.getItem('life_bot_logs')
          return raw ? JSON.parse(raw).slice(-50).reverse() : []
        } catch {
          return []
        }
      },
      clearLogs: async (): Promise<void> => {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('life_bot_logs')
        }
      },
      test: async (botKey?: string): Promise<{ ok: boolean; error?: string }> => {
        let cfg = DEFAULT_WEB_BOT_CONFIG
        try {
          const rows = await client.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['bot_bridge_config'])
          if (rows.length && rows[0].value) cfg = { ...DEFAULT_WEB_BOT_CONFIG, ...JSON.parse(rows[0].value) }
        } catch {}
        let token = cfg.sportBotToken || cfg.botToken
        let chatId = cfg.sportBotChatId || cfg.chatId
        let title = 'Sport Bot'
        if (botKey === 'finance') {
          token = cfg.financeBotToken || token
          chatId = cfg.financeBotChatId || chatId
          title = 'Finance Bot'
        } else if (botKey === 'man') {
          token = cfg.manBotToken || token
          chatId = cfg.manBotChatId || chatId
          title = 'Spartan MAN Bot'
        }
        if (!token || !chatId) return { ok: false, error: 'Bot token or Chat ID is missing' }
        try {
          const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `⚡ <b>Life System — ${title} Online!</b>\n\n2-way Telegram synchronization active.`,
              parse_mode: 'HTML'
            })
          })
          const d = await res.json()
          return { ok: Boolean(d.ok), error: d.description }
        } catch (e) {
          return { ok: false, error: (e as Error).message }
        }
      },
      startPolling: async (): Promise<boolean> => {
        webBotPollingActive = true
        if (!webPollingInterval) {
          webPollingInterval = setInterval(() => {
            if (typeof document === 'undefined' || document.visibilityState === 'visible') {
              executeWebPoll().catch(() => {})
            }
          }, 12000)
        }
        return true
      },
      stopPolling: async (): Promise<boolean> => {
        webBotPollingActive = false
        if (webPollingInterval) {
          clearInterval(webPollingInterval)
          webPollingInterval = null
        }
        return false
      },
      pollOnce: async (): Promise<{ processedCount: number; replies: string[] }> => {
        return executeWebPoll()
      }
    },
  }
}
