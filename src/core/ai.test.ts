import { describe, expect, it } from 'vitest'
import {
  selectModelForTask,
  buildRewardPrompt,
  parseRewardResponse,
  buildPerformancePrompt,
  parsePerformanceResponse,
  buildSystemOraclePrompt,
  buildTaskDecomposePrompt,
  parseTaskDecomposition,
  parseAgentToolCalls,
  heuristicInspectProduct,
  buildInspectProductPrompt,
  parseInspectProductResponse,
  type AIConfig,
  type AIRewardContext,
  type AIPerformanceContext,
  type SystemCoachContext
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

    it('routes reward_ideas to Gemini 3.5 Flash on auto when Gemini key is available', () => {
      const choice = selectModelForTask(baseConfig, 'reward_ideas')
      expect(choice.provider).toBe('gemini')
      expect(choice.model).toBe('gemini-3.5-flash')
    })

    it('routes decompose_task to Gemini 3.5 Flash on auto when Gemini key is available', () => {
      const choice = selectModelForTask(baseConfig, 'decompose_task')
      expect(choice.provider).toBe('gemini')
      expect(choice.model).toBe('gemini-3.5-flash')
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

    it('routes performance_report to Gemini 3.1 Pro when only Gemini key is available', () => {
      const choice = selectModelForTask({ ...baseConfig, openRouterKey: '' }, 'performance_report')
      expect(choice.provider).toBe('gemini')
      expect(choice.model).toBe('gemini-3.1-pro-preview')
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
      expect(prompt).toContain('Points balance')
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
      expect(prompt).toContain('tough-love personal coach')
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

  describe('System Oracle Coach & Task Decomposition', () => {
    const coachCtx: SystemCoachContext = {
      level: 20,
      hunterTitle: 'Shadow Sovereign',
      hunterGrade: 'S-Rank',
      attributes: {
        str: 45,
        agi: 40,
        vit: 38,
        int: 52,
        sen: 50,
        totalCombatPower: 675
      },
      coinsBalance: 2400,
      cleanStreakDays: 30,
      todayTasksSummary: '1. SI-266 Lab 7 (P1)\n2. Gym Push Day',
      calendarAgenda: '10:00 - Distributed Systems Lecture'
    }

    it('builds system oracle prompt with telemetry and instructions', () => {
      const prompt = buildSystemOraclePrompt(coachCtx, 'I feel lazy today, give me a directive.')
      expect(prompt).toContain('Tough love')
      expect(prompt).toContain('30 Days')
      expect(prompt).toContain('SI-266 Lab 7')
      expect(prompt).toContain('Distributed Systems Lecture')
      expect(prompt).toContain('Victor: I feel lazy today')
    })

    it('builds task decomposition prompt with quest details', () => {
      const prompt = buildTaskDecomposePrompt('Finish SI-266 Lab 7', 'Write cryptography report', 'university', 'B-Rank')
      expect(prompt).toContain('breaking a big task into small steps')
      expect(prompt).toContain('Finish SI-266 Lab 7')
      expect(prompt).toContain('Write cryptography report')
      expect(prompt).toContain('university')
    })

    it('parses valid task decomposition JSON cleanly', () => {
      const rawJson = `{
        "strategyTip": "Conquer the cryptographic math proof first before compiling the Word report.",
        "subtasks": [
          { "title": "Review Lab 7 requirements & formulas", "minutes": 15, "coins": 8, "xp": 15, "priority": 2 },
          { "title": "Implement cipher algorithm in Python", "minutes": 45, "coins": 20, "xp": 40, "priority": 1 },
          { "title": "Document test cases and export PDF", "minutes": 20, "coins": 10, "xp": 20, "priority": 2 }
        ]
      }`
      const res = parseTaskDecomposition(rawJson, 'Gemini 2.5 Flash')
      expect(res.strategyTip).toContain('cryptographic math proof')
      expect(res.subtasks).toHaveLength(3)
      expect(res.subtasks[0].title).toBe('Review Lab 7 requirements & formulas')
      expect(res.subtasks[1].priority).toBe(1)
      expect(res.subtasks[1].coins).toBe(20)
      expect(res.modelUsed).toBe('Gemini 2.5 Flash')
    })

    it('falls back gracefully when JSON parsing fails', () => {
      const res = parseTaskDecomposition('Invalid non-json output', 'DeepSeek V3')
      expect(res.subtasks.length).toBeGreaterThanOrEqual(3)
      expect(res.strategyTip).toBeTruthy()
      expect(res.modelUsed).toBe('DeepSeek V3')
    })
    it('parses agent tool calls and cleans message text', () => {
      const modelOutput = `I have checked off task "ss" and logged 25 pushups for you, Victor.

\`\`\`tool_call
{
  "tool": "complete_task",
  "args": { "task": "ss" }
}
\`\`\`

\`\`\`tool_call
{
  "tool": "log_workout",
  "args": { "exercise": "Pushups", "amount": 25, "unit": "reps" }
}
\`\`\`

Great work keeping up the momentum!`

      const { cleanedText, toolCalls } = parseAgentToolCalls(modelOutput)
      expect(toolCalls).toHaveLength(2)
      expect(toolCalls[0].tool).toBe('complete_task')
      expect(toolCalls[0].args.task).toBe('ss')
      expect(toolCalls[1].tool).toBe('log_workout')
      expect(toolCalls[1].args.amount).toBe(25)
      expect(cleanedText).toContain('I have checked off task "ss"')
      expect(cleanedText).toContain('Great work keeping up the momentum!')
      expect(cleanedText).not.toContain('\`\`\`tool_call')
    })
  })
describe('Product Link & Query Inspector', () => {
    it('heuristically inspects a store URL extracting clean title and 10:1 coin pricing', () => {
      const res = heuristicInspectProduct('https://darwin.md/casti-apple-airpods-pro-2-white.html', 'MDL')
      expect(res.title).toContain('Airpods Pro 2')
      expect(res.category).toBe('tech')
      expect(res.productUrl).toBe('https://darwin.md/casti-apple-airpods-pro-2-white.html')
      expect(res.coins).toBe(res.price * 10)
      expect(res.imageUrl).toContain('images.unsplash.com')
    })

    it('heuristically inspects query text like "Nike Running Shoes"', () => {
      const res = heuristicInspectProduct('Nike Running Shoes', 'MDL')
      expect(res.title).toBe('Nike Running Shoes')
      expect(res.category).toBe('gear')
      expect(res.coins).toBe(res.price * 10)
      expect(res.productUrl).toContain('google.com/search')
    })

    it('builds a prompt requiring strict 10:1 ratio and valid JSON', () => {
      const prompt = buildInspectProductPrompt('Braun Series 9 shaver', 'MDL')
      expect(prompt).toContain('Braun Series 9 shaver')
      expect(prompt).toContain('Strict 10:1 ratio with price (MDL * 10)')
      expect(prompt).toContain('Output MUST be a single valid JSON object')
    })

    it('parses valid AI JSON response into InspectedProductResult', () => {
      const json = JSON.stringify({
        title: 'Sony WH-1000XM5 ANC Headphones',
        price: 6500,
        coins: 65000,
        tier: 'gold',
        category: 'tech',
        note: 'Flagship noise cancelling headphones.',
        imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e',
        productUrl: 'https://darwin.md/sony-wh-1000xm5'
      })
      const res = parseInspectProductResponse(json, 'https://darwin.md/sony-wh-1000xm5', 'MDL')
      expect(res.title).toBe('Sony WH-1000XM5 ANC Headphones')
      expect(res.price).toBe(6500)
      expect(res.coins).toBe(65000)
      expect(res.tier).toBe('gold')
      expect(res.category).toBe('tech')
      expect(res.productUrl).toBe('https://darwin.md/sony-wh-1000xm5')
    })

    it('falls back to heuristic inspection if AI output is malformed', () => {
      const res = parseInspectProductResponse('not valid json', 'https://darwin.md/husa-silicon-iphone-15-pro-black.html', 'MDL')
      expect(res.title).toContain('Husa Silicon Iphone 15 Pro')
      expect(res.coins).toBe(res.price * 10)
    })
  })
})
