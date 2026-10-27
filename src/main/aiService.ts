import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import {
  buildPerformancePrompt,
  buildRewardPrompt,
  buildSystemOraclePrompt,
  buildTaskDecomposePrompt,
  DEFAULT_AI_CONFIG,
  parsePerformanceResponse,
  parseRewardResponse,
  parseTaskDecomposition,
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

export class AIService {
  private file: string
  private calendar?: CalendarService
  private tasksService?: Tasks

  constructor(
    filePath?: string,
    private wallet?: Wallet,
    private discipline?: Discipline,
    private money?: MoneyService,
    private sleep?: SleepService,
    private customFetch: typeof fetch = fetch,
    calendar?: CalendarService,
    tasksService?: Tasks
  ) {
    this.calendar = calendar
    this.tasksService = tasksService
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

  getConfig(): AIConfig {
    if (!existsSync(this.file)) return { ...DEFAULT_AI_CONFIG }
    try {
      const buf = readFileSync(this.file)
      if (!buf || !buf.length) return { ...DEFAULT_AI_CONFIG }
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const str = safeStorage.decryptString(buf)
        const cfg = { ...DEFAULT_AI_CONFIG, ...JSON.parse(str) }
        if (cfg.selectedModel === 'gemini-2.5-flash') cfg.selectedModel = 'gemini-2.0-flash'
        return cfg
      }
      const cfg = { ...DEFAULT_AI_CONFIG, ...JSON.parse(buf.toString('utf8')) }
      if (cfg.selectedModel === 'gemini-2.5-flash') cfg.selectedModel = 'gemini-2.0-flash'
      return cfg
    } catch {
      return { ...DEFAULT_AI_CONFIG }
    }
  }

  saveConfig(patch: Partial<AIConfig>): AIConfig {
    const cur = this.getConfig()
    const next: AIConfig = {
      ...cur,
      ...patch,
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
    let targetModel = model === 'gemini-2.5-flash' || !model.startsWith('gemini') ? 'gemini-2.0-flash' : model

    const tryFetch = async (m: string) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(key)}`
      return await this.customFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
        })
      })
    }

    let res = await tryFetch(targetModel)
    // Automatic fallback if requested model is 404 (e.g. deprecated or unavailable)
    if (res.status === 404 && targetModel !== 'gemini-2.0-flash') {
      targetModel = 'gemini-2.0-flash'
      res = await tryFetch(targetModel)
    }
    if (res.status === 404 && targetModel !== 'gemini-1.5-flash') {
      targetModel = 'gemini-1.5-flash'
      res = await tryFetch(targetModel)
    }

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Google Gemini API error (${res.status}): ${errText} (${targetModel})`)
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
    let model = targetProvider === 'gemini'
      ? (cfg.selectedModel.startsWith('gemini') && cfg.selectedModel !== 'gemini-2.5-flash' ? cfg.selectedModel : 'gemini-2.0-flash')
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

  async askCoach(
    userMessage: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<{ reply: string; modelUsed: string }> {
    const all = this.wallet?.entries() ?? []
    const lv = levelInfo(totalXp(all))
    const coinsBalance = balance(all)
    const disc = this.discipline?.state()
    const calendarAgenda = this.calendar?.getEventsForAi()

    // Retrieve active tasks for tactical awareness
    let tasksSummary = ''
    try {
      const activeTasks = this.tasksService?.state()?.tasks?.filter((t) => !t.done) ?? []
      if (activeTasks.length > 0) {
        tasksSummary = activeTasks
          .slice(0, 6)
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
      calendarAgenda
    }

    const systemPrompt = buildSystemOraclePrompt(coachCtx, userMessage, history)
    const { text, model, provider } = await this.executeTask('coach_chat', systemPrompt)
    return { reply: text.trim(), modelUsed: `${provider.toUpperCase()} (${model})` }
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
