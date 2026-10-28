import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import {
  buildPerformancePrompt,
  buildRewardPrompt,
  buildSystemOraclePrompt,
  buildTaskDecomposePrompt,
  buildInspectProductPrompt,
  heuristicInspectProduct,
  parseInspectProductResponse,
  type InspectedProductResult,
  DEFAULT_AI_CONFIG,
  parsePerformanceResponse,
  parseRewardResponse,
  parseTaskDecomposition,
  parseAgentToolCalls,
  type AgentToolCall,
  type ToolExecutionResult,
  selectModelForTask,
  type AIConfig,
  type AIPerformanceContext,
  type AIPerformanceReport,
  type AIRewardContext,
  type AITask,
  type GeneratedReward,
  type SystemCoachContext,
  type TaskDecompositionResult
} from '@core/ai'
import { levelInfo } from '@core/levels'
import { balance, totalXp } from '@core/ledger'
import type { Wallet } from './wallet'
import type { Discipline } from './discipline'
import type { MoneyService } from './money'
import type { SleepService } from './sleep'
import type { CalendarService } from './calendarService'
import type { Tasks } from './planner'
import type { Body } from './body'

export class AIService {
  private file: string
  private calendar?: CalendarService
  private tasksService?: Tasks
  private bodyService?: Body
  private onDataChanged?: () => void

  constructor(
    filePath?: string,
    private wallet?: Wallet,
    private discipline?: Discipline,
    private money?: MoneyService,
    private sleep?: SleepService,
    private customFetch: typeof fetch = fetch,
    calendar?: CalendarService,
    tasksService?: Tasks,
    bodyService?: Body,
    onDataChanged?: () => void
  ) {
    this.calendar = calendar
    this.tasksService = tasksService
    this.bodyService = bodyService
    this.onDataChanged = onDataChanged
    try {
      this.file = filePath ?? join(app.getPath('userData'), 'ai_config.bin')
    } catch {
      this.file = filePath ?? join(process.cwd(), 'ai_config.bin')
    }
  }

  setCalendar(cal: CalendarService): void {
    this.calendar = cal
  }

  setTasks(tasks: Tasks): void {
    this.tasksService = tasks
  }

  setBody(body: Body): void {
    this.bodyService = body
  }

  setOnDataChanged(cb: () => void): void {
    this.onDataChanged = cb
  }

  getConfig(): AIConfig {
    if (!existsSync(this.file)) return { ...DEFAULT_AI_CONFIG }
    try {
      const buf = readFileSync(this.file)
      if (!buf || !buf.length) return { ...DEFAULT_AI_CONFIG }
      const migrate = (cfg: AIConfig): AIConfig => {
        const legacy = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-lite']
        if (legacy.includes(cfg.selectedModel)) cfg.selectedModel = 'gemini-3.5-flash'
        return cfg
      }
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const str = safeStorage.decryptString(buf)
        return migrate({ ...DEFAULT_AI_CONFIG, ...JSON.parse(str) })
      }
      return migrate({ ...DEFAULT_AI_CONFIG, ...JSON.parse(buf.toString('utf8')) })
    } catch {
      return { ...DEFAULT_AI_CONFIG }
    }
  }

  saveConfig(patch: Partial<AIConfig>): AIConfig {
    const cur = this.getConfig()
    const legacy = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-lite']
    const nextModel = patch.selectedModel !== undefined ? patch.selectedModel : cur.selectedModel
    const next: AIConfig = {
      ...cur,
      ...patch,
      selectedModel: legacy.includes(nextModel) ? 'gemini-3.5-flash' : nextModel,
      openRouterKey: patch.openRouterKey !== undefined ? patch.openRouterKey.trim() : cur.openRouterKey,
      geminiKey: patch.geminiKey !== undefined ? patch.geminiKey.trim() : cur.geminiKey
    }
    const json = JSON.stringify(next)
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      writeFileSync(this.file, safeStorage.encryptString(json))
    } else {
      writeFileSync(this.file, Buffer.from(json, 'utf8'))
    }
    return next
  }

  private async callGemini(model: string, key: string, prompt: string): Promise<string> {
    const cleanKey = (key || '').trim()
    if (!cleanKey) throw new Error('No Google Gemini API key configured. Please obtain a free key from Google AI Studio.')

    let targetModel = (model || '').trim().replace(/^models\//, '')
    const legacyMap: Record<string, string> = {
      'gemini-2.5-flash': 'gemini-3.5-flash',
      'gemini-2.0-flash': 'gemini-3.5-flash',
      'gemini-1.5-flash': 'gemini-3.5-flash',
      'gemini-1.5-pro': 'gemini-3.1-pro-preview',
      'gemini-2.0-flash-lite': 'gemini-3.1-flash-lite'
    }
    if (legacyMap[targetModel]) {
      targetModel = legacyMap[targetModel]
    } else if (!targetModel.startsWith('gemini')) {
      targetModel = 'gemini-3.5-flash'
    }

    const tryFetch = async (m: string) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(cleanKey)}`
      return await this.customFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
        })
      })
    }

    const candidateModels = Array.from(
      new Set([targetModel, 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'])
    )

    let res: Response | null = null
    let successfulModel = targetModel

    for (const candidate of candidateModels) {
      try {
        const response = await tryFetch(candidate)
        if (response.ok) {
          res = response
          successfulModel = candidate
          break
        }
        if (response.status === 404) {
          continue
        }
        res = response
        successfulModel = candidate
        break
      } catch {
        // network attempt failed, continue
      }
    }

    // Dynamic model discovery fallback if static candidates 404
    if (!res || !res.ok) {
      try {
        const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`
        const listRes = await this.customFetch(listUrl)
        if (listRes.ok) {
          const listData = (await listRes.json()) as any
          const availableModels: string[] = (listData.models || [])
            .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
            .map((m: any) => String(m.name).replace(/^models\//, ''))

          const dynamicCandidate = availableModels.find((m) => m.includes('flash')) || availableModels[0]
          if (dynamicCandidate && !candidateModels.includes(dynamicCandidate)) {
            const dynamicRes = await tryFetch(dynamicCandidate)
            if (dynamicRes.ok) {
              res = dynamicRes
              successfulModel = dynamicCandidate
            }
          }
        }
      } catch {
        // fallback ignored
      }
    }

    if (!res || !res.ok) {
      const errText = res ? await res.text() : 'No response from Google Gemini servers'
      throw new Error(`Google Gemini API error (${res?.status ?? 500}): ${errText} (${successfulModel})`)
    }

    const data = (await res.json()) as any
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error('Empty response from Google Gemini model')
    return text
  }

  private async callOpenRouter(model: string, key: string, prompt: string): Promise<string> {
    const url = 'https://openrouter.ai/api/v1/chat/completions'
    const res = await this.customFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': 'https://github.com/vicuvi1/MEGA-SYSTEM',
        'X-Title': 'Life System'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7
      })
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`OpenRouter API error (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as any
    const text = data.choices?.[0]?.message?.content
    if (!text) throw new Error('Empty response from OpenRouter model')
    return text
  }

  async executeTask(task: AITask, prompt: string): Promise<{ text: string; model: string; provider: string }> {
    const cfg = this.getConfig()
    const { provider, model } = selectModelForTask(cfg, task)

    let text = ''
    if (provider === 'gemini') {
      text = await this.callGemini(model, cfg.geminiKey, prompt)
    } else {
      text = await this.callOpenRouter(model, cfg.openRouterKey, prompt)
    }

    return { text, model, provider }
  }

  async testConnection(provider?: 'gemini' | 'openrouter'): Promise<{ ok: boolean; message: string; model: string }> {
    const cfg = this.getConfig()
    const targetProvider = provider ?? (cfg.geminiKey ? 'gemini' : 'openrouter')
    const legacy = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-lite']
    let model = targetProvider === 'gemini'
      ? (cfg.selectedModel.startsWith('gemini') && !legacy.includes(cfg.selectedModel) ? cfg.selectedModel : 'gemini-3.5-flash')
      : (cfg.selectedModel && !cfg.selectedModel.startsWith('gemini') && cfg.selectedModel !== 'auto' ? cfg.selectedModel : 'deepseek/deepseek-chat')

    try {
      let reply = ''
      if (targetProvider === 'gemini') {
        if (!cfg.geminiKey) throw new Error('No Google Gemini API key configured')
        reply = await this.callGemini(model, cfg.geminiKey, 'Respond with "System Online: Awakening Initialized."')
      } else {
        if (!cfg.openRouterKey) throw new Error('No OpenRouter API key configured')
        reply = await this.callOpenRouter(model, cfg.openRouterKey, 'Respond with "System Online: Awakening Initialized."')
      }

      return {
        ok: true,
        message: reply.trim(),
        model: `${targetProvider.toUpperCase()}: ${model}`
      }
    } catch (err: any) {
      return {
        ok: false,
        message: err.message,
        model
      }
    }
  }

  async inspectProduct(queryOrUrl: string): Promise<InspectedProductResult> {
    const currency = this.money?.state()?.currency ?? 'MDL'
    const clean = queryOrUrl?.trim() || ''
    if (!clean) {
      return heuristicInspectProduct('Reward Upgrade', currency)
    }

    try {
      const cfg = this.getConfig()
      if (!cfg.geminiKey && !cfg.openRouterKey) {
        return heuristicInspectProduct(clean, currency)
      }
      const prompt = buildInspectProductPrompt(clean, currency)
      const { text } = await this.executeTask('inspect_product', prompt)
      return parseInspectProductResponse(text, clean, currency)
    } catch {
      return heuristicInspectProduct(clean, currency)
    }
  }

  async generateRewards(userPrompt?: string): Promise<{ rewards: GeneratedReward[]; modelUsed: string }> {
    const all = this.wallet?.entries() ?? []
    const lv = levelInfo(totalXp(all))
    const coinsBalance = balance(all)

    const ctx: AIRewardContext = {
      level: lv.level,
      hunterTitle: lv.hunterTitle,
      hunterGrade: lv.hunterGrade,
      coinsBalance,
      vaultBalance: 0,
      currency: 'MDL',
      userPrompt
    }

    const prompt = buildRewardPrompt(ctx)
    const { text, model, provider } = await this.executeTask('reward_ideas', prompt)
    const rewards = parseRewardResponse(text)
    return { rewards, modelUsed: `${provider.toUpperCase()} (${model})` }
  }

  async generatePerformanceReport(): Promise<AIPerformanceReport> {
    const all = this.wallet?.entries() ?? []
    const lv = levelInfo(totalXp(all))
    const summary = this.wallet?.summary()
    const disc = this.discipline?.state()
    const sleep = this.sleep?.state()
    const money = this.money?.state()

    const ctx: AIPerformanceContext = {
      level: lv.level,
      hunterTitle: lv.hunterTitle,
      hunterGrade: lv.hunterGrade,
      combatPower: lv.attributes?.totalCombatPower ?? lv.level * 150,
      todayCoins: summary?.todayCoins ?? 0,
      todayXp: summary?.todayXp ?? 0,
      cleanStreak: disc?.current ?? 0,
      totalCleanDays: disc?.totalClean ?? 0,
      workoutsThisWeek: 3,
      sleepQualityAvg: sleep?.todayLog?.quality ?? 4,
      budgetSpent: money?.today?.totalSpent ?? 0,
      budgetDaily: (money?.dailyBudget ?? 10000) / 100,
      currency: money?.currency ?? 'MDL',
      calendarAgenda: this.calendar?.getEventsForAi()
    }

    const prompt = buildPerformancePrompt(ctx)
    const { text, model, provider } = await this.executeTask('performance_report', prompt)
    return parsePerformanceResponse(text, `${provider.toUpperCase()} (${model})`)
  }


  async executeToolCall(call: AgentToolCall): Promise<ToolExecutionResult> {
    const { tool, args } = call
    try {
      switch (tool) {
        case 'complete_task': {
          if (!this.tasksService) return { tool, result: 'Tasks service not available', success: false }
          const query = String(args.task || args.title || args.name || '').trim().toLowerCase()
          const state = this.tasksService.state()
          const matching = state.tasks.find((t) => !t.done && (
            t.title.toLowerCase().includes(query) ||
            String(t.id) === query ||
            query.includes(t.title.toLowerCase())
          ))
          if (!matching) {
            return { tool, result: `No open task found matching "${query}"`, success: false }
          }
          this.tasksService.complete(matching.id)
          this.onDataChanged?.()
          return {
            tool,
            result: `✓ Completed quest "${matching.title}" (+${matching.coins} 🪙 / +${matching.xp} XP)`,
            success: true,
            data: { taskId: matching.id, taskTitle: matching.title }
          }
        }

        case 'add_task': {
          if (!this.tasksService) return { tool, result: 'Tasks service not available', success: false }
          const title = String(args.title || args.name || '').trim()
          if (!title) return { tool, result: 'Task title is required', success: false }
          const priority = (args.priority === 1 || args.priority === 2 || args.priority === 3) ? args.priority : 2
          const category = String(args.category || 'life').toLowerCase()
          const due = args.due ? String(args.due) : null
          const coins = priority === 1 ? 15 : (priority === 2 ? 10 : 5)
          const xp = priority === 1 ? 30 : (priority === 2 ? 20 : 10)
          this.tasksService.save({
            title,
            priority,
            category: this.tasksService.categories().some(c => c.id === category) ? category : (this.tasksService.categories()[0]?.id || 'life'),
            coins,
            xp,
            due,
            notes: null,
            repeat: 'none',
            weekdays: 127
          })
          this.onDataChanged?.()
          return {
            tool,
            result: `✓ Created quest "${title}" [P${priority}] (+${coins} 🪙 reward)`,
            success: true
          }
        }

        case 'delete_task': {
          if (!this.tasksService) return { tool, result: 'Tasks service not available', success: false }
          const query = String(args.task || args.title || '').trim().toLowerCase()
          const state = this.tasksService.state()
          const matching = state.tasks.find((t) => t.title.toLowerCase().includes(query) || String(t.id) === query)
          if (!matching) {
            return { tool, result: `Task "${query}" not found to delete`, success: false }
          }
          this.tasksService.archive(matching.id)
          this.onDataChanged?.()
          return {
            tool,
            result: `✓ Removed quest "${matching.title}" from queue`,
            success: true
          }
        }

        case 'log_workout': {
          if (!this.bodyService) return { tool, result: 'Body/Workout service not available', success: false }
          const exercise = String(args.exercise || args.name || 'Workout').trim()
          const amount = parseFloat(args.amount) || 20
          const unit = String(args.unit || 'reps').toLowerCase()
          const validUnit = ['reps', 'sets', 'kg', 'km', 'minutes'].includes(unit) ? unit : 'reps'
          const workoutRes = this.bodyService.logWorkout({
            title: `${exercise} (${amount} ${validUnit})`,
            items: [{
              exerciseId: exercise.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
              name: exercise,
              amount,
              unit: validUnit as any
            }],
            note: 'Logged by System Oracle Agent'
          })
          const latestId = this.bodyService.workouts(1)[0]?.id
          this.onDataChanged?.()
          return {
            tool,
            result: `✓ Logged ${amount} ${validUnit} of ${exercise} (+15 🪙 / +35 XP)`,
            success: true,
            data: { workoutId: latestId, ledgerId: workoutRes.workout.ledgerId }
          }
        }

        case 'log_water': {
          const ml = parseInt(args.amountMl || args.amount || 250, 10)
          this.onDataChanged?.()
          return {
            tool,
            result: `✓ Logged +${ml} ml of water into Daily Hydration Tracker`,
            success: true
          }
        }

        case 'log_clean_checkin': {
          if (!this.discipline) return { tool, result: 'Discipline service not available', success: false }
          this.discipline.checkIn()
          const discState = this.discipline.state()
          this.onDataChanged?.()
          return {
            tool,
            result: `✓ Clean Day Affirmed! Current Streak: ${discState.current} days (+20 🪙 / +40 XP)`,
            success: true
          }
        }

        case 'log_expense': {
          if (!this.money) return { tool, result: 'Money service not available', success: false }
          const amount = parseFloat(args.amount) || 0
          const category = String(args.category || 'food').toLowerCase()
          const note = args.note ? String(args.note) : undefined
          const expenseRes = this.money.addExpense(Math.round(amount * 100), category, note || 'Logged by System Oracle')
          this.onDataChanged?.()
          return {
            tool,
            result: `✓ Recorded ${amount} ${this.money.state().currency} expense for ${category}${note ? ` (${note})` : ''}`,
            success: true,
            data: { expenseId: expenseRes.expense.id }
          }
        }

        case 'log_metric': {
          if (!this.bodyService) return { tool, result: 'Body service not available', success: false }
          const weight = args.weight ? parseFloat(args.weight) : undefined
          const waist = args.waist ? parseFloat(args.waist) : undefined
          this.bodyService.logMetric({ weight, waist, note: 'Logged by System Oracle' })
          this.onDataChanged?.()
          return {
            tool,
            result: `✓ Logged body composition: ${weight ? `${weight} kg ` : ''}${waist ? `${waist} cm` : ''} (+5 🪙)`,
            success: true
          }
        }

        case 'award_coins': {
          if (!this.wallet) return { tool, result: 'Wallet service not available', success: false }
          const amount = Math.min(100, Math.max(1, parseInt(args.amount, 10) || 10))
          const reason = String(args.reason || 'Oracle Tactical Reward').trim()
          const now = new Date()
          const ledgerId = this.wallet.append({
            ts: now.toISOString(),
            day: this.wallet.today(now),
            module: 'oracle',
            kind: 'earn',
            coins: amount,
            xp: amount * 2,
            ref: 'oracle:reward',
            note: reason
          })
          this.onDataChanged?.()
          return {
            tool,
            result: `✓ Awarded +${amount} 🪙 Coins: ${reason}`,
            success: true,
            data: { ledgerId }
          }
        }

        default:
          return { tool, result: `Unknown tool "${tool}"`, success: false }
      }
    } catch (err: any) {
      return { tool, result: `Tool failed: ${err.message}`, success: false }
    }
  }

  async askCoach(
    userMessage: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<{
    reply: string
    modelUsed: string
    toolExecutions?: Array<{ tool: string; result: string; success: boolean }>
  }> {
    const all = this.wallet?.entries() ?? []
    const lv = levelInfo(totalXp(all))
    const coinsBalance = balance(all)
    const disc = this.discipline?.state()
    const calendarAgenda = this.calendar?.getEventsForAi()
    const bodyState = this.bodyService?.state()

    // Retrieve active tasks for tactical awareness
    let tasksSummary = ''
    try {
      const activeTasks = this.tasksService?.state()?.tasks?.filter((t) => !t.done) ?? []
      if (activeTasks.length > 0) {
        tasksSummary = activeTasks
          .slice(0, 8)
          .map((t, i) => `${i + 1}. [P${t.priority}] ${t.title} (${t.category}${t.due ? ` due ${t.due}` : ''})`)
          .join('\n')
      }
    } catch {
      // safe fallback
    }

    const coachCtx: SystemCoachContext = {
      level: lv.level,
      hunterTitle: lv.hunterTitle,
      hunterGrade: lv.hunterGrade,
      attributes: lv.attributes,
      coinsBalance,
      cleanStreakDays: disc?.current ?? 0,
      todayTasksSummary: tasksSummary,
      calendarAgenda,
      currentDate: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      currentTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      latestWeight: bodyState?.latestWeight ?? null,
      latestWaist: bodyState?.latestWaist ?? null
    }

    const systemPrompt = buildSystemOraclePrompt(coachCtx, userMessage, history)
    const { text, model, provider } = await this.executeTask('coach_chat', systemPrompt)

    const { cleanedText, toolCalls } = parseAgentToolCalls(text)
    const toolExecutions: ToolExecutionResult[] = []

    for (const call of toolCalls) {
      const res = await this.executeToolCall(call)
      toolExecutions.push(res)
    }

    let finalReply = cleanedText
    if (toolExecutions.length > 0) {
      const toolSummaries = toolExecutions.map((e) => e.result).join('\n')
      finalReply = finalReply ? `${finalReply}\n\n${toolSummaries}` : toolSummaries
    }

    return {
      reply: finalReply.trim(),
      modelUsed: `${provider.toUpperCase()} (${model})`,
      toolExecutions: toolExecutions.length > 0 ? toolExecutions : undefined
    }
  }

  async decomposeTask(
    title: string,
    notes?: string,
    category?: string
  ): Promise<TaskDecompositionResult> {
    const all = this.wallet?.entries() ?? []
    const lv = levelInfo(totalXp(all))
    const prompt = buildTaskDecomposePrompt(title, notes, category, lv.hunterGrade)
    const { text, model, provider } = await this.executeTask('decompose_task', prompt)
    return parseTaskDecomposition(text, `${provider.toUpperCase()} (${model})`)
  }
}
