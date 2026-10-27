/**
 * Pure domain logic for AI Integration, Model Selection & Task Routing.
 * Supports Google Gemini (Free / Pro) and OpenRouter (DeepSeek V3, R1, Claude, GPT).
 * Zero Electron / DOM dependencies.
 */

export interface AIConfig {
  openRouterKey: string
  geminiKey: string
  selectedModel: string // 'auto' | specific model string
  enabled: boolean
}

export type AITask = 'reward_ideas' | 'performance_report' | 'coach_chat'

export interface ModelChoice {
  provider: 'gemini' | 'openrouter'
  model: string
  label: string
  isFree?: boolean
}

export const POPULAR_MODELS: ModelChoice[] = [
  { provider: 'gemini', model: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Ultra Fast & Free Tier)', isFree: true },
  { provider: 'gemini', model: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Fast & Free Tier)', isFree: true },
  { provider: 'gemini', model: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (Deep Reasoning & Analysis)', isFree: true },
  { provider: 'openrouter', model: 'deepseek/deepseek-chat', label: 'DeepSeek V3 (OpenRouter - High Performance)' },
  { provider: 'openrouter', model: 'deepseek/deepseek-r1', label: 'DeepSeek R1 (OpenRouter - Deep Reasoning)' },
  { provider: 'openrouter', model: 'openai/gpt-4o-mini', label: 'GPT-4o Mini (OpenRouter)' },
  { provider: 'openrouter', model: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku (OpenRouter)' },
  { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B (OpenRouter)' }
]

export const DEFAULT_AI_CONFIG: AIConfig = {
  openRouterKey: '',
  geminiKey: '',
  selectedModel: 'auto',
  enabled: true
}

/**
 * Intelligently routes tasks to the best configured model based on workload type and user keys.
 */
export function selectModelForTask(
  config: AIConfig,
  task: AITask
): { provider: 'gemini' | 'openrouter'; model: string } {
  const hasGemini = Boolean(config.geminiKey?.trim())
  const hasOpenRouter = Boolean(config.openRouterKey?.trim())

  if (!hasGemini && !hasOpenRouter) {
    throw new Error('No AI API key found. Please add a Google Gemini (Free) or OpenRouter API key in Settings.')
  }

  // If user selected a specific model manually (not 'auto')
  if (config.selectedModel && config.selectedModel !== 'auto') {
    const isGeminiModel = config.selectedModel.startsWith('gemini')
    if (isGeminiModel && hasGemini) {
      return { provider: 'gemini', model: config.selectedModel }
    }
    if (!isGeminiModel && hasOpenRouter) {
      return { provider: 'openrouter', model: config.selectedModel }
    }
    // Fallback if chosen provider's key is not set
    if (hasGemini) return { provider: 'gemini', model: 'gemini-2.5-flash' }
    return { provider: 'openrouter', model: 'deepseek/deepseek-chat' }
  }

  // AUTO Routing based on task complexity:
  // 1. Reward ideas generation -> Fast response (Gemini Flash or DeepSeek V3)
  if (task === 'reward_ideas') {
    if (hasGemini) return { provider: 'gemini', model: 'gemini-2.5-flash' }
    return { provider: 'openrouter', model: 'deepseek/deepseek-chat' }
  }

  // 2. Performance conclusion report -> Deep analytical reasoning (DeepSeek R1 or Gemini 1.5 Pro)
  if (task === 'performance_report') {
    if (hasOpenRouter) return { provider: 'openrouter', model: 'deepseek/deepseek-r1' }
    if (hasGemini) return { provider: 'gemini', model: 'gemini-1.5-pro' }
  }

  // 3. Coach chat / advice
  if (hasOpenRouter) return { provider: 'openrouter', model: 'deepseek/deepseek-chat' }
  return { provider: 'gemini', model: 'gemini-2.5-flash' }
}

export interface AIRewardContext {
  level: number
  hunterTitle: string
  hunterGrade: string
  coinsBalance: number
  vaultBalance: number
  currency: string
  userPrompt?: string
}

export interface GeneratedReward {
  title: string
  price: number
  realCost: number
  tier: 'bronze' | 'silver' | 'gold' | 'legendary'
  category: 'gear' | 'tech' | 'trip' | 'luxury' | 'wellness'
  note: string
  imageUrl: string
}

export function buildRewardPrompt(ctx: AIRewardContext): string {
  const userInterest = ctx.userPrompt?.trim()
    ? `User specific interest or category: "${ctx.userPrompt}"`
    : `Suggest a well-rounded mix of physical fitness/grooming gear, high-performance tech/focus tools, and restorative experiences.`

  return `You are the Solo Leveling System & Reward Architect for Player Victor Barbuta.
The player has awakened at Level ${ctx.level} (${ctx.hunterGrade} - ${ctx.hunterTitle}).
Wallet balance: ${ctx.coinsBalance} coins.
Reward Surplus Vault savings: ${ctx.vaultBalance} ${ctx.currency}.
Primary real-world currency: ${ctx.currency}.
${userInterest}

Generate exactly 3 inspiring, realistic, highly motivating real-life rewards or wishlist goals that the user can work hard to earn.
Rules:
- Title must be punchy and specific (e.g. "Garmin Forerunner GPS Watch", "Sony WH-1000XM5 ANC Headphones", "Deep Tissue Sports Massage & Sauna").
- Price must be in coins (100 coins = ~10 ${ctx.currency}).
- Real cost must be a realistic market price in ${ctx.currency} (or approximate equivalent).
- Tier must match: 'bronze' (Levels 1+), 'silver' (Levels 5+), 'gold' (Levels 10+), or 'legendary' (Levels 20+).
- Category: 'gear', 'tech', 'trip', 'luxury', or 'wellness'.
- Note: 1-2 motivating sentences explaining why this reward will empower the player.
- ImageUrl: provide a high-quality, relevant Unsplash photo URL (use https://images.unsplash.com/photo-... with ?w=600&auto=format&fit=crop&q=80).

Output MUST be a single valid JSON array of objects without markdown formatting or commentary:
[
  {
    "title": "string",
    "price": number,
    "realCost": number,
    "tier": "bronze" | "silver" | "gold" | "legendary",
    "category": "gear" | "tech" | "trip" | "luxury" | "wellness",
    "note": "string",
    "imageUrl": "string"
  }
]`
}

export function parseRewardResponse(text: string): GeneratedReward[] {
  let cleaned = text.trim()
  if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '')
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '')
  if (cleaned.endsWith('```')) cleaned = cleaned.replace(/```$/, '')
  cleaned = cleaned.trim()

  const parsed = JSON.parse(cleaned)
  if (!Array.isArray(parsed)) throw new Error('AI response was not a JSON array')

  return parsed.map((item: any) => ({
    title: String(item.title || 'Untitled Reward').slice(0, 80),
    price: Math.max(10, Math.round(Number(item.price) || 300)),
    realCost: Math.max(0, Math.round(Number(item.realCost) || 0)),
    tier: ['bronze', 'silver', 'gold', 'legendary'].includes(item.tier) ? item.tier : 'bronze',
    category: ['gear', 'tech', 'trip', 'luxury', 'wellness'].includes(item.category) ? item.category : 'gear',
    note: String(item.note || '').slice(0, 200),
    imageUrl: String(item.imageUrl || 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&auto=format&fit=crop&q=80')
  }))
}

export interface AIPerformanceContext {
  level: number
  hunterTitle: string
  hunterGrade: string
  combatPower: number
  todayCoins: number
  todayXp: number
  cleanStreak: number
  totalCleanDays: number
  workoutsThisWeek: number
  sleepQualityAvg: number
  budgetSpent: number
  budgetDaily: number
  currency: string
}

export interface AIPerformanceReport {
  gradeRating: string
  headline: string
  summary: string
  strengths: string[]
  growthAreas: string[]
  strategicDirectives: string[]
  warriorVerdict: string
  generatedAt: string
  modelUsed: string
}

export function buildPerformancePrompt(ctx: AIPerformanceContext): string {
  return `You are the Supreme Solo Leveling System Oracle evaluating Player Victor Barbuta.
Player Telemetry:
- Hunter Rank: Level ${ctx.level} (${ctx.hunterGrade} - "${ctx.hunterTitle}")
- Combat Power: ${ctx.combatPower.toLocaleString()} CP
- Today Gains: +${ctx.todayCoins} Coins, +${ctx.todayXp} XP
- Clean Discipline Streak: ${ctx.cleanStreak} consecutive days (Total clean: ${ctx.totalCleanDays} days)
- Workouts This Week: ${ctx.workoutsThisWeek} sessions
- Sleep Quality Score: ${ctx.sleepQualityAvg}/5
- Everyday Spending Today: ${ctx.budgetSpent} ${ctx.currency} (Daily Budget: ${ctx.budgetDaily} ${ctx.currency})

Generate an authentic, motivating Solo Leveling style Strategic Performance Conclusion Report.
Respond in valid JSON format:
{
  "gradeRating": "S-Rank" | "A-Rank" | "B-Rank" | "C-Rank",
  "headline": "Short epic headline summarizing current momentum",
  "summary": "2-3 sentences evaluating the player's holistic mastery across body, discipline, focus, and finances.",
  "strengths": ["string", "string"],
  "growthAreas": ["string", "string"],
  "strategicDirectives": ["Direct order 1 for the next 24 hours", "Direct order 2 for the next 24 hours"],
  "warriorVerdict": "An inspiring, intense concluding sentence pushing the hunter to ascend to the next tier."
}`
}

export function parsePerformanceResponse(text: string, modelUsed = 'AI'): AIPerformanceReport {
  let cleaned = text.trim()
  if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '')
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '')
  if (cleaned.endsWith('```')) cleaned = cleaned.replace(/```$/, '')
  cleaned = cleaned.trim()

  const p = JSON.parse(cleaned)
  return {
    gradeRating: String(p.gradeRating || 'A-Rank'),
    headline: String(p.headline || 'System Evaluation Complete'),
    summary: String(p.summary || 'Habit execution and discipline metrics analyzed.'),
    strengths: Array.isArray(p.strengths) ? p.strengths.map(String) : ['Consistency in daily rituals'],
    growthAreas: Array.isArray(p.growthAreas) ? p.growthAreas.map(String) : ['Elevate focus duration'],
    strategicDirectives: Array.isArray(p.strategicDirectives) ? p.strategicDirectives.map(String) : ['Execute daily quest without hesitation'],
    warriorVerdict: String(p.warriorVerdict || 'Slips are resurrectable as fuel. Keep ascending.'),
    generatedAt: new Date().toISOString(),
    modelUsed
  }
}
