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

export type AITask = 'reward_ideas' | 'performance_report' | 'coach_chat' | 'decompose_task'

export interface TaskDecompositionItem {
  title: string
  minutes: number
  coins: number
  xp: number
  priority: 1 | 2 | 3
}

export interface TaskDecompositionResult {
  subtasks: TaskDecompositionItem[]
  strategyTip: string
  modelUsed?: string
}

export interface SystemCoachContext {
  level: number
  hunterTitle: string
  hunterGrade: string
  attributes: {
    str: number
    agi: number
    vit: number
    int: number
    sen: number
    totalCombatPower: number
  }
  coinsBalance: number
  cleanStreakDays: number
  todayTasksSummary?: string
  calendarAgenda?: string
}

export interface ModelChoice {
  provider: 'gemini' | 'openrouter'
  model: string
  label: string
  isFree?: boolean
}

export const POPULAR_MODELS: ModelChoice[] = [
  { provider: 'gemini', model: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Recommended · Fast & Free Tier)', isFree: true },
  { provider: 'gemini', model: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (Stable & Free Tier)', isFree: true },
  { provider: 'gemini', model: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (Deep Reasoning & Analysis)', isFree: true },
  { provider: 'gemini', model: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite (Ultra Lightweight)', isFree: true },
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
    if (hasGemini) return { provider: 'gemini', model: 'gemini-2.0-flash' }
    return { provider: 'openrouter', model: 'deepseek/deepseek-chat' }
  }

  // AUTO Routing based on task complexity:
  // 1. Reward ideas & task decomposition -> Fast response (Gemini Flash or DeepSeek V3)
  if (task === 'reward_ideas' || task === 'decompose_task') {
    if (hasGemini) return { provider: 'gemini', model: 'gemini-2.0-flash' }
    return { provider: 'openrouter', model: 'deepseek/deepseek-chat' }
  }

  // 2. Performance conclusion report -> Deep analytical reasoning (DeepSeek R1 or Gemini 1.5 Pro)
  if (task === 'performance_report') {
    if (hasOpenRouter) return { provider: 'openrouter', model: 'deepseek/deepseek-r1' }
    if (hasGemini) return { provider: 'gemini', model: 'gemini-1.5-pro' }
  }

  // 3. Coach chat / advice
  if (hasOpenRouter) return { provider: 'openrouter', model: 'deepseek/deepseek-chat' }
  return { provider: 'gemini', model: 'gemini-2.0-flash' }
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
  const arrayMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/)
  if (arrayMatch) {
    cleaned = arrayMatch[0]
  } else {
    if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '')
    if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '')
    if (cleaned.endsWith('```')) cleaned = cleaned.replace(/```$/, '')
    cleaned = cleaned.trim()
  }

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
  calendarAgenda?: string
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
${ctx.calendarAgenda ? `- Google Calendar Agenda:\n  ${ctx.calendarAgenda.replace(/\n/g, '\n  ')}` : ''}

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
  const objMatch = cleaned.match(/\{\s*"[\s\S]*\}\s*$/) || cleaned.match(/\{[\s\S]*\}/)
  if (objMatch) {
    cleaned = objMatch[0]
  } else {
    if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '')
    if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '')
    if (cleaned.endsWith('```')) cleaned = cleaned.replace(/```$/, '')
    cleaned = cleaned.trim()
  }

  let p: any = {}
  try {
    p = JSON.parse(cleaned)
  } catch {
    p = {
      gradeRating: 'A-Rank',
      headline: 'System Momentum Sustained',
      summary: text.slice(0, 300) || 'Habit execution and discipline metrics analyzed.',
      strengths: ['Consistent daily commitment'],
      growthAreas: ['Refine execution focus'],
      strategicDirectives: ['Execute tomorrow morning ritual without delay'],
      warriorVerdict: 'Ascend beyond current limits.'
    }
  }

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

export function buildSystemOraclePrompt(
  ctx: SystemCoachContext,
  userMessage: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  const historyText = history && history.length > 0
    ? '\nConversation History:\n' + history.map((h) => `${h.role === 'user' ? 'Hunter Victor' : 'System Oracle'}: ${h.content}`).join('\n') + '\n'
    : ''

  const tasksText = ctx.todayTasksSummary ? `\nTop Pending Tasks / Directives:\n${ctx.todayTasksSummary}\n` : ''
  const calText = ctx.calendarAgenda ? `\nToday's Schedule & Appointments:\n${ctx.calendarAgenda}\n` : ''

  return `[SYSTEM INSTRUCTION: SOLO LEVELING HUNTER ORACLE]
You are the sentient System AI and Strategic Mentor for Player Victor Barbuta in the MEGA-SYSTEM.
You speak with the calm, authoritative, intense, yet deeply empowering tone of the Solo Leveling System.
You treat Victor's daily life, university studies, coding, training, and discipline as real hunter progression.

Player Telemetry:
- Hunter Rank: Level ${ctx.level} (${ctx.hunterGrade} - "${ctx.hunterTitle}")
- Attributes: STR ${ctx.attributes.str} | AGI ${ctx.attributes.agi} | VIT ${ctx.attributes.vit} | INT ${ctx.attributes.int} | SEN ${ctx.attributes.sen}
- Total Combat Power: ${ctx.attributes.totalCombatPower.toLocaleString()} CP
- Pure Clean Streak: ${ctx.cleanStreakDays} Days
- Wallet Balance: ${ctx.coinsBalance} Coins
${tasksText}${calText}
Guiding Principles:
1. Address the player as "Hunter Victor" or "Player Victor".
2. If the player mentions an urge, relapse risk, or procrastination, immediately activate the [TACTICAL PROTOCOL]: give an intense 3-step physical interrupt (cold water, 20 pushups/breaths, physical displacement) with zero tolerance for self-pity.
3. If the player asks how to approach a task or study session, give an exact, surgical breakdown with time-boxing and relentless clarity.
4. Keep answers focused, impactful, and directly actionable (avoid bloated filler). Use markdown formatting and warrior directives.
${historyText}
Hunter Victor: ${userMessage}
System Oracle:`
}

export function buildTaskDecomposePrompt(
  taskTitle: string,
  notes?: string | null,
  category?: string | null,
  hunterGrade = 'E-Rank'
): string {
  return `[SYSTEM INSTRUCTION: QUEST DECOMPOSITION]
You are the Solo Leveling System Oracle breaking down a complex quest for Hunter Victor (${hunterGrade}).
Quest to Decompose: "${taskTitle}"
${notes ? `Additional Notes: "${notes}"` : ''}
${category ? `Category: "${category}"` : ''}

Deconstruct this quest into 3 to 4 sequential, highly actionable micro-subtasks that overcome inertia.
Each subtask should take between 10 and 60 minutes.
Assign gamified Coin reward (5 to 25 coins) and XP (10 to 50 XP) based on difficulty.

Respond ONLY in valid JSON matching this schema:
{
  "strategyTip": "1 concise sentence explaining the psychological/tactical angle to dominate this quest.",
  "subtasks": [
    {
      "title": "Clear action-verb micro-task",
      "minutes": 25,
      "coins": 10,
      "xp": 20,
      "priority": 1
    }
  ]
}`
}

export function parseTaskDecomposition(text: string, modelUsed = 'AI'): TaskDecompositionResult {
  let cleaned = text.trim()
  const objMatch = cleaned.match(/\{\s*"[\s\S]*\}\s*$/) || cleaned.match(/\{[\s\S]*\}/)
  if (objMatch) {
    cleaned = objMatch[0]
  } else {
    if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '')
    if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '')
    if (cleaned.endsWith('```')) cleaned = cleaned.replace(/```$/, '')
    cleaned = cleaned.trim()
  }

  try {
    const parsed = JSON.parse(cleaned)
    const rawList = Array.isArray(parsed.subtasks) ? parsed.subtasks : []
    const subtasks: TaskDecompositionItem[] = rawList.map((item: any, i: number) => ({
      title: String(item.title || `Sub-phase ${i + 1}`).trim(),
      minutes: Number(item.minutes) || 25,
      coins: Number(item.coins) || 10,
      xp: Number(item.xp) || 20,
      priority: (item.priority === 1 || item.priority === 3 ? item.priority : 2) as 1 | 2 | 3
    }))

    return {
      subtasks: subtasks.length > 0 ? subtasks : [
        { title: 'Step 1: Set up environment and eliminate distractions', minutes: 10, coins: 5, xp: 10, priority: 2 },
        { title: 'Step 2: Execute core deep focus block', minutes: 35, coins: 15, xp: 30, priority: 1 },
        { title: 'Step 3: Review and verify completion', minutes: 15, coins: 10, xp: 20, priority: 2 }
      ],
      strategyTip: String(parsed.strategyTip || 'Momentum is gained in the first 5 minutes. Start with zero hesitation.'),
      modelUsed
    }
  } catch {
    return {
      subtasks: [
        { title: 'Step 1: Set up environment and eliminate distractions', minutes: 10, coins: 5, xp: 10, priority: 2 },
        { title: 'Step 2: Complete the hardest 25-minute core focus block', minutes: 25, coins: 15, xp: 30, priority: 1 },
        { title: 'Step 3: Verify outputs and wrap up completion checklist', minutes: 15, coins: 10, xp: 20, priority: 2 }
      ],
      strategyTip: 'Overcome inertia by attacking the immediate first step for just 5 minutes.',
      modelUsed
    }
  }
}
