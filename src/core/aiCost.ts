// The monthly AI cost meter for photo reading (pure, tested). The server
// records the REAL token counts of every photo read in ai_usage (kinds
// foodPhoto, foodPhoto2 = the careful second look, scaleShot = a scale
// screenshot) and counts the photos sent this month; `/api/ai {op:'photoCost'}`
// sums them. Here they become money with the prices you set (synced setting
// `ai_cost`): by default Gemini 3.5 Flash at $1.50 per million input tokens and
// $9 per million output tokens (thinking is counted as output, as it is paid).

export interface CostPrefs {
  /** The model's name, for the label only. */
  model: string
  /** US dollars per million input tokens (the photo and the prompt). */
  inPerM: number
  /** US dollars per million output tokens (the answer and the thinking). */
  outPerM: number
}
export const AI_COST_KEY = 'ai_cost'
export const DEFAULT_COST: CostPrefs = { model: 'Gemini 3.5 Flash', inPerM: 1.5, outPerM: 9 }

const price = (v: unknown, d: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n * 1000) / 1000 : d
}
export function cleanCostPrefs(raw: unknown): CostPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<CostPrefs>
  const model = typeof o.model === 'string' && o.model.trim() ? o.model.replace(/\s+/g, ' ').trim().slice(0, 40) : DEFAULT_COST.model
  return { model, inPerM: price(o.inPerM, DEFAULT_COST.inPerM), outPerM: price(o.outPerM, DEFAULT_COST.outPerM) }
}

/** One kind's sums for the month, as the server sends them. */
export interface UsageRow {
  kind: string
  calls: number
  prompt: number
  completion: number
}
export interface PhotoUsage {
  month: string
  /** Photos sent to the AI this month (each photo of an album counts). */
  photos: number | null
  rows: UsageRow[]
}
export interface CostReport {
  month: string
  photos: number
  reads: number
  secondLooks: number
  scale: number
  inTokens: number
  outTokens: number
  usd: number
  perPhoto: number | null
  line: string
}

const n0 = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0)
/** "$0.42" (or "$0.004" under a cent). */
export const usdText = (usd: number) => (usd > 0 && usd < 0.01 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`)

/** The month's photo reading in money: tokens × your prices. */
export function costReport(u: PhotoUsage, p: CostPrefs): CostReport {
  const rows = (u.rows ?? []).filter((r) => r && typeof r.kind === 'string')
  const sum = (k: string, f: 'calls' | 'prompt' | 'completion') => rows.filter((r) => r.kind === k).reduce((a, r) => a + n0(r[f]), 0)
  const kinds = ['foodPhoto', 'foodPhoto2', 'scaleShot']
  const inTokens = kinds.reduce((a, k) => a + sum(k, 'prompt'), 0)
  const outTokens = kinds.reduce((a, k) => a + sum(k, 'completion'), 0)
  const usd = Math.round(((inTokens * p.inPerM + outTokens * p.outPerM) / 1e6) * 10000) / 10000
  const reads = sum('foodPhoto', 'calls')
  const scale = sum('scaleShot', 'calls')
  const photos = u.photos != null && u.photos >= 0 ? Math.round(u.photos) : reads + scale
  const perPhoto = photos > 0 ? Math.round((usd / photos) * 10000) / 10000 : null
  const line = photos ? `${photos} ${photos === 1 ? 'photo' : 'photos'} read this month · about ${usdText(usd)}${perPhoto != null ? ` (${usdText(perPhoto)} a photo)` : ''}` : 'No photos read this month yet.'
  return { month: u.month, photos, reads, secondLooks: sum('foodPhoto2', 'calls'), scale, inTokens, outTokens, usd, perPhoto, line }
}
