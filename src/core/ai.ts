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

export type AITask = 'reward_ideas' | 'performance_report' | 'coach_chat' | 'decompose_task' | 'inspect_product'

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
  currentDate?: string
  currentTime?: string
  latestWeight?: number | null
  latestWaist?: number | null
}

export interface AgentToolCall {
  tool:
    | 'complete_task'
    | 'add_task'
    | 'delete_task'
    | 'log_workout'
    | 'log_water'
    | 'log_clean_checkin'
    | 'log_expense'
    | 'log_metric'
    | 'award_coins'
  args: Record<string, any>
}

export interface ToolExecutionResult {
  tool: string
  result: string
  success: boolean
  data?: any
}

export function parseAgentToolCalls(text: string): { cleanedText: string; toolCalls: AgentToolCall[] } {
  const toolCalls: AgentToolCall[] = []
  const regex = /```(?:tool_call|tool|json)?\s*(\{\s*"tool"[\s\S]*?\})\s*```/gi

  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1])
      if (parsed && typeof parsed.tool === 'string') {
        toolCalls.push({
          tool: parsed.tool as any,
          args: parsed.args || {}
        })
      }
    } catch {}
  }

  if (toolCalls.length === 0) {
    const rawRegex = /\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[\s\S]*?\}\s*\}/gi
    while ((match = rawRegex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[0])
        if (parsed && typeof parsed.tool === 'string') {
          toolCalls.push({
            tool: parsed.tool as any,
            args: parsed.args || {}
          })
        }
      } catch {}
    }
  }

  let cleanedText = text.replace(/```(?:tool_call|tool|json)?\s*\{\s*"tool"[\s\S]*?\}\s*```/gi, '').trim()
  cleanedText = cleanedText.replace(/\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[\s\S]*?\}\s*\}/gi, '').trim()

  return { cleanedText, toolCalls }
}

export interface ModelChoice {
  provider: 'gemini' | 'openrouter'
  model: string
  label: string
  isFree?: boolean
}

export const POPULAR_MODELS: ModelChoice[] = [
  { provider: 'gemini', model: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (Recommended · Ultra Fast & Free Tier)', isFree: true },
  { provider: 'gemini', model: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite (Lightweight & Free Tier)', isFree: true },
  { provider: 'gemini', model: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (Latest Multimodal & Deep Thinking)', isFree: true },
  { provider: 'gemini', model: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Deep Strategy & Reasoning)', isFree: true },
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
    if (hasGemini) return { provider: 'gemini', model: 'gemini-3.5-flash' }
    return { provider: 'openrouter', model: 'deepseek/deepseek-chat' }
  }

  // AUTO Routing based on task complexity:
  // 1. Reward ideas & task decomposition & product inspection -> Fast response (Gemini Flash or DeepSeek V3)
  if (task === 'reward_ideas' || task === 'decompose_task' || task === 'inspect_product') {
    if (hasGemini) return { provider: 'gemini', model: 'gemini-3.5-flash' }
    return { provider: 'openrouter', model: 'deepseek/deepseek-chat' }
  }

  // 2. Performance conclusion report -> Deep analytical reasoning (DeepSeek R1 or Gemini Pro)
  if (task === 'performance_report') {
    if (hasOpenRouter) return { provider: 'openrouter', model: 'deepseek/deepseek-r1' }
    if (hasGemini) return { provider: 'gemini', model: 'gemini-3.1-pro-preview' }
  }

  // 3. Coach chat / advice
  if (hasOpenRouter) return { provider: 'openrouter', model: 'deepseek/deepseek-chat' }
  return { provider: 'gemini', model: 'gemini-3.5-flash' }
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
  productUrl?: string
}

export function buildRewardPrompt(ctx: AIRewardContext): string {
  const userInterest = ctx.userPrompt?.trim()
    ? `User specific interest or category: "${ctx.userPrompt}"`
    : `Suggest a well-rounded mix of physical fitness/grooming gear, high-performance tech/focus tools, and restorative experiences.`

  return `You design motivating real-life rewards for Victor's personal Life System (points he earns by focusing and finishing tasks).
Points balance: ${ctx.coinsBalance}.
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

export interface InspectedProductResult {
  title: string
  price: number
  coins: number
  tier: 'bronze' | 'silver' | 'gold' | 'legendary'
  category: 'gear' | 'tech' | 'trip' | 'luxury' | 'wellness'
  note: string
  imageUrl: string
  productUrl: string
}

export function heuristicInspectProduct(input: string, currency = 'MDL'): InspectedProductResult {
  const cleanInput = input.trim()
  let title = 'Custom Upgrade'
  let productUrl = ''
  let estimatedPrice = 450
  let category: 'gear' | 'tech' | 'trip' | 'luxury' | 'wellness' = 'gear'
  let imageUrl = 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80'

  const isUrl = /^https?:\/\//i.test(cleanInput)
  if (isUrl) {
    productUrl = cleanInput
    try {
      const parsed = new URL(cleanInput)
      const pathname = parsed.pathname.replace(/\.(html|php|aspx|htm)$/i, '')
      const parts = pathname.split('/').filter(Boolean)
      const slug = parts[parts.length - 1] || parsed.hostname
      title = slug
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/(\d+)\s*(gb|tb|mah|w|hz)/gi, '$1$2')
        .slice(0, 60)
    } catch {
      title = 'Inspected Product'
    }
  } else {
    title = cleanInput.slice(0, 60)
    productUrl = `https://www.google.com/search?q=${encodeURIComponent(cleanInput)}`
  }

  const lower = (cleanInput + ' ' + title).toLowerCase()

  if (lower.includes('iphone') || lower.includes('macbook') || lower.includes('laptop') || lower.includes('ipad')) {
    category = 'tech'
    imageUrl = 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&auto=format&fit=crop&q=80'
    estimatedPrice = lower.includes('macbook') ? 18000 : lower.includes('iphone') ? 15000 : 7000
  } else if (lower.includes('headphone') || lower.includes('earphone') || lower.includes('airpod') || lower.includes('sound') || lower.includes('casti') || lower.includes('boxa')) {
    category = 'tech'
    imageUrl = 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80'
    estimatedPrice = lower.includes('airpod') ? 4200 : 1200
  } else if (lower.includes('watch') || lower.includes('ceas') || lower.includes('garmin')) {
    category = 'gear'
    imageUrl = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80'
    estimatedPrice = 4500
  } else if (lower.includes('shaver') || lower.includes('barbierit') || lower.includes('tuns') || lower.includes('trimmer')) {
    category = 'gear'
    imageUrl = 'https://images.unsplash.com/photo-1621607512214-68297480165e?w=600&auto=format&fit=crop&q=80'
    estimatedPrice = 1500
  } else if (lower.includes('cream') || lower.includes('skincare') || lower.includes('crema') || lower.includes('serum') || lower.includes('lotion')) {
    category = 'wellness'
    imageUrl = 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600&auto=format&fit=crop&q=80'
    estimatedPrice = 350
  } else if (lower.includes('shoe') || lower.includes('pantofi') || lower.includes('sneaker') || lower.includes('nike') || lower.includes('adidas')) {
    category = 'gear'
    imageUrl = 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&auto=format&fit=crop&q=80'
    estimatedPrice = 2200
  } else if (lower.includes('husa') || lower.includes('case') || lower.includes('armor') || lower.includes('sticla')) {
    category = 'gear'
    imageUrl = 'https://images.unsplash.com/photo-1584438784894-089d6a62b8fa?w=600&auto=format&fit=crop&q=80'
    estimatedPrice = 350
  } else if (lower.includes('game') || lower.includes('joc') || lower.includes('steam') || lower.includes('playstation')) {
    category = 'luxury'
    imageUrl = 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600&auto=format&fit=crop&q=80'
    estimatedPrice = 800
  } else if (lower.includes('spa') || lower.includes('masaj') || lower.includes('retreat') || lower.includes('sauna')) {
    category = 'wellness'
    imageUrl = 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=600&auto=format&fit=crop&q=80'
    estimatedPrice = 1200
  } else if (lower.includes('travel') || lower.includes('trip') || lower.includes('flight') || lower.includes('hotel') || lower.includes('kaaba') || lower.includes('umrah')) {
    category = 'trip'
    imageUrl = 'https://images.unsplash.com/photo-1591604129939-f1efa4d9f7fa?w=800&auto=format&fit=crop&q=80'
    estimatedPrice = 15000
  }

  if (currency === 'USD' || currency === 'EUR') {
    estimatedPrice = Math.max(10, Math.round(estimatedPrice / 18))
  }

  const coins = Math.round(estimatedPrice * 10)
  const tier: 'bronze' | 'silver' | 'gold' | 'legendary' =
    coins >= 15000 ? 'legendary' : coins >= 5000 ? 'gold' : coins >= 1000 ? 'silver' : 'bronze'

  return {
    title,
    price: estimatedPrice,
    coins,
    tier,
    category,
    note: `Smart-extracted upgrade for ${title}. Fair 10:1 coin ratio locked.`,
    imageUrl,
    productUrl
  }
}

export function buildInspectProductPrompt(input: string, currency: string): string {
  return `You design motivating real-life rewards for Victor's personal Life System.
He wants to turn an online product or idea into a reward he earns with points.
Input product link or name: "${input}"
Player's real-world currency: ${currency}.

Analyze the product and output a JSON object with:
- "title": Clean, concise product name (under 50 chars). Remove store slogans or messy tracking text.
- "price": Realistic retail price in ${currency} (integer). If it's a known product (e.g. AirPods, Nike, Kindle, shaver), use accurate retail market price.
- "coins": Strict 10:1 ratio with price (${currency} * 10). Example: If price is 450 ${currency}, coins MUST be 4500.
- "tier": "bronze" (price < 500 ${currency}), "silver" (500 - 1999 ${currency}), "gold" (2000 - 9999 ${currency}), or "legendary" (10000+ ${currency}).
- "category": One of "gear", "tech", "trip", "luxury", or "wellness".
- "note": 1-2 motivating sentences on why this upgrade empowers the player and how to earn it.
- "imageUrl": A high-quality, relevant Unsplash photo URL (use https://images.unsplash.com/photo-... with ?w=600&auto=format&fit=crop&q=80).
- "productUrl": The original product URL if provided, or an official product/search link.

Output MUST be a single valid JSON object without markdown fences or additional commentary:
{
  "title": "string",
  "price": number,
  "coins": number,
  "tier": "bronze" | "silver" | "gold" | "legendary",
  "category": "gear" | "tech" | "trip" | "luxury" | "wellness",
  "note": "string",
  "imageUrl": "string",
  "productUrl": "string"
}`
}

export function parseInspectProductResponse(text: string, input: string, currency: string): InspectedProductResult {
  let cleaned = text.trim()
  const objMatch = cleaned.match(/\{[\s\S]*\}/)
  if (objMatch) {
    cleaned = objMatch[0]
  }
  try {
    const p = JSON.parse(cleaned)
    const price = Math.max(1, Math.round(Number(p.price) || 100))
    const coins = Math.max(10, Math.round(Number(p.coins) || price * 10))
    const tier = ['bronze', 'silver', 'gold', 'legendary'].includes(p.tier)
      ? p.tier
      : coins >= 15000
      ? 'legendary'
      : coins >= 5000
      ? 'gold'
      : coins >= 1000
      ? 'silver'
      : 'bronze'
    const category = ['gear', 'tech', 'trip', 'luxury', 'wellness'].includes(p.category) ? p.category : 'gear'
    const imageUrl = String(p.imageUrl || '').startsWith('http')
      ? p.imageUrl
      : 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80'
    const productUrl = String(p.productUrl || input).startsWith('http')
      ? (p.productUrl || input)
      : `https://www.google.com/search?q=${encodeURIComponent(p.title || input)}`

    return {
      title: String(p.title || 'Inspected Product').slice(0, 60),
      price,
      coins,
      tier,
      category,
      note: String(p.note || 'Inspected warrior upgrade.').slice(0, 200),
      imageUrl,
      productUrl
    }
  } catch {
    return heuristicInspectProduct(input, currency)
  }
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
  return `You are Victor's tough-love personal coach reviewing how he is doing.
His data:
- Today: +${ctx.todayCoins} points
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
    ? '\nConversation History:\n' + history.map((h) => `${h.role === 'user' ? 'Victor' : 'Oracle'}: ${h.content}`).join('\n') + '\n'
    : ''

  const tasksText = ctx.todayTasksSummary ? `\nActive Quests & Tasks:\n${ctx.todayTasksSummary}\n` : '\nActive Quests: None currently pending.\n'
  const calText = ctx.calendarAgenda ? `\nSchedule & Calendar Events:\n${ctx.calendarAgenda}\n` : ''
  const nowStr = ctx.currentDate || new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const timeStr = ctx.currentTime || new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

  return `You are Victor's personal coach inside his Life System. Tough love: direct, honest, you call out excuses, and you always give one clear next step.
Current Real-World Time: ${nowStr}, ${timeStr}.

User Telemetry:
- Clean Discipline Streak: ${ctx.cleanStreakDays} Days
- Points: ${ctx.coinsBalance}
${ctx.latestWeight ? `- Current Weight: ${ctx.latestWeight} kg\n` : ''}${ctx.latestWaist ? `- Current Waist: ${ctx.latestWaist} cm\n` : ''}${tasksText}${calText}
CORE DIRECTIVES & COMMUNICATION STYLE:
1. ANSWER WHAT VICTOR ACTUALLY ASKS FIRST: If Victor asks a specific question (e.g. date calculations, days until an event, advice, or status), answer it directly, accurately, and conversationally in the very first sentence. Never evade the question or replace it with generic boilerplate.
2. DO NOT USE FORCED TEMPLATES: DO NOT use repetitive, rigid formulas (like "• Immediate Focus / • Secondary Move / • Discipline Anchor") unless explicitly asked for a structured breakdown. Be natural, adaptable, sharp, and high-IQ.
3. NO PREACHY OR PATRONIZING LECTURES: Do not lecture him or say cliché phrases like "cool isn't a feeling" or nag him about complacency. Be the honest coach who respects him enough to push.
4. CALCULATE DATES ACCURATELY: Use the current real-world date (${nowStr}) for all day-counting or calendar calculations.
5. CONCISE & PUNCHY: Keep responses focused, sharp, and easy to read.

AGENTIC SYSTEM TOOLS (YOU CAN MODIFY APP DATA!):
You have direct authorization to execute actions and modify data in Life System on Victor's behalf.
When Victor asks you to log something, complete a task, add a quest, record an expense, or take an action, or when taking action directly fulfills his intent, emit a tool call in a code block:

\`\`\`tool_call
{ "tool": "<tool_name>", "args": { ... } }
\`\`\`

Available Tools:
• complete_task: { "task": "<task title or partial keyword or id>" }
  (Marks an open quest complete, awarding coins and XP)
• add_task: { "title": "<string>", "priority": 1|2|3, "category": "study"|"code"|"gym"|"life"|"work", "due": "YYYY-MM-DD" }
  (Adds a new quest to his active task list)
• delete_task: { "task": "<task title or keyword>" }
  (Archives or deletes a quest)
• log_workout: { "exercise": "Pushups"|"Sit-ups"|"Running"|"Gym"|"Boxing"|"Squats", "amount": <number>, "unit": "reps"|"km"|"sets"|"minutes"|"kg" }
  (Logs an athletic workout, awarding +15 coins and +35 XP)
• log_water: { "amountMl": 250|500|1000 }
  (Logs water intake into the hydration tracker)
• log_clean_checkin: {}
  (Affirms today's clean streak check-in, +20 coins, +40 XP)
• log_expense: { "amount": <number>, "category": "food"|"transit"|"bills"|"gear"|"fun", "note": "<string>" }
  (Logs an expense in MDL against daily budget)
• log_metric: { "weight": <number>, "waist": <number> }
  (Records body weight in kg or waist circumference in cm)
• award_coins: { "amount": <number>, "reason": "<string>" }
  (Grants bonus points for real milestones)

You can call multiple tools if needed. Always confirm the action clearly to Victor.
${historyText}
Victor: ${userMessage}
Coach:`
}

export function buildTaskDecomposePrompt(
  taskTitle: string,
  notes?: string | null,
  category?: string | null,
  hunterGrade = 'E-Rank'
): string {
  return `You are Victor's coach breaking a big task into small steps.
Task: "${taskTitle}"
${notes ? `Additional Notes: "${notes}"` : ''}
${category ? `Category: "${category}"` : ''}

Break this task into 3 to 4 sequential, highly actionable micro-subtasks that overcome inertia.
Each subtask should take between 10 and 60 minutes.
Give each step points (5 to 25) by effort; set xp to the same number.

Respond ONLY in valid JSON matching this schema:
{
  "strategyTip": "1 concise sentence on how to start without procrastinating.",
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

/** A promise that gives up after `ms` (the server has 60 s per request: never wait past it). */
export function withTimeout<T>(p: Promise<T>, ms: number, what = 'The AI'): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  return Promise.race([p, new Promise<never>((_, no) => (t = setTimeout(() => no(new Error(`${what} took too long`)), ms)))]).finally(() => t && clearTimeout(t))
}
