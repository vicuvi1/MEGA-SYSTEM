import { describe, expect, it } from 'vitest'
import { activeBlock, benUsage, BLOCK_MS, fmtLeft, fmtTokens, fmtUsd, newCodexState, parseClaudeLine, parseCodexLine, toolUsage, usageAlert, usageBlocks, type UsageEntry } from './aiUsage'
import { costOf, priceFor, shortModel } from './usagePrices'

// Made-up log lines in the shape Claude Code and Codex write.
const claudeLine = (o: { at: string; id?: string; req?: string; model?: string; i?: number; out?: number; cw?: number; cr?: number }) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: o.at,
    requestId: o.req ?? 'req_1',
    message: { id: o.id ?? 'msg_1', model: o.model ?? 'claude-sonnet-4-5-20250929', role: 'assistant', content: [{ type: 'text', text: 'secret words that must never be kept' }], usage: { input_tokens: o.i ?? 100, output_tokens: o.out ?? 50, cache_creation_input_tokens: o.cw ?? 0, cache_read_input_tokens: o.cr ?? 0 } }
  })

const H = 3600_000
const T0 = Date.parse('2026-03-02T09:20:00Z')
const e = (at: number, tokens = 1000, model = 'claude-sonnet-4-5'): UsageEntry => ({ at, model, t: { input: tokens, output: 0, cacheWrite: 0, cacheRead: 0 } })

describe('prices', () => {
  it('knows the model families and leaves unknown ones out', () => {
    expect(priceFor('claude-opus-4-1-20250805')?.input).toBe(15)
    expect(priceFor('claude-opus-4-5-20251101')?.input).toBe(5)
    expect(priceFor('claude-opus-5-5')?.input).toBe(4)
    expect(priceFor('claude-sonnet-4-5-20250929')?.output).toBe(15)
    expect(priceFor('claude-haiku-4-5')?.input).toBe(1)
    expect(priceFor('gpt-5-codex')?.input).toBe(1.25)
    expect(priceFor('some-local-model')).toBeNull()
    expect(costOf('some-local-model', { input: 1e6, output: 0, cacheWrite: 0, cacheRead: 0 })).toBe(0)
  })
  it('counts cache writes and reads at their own price', () => {
    // Sonnet: $3 in, $15 out, $3.75 cache write, $0.30 cache read per million.
    expect(costOf('claude-sonnet-4-5', { input: 1e6, output: 1e6, cacheWrite: 1e6, cacheRead: 1e6 })).toBeCloseTo(3 + 15 + 3.75 + 0.3, 5)
  })
  it('gives short names', () => {
    expect(shortModel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
    expect(shortModel('claude-opus-4-20250514')).toBe('Opus 4')
    expect(shortModel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
    expect(shortModel('gpt-5-codex')).toBe('GPT-5 Codex')
    expect(shortModel('anthropic/claude-sonnet-4.5')).toBe('Sonnet 4.5')
  })
})

describe('Claude Code log lines', () => {
  it('reads only the numbers, the model and the time', () => {
    const r = parseClaudeLine(claudeLine({ at: '2026-03-02T09:00:00Z', i: 10, out: 20, cw: 30, cr: 40 }))
    expect(r).toEqual({ at: Date.parse('2026-03-02T09:00:00Z'), model: 'claude-sonnet-4-5-20250929', t: { input: 10, output: 20, cacheWrite: 30, cacheRead: 40 }, key: 'msg_1:req_1' })
    expect(JSON.stringify(r)).not.toContain('secret')
  })
  it('skips lines without usage, broken lines and synthetic messages', () => {
    expect(parseClaudeLine(JSON.stringify({ type: 'user', timestamp: '2026-03-02T09:00:00Z', message: { content: 'hi' } }))).toBeNull()
    expect(parseClaudeLine('{"usage": oops')).toBeNull()
    expect(parseClaudeLine(claudeLine({ at: '2026-03-02T09:00:00Z', model: '<synthetic>' }))).toBeNull()
    expect(parseClaudeLine(claudeLine({ at: 'not a date' }))).toBeNull()
    expect(parseClaudeLine(claudeLine({ at: '2026-03-02T09:00:00Z', i: 0, out: 0 }))).toBeNull()
  })
})

describe('Codex log lines', () => {
  it('counts what is new in the running total and keeps the model and the real limit', () => {
    const st = newCodexState()
    const ev = (at: string, total: number, cached: number, out: number, extra: object = {}) =>
      JSON.stringify({ timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total, cached_input_tokens: cached, output_tokens: out } }, ...extra } })
    expect(parseCodexLine(JSON.stringify({ timestamp: '2026-03-02T09:00:00Z', type: 'turn_context', payload: { model: 'gpt-5-codex', cwd: '/x' } }), st)).toBeNull()
    const a = parseCodexLine(ev('2026-03-02T09:01:00Z', 1000, 400, 100), st)
    expect(a).toEqual({ at: Date.parse('2026-03-02T09:01:00Z'), model: 'gpt-5-codex', t: { input: 600, output: 100, cacheWrite: 0, cacheRead: 400 } })
    const b = parseCodexLine(ev('2026-03-02T09:02:00Z', 1500, 600, 150, { rate_limits: { primary: { used_percent: 42.5, window_minutes: 300, resets_in_seconds: 3600 } } }), st)
    expect(b?.t).toEqual({ input: 300, output: 50, cacheWrite: 0, cacheRead: 200 })
    expect(st.limits?.primary).toEqual({ pct: 42.5, windowMin: 300, resetsAt: Date.parse('2026-03-02T09:02:00Z') + 3600_000 })
    // The same total again adds nothing.
    expect(parseCodexLine(ev('2026-03-02T09:03:00Z', 1500, 600, 150), st)).toBeNull()
  })
})

describe('5-hour blocks', () => {
  it('start at the full hour and last 5 hours; a 5-hour gap starts a new one', () => {
    const blocks = usageBlocks([e(T0), e(T0 + 2 * H), e(T0 + 4.9 * H), e(T0 + 5 * H), e(T0 + 11 * H)])
    expect(blocks.map((b) => new Date(b.start).toISOString())).toEqual(['2026-03-02T09:00:00.000Z', '2026-03-02T14:00:00.000Z', '2026-03-02T20:00:00.000Z'])
    expect(blocks[0].tokens).toBe(2000)
    expect(blocks[0].end - blocks[0].start).toBe(BLOCK_MS)
  })
  it('only the newest block can be running, and only until its end', () => {
    const blocks = usageBlocks([e(T0)])
    expect(activeBlock(blocks, T0 + H)).toBe(blocks[0])
    expect(activeBlock(blocks, T0 + 5 * H)).toBeNull()
  })
})

describe('a tool column', () => {
  const now = T0 + 30 * H
  const entries = [e(now - 26 * H, 8000), e(now - 25 * H, 2000), e(now - 1 * H, 3000), e(now - 0.5 * H, 2000, 'claude-opus-4-5')]
  it('compares this block with the busiest one, with the reset time', () => {
    const t = toolUsage('claude', entries, now)
    expect(t.block?.tokens).toBe(5000)
    expect(t.pct).toBe(50)
    expect(t.basis).toBe('busiest')
    expect(t.resetsAt).toBe(Math.floor((now - H) / H) * H + BLOCK_MS)
    expect(t.week.tokens).toBe(15000)
    expect(t.byModel.map((m) => m.label)).toEqual(['Sonnet 4.5', 'Opus 4.5'])
  })
  it('uses your own limit when set, and Codex\'s real limit when it reports one', () => {
    expect(toolUsage('claude', entries, now, { limit: 20000 }).pct).toBe(25)
    const real = toolUsage('codex', entries, now, { codex: { primary: { pct: 77, windowMin: 300, resetsAt: now + H }, secondary: null, at: now } })
    expect(real.pct).toBe(77)
    expect(real.basis).toBe('limit')
    expect(real.resetsAt).toBe(now + H)
  })
  it('says nothing when there is nothing to compare with', () => {
    const t = toolUsage('claude', [e(now - H)], now)
    expect(t.pct).toBeNull()
    expect(t.basis).toBe('none')
  })
})

describe("Ben's column", () => {
  it('shows the month against the budget', () => {
    const b = benUsage({ today: { calls: 3, cost: 0.02, tokens: 4000 }, week: { calls: 30, cost: 0.4, tokens: 90000 }, byModelWeek: [{ model: 'google/gemini-2.5-flash', calls: 30, cost: 0.4, tokens: 90000 }], budget: { budget: 5, spent: 4.6 } }, T0)!
    expect(b.pct).toBe(92)
    expect(b.letter).toBe('B')
    expect(b.windowId).toBe('month:2026-3')
    expect(b.resetsAt).toBe(new Date(2026, 3, 1).getTime())
  })
  it('no budget (0 = no limit): no ring', () => {
    expect(benUsage({ budget: { budget: 0, spent: 3 } }, T0)!.pct).toBeNull()
  })
})

describe('alerts', () => {
  const col = (pct: number, windowId = '5h:1') => ({ ...toolUsage('claude', [], T0), pct, basis: 'busiest' as const, windowId })
  const p = { on: true, warn: 70, crit: 90 }
  it('warns at 70%, then once more at 90%, each once per window', () => {
    const a = usageAlert([col(72)], [], p)
    expect(a.notice?.text).toBe('Claude 5-hour 72% used')
    expect(a.notice?.level).toBe('warn')
    expect(usageAlert([col(75)], a.told, p).notice).toBeNull()
    const c = usageAlert([col(91)], a.told, p)
    expect(c.notice?.level).toBe('crit')
    expect(usageAlert([col(95)], c.told, p).notice).toBeNull()
    // A new window: told again.
    expect(usageAlert([col(72, '5h:2')], c.told, p).notice?.level).toBe('warn')
  })
  it('going straight to critical counts the warning too', () => {
    const c = usageAlert([col(93)], [], p)
    expect(c.notice?.level).toBe('crit')
    expect(usageAlert([col(80)], c.told, p).notice).toBeNull()
  })
  it('off means quiet', () => {
    expect(usageAlert([col(99)], [], { ...p, on: false }).notice).toBeNull()
  })
})

describe('formats', () => {
  it('tokens, money and time left', () => {
    expect(fmtTokens(950)).toBe('950')
    expect(fmtTokens(1234)).toBe('1.2k')
    expect(fmtTokens(3_400_000)).toBe('3.4M')
    expect(fmtUsd(0.004)).toBe('<$0.01')
    expect(fmtUsd(3.456)).toBe('$3.46')
    expect(fmtLeft(2 * H + 14 * 60_000)).toBe('2h 14m')
    expect(fmtLeft(9 * 60_000)).toBe('9m')
  })
})
