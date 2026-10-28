import type { UnifiedEconomyService } from './unifiedEconomy'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import {
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
  parseTelegramText
} from '@core/botCommands'
import { formatMoney } from '@core/money'
import type { Body } from './body'
import type { Discipline } from './discipline'
import type { MoneyService } from './money'
import type { SleepService } from './sleep'
import type { Tasks } from './planner'
import type { Wallet } from './wallet'
import type { CalendarService } from './calendarService'
import type { FinanceHost } from './apps/finance'

export interface BotLogEntry {
  id: number
  ts: string
  command: string
  sender: string
  success: boolean
  reply: string
}

export interface BotBridgeConfig {
  botToken: string
  chatId: string
  enabled: boolean
  pollingEnabled: boolean
  morningBriefing: boolean
  eveningNudge: boolean
  // Secondary connected bot tokens
  sportBotToken?: string
  sportBotChatId?: string
  financeBotToken?: string
  financeBotChatId?: string
  manBotToken?: string
  manBotChatId?: string
  wakyBotToken?: string
  wakyBotChatId?: string
  plannerBotToken?: string
  plannerBotChatId?: string
  coachBotToken?: string
  coachBotChatId?: string
  financeSyncEnabled?: boolean
}

const DEFAULT_BRIDGE_CONFIG: BotBridgeConfig = {
  botToken: '',
  chatId: '',
  enabled: false,
  pollingEnabled: false,
  morningBriefing: true,
  eveningNudge: true,
  sportBotToken: '',
  sportBotChatId: '',
  financeBotToken: '',
  financeBotChatId: '',
  manBotToken: '',
  manBotChatId: '',
  wakyBotToken: '',
  wakyBotChatId: '',
  plannerBotToken: '',
  plannerBotChatId: '',
  coachBotToken: '',
  coachBotChatId: '',
  financeSyncEnabled: true
}

export class TelegramBotHub {
  private economy?: UnifiedEconomyService
  private calendar?: CalendarService
  private financeHost?: FinanceHost
  private file: string
  private logsList: BotLogEntry[] = []
  private isPolling = false
  private abortController: AbortController | null = null
  private onWalletChangeCallback?: () => void
  private lastPollTimestamp: string | null = null
  private lastPollingError: string | null = null
  private processedCommandsCount = 0

  constructor(
    private wallet?: Wallet,
    private discipline?: Discipline,
    private body?: Body,
    private sleep?: SleepService,
    private money?: MoneyService,
    private tasks?: Tasks,
    filePathOrEconomy?: string | UnifiedEconomyService,
    economyOrFilePath?: UnifiedEconomyService | string
  ) {
    let filePath: string | undefined
    if (typeof filePathOrEconomy === 'string') {
      filePath = filePathOrEconomy
      if (typeof economyOrFilePath !== 'string') this.economy = economyOrFilePath
    } else if (filePathOrEconomy) {
      this.economy = filePathOrEconomy
      if (typeof economyOrFilePath === 'string') filePath = economyOrFilePath
    }
    try {
      this.file = filePath ?? join(app.getPath('userData'), 'telegram_hub.bin')
    } catch {
      this.file = filePath ?? 'telegram_hub.bin'
    }
  }

  setEconomy(eco: UnifiedEconomyService): void {
    this.economy = eco
  }

  setCalendar(cal: CalendarService): void {
    this.calendar = cal
  }

  setFinanceHost(fh: FinanceHost): void {
    this.financeHost = fh
  }

  setWalletCallback(cb: () => void): void {
    this.onWalletChangeCallback = cb
  }

  getConfig(): BotBridgeConfig {
    if (!existsSync(this.file)) return { ...DEFAULT_BRIDGE_CONFIG }
    try {
      const buf = readFileSync(this.file)
      if (!buf || !buf.length) return { ...DEFAULT_BRIDGE_CONFIG }
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const str = safeStorage.decryptString(buf)
        return { ...DEFAULT_BRIDGE_CONFIG, ...JSON.parse(str) }
      }
      return { ...DEFAULT_BRIDGE_CONFIG, ...JSON.parse(buf.toString('utf8')) }
    } catch {
      return { ...DEFAULT_BRIDGE_CONFIG }
    }
  }

  saveConfig(patch: Partial<BotBridgeConfig>): BotBridgeConfig {
    const cur = this.getConfig()
    const next = { ...cur, ...patch }
    const json = JSON.stringify(next)

    try {
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        writeFileSync(this.file, safeStorage.encryptString(json))
      } else {
        writeFileSync(this.file, Buffer.from(json, 'utf8'))
      }
    } catch {
      // fallback
    }

    if (next.financeBotToken) {
      this.financeHost?.syncTelegram(next.financeBotToken, next.financeBotChatId || next.chatId).catch(() => {})
    }

    const hasAnyToken = !!(next.botToken || next.financeBotToken || next.sportBotToken || next.manBotToken || next.wakyBotToken || next.plannerBotToken || next.coachBotToken)
    if (next.enabled && next.pollingEnabled && hasAnyToken && !this.isPolling) {
      this.startPolling()
    } else if ((!next.enabled || !next.pollingEnabled || !hasAnyToken) && this.isPolling) {
      this.stopPolling()
    }

    return next
  }

  getLogs(): BotLogEntry[] {
    return this.logsList.slice(-50).reverse()
  }

  clearLogs(): void {
    this.logsList = []
  }

  private addLog(command: string, sender: string, success: boolean, reply: string): void {
    const entry: BotLogEntry = {
      id: Date.now() + Math.random(),
      ts: new Date().toISOString(),
      command,
      sender,
      success,
      reply: reply.slice(0, 300)
    }
    this.logsList.push(entry)
    if (this.logsList.length > 60) {
      this.logsList = this.logsList.slice(-50)
    }
  }

  async sendMessage(text: string, customToken?: string, customChatId?: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = this.getConfig()
    const token = customToken || cfg.botToken
    const chatId = customChatId || cfg.chatId

    if (!token || !chatId) {
      return { ok: false, error: 'Telegram Bot Token or Chat ID is missing' }
    }

    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML'
        }),
        signal: AbortSignal.timeout(10000)
      })

      const json = (await res.json()) as { ok: boolean; description?: string }
      if (!json.ok) {
        return { ok: false, error: json.description ?? 'Telegram API error' }
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  async sendTest(botKey?: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = this.getConfig()

    if (botKey === 'all') {
      const bots = [
        { name: 'Master Command Center', token: cfg.botToken, chat: cfg.chatId },
        { name: 'Finance Bot', token: cfg.financeBotToken, chat: cfg.financeBotChatId || cfg.chatId },
        { name: 'Sport Bot', token: cfg.sportBotToken, chat: cfg.sportBotChatId || cfg.chatId },
        { name: 'MAN Discipline Bot', token: cfg.manBotToken, chat: cfg.manBotChatId || cfg.chatId },
        { name: 'Waky Sleep Bot', token: cfg.wakyBotToken, chat: cfg.wakyBotChatId || cfg.chatId },
        { name: 'Planner Quest Bot', token: cfg.plannerBotToken, chat: cfg.plannerBotChatId || cfg.chatId },
        { name: 'AI Coach Bot', token: cfg.coachBotToken, chat: cfg.coachBotChatId || cfg.chatId }
      ].filter((b) => b.token)

      if (bots.length === 0) {
        return { ok: false, error: 'No bots configured yet. Please configure at least one bot token.' }
      }

      let okCount = 0
      let lastError: string | undefined
      for (const b of bots) {
        const res = await this.sendMessage(
          `⚡ <b>Life System — ${b.name} Online!</b>\n\nBridge verified & active. Send <code>/help</code> or your logs to interact in real-time.`,
          b.token,
          b.chat
        )
        if (res.ok) okCount++
        else lastError = `${b.name}: ${res.error}`
      }

      return okCount > 0
        ? { ok: true }
        : { ok: false, error: lastError || 'Failed to ping bots' }
    }

    let token = cfg.botToken
    let chatId = cfg.chatId
    let botTitle = 'Life System Bot Center'

    if (botKey === 'finance') {
      token = cfg.financeBotToken || cfg.botToken
      chatId = cfg.financeBotChatId || cfg.chatId
      botTitle = '💰 Life System Finance Bot'
    } else if (botKey === 'sport') {
      token = cfg.sportBotToken || cfg.botToken
      chatId = cfg.sportBotChatId || cfg.chatId
      botTitle = '🏃 Life System Sport Bot'
    } else if (botKey === 'man') {
      token = cfg.manBotToken || cfg.botToken
      chatId = cfg.manBotChatId || cfg.chatId
      botTitle = '🛡️ MAN Spartan Discipline Bot'
    } else if (botKey === 'waky') {
      token = cfg.wakyBotToken || cfg.botToken
      chatId = cfg.wakyBotChatId || cfg.chatId
      botTitle = '🌙 Waky Sleep & Circadian Bot'
    } else if (botKey === 'planner') {
      token = cfg.plannerBotToken || cfg.botToken
      chatId = cfg.plannerBotChatId || cfg.chatId
      botTitle = '🎯 Task & Quest Execution Bot'
    } else if (botKey === 'coach') {
      token = cfg.coachBotToken || cfg.botToken
      chatId = cfg.coachBotChatId || cfg.chatId
      botTitle = '🤖 AI System Coach Bot'
    }

    return this.sendMessage(
      `⚡ <b>${botTitle} Online!</b>\n\nYour 2-way Telegram control bridge is active. Send <code>/help</code> to this bot to view all commands.`,
      token,
      chatId
    )
  }

  async handleIncomingCommand(text: string, senderChatId: string): Promise<string> {
    const cfg = this.getConfig()

    // Whitelist check
    const isWhitelisted =
      (cfg.chatId && String(senderChatId) === String(cfg.chatId)) ||
      (cfg.sportBotChatId && String(senderChatId) === String(cfg.sportBotChatId)) ||
      (cfg.financeBotChatId && String(senderChatId) === String(cfg.financeBotChatId)) ||
      (cfg.manBotChatId && String(senderChatId) === String(cfg.manBotChatId)) ||
      (cfg.wakyBotChatId && String(senderChatId) === String(cfg.wakyBotChatId)) ||
      (cfg.plannerBotChatId && String(senderChatId) === String(cfg.plannerBotChatId)) ||
      (cfg.coachBotChatId && String(senderChatId) === String(cfg.coachBotChatId))

    if (!isWhitelisted) {
      const unauthorized = `⛔ <b>Unauthorized access.</b> Chat ID <code>${senderChatId}</code> is not in your allowed whitelist.`
      this.addLog(text, senderChatId, false, unauthorized)
      return unauthorized
    }

    const parsed = parseTelegramText(text)
    if (!parsed) {
      return ''
    }

    try {
      let reply = ''
      switch (parsed.type) {
        case 'help':
          reply = formatHelpMessage()
          break

        case 'today': {
          const summary = this.wallet?.summary()
          const cleanStreak = this.discipline?.state().current ?? 0
          const workoutStreak = this.body?.state().streak ?? 0
          const openTasks = this.tasks?.state().tasks.filter((t) => !t.done) ?? []
          reply = formatTodayStatus({
            balance: summary?.balance ?? 0,
            level: summary?.level.level ?? 1,
            rank: summary?.level.rank ?? 'Initiate',
            totalXp: summary?.totalXp ?? 0,
            ritualsDone: summary?.todayRules?.length ?? 0,
            totalRituals: 5,
            cleanStreak,
            workoutStreak,
            tasksLeft: openTasks.length
          })
          if (this.calendar) {
            const calEvents = this.calendar.getEvents()
            if (calEvents.length > 0) {
              const calList = calEvents
                .slice(0, 3)
                .map((e) => `• <b>${e.startTime}</b>: ${e.title}`)
                .join('\n')
              reply += `\n\n📅 <b>Google Calendar:</b>\n${calList}`
            }
          }
          break
        }

        case 'checkin': {
          if (!this.discipline) {
            reply = '❌ Discipline service unavailable.'
            break
          }
          this.discipline.checkIn()
          const next = this.discipline.state()
          this.onWalletChangeCallback?.()
          reply = formatCleanCheckinResponse(next.current, 10)
          break
        }

        case 'oath': {
          if (!this.discipline) {
            reply = '❌ Discipline service unavailable.'
            break
          }
          this.discipline.oath()
          this.onWalletChangeCallback?.()
          reply = `📜 <b>Morning Oath Affirmed!</b>\n\n<i>"I commit to purity, disciplined physical power, sharp financial focus, and daily relentless self-mastery."</i>\n\n+3 coins awarded! Stay on the path!`
          break
        }

        case 'workout': {
          if (!this.body) {
            reply = '❌ Body workout service unavailable.'
            break
          }
          const exercise = parsed.exerciseName || 'pushups'
          const amount = parsed.exerciseAmount || 20
          const res = this.body.logWorkout({
            title: `${exercise} (Telegram Log)`,
            items: [
              {
                exerciseId: exercise.toLowerCase(),
                name: exercise,
                amount,
                unit: 'reps'
              }
            ],
            note: 'Logged via Telegram Hub'
          })
          this.onWalletChangeCallback?.()
          reply = formatWorkoutResponse(exercise, amount, res.state.streak, res.awarded ? 10 : 0)
          break
        }

        case 'sport': {
          if (!this.body) {
            reply = '❌ Sport & Workout service unavailable.'
            break
          }
          const exName = parsed.exerciseName || 'Athletic Workout'
          const amount = parsed.exerciseAmount || 1
          const rawUnit = parsed.exerciseUnit || 'minutes'
          const validUnit = rawUnit === 'reps' || rawUnit === 'kg' || rawUnit === 'sets' ? rawUnit : 'minutes'
          const res = this.body.logWorkout({
            title: `${exName} (Telegram Sport Bot)`,
            items: [
              {
                exerciseId: exName.toLowerCase().replace(/\s+/g, '_'),
                name: exName,
                amount,
                unit: validUnit
              }
            ],
            note: `Logged via Telegram Sport Bot (${amount} ${rawUnit})`
          })
          this.onWalletChangeCallback?.()
          reply = formatSportResponse(
            exName,
            amount,
            rawUnit,
            res.state.streak,
            res.awarded ? 15 : 5,
            35
          )
          break
        }

        case 'weight': {
          if (!this.body) {
            reply = '❌ Body metrics service unavailable.'
            break
          }
          const weight = parsed.metricWeight
          if (!weight || weight < 30 || weight > 300) {
            reply = '⚠️ Please provide a valid weight (e.g. <code>/weight 74.5</code>).'
            break
          }
          this.body.logMetric({ weight, note: 'Logged via Telegram Sport Bot' })
          this.onWalletChangeCallback?.()
          reply = formatMetricResponse('weight', weight, 'kg', 5, 15)
          break
        }

        case 'waist': {
          if (!this.body) {
            reply = '❌ Body metrics service unavailable.'
            break
          }
          const waist = parsed.metricWaist
          if (!waist || waist < 40 || waist > 200) {
            reply = '⚠️ Please provide a valid waist measurement (e.g. <code>/waist 82</code>).'
            break
          }
          this.body.logMetric({ waist, note: 'Logged via Telegram Sport Bot' })
          this.onWalletChangeCallback?.()
          reply = formatMetricResponse('waist', waist, 'cm', 5, 15)
          break
        }

        case 'sport_status': {
          if (!this.body) {
            reply = '❌ Body service unavailable.'
            break
          }
          const st = this.body.state()
          reply = formatSportStatusResponse({
            streak: st.streak,
            totalWorkouts: st.totalWorkouts,
            thisWeek: st.workoutsThisWeek,
            latestWeight: st.latestWeight,
            latestWaist: st.latestWaist
          })
          break
        }

        case 'pr': {
          if (!this.body) {
            reply = '❌ Body service unavailable.'
            break
          }
          if (parsed.prExercise && parsed.prValue) {
            this.body.logWorkout({
              title: `PR: ${parsed.prExercise} ${parsed.prValue}`,
              items: [
                {
                  exerciseId: parsed.prExercise.toLowerCase().replace(/\s+/g, '_'),
                  name: `PR: ${parsed.prExercise}`,
                  amount: parseFloat(parsed.prValue) || 1,
                  unit: 'reps'
                }
              ],
              note: `🏆 Personal Record logged via Telegram Sport Bot: ${parsed.prExercise} -> ${parsed.prValue}`
            })
            this.onWalletChangeCallback?.()
            reply = `🏆 <b>PERSONAL RECORD (PR) CRUSHED!</b> 🏆\n\n• <b>Exercise:</b> ${parsed.prExercise}\n• <b>Record Value:</b> ${parsed.prValue}\n• <b>Reward:</b> +20 🪙 Coins · +50 XP\n\n<i>"A true Hunter continuously breaks their previous limits!"</i>`
          } else {
            const st = this.body.state()
            reply = formatSportStatusResponse({
              streak: st.streak,
              totalWorkouts: st.totalWorkouts,
              thisWeek: st.workoutsThisWeek,
              latestWeight: st.latestWeight,
              latestWaist: st.latestWaist
            })
          }
          break
        }

        case 'expense': {
          const amt = parsed.expenseAmount || 0
          const cat = parsed.expenseCategory || 'other'
          const note = parsed.expenseNote || ''
          const cents = Math.round(amt * 100)
          let res: any = null

          if (this.money) {
            res = this.money.addExpense(
              cents,
              cat as any,
              note ? `[Telegram] ${note}` : '[Telegram]', undefined, true
            )
            this.onWalletChangeCallback?.()
          }

          let fhSyncResult: { synced: boolean; totalBalance?: string; accountName?: string } | undefined
          if (this.financeHost && (cfg.financeSyncEnabled ?? true)) {
            try {
              const fhRes = await this.financeHost.addTransaction({
                type: 'expense',
                amount: cents,
                category: cat,
                note: note || undefined
              })
              if (fhRes.ok) {
                fhSyncResult = {
                  synced: true,
                  totalBalance: fhRes.balanceTotal != null ? `${(fhRes.balanceTotal / 100).toFixed(2)} MDL` : undefined,
                  accountName: fhRes.accountName
                }
              }
            } catch (err) {
              console.warn('Finance sync warning:', err)
            }
          }

          const cur = res?.state?.currency || 'MDL'
          const remainingBudget = res ? formatMoney(Math.max(0, res.state.today.remaining), cur) : 'Unrestricted'
          reply = formatExpenseResponse(
            formatMoney(cents, cur),
            cat,
            note || null,
            remainingBudget,
            res?.awarded ? 3 : 0,
            fhSyncResult
          )
          break
        }

        case 'balance': {
          let fhAccountsTotalMdl = 0
          let fhAccounts: { name: string; balanceMdl: number; currency: string }[] = []
          if (this.financeHost) {
            try {
              const summary = await this.financeHost.getFinanceSummary()
              if (summary) {
                fhAccountsTotalMdl = summary.totalMdl
                fhAccounts = summary.accounts.map((a) => ({
                  name: a.name,
                  balanceMdl: a.balanceMdl,
                  currency: summary.currency
                }))
              }
            } catch (e) {
              console.warn('Failed to query finance summary for bot balance:', e)
            }
          }

          const walletSummary = this.wallet?.summary()
          const coins = walletSummary?.balance ?? 0
          const coinsValueMdl = Math.round((coins / 10) * 100) / 100

          let vaultSurplusMdl = 0
          if (this.economy) {
            const ecoSummary = this.economy.getEconomySummary()
            vaultSurplusMdl = ecoSummary.vaultBalance
          }

          const moneyState = this.money?.state()
          const budgetLeft = moneyState ? Math.max(0, moneyState.today.remaining) / 100 : undefined

          reply = formatBalanceResponse({
            currency: 'MDL',
            walletCoins: coins,
            walletCoinsValueMdl: coinsValueMdl,
            vaultSurplusMdl: vaultSurplusMdl,
            financeAccountsTotalMdl: fhAccountsTotalMdl,
            financeAccounts: fhAccounts,
            dailyBudgetLeftMdl: budgetLeft
          })
          break
        }

        case 'wake': {
          if (!this.sleep) {
            reply = '❌ Sleep service unavailable.'
            break
          }
          const nowStr = new Date().toTimeString().slice(0, 5)
          const res = this.sleep.logWake(nowStr)
          this.onWalletChangeCallback?.()
          reply = `🌅 <b>Wake-up Logged!</b>\nTime: <b>${res.log.wakeTime}</b>\n${
            res.log.onTime ? `🎯 Target met! <b>+10 coins awarded!</b>` : `Recorded into sleep history.`
          }`
          break
        }

        case 'bed': {
          if (!this.sleep) {
            reply = '❌ Sleep service unavailable.'
            break
          }
          const nowStr = new Date().toTimeString().slice(0, 5)
          const res = this.sleep.logBed(nowStr)
          this.onWalletChangeCallback?.()
          reply = `🌙 <b>Bedtime Logged!</b>\nTime: <b>${res.log.bedTime}</b>\n${
            res.log.bedOnTime ? `🎯 Target met! <b>+5 coins awarded!</b>` : `Recorded into sleep history.`
          }`
          break
        }

        case 'tasks': {
          if (!this.tasks) {
            reply = '❌ Tasks service unavailable.'
            break
          }
          const openTasks = this.tasks.state().tasks.filter((t) => !t.done).slice(0, 8)
          if (!openTasks.length) {
            reply = `📋 <b>No pending tasks!</b>\n\nAll clear. Enjoy your day!`
          } else {
            const list = openTasks.map((t, idx) => `${idx + 1}. [${t.category}] <b>${t.title}</b>`).join('\n')
            reply = `📋 <b>ACTIVE TASKS:</b>\n\n${list}\n\n<i>To complete one, send:</i> <code>/done &lt;number&gt;</code>`
          }
          break
        }

        case 'done': {
          if (!this.tasks) {
            reply = '❌ Tasks service unavailable.'
            break
          }
          const openTasks = this.tasks.state().tasks.filter((t) => !t.done)
          const num = parsed.taskIndex ?? parseInt(parsed.args[0], 10)
          let target = openTasks.find((t) => t.id === num)
          if (!target && !isNaN(num) && num > 0 && num <= openTasks.length) {
            target = openTasks[num - 1]
          }
          if (target) {
            this.tasks.complete(target.id)
            this.onWalletChangeCallback?.()
            reply = `✅ Task completed: <b>${target.title}</b>\n<b>+10 coins awarded!</b>`
          } else {
            reply = `⚠️ Task number not found. Use <code>/tasks</code> to view list.`
          }
          break
        }

                case 'vault': {
          if (!this.economy) {
            reply = '❌ Economy service unavailable.'
            break
          }
          const s = this.economy.getEconomySummary()
          reply = [
            '🏛️ <b>UNIFIED REWARD VAULT & ECONOMY</b>',
            '',
            `🪙 <b>Coins Balance:</b> ${s.coinsBalance} coins (≈ <b>${s.coinsRealValue} ${s.currency}</b>)`,
            `💰 <b>Reward Vault:</b> <b>${s.vaultBalance} ${s.currency}</b> (accumulated surplus cash)`,
            `🔥 <b>Multiplier:</b> ${s.multiplier.label}`,
            `🎯 <b>Monthly Budget:</b> ${s.monthSpent} / ${s.monthlyBudget || '∞'} ${s.currency} used`,
            '',
            s.pinnedGoal
              ? `🌟 <b>Pinned Goal:</b> ${s.pinnedGoal.title} (${s.pinnedGoal.allocatedCoins}/${s.pinnedGoal.targetCoins} coins · ${s.pinnedGoal.allocatedRealCost}/${s.pinnedGoal.targetRealCost} ${s.currency})`
              : '<i>Set a pinned goal in the desktop Shop to track milestones!</i>'
          ].join('\n')
          break
        }

        case 'goals': {
          if (!this.economy) {
            reply = '❌ Economy service unavailable.'
            break
          }
          const goals = this.economy.goals().filter((g: any) => !g.completed)
          if (!goals.length) {
            reply = '🎯 <b>No active goals!</b>\n\nAll goals completed or none created. Add your dream milestones in the desktop Shop!'
          } else {
            const list = goals
              .map((g: any, idx: number) =>
                  `${idx + 1}. ${g.pinned ? '⭐ ' : ''}<b>${g.title}</b>\n   • Coins: ${g.allocatedCoins}/${g.targetCoins}\n   • Cash: ${g.allocatedRealCost}/${g.targetRealCost} ${this.economy?.getCurrency()}`
              )
              .join('\n\n')
            reply = `🎯 <b>WISHLIST MEGA GOALS:</b>\n\n${list}\n\n<i>Fund goals by staying under budget and stacking coins!</i>`
          }
          break
        }

        case 'crush':
          reply = formatUrgeResponse()
          break

        default:
          reply = `❓ Unknown command: <code>${parsed.raw}</code>\n\nSend <code>/help</code> to view available commands.`
          break
      }

      this.addLog(text, senderChatId, true, reply)
      return reply
    } catch (e) {
      const err = (e as Error).message
      const reply = `⚠️ Error executing command: ${err}`
      this.addLog(text, senderChatId, false, reply)
      return reply
    }
  }

  startPolling(): void {
    if (this.isPolling) return
    const cfg = this.getConfig()
    const tokens: string[] = []
    for (const tok of [
      cfg.botToken,
      cfg.financeBotToken,
      cfg.sportBotToken,
      cfg.manBotToken,
      cfg.wakyBotToken,
      cfg.plannerBotToken,
      cfg.coachBotToken
    ]) {
      if (tok && !tokens.includes(tok)) tokens.push(tok)
    }
    if (tokens.length === 0) return

    this.isPolling = true
    this.abortController = new AbortController()
    for (const tok of tokens) {
      this.pollLoop(tok, this.abortController.signal).catch(() => {})
    }
  }

  stopPolling(): void {
    this.isPolling = false
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  getPollingStatus(): boolean {
    return this.isPolling
  }

  getStatus(): {
    polling: boolean
    enabled: boolean
    configured: boolean
    lastPollAt: string | null
    lastError: string | null
    processedCount: number
  } {
    const cfg = this.getConfig()
    return {
      polling: this.isPolling,
      enabled: !!cfg.enabled,
      configured: !!(cfg.botToken && cfg.chatId),
      lastPollAt: this.lastPollTimestamp,
      lastError: this.lastPollingError,
      processedCount: this.processedCommandsCount
    }
  }

  private async pollLoop(token: string, signal: AbortSignal): Promise<void> {
    let offset = 0
    while (this.isPolling && !signal.aborted) {
      try {
        this.lastPollTimestamp = new Date().toISOString()
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=20`
        const timeoutSignal = AbortSignal.timeout(30000)
        const fetchSignal = typeof (AbortSignal as any).any === 'function'
          ? (AbortSignal as any).any([signal, timeoutSignal])
          : signal

        const res = await fetch(url, { signal: fetchSignal })
        if (!res.ok) {
          this.lastPollingError = `Telegram HTTP ${res.status}: ${res.statusText}`
          await new Promise((r) => setTimeout(r, 4000))
          continue
        }

        this.lastPollingError = null

        const data = (await res.json()) as {
          ok: boolean
          result?: { update_id: number; message?: { text?: string; chat?: { id: number } } }[]
        }

        if (data.ok && Array.isArray(data.result)) {
          for (const u of data.result) {
            offset = Math.max(offset, u.update_id + 1)
            if (u.message?.text && u.message?.chat?.id) {
              const text = u.message.text
              const chatId = String(u.message.chat.id)
              this.processedCommandsCount++
              const reply = await this.handleIncomingCommand(text, chatId)
              await this.sendMessage(reply, token, chatId)
            }
          }
        }
      } catch (err) {
        this.lastPollingError = (err as Error).message || 'Telegram polling error'
        if (signal.aborted) break
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
  }
}
