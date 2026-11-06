// AI usage page: what a million tokens cost, per model, in US dollars. These
// are the providers' published list prices (checked 2026-11), kept in this one
// file so they are easy to update. The island only uses them for an estimate:
// a subscription (Claude Pro/Max, ChatGPT Plus) is not billed per token, so
// for those the number is "what this would cost on the API".

export interface ModelPrice {
  /** Per million tokens. */
  input: number
  output: number
  /** Writing the prompt cache (Claude: 1.25 × input for the 5-minute cache). */
  cacheWrite: number
  /** Reading the prompt cache. */
  cacheRead: number
}

const claude = (input: number, output: number, cacheRead = input * 0.1): ModelPrice => ({ input, output, cacheWrite: input * 1.25, cacheRead })
const openai = (input: number, output: number, cacheRead = input * 0.1): ModelPrice => ({ input, output, cacheWrite: input, cacheRead })

/** First match wins, so the more exact names come first. */
export const PRICES: { match: RegExp; label: string; price: ModelPrice }[] = [
  // Claude (Anthropic)
  { match: /fable|mythos/, label: 'Claude Fable', price: claude(10, 50, 0.25) },
  { match: /opus-5-5|opus-5\.5/, label: 'Claude Opus 5.5', price: claude(4, 20, 0.2) },
  { match: /opus-(5|4-[5-9])\b|opus-(5|4\.[5-9])\b/, label: 'Claude Opus', price: claude(5, 25) },
  { match: /opus/, label: 'Claude Opus (older)', price: claude(15, 75) },
  { match: /sonnet-5/, label: 'Claude Sonnet 5', price: claude(2, 10, 0.2) },
  { match: /sonnet/, label: 'Claude Sonnet', price: claude(3, 15) },
  { match: /haiku-5/, label: 'Claude Haiku 5.5', price: claude(0.1, 0.5) },
  { match: /haiku-4/, label: 'Claude Haiku 4.5', price: claude(1, 5) },
  { match: /haiku/, label: 'Claude Haiku (older)', price: claude(0.8, 4) },
  // OpenAI (Codex)
  { match: /gpt-5.*mini/, label: 'GPT-5 mini', price: openai(0.25, 2) },
  { match: /gpt-5|codex/, label: 'GPT-5', price: openai(1.25, 10) },
  { match: /o4-mini|o3-mini/, label: 'o-mini', price: openai(1.1, 4.4, 0.275) },
  { match: /gpt-4\.1/, label: 'GPT-4.1', price: openai(2, 8, 0.5) }
]

/** The price for a model name, or null when we don't know it (its cost is then left out, never guessed). */
export function priceFor(model: string | null | undefined): ModelPrice | null {
  const m = String(model ?? '').toLowerCase()
  if (!m || m === '<synthetic>') return null
  return PRICES.find((p) => p.match.test(m))?.price ?? null
}

export interface TokenCounts {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

export const NO_TOKENS: TokenCounts = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }

/** US dollars for these tokens on this model (0 when the model is unknown). */
export function costOf(model: string | null | undefined, t: TokenCounts): number {
  const p = priceFor(model)
  if (!p) return 0
  return (t.input * p.input + t.output * p.output + t.cacheWrite * p.cacheWrite + t.cacheRead * p.cacheRead) / 1e6
}

/** "claude-sonnet-4-5-20250929" → "Sonnet 4.5"; "gpt-5-codex" → "GPT-5 Codex". */
export function shortModel(model: string | null | undefined): string {
  const m = String(model ?? '').toLowerCase().replace(/-\d{8}$/, '').replace(/^.*\//, '')
  const c = /claude-(?:(\d+)-(\d+)-)?(opus|sonnet|haiku|fable|mythos)(?:-(\d+)(?:[-.](\d+))?)?/.exec(m)
  if (c) {
    const name = c[3][0].toUpperCase() + c[3].slice(1)
    const ver = c[4] ? `${c[4]}${c[5] && c[5].length <= 2 ? `.${c[5]}` : ''}` : c[1] ? `${c[1]}.${c[2]}` : ''
    return ver ? `${name} ${ver}` : name
  }
  if (/^gpt|^o\d/.test(m)) return m.replace(/^gpt/, 'GPT').replace(/-codex/, ' Codex').replace(/-mini/, ' mini')
  return m.slice(0, 24) || 'Unknown'
}
