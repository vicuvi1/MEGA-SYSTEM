import { describe, expect, it } from 'vitest'
import {
  buildRewardPrompt,
  parseRewardResponse,
  buildPerformancePrompt,
  parsePerformanceResponse,
  buildTaskDecomposePrompt,
  parseTaskDecomposition,
  heuristicInspectProduct,
  buildInspectProductPrompt,
  parseInspectProductResponse,
  type AIConfig,
  type AIRewardContext,
  type AIPerformanceContext,
} from './ai'

describe('AI Core Domain Engine', () => {
  const baseConfig: AIConfig = {
    openRouterKey: 'sk-or-test-12345',
    geminiKey: 'AIzaSyTest12345',
    selectedModel: 'auto',
    enabled: true
  }

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

  describe('Task Decomposition', () => {
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
  })
describe('Product Link & Query Inspector', () => {
    it('heuristically inspects a store URL extracting clean title and 10:1 coin pricing', () => {
      const res = heuristicInspectProduct('https://shop.example.com/casti-apple-airpods-pro-2-white.html', 'MDL')
      expect(res.title).toContain('Airpods Pro 2')
      expect(res.category).toBe('tech')
      expect(res.productUrl).toBe('https://shop.example.com/casti-apple-airpods-pro-2-white.html')
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
        productUrl: 'https://shop.example.com/sony-wh-1000xm5'
      })
      const res = parseInspectProductResponse(json, 'https://shop.example.com/sony-wh-1000xm5', 'MDL')
      expect(res.title).toBe('Sony WH-1000XM5 ANC Headphones')
      expect(res.price).toBe(6500)
      expect(res.coins).toBe(65000)
      expect(res.tier).toBe('gold')
      expect(res.category).toBe('tech')
      expect(res.productUrl).toBe('https://shop.example.com/sony-wh-1000xm5')
    })

    it('falls back to heuristic inspection if AI output is malformed', () => {
      const res = parseInspectProductResponse('not valid json', 'https://shop.example.com/husa-silicon-iphone-15-pro-black.html', 'MDL')
      expect(res.title).toContain('Husa Silicon Iphone 15 Pro')
      expect(res.coins).toBe(res.price * 10)
    })
  })
})
