// AI on the website: the server asks Gemini (next model on a 404, thinking
// parts left out) and the coach's actions run on the real services.
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module without types
import { askGemini } from '../../../../api/ai.mjs'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('askGemini', () => {
  it('sends the key in a header, skips a missing model and drops thinking parts', async () => {
    const calls: Array<{ url: string; key: string | null }> = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, key: new Headers(init.headers).get('x-goog-api-key') })
      if (calls.length === 1) return json(404, { error: { message: 'gone' } })
      return json(200, { candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: 'Hello' }, { text: ' there' }] } }] })
    }) as unknown as typeof fetch
    const r = await askGemini('k-1', 'hi', fetchImpl)
    expect(r.text).toBe('Hello there')
    expect(calls).toHaveLength(2)
    expect(calls[0].url).not.toContain('k-1')
    expect(calls[1].key).toBe('k-1')
    expect(r.model).toBe('gemini-3.1-flash-lite')
  })

  it('reports Google’s error in plain words', async () => {
    const fetchImpl = (async () => json(403, { error: { message: 'API key not valid' } })) as unknown as typeof fetch
    await expect(askGemini('bad', 'hi', fetchImpl)).rejects.toThrow('Gemini 403: API key not valid')
  })
})

describe('OpenRouter first, Gemini as backup', () => {
  it('picks the newest DeepSeek flash model on OpenRouter', async () => {
    // @ts-expect-error plain JS module without types
    const { openRouterModel } = await import('../../../../api/ai.mjs?pick')
    const f = (async () => json(200, { data: [{ id: 'deepseek/deepseek-chat' }, { id: 'deepseek/deepseek-v3.1-flash' }, { id: 'deepseek/deepseek-v4.1-flash' }, { id: 'deepseek/deepseek-v4.1-flash:free' }, { id: 'openai/gpt-x-flash' }] })) as unknown as typeof fetch
    expect(await openRouterModel({}, f)).toBe('deepseek/deepseek-v4.1-flash')
    expect(await openRouterModel({ OPENROUTER_MODEL: 'deepseek/other' }, f)).toBe('deepseek/other')
  })

  it('picks a strong model for hard thinking, and falls back to flash when it fails', async () => {
    // @ts-expect-error plain JS module without types
    const { strongModel, askOpenRouter } = await import('../../../../api/ai.mjs?strong')
    const list = { data: [{ id: 'deepseek/deepseek-v4.1-flash' }, { id: 'deepseek/deepseek-v4-pro' }, { id: 'deepseek/deepseek-v4.1-pro' }, { id: 'deepseek/deepseek-r1-distill-qwen' }, { id: 'deepseek/deepseek-v4.1-pro:free' }] }
    const used: string[] = []
    const f = (async (url: string, init?: any) => {
      if (String(url).endsWith('/models')) return json(200, list)
      const body = JSON.parse(init.body)
      used.push(body.model)
      if (body.model.includes('pro')) return json(500, { error: { message: 'busy' } })
      return json(200, { choices: [{ message: { content: '{"reply":"ok"}' } }] })
    }) as unknown as typeof fetch
    expect(await strongModel({}, f)).toBe('deepseek/deepseek-v4.1-pro')
    const r = await askOpenRouter('k', 'hi', f, { strong: true }, {})
    expect(used).toEqual(['deepseek/deepseek-v4.1-pro', 'deepseek/deepseek-v4.1-flash'])
    expect(r.model).toBe('deepseek/deepseek-v4.1-flash')
  })

  it('uses OpenRouter for text, Gemini for photos and when OpenRouter fails', async () => {
    // @ts-expect-error plain JS module without types
    const { askModel } = await import('../../../../api/ai.mjs?route')
    const env = { OPENROUTER_API_KEY: 'or', GEMINI_API_KEY: 'g', OPENROUTER_MODEL: 'deepseek/x' }
    const hits: string[] = []
    const ok = (async (url: string) => {
      hits.push(url.includes('openrouter') ? 'or' : 'gemini')
      if (url.includes('openrouter')) return json(200, { choices: [{ message: { content: 'from deepseek' } }] })
      return json(200, { candidates: [{ content: { parts: [{ text: 'from gemini' }] } }] })
    }) as unknown as typeof fetch
    expect((await askModel('hi', {}, env, ok)).text).toBe('from deepseek')
    expect((await askModel('receipt', { media: [{ mime: 'image/jpeg', data: 'x' }] }, env, ok)).text).toBe('from gemini')
    const down = (async (url: string) => (url.includes('openrouter') ? json(500, { error: { message: 'down' } }) : json(200, { candidates: [{ content: { parts: [{ text: 'backup' }] } }] }))) as unknown as typeof fetch
    expect((await askModel('hi', {}, env, down)).text).toBe('backup')
  })

  it('keeps every answer, with all its fallbacks, inside one time limit per request', async () => {
    // @ts-expect-error plain JS module without types
    const { askModel, slot } = await import('../../../../api/ai.mjs?deadline')
    expect(slot(30_000, Date.now() + 50_000)).toBe(30_000)
    expect(slot(30_000, Date.now() + 10_000)).toBeLessThanOrEqual(7_000)
    expect(() => slot(30_000, Date.now() + 4_000)).toThrow(/too long/)
    // Every model hangs until its own time limit stops it.
    const env = { OPENROUTER_API_KEY: 'or', GEMINI_API_KEY: 'g', OPENROUTER_MODEL: 'deepseek/x', OPENROUTER_STRONG_MODEL: 'deepseek/y' }
    const tries: string[] = []
    const hang = ((url: string, init?: any) => {
      tries.push(url.includes('openrouter') ? JSON.parse(init.body).model : 'gemini')
      return new Promise((_ok, no) => init?.signal?.addEventListener('abort', () => no(init.signal.reason ?? new Error('aborted'))))
    }) as unknown as typeof fetch
    const t0 = Date.now()
    await expect(askModel('plan my week', { strong: true, deadline: Date.now() + 5_000 }, env, hang)).rejects.toThrow(/too long/)
    // The first try got the time that was left (less 3 s); then nothing else was tried.
    expect(Date.now() - t0).toBeLessThan(3_500)
    expect(tries).toEqual(['deepseek/y'])
  })

  it('the coach prompt carries your goals and rules', async () => {
    const { brainPrompt } = await import('./botBrain')
    const p = brainPrompt('mega', 'ctx', { facts: [], chat: [] }, 'hi', undefined, { about: 'Student in Chisinau', goals: ['Pass the DS exam'], rules: ['No phone in bed'] })
    expect(p).toContain('- Pass the DS exam')
    expect(p).toContain('hold him to them')
    expect(p).toContain('- No phone in bed')
    expect(p).toContain('Student in Chisinau')
  })
})
