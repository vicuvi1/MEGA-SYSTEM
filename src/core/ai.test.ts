import { describe, expect, it } from 'vitest'
import {
  selectModelForTask,
  buildRewardPrompt,
  parseRewardResponse,
  buildPerformancePrompt,
  parsePerformanceResponse,
  type AIConfig,
  type AIRewardContext,
  type AIPerformanceContext
} from './ai'

describe('AI Core Domain Engine', () => {
  const baseConfig: AIConfig = {
    openRouterKey: 'sk-or-test-12345',
    geminiKey: 'AIzaSyTest12345',
    selectedModel: 'auto',
    enabled: true
  }

  describe('selectModelForTask', () => {
    it('throws error when no keys are provided', () => {
      expect(() => selectModelForTask({ ...baseConfig, openRouterKey: '', geminiKey: '' }, 'reward_ideas')).toThrow(
        /No AI API key found/
      )
    })

    it('routes reward_ideas to Gemini 2.5 Flash on auto when Gemini key is available', () => {
      const choice = selectModelForTask(baseConfig, 'reward_ideas')
      expect(choice.provider).toBe('gemini')
      expect(choice.model).toBe('gemini-2.5-flash')
    })

    it('routes reward_ideas to OpenRouter DeepSeek V3 when only OpenRouter key is available', () => {
      const choice = selectModelForTask({ ...baseConfig, geminiKey: '' }, 'reward_ideas')
      expect(choice.provider).toBe('openrouter')
      expect(choice.model).toBe('deepseek/deepseek-chat')
    })

    it('routes performance_report to DeepSeek R1 on auto when OpenRouter key is available', () => {
      const choice = selectModelForTask(baseConfig, 'performance_report')
      expect(choice.provider).toBe('openrouter')
      expect(choice.model).toBe('deepseek/deepseek-r1')
    })

    it('routes performance_report to Gemini 1.5 Pro when only Gemini key is available', () => {
      const choice = selectModelForTask({ ...baseConfig, openRouterKey: '' }, 'performance_report')
      expect(choice.provider).toBe('gemini')
      expect(choice.model).toBe('gemini-1.5-pro')
    })

    it('respects manual model selection when user chooses specific model', () => {
      const manual = selectModelForTask({ ...baseConfig, selectedModel: 'deepseek/deepseek-chat' }, 'performance_report')
      expect(manual.provider).toBe('openrouter')
      expect(manual.model).toBe('deepseek/deepseek-chat')
    })
  })

  describe('Reward Prompts & Parsing', () => {
    const rewardCtx: AIRewardContext = {
      level: 12,
      hunterTitle: 'Gate Breaker',
      hunterGrade: 'C-Rank',
      coinsBalance: 1450,
      vaultBalance: 600,
      currency: 'MDL',
      userPrompt: 'noise-cancelling headphones'
    }

    it('builds a rich reward generation prompt with player context', () => {
      const prompt = buildRewardPrompt(rewardCtx)
      expect(prompt).toContain('Level 12')
      expect(prompt).toContain('C-Rank')
      expect(prompt).toContain('noise-cancelling headphones')
      expect(prompt).toContain('MDL')
    })

    it('parses valid AI reward JSON array cleanly', () => {
      const rawJson = `\`\`\`json
      [
        {
          "title": "Bose QuietComfort 45",
          "price": 3500,
          "realCost": 3200,
          "tier": "gold",
          "category": "tech",
          "note": "Block out chaos and maintain deep focus flow.",
          "imageUrl": "https://images.unsplash.com/photo-headphones?w=600"
        }
      ]
      \`\`\``
      const rewards = parseRewardResponse(rawJson)
      expect(rewards).toHaveLength(1)
      expect(rewards[0].title).toBe('Bose QuietComfort 45')
      expect(rewards[0].price).toBe(3500)
      expect(rewards[0].realCost).toBe(3200)
      expect(rewards[0].tier).toBe('gold')
    })
  })

  describe('Performance Report Prompts & Parsing', () => {
    const perfCtx: AIPerformanceContext = {
      level: 15,
      hunterTitle: 'Raid Vanguard',
      hunterGrade: 'C-Rank',
      combatPower: 4500,
      todayCoins: 55,
      todayXp: 80,
      cleanStreak: 12,
      totalCleanDays: 34,
      workoutsThisWeek: 4,
      sleepQualityAvg: 4.5,
      budgetSpent: 85,
      budgetDaily: 200,
      currency: 'MDL'
    }

    it('builds a comprehensive performance evaluation prompt', () => {
      const prompt = buildPerformancePrompt(perfCtx)
      expect(prompt).toContain('Raid Vanguard')
      expect(prompt).toContain('4,500 CP')
      expect(prompt).toContain('12 consecutive days')
    })

    it('parses valid AI performance JSON report', () => {
      const rawJson = `{
        "gradeRating": "S-Rank",
        "headline": "Flawless Ascendance in Red Gates",
        "summary": "Workout frequency and budget discipline are exemplary.",
        "strengths": ["12-day clean streak", "Under budget by 115 MDL"],
        "growthAreas": ["Extend evening focus timer"],
        "strategicDirectives": ["Log morning oath before 07:00", "Execute 50 pushups"],
        "warriorVerdict": "The System has chosen a true monarch."
      }`
      const report = parsePerformanceResponse(rawJson, 'Gemini 2.5 Flash')
      expect(report.gradeRating).toBe('S-Rank')
      expect(report.headline).toBe('Flawless Ascendance in Red Gates')
      expect(report.strengths).toHaveLength(2)
      expect(report.modelUsed).toBe('Gemini 2.5 Flash')
    })
  })
})
