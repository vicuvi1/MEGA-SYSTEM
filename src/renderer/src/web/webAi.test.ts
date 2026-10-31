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
