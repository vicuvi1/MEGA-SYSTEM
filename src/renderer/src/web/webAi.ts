// AI on the website: the same prompts and answers as the desktop
// (src/main/aiService.ts, prompts in @core/ai), built from this browser's copy
// of your data. Google Gemini is asked through /api/ai, which holds the key.
import {
  DEFAULT_AI_CONFIG,
  buildInspectProductPrompt,
  buildPerformancePrompt,
  buildRewardPrompt,
  buildSystemOraclePrompt,
  buildTaskDecomposePrompt,
  heuristicInspectProduct,
  parseAgentToolCalls,
  parseInspectProductResponse,
  parsePerformanceResponse,
  parseRewardResponse,
  parseTaskDecomposition,
  type AIConfig,
  type AgentToolCall,
  type ToolExecutionResult
} from '@core/ai'
import { levelInfo } from '@core/levels'
import { balance, totalXp } from '@core/ledger'
import type { Services, WebServices } from './webServices'

export type AskAi = (prompt: string) => Promise<{ text: string; model: string }>

/** Calls /api/ai with the session; errors carry the server's plain message. */
export function serverAi(session: () => string | null): AskAi {
  return async (prompt) => {
    const r = await fetch('/api/ai', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session() ?? ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `AI ${r.status}`)
    return { text: String(j.text ?? ''), model: String(j.model ?? 'gemini') }
  }
}

const used = (model: string) => `GEMINI (${model})`

/** One of the coach's actions ("add a task", "log 20 push-ups"), on the services. */
export function runTool(s: Services, call: AgentToolCall): ToolExecutionResult {
  const { tool, args } = call
  try {
    switch (tool) {
      case 'complete_task': {
        const q = String(args.task || args.title || args.name || '').trim().toLowerCase()
        const t = s.tasks.state().tasks.find((x) => !x.done && (x.title.toLowerCase().includes(q) || String(x.id) === q || q.includes(x.title.toLowerCase())))
        if (!q || !t) return { tool, result: `No open task found matching "${q}"`, success: false }
        s.tasks.complete(t.id)
        return { tool, result: `✓ Completed "${t.title}" (+${t.coins} 🪙)`, success: true, data: { taskId: t.id } }
      }
      case 'add_task': {
        const title = String(args.title || args.name || '').trim()
        if (!title) return { tool, result: 'Task title is required', success: false }
        const priority = args.priority === 1 || args.priority === 2 || args.priority === 3 ? args.priority : 2
        const cats = s.tasks.categories()
        const want = String(args.category || 'life').toLowerCase()
        s.tasks.save({
          title,
          priority,
          category: cats.some((c) => c.id === want) ? want : (cats[0]?.id ?? 'life'),
          coins: priority === 1 ? 15 : priority === 2 ? 10 : 5,
          xp: priority === 1 ? 30 : priority === 2 ? 20 : 10,
          due: args.due ? String(args.due) : null,
          notes: null,
          repeat: 'none',
          weekdays: 127
        } as any)
        return { tool, result: `✓ Added task "${title}" [P${priority}]`, success: true }
      }
      case 'delete_task': {
        const q = String(args.task || args.title || '').trim().toLowerCase()
        const t = s.tasks.state().tasks.find((x) => x.title.toLowerCase().includes(q) || String(x.id) === q)
        if (!q || !t) return { tool, result: `Task "${q}" not found`, success: false }
        s.tasks.archive(t.id)
        return { tool, result: `✓ Removed "${t.title}"`, success: true }
      }
      case 'log_workout': {
        const exercise = String(args.exercise || args.name || 'Workout').trim()
        const amount = parseFloat(args.amount) || 20
        const u = String(args.unit || 'reps').toLowerCase()
        const unit = ['reps', 'sets', 'kg', 'km', 'minutes'].includes(u) ? u : 'reps'
        s.body.logWorkout({
          title: `${exercise} (${amount} ${unit})`,
          items: [{ exerciseId: exercise.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: exercise, amount, unit: unit as any }],
          note: 'Logged by the AI coach'
        } as any)
        return { tool, result: `✓ Logged ${amount} ${unit} of ${exercise}`, success: true }
      }
      case 'log_clean_checkin': {
        s.discipline.checkIn()
        return { tool, result: `✓ Clean day checked in: ${s.discipline.state().current} days`, success: true }
      }
      case 'log_expense': {
        const amount = parseFloat(args.amount) || 0
        if (amount <= 0) return { tool, result: 'The amount is missing', success: false }
        const category = String(args.category || 'food').toLowerCase()
        s.money.addExpense(Math.round(amount * 100), category as any, args.note ? String(args.note) : 'Logged by the AI coach')
        return { tool, result: `✓ Recorded ${amount} ${s.money.state().currency} for ${category}`, success: true }
      }
      case 'log_metric': {
        const weight = args.weight ? parseFloat(args.weight) : undefined
        const waist = args.waist ? parseFloat(args.waist) : undefined
        s.body.logMetric({ weight, waist, note: 'Logged by the AI coach' } as any)
        return { tool, result: `✓ Logged ${weight ? `${weight} kg ` : ''}${waist ? `${waist} cm` : ''}`.trim(), success: true }
      }
      case 'award_coins': {
        const amount = Math.min(100, Math.max(1, parseInt(args.amount, 10) || 10))
        const reason = String(args.reason || 'Coach reward').trim()
        const now = new Date()
        s.wallet.append({ ts: now.toISOString(), day: s.wallet.today(now), module: 'oracle', kind: 'earn', coins: amount, xp: amount * 2, ref: 'oracle:reward', note: reason } as any)
        return { tool, result: `✓ +${amount} 🪙: ${reason}`, success: true }
      }
      default:
        return { tool, result: `I can't do "${tool}" on the website`, success: false }
    }
  } catch (e: any) {
    return { tool, result: `That didn't work: ${e?.message ?? e}`, success: false }
  }
}

export function createWebAi(svc: WebServices, ask: AskAi, status: () => Promise<boolean>) {
  const level = (s: Services) => {
    const all = s.wallet.entries()
    return { lv: levelInfo(totalXp(all)), coins: balance(all) }
  }
  const config = async (): Promise<AIConfig> => {
    const on = await status().catch(() => false)
    // The key never comes to the page; a marker tells the UI it is there.
    return { ...DEFAULT_AI_CONFIG, geminiKey: on ? 'on the server' : '', selectedModel: 'gemini-3.5-flash', enabled: on }
  }
  return {
    config,
    saveConfig: async () => config(),
    test: async () => {
      try {
        const r = await ask('Reply with exactly: AI is ready.')
        return { ok: true, message: r.text.trim(), model: used(r.model) }
      } catch (e: any) {
        return { ok: false, message: e?.message ?? String(e), model: '' }
      }
    },
    generateRewards: async (userPrompt?: string) => {
      const prompt = await svc.read((s) => {
        const { lv, coins } = level(s)
        return buildRewardPrompt({ level: lv.level, hunterTitle: lv.hunterTitle, hunterGrade: lv.hunterGrade, coinsBalance: coins, vaultBalance: 0, currency: 'MDL', userPrompt })
      })
      const r = await ask(prompt)
      return { rewards: parseRewardResponse(r.text), modelUsed: used(r.model) }
    },
    performanceReport: async () => {
      const prompt = await svc.read((s) => {
        const { lv } = level(s)
        const sum = s.wallet.summary()
        const money = s.money.state()
        return buildPerformancePrompt({
          level: lv.level,
          hunterTitle: lv.hunterTitle,
          hunterGrade: lv.hunterGrade,
          combatPower: lv.attributes?.totalCombatPower ?? lv.level * 150,
          todayCoins: sum.todayCoins ?? 0,
          todayXp: sum.todayXp ?? 0,
          cleanStreak: s.discipline.state().current ?? 0,
          totalCleanDays: s.discipline.state().totalClean ?? 0,
          workoutsThisWeek: s.body.workouts(20).filter((w: any) => Date.now() - new Date(w.ts ?? w.day).getTime() < 7 * 86400_000).length,
          sleepQualityAvg: s.sleep.state().todayLog?.quality ?? 4,
          budgetSpent: money?.today?.totalSpent ?? 0,
          budgetDaily: (money?.dailyBudget ?? 10000) / 100,
          currency: money?.currency ?? 'MDL'
        })
      })
      const r = await ask(prompt)
      return parsePerformanceResponse(r.text, used(r.model))
    },
    askCoach: async (message: string, history?: Array<{ role: 'user' | 'assistant'; content: string }>) => {
      const prompt = await svc.read((s) => {
        const { lv, coins } = level(s)
        const open = s.tasks.state().tasks.filter((t) => !t.done).slice(0, 8)
        const body = s.body.state()
        const now = new Date()
        return buildSystemOraclePrompt(
          {
            level: lv.level,
            hunterTitle: lv.hunterTitle,
            hunterGrade: lv.hunterGrade,
            attributes: lv.attributes,
            coinsBalance: coins,
            cleanStreakDays: s.discipline.state().current ?? 0,
            todayTasksSummary: open.map((t, i) => `${i + 1}. [P${t.priority}] ${t.title} (${t.category}${t.due ? ` due ${t.due}` : ''})`).join('\n'),
            currentDate: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
            currentTime: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            latestWeight: body?.latestWeight ?? null,
            latestWaist: body?.latestWaist ?? null
          } as any,
          message,
          history
        )
      })
      const r = await ask(prompt)
      const { cleanedText, toolCalls } = parseAgentToolCalls(r.text)
      const runs = toolCalls.length
        ? await svc.write((s) => toolCalls.map((c) => runTool(s, c)), 'life-wallet-changed', 'life-discipline-changed', 'life-body-changed')
        : []
      if (runs.length) window.dispatchEvent(new CustomEvent('life-tasks-changed'))
      const extra = runs.map((x) => x.result).join('\n')
      return {
        reply: (cleanedText ? (extra ? `${cleanedText}\n\n${extra}` : cleanedText) : extra).trim(),
        modelUsed: used(r.model),
        toolExecutions: runs.length ? runs : undefined
      }
    },
    decomposeTask: async (title: string, notes?: string, category?: string) => {
      const grade = await svc.read((s) => level(s).lv.hunterGrade)
      const r = await ask(buildTaskDecomposePrompt(title, notes, category, grade))
      return parseTaskDecomposition(r.text, used(r.model))
    },
    inspectProduct: async (q: string) => {
      const currency = (await svc.read((s) => s.money.state()?.currency)) ?? 'MDL'
      const clean = q?.trim() || ''
      if (!clean) return heuristicInspectProduct('Reward Upgrade', currency)
      try {
        const r = await ask(buildInspectProductPrompt(clean, currency))
        return parseInspectProductResponse(r.text, clean, currency)
      } catch {
        return heuristicInspectProduct(clean, currency)
      }
    }
  }
}
