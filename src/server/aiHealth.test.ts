// Ben's AI health (the "Ben's AI: Failing … aborted due to timeout" messages):
// a slow thinking model falls back to the quick one, the quick one gets at most
// one retry, the self-check ping uses the quick model with thinking off, and a
// call that was never made (the tick's time was used up) doesn't count.
// Fake fetch and fake timers only; nothing reaches the network.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { aiFailureCounts } from '@core/health'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const timeoutError = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError')
const env = { OPENROUTER_API_KEY: 'or-test', OPENROUTER_MODEL: 'deepseek/quick', OPENROUTER_STRONG_MODEL: 'deepseek/thinker' }
type Call = { model: string; body: any; ms: number | null }

/** A fake OpenRouter: `plan(model, n)` answers each call (n = calls so far to that model). */
function fakeRouter(plan: (model: string, n: number) => Response | Error) {
  const calls: Call[] = []
  const seen: Record<string, number> = {}
  const f = (async (_url: string, init?: any) => {
    const body = JSON.parse(init.body)
    calls.push({ model: body.model, body, ms: null })
    seen[body.model] = (seen[body.model] ?? 0) + 1
    const r = plan(body.model, seen[body.model])
    if (r instanceof Error || r instanceof DOMException) throw r
    return r
  }) as unknown as typeof fetch
  return { f, calls }
}
const answer = (model: string, text: string) => json(200, { model, choices: [{ message: { content: text } }] })

afterEach(() => {
  vi.useRealTimers()
})

describe("Ben's AI: time-outs", () => {
  it('a thinking model that times out in the tick: the quick model answers, marked as the stand-in', async () => {
    // @ts-expect-error plain JS module without types
    const { askModel } = await import('../../api/ai.mjs?bg-timeout')
    const { f, calls } = fakeRouter((m) => (m === 'deepseek/thinker' ? timeoutError() : answer(m, 'quick plan')))
    const r = await askModel('morning plan', { strong: true, think: true, kind: 'plan', deadline: Date.now() + 50_000 }, env, f)
    expect(r.text).toBe('quick plan')
    expect(r.fallback).toBe('quick')
    expect(calls.map((c) => c.model)).toEqual(['deepseek/thinker', 'deepseek/quick'])
  })

  it('the thinking model gets a shorter cap in background work, so the quick model keeps a fair try', async () => {
    // @ts-expect-error plain JS module without types
    const { BACKGROUND_THINK_MS, thinkSlot } = await import('../../api/ai.mjs?bg-cap')
    expect(BACKGROUND_THINK_MS).toBeLessThan(35_000)
    // 50 s for the tick: thinking gets at most the cap, leaving 50 − 3 − cap for the quick model.
    expect(thinkSlot(BACKGROUND_THINK_MS, Date.now() + 50_000)).toBe(BACKGROUND_THINK_MS)
  })

  it('the quick model is retried once after a time-out (1 s wait, fastest provider), and the answer arrives', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    // @ts-expect-error plain JS module without types
    const { askModel, RETRY_BACKOFF_MS } = await import('../../api/ai.mjs?retry-ok')
    const { f, calls } = fakeRouter((m, n) => (n === 1 ? timeoutError() : answer(m, 'second try')))
    const p = askModel('evening note', { kind: 'nudge', deadline: Date.now() + 50_000 }, env, f)
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS - 10)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(20)
    expect((await p).text).toBe('second try')
    expect(calls).toHaveLength(2)
    expect(calls[0].body.provider).toEqual({ order: ['deepseek'], allow_fallbacks: true })
    expect(calls[1].body.provider).toEqual({ sort: 'latency' })
  })

  it('never more than one retry, and the error is plain words (not "aborted due to timeout")', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    // @ts-expect-error plain JS module without types
    const { askModel } = await import('../../api/ai.mjs?retry-fail')
    const { f, calls } = fakeRouter(() => timeoutError())
    const p = askModel('evening note', { kind: 'nudge', deadline: Date.now() + 50_000 }, env, f)
    const done = expect(p).rejects.toThrow(/quick timed out after \d+ s/)
    await vi.advanceTimersByTimeAsync(5_000)
    await done
    expect(calls).toHaveLength(2)
  })

  it("Ben's chat retries by itself: the server doesn't add a retry on top", async () => {
    // @ts-expect-error plain JS module without types
    const { askModel } = await import('../../api/ai.mjs?chat-own-retry')
    const { f, calls } = fakeRouter(() => timeoutError())
    await expect(askModel('hi', { kind: 'chat', deadline: Date.now() + 50_000 }, env, f)).rejects.toThrow(/timed out/)
    expect(calls).toHaveLength(1)
  })

  it('a refused key is not retried', async () => {
    // @ts-expect-error plain JS module without types
    const { askModel } = await import('../../api/ai.mjs?no-retry-401')
    const { f, calls } = fakeRouter(() => json(401, { error: { message: 'No auth credentials found' } }))
    await expect(askModel('note', { kind: 'nudge', deadline: Date.now() + 50_000 }, env, f)).rejects.toThrow(/401/)
    expect(calls).toHaveLength(1)
  })

  it('a call that was never made (the tick had no time left) is not an AI failure', async () => {
    // @ts-expect-error plain JS module without types
    const { slot } = await import('../../api/ai.mjs?skipped')
    let err: any = null
    try {
      slot(30_000, Date.now() + 2_000)
    } catch (e) {
      err = e
    }
    expect(err?.skipped).toBe(true)
    expect(aiFailureCounts(err, {}, 1, 0)).toBe(false)
    // A real time-out still counts.
    expect(aiFailureCounts(Object.assign(new Error('quick timed out after 30 s'), { timeout: true }), {}, 1, 0)).toBe(true)
  })
})

describe('the daily self-check AI ping', () => {
  it('asks the quick model with thinking off and a tight token cap, never the thinking model', async () => {
    // @ts-expect-error plain JS module without types
    const { pingModel, PING_TIMEOUTS_MS } = await import('../../api/ai.mjs?ping')
    const { f, calls } = fakeRouter((m) => answer(m, 'OK'))
    const r = await pingModel(env, f)
    expect(r.ai).toMatchObject({ ok: true, model: 'deepseek/quick' })
    expect(calls).toHaveLength(1)
    expect(calls[0].model).toBe('deepseek/quick')
    expect(calls[0].body.max_tokens).toBeLessThanOrEqual(5)
    expect(calls[0].body.reasoning).toEqual({ enabled: false })
    expect(PING_TIMEOUTS_MS[0]).toBeLessThanOrEqual(10_000)
  })

  it('one slow ping is asked again after a short wait before it reports a failure', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    // @ts-expect-error plain JS module without types
    const { pingModel } = await import('../../api/ai.mjs?ping-retry')
    const { f, calls } = fakeRouter((m, n) => (n === 1 ? timeoutError() : answer(m, 'OK')))
    const p = pingModel(env, f)
    await vi.advanceTimersByTimeAsync(2_000)
    expect((await p).ai.ok).toBe(true)
    expect(calls).toHaveLength(2)
    const down = fakeRouter(() => timeoutError())
    const q = pingModel(env, down.f)
    await vi.advanceTimersByTimeAsync(2_000)
    expect((await q).ai).toMatchObject({ ok: false, error: expect.stringMatching(/no answer in \d+ s/) })
  })
})
