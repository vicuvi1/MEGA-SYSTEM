// AI on the website: the same prompts and answers as the desktop
// (src/main/aiService.ts, prompts in @core/ai), built from this browser's copy
// of your data. Google Gemini is asked through /api/ai, which holds the key.
import {
  DEFAULT_AI_CONFIG,
  buildInspectProductPrompt,
  buildPerformancePrompt,
  buildRewardPrompt,
  buildTaskDecomposePrompt,
  heuristicInspectProduct,
  parseInspectProductResponse,
  parsePerformanceResponse,
  parseRewardResponse,
  parseTaskDecomposition,
  type AIConfig
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

/** Todoist, when connected: the coach's new tasks go there (one task list). */
export interface AiTodoist {
  on: () => Promise<boolean>
  quickAdd: (text: string) => Promise<{ content: string; due: string | null }>
}

export function createWebAi(svc: WebServices, ask: AskAi, status: () => Promise<boolean>, todoist?: AiTodoist) {
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
