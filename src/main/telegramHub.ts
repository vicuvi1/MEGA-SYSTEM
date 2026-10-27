import type { UnifiedEconomyService } from './unifiedEconomy'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import {
  formatCleanCheckinResponse,
  formatExpenseResponse,
  formatHelpMessage,
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
  manBotChatId: ''
}

export class TelegramBotHub {
  private economy?: UnifiedEconomyService
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

    if (next.enabled && next.pollingEnabled && next.botToken && !this.isPolling) {
      this.startPolling()
    } else if ((!next.enabled || !next.pollingEnabled || !next.botToken) && this.isPolling) {
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

  async sendTest(): Promise<{ ok: boolean; error?: string }> {
    return this.sendMessage(
      '⚡ <b>Life System Bot Center Online!</b>\n\nYour 2-way Telegram control bridge is active. Send <code>/help</code> to this bot to view all commands.'
    )
  }

  async handleIncomingCommand(text: string, senderChatId: string): Promise<string> {
    const cfg = this.getConfig()

    // Whitelist check
    const isWhitelisted =
      (cfg.chatId && String(senderChatId) === String(cfg.chatId)) ||
      (cfg.sportBotChatId && String(senderChatId) === String(cfg.sportBotChatId)) ||
      (cfg.financeBotChatId && String(senderChatId) === String(cfg.financeBotChatId)) ||
      (cfg.manBotChatId && String(senderChatId) === String(cfg.manBotChatId))

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

        case 'expense': {
          if (!this.money) {
            reply = '❌ Money expense service unavailable.'
            break
          }
          const amt = parsed.expenseAmount || 0
          const cat = parsed.expenseCategory || 'other'
          const note = parsed.expenseNote || ''
          const cents = Math.round(amt * 100)
          const res = this.money.addExpense(
            cents,
            cat as any,
            note ? `[Telegram] ${note}` : '[Telegram]'
          )
          this.onWalletChangeCallback?.()
          const cur = res.state.currency
          reply = formatExpenseResponse(
            formatMoney(cents, cur),
            cat,
            note || null,
            formatMoney(Math.max(0, res.state.today.remaining), cur),
            res.awarded ? 3 : 0
          )
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
    if (!cfg.botToken) return

    this.isPolling = true
    this.abortController = new AbortController()
    this.pollLoop(cfg.botToken, this.abortController.signal).catch(() => {})
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
        this.lastPollingError = null
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=20`
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
        if (!res.ok) {
          await new Promise((r) => setTimeout(r, 4000))
          continue
        }

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
