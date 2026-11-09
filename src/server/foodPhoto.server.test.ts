// Food photo logging, the server part (api/_vision.mjs and the foodPhoto op of
// api/ai.mjs): provider by env, keys only in headers, JSON mode, one retry,
// 50 photos a day in sys_kv. Fake providers and made-up foods only.
import { describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
// @ts-expect-error plain JS module without types
import { GEMINI_SCALE_SCHEMA, GEMINI_SCHEMA, buildVisionRequest, countPhoto, foodPhotoPrompt, photoDay, overLimit, readFoodPhoto, readPhotoRequest, visionProvider } from '../../api/_vision.mjs'
// @ts-expect-error plain JS module without types
import { foodPhoto } from '../../api/ai.mjs'
import { validateVision } from '@core/foodVision'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const body = {
  image: { mime: 'image/png', data: PIXEL },
  note: '2 containers, one was buckwheat',
  saved: [{ id: 'sv-bulgur', name: 'Bulgur container', portion: '1 container (350 g)', kcal: 520, protein: 38 }],
  today: { kcal: 1400, protein: 60, items: ['Oats'] },
  targets: { kcal: 2700, protein: 130 }
}
const answer = { items: [{ name: 'Bulgur container', matchedSavedFoodId: 'sv-bulgur', qty: 1, unit: 'container', grams: 350, kcal: 500, protein: 30, confidence: 'high' }], totals: { kcal: 500, protein: 30 }, message: 'Two boxes of grains.' }
const geminiOk = () => json(200, { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: JSON.stringify(answer) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 120 } })

describe('visionProvider', () => {
  it('is Gemini by default, with the model override and a backup', () => {
    expect(visionProvider({ GEMINI_API_KEY: 'g-key' })).toEqual({ name: 'gemini', key: 'g-key', models: ['gemini-3.5-flash', 'gemini-2.5-flash'] })
    expect(visionProvider({ GEMINI_API_KEY: 'g-key', VISION_MODEL: 'gemini-9-flash' }).models[0]).toBe('gemini-9-flash')
  })
  it('is Claude with VISION_PROVIDER=claude and its own key', () => {
    expect(visionProvider({ VISION_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'a-key', GEMINI_API_KEY: 'g' })).toEqual({ name: 'claude', key: 'a-key', models: ['claude-haiku-4-5'] })
    expect(visionProvider({ VISION_PROVIDER: 'Claude', GEMINI_API_KEY: 'g' })).toBeNull()
  })
  it('is null without a key', () => {
    expect(visionProvider({})).toBeNull()
  })
})

describe('the request', () => {
  const req = readPhotoRequest(body)
  it('checks the photo and trims the rest', () => {
    expect(readPhotoRequest({ ...body, image: { mime: 'text/html', data: PIXEL } }).error).toMatch(/JPEG, PNG or WebP/)
    expect(readPhotoRequest({ ...body, image: { mime: 'image/jpeg', data: 'x'.repeat(1_600_000) } }).error).toMatch(/too big/)
    expect(readPhotoRequest({ ...body, image: { mime: 'image/jpeg', data: '<script>' } }).error).toBeTruthy()
    expect(readPhotoRequest({ ...body, image: { mime: 'image/png', data: `data:image/png;base64,${PIXEL}` } }).image.data).toBe(PIXEL)
    expect(readPhotoRequest({ ...body, note: 'x'.repeat(900) }).note).toHaveLength(300)
  })
  it('puts the note, saved foods, today and goals in the prompt', () => {
    const { user, system } = foodPhotoPrompt(req)
    expect(user).toContain('2 containers, one was buckwheat')
    expect(user).toContain('id sv-bulgur: Bulgur container, portion 1 container (350 g): 520 kcal, 38 g protein')
    expect(user).toContain('Today so far: 1400 kcal, 60 g protein (Oats)')
    expect(user).toContain('Goals today: 2700 kcal, 130 g protein')
    expect(system).toMatch(/ONLY with JSON/)
  })
  it('Gemini: JSON mode with a schema; the key only in a header', () => {
    const r = buildVisionRequest({ name: 'gemini', key: 'SECRET-G', models: [] }, 'gemini-3.5-flash', req)
    expect(r.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent')
    expect(r.headers['x-goog-api-key']).toBe('SECRET-G')
    expect(r.url + JSON.stringify(r.body)).not.toContain('SECRET-G')
    expect(r.body.generationConfig.responseMimeType).toBe('application/json')
    expect(r.body.generationConfig.responseSchema).toBe(GEMINI_SCHEMA)
    expect(GEMINI_SCHEMA.type).toBe('OBJECT')
    expect(r.body.contents[0].parts[0].inline_data).toEqual({ mime_type: 'image/png', data: PIXEL })
  })
  it('Claude: a forced tool call; the key only in a header', () => {
    const r = buildVisionRequest({ name: 'claude', key: 'SECRET-A', models: [] }, 'claude-haiku-4-5', req)
    expect(r.url).toBe('https://api.anthropic.com/v1/messages')
    expect(r.headers['x-api-key']).toBe('SECRET-A')
    expect(r.headers['anthropic-version']).toBe('2023-06-01')
    expect(r.url + JSON.stringify(r.body)).not.toContain('SECRET-A')
    expect(r.body.tool_choice).toEqual({ type: 'tool', name: 'log_meal' })
    expect(r.body.tools[0].input_schema.properties.items.items.properties.matchedSavedFoodId.type).toEqual(['string', 'null'])
    expect(r.body.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PIXEL } })
  })
})

describe('scale screenshots (kind scale)', () => {
  const req = readPhotoRequest({ kind: 'scale', image: body.image, saved: body.saved, note: 'ignored' })
  it('keeps only the picture and asks for the scale numbers', () => {
    expect(req).toEqual({ kind: 'scale', image: { mime: 'image/png', data: PIXEL } })
    expect(readPhotoRequest({ kind: 'scale', image: { mime: 'text/html', data: PIXEL } }).error).toMatch(/JPEG, PNG or WebP/)
  })
  it('Gemini and Claude get the scale prompt and shape, keys only in headers', () => {
    const g = buildVisionRequest({ name: 'gemini', key: 'SECRET-G', models: [] }, 'gemini-3.5-flash', req)
    expect(g.body.systemInstruction.parts[0].text).toMatch(/smart scale/)
    expect(g.body.generationConfig.responseSchema).toBe(GEMINI_SCALE_SCHEMA)
    expect(Object.keys(GEMINI_SCALE_SCHEMA.properties)).toEqual(['weightKg', 'bodyFatPct', 'muscleKg', 'waterPct', 'proteinPct', 'boneKg', 'visceralFat', 'bmr', 'bmi', 'heartRate', 'bodyScore', 'measuredAt'])
    expect(JSON.stringify(g.body)).not.toContain('SECRET-G')
    const c = buildVisionRequest({ name: 'claude', key: 'SECRET-A', models: [] }, 'claude-haiku-4-5', req)
    expect(c.body.tool_choice).toEqual({ type: 'tool', name: 'log_scale' })
    expect(c.body.tools[0].input_schema.properties.weightKg.type).toEqual(['number', 'null'])
  })
  it('records its tokens as scaleShot', async () => {
    const used: any[] = []
    const reply = json(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ weightKg: 71.8, bodyFatPct: 15.4 }) }] } }], usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 40 } })
    const out = await readFoodPhoto({ name: 'gemini', key: 'g', models: ['gemini-3.5-flash'] }, req, { fetchImpl: (async () => reply) as any, record: async (u: any) => used.push(u), wait: async () => {} })
    expect(out.json).toEqual({ weightKg: 71.8, bodyFatPct: 15.4 })
    expect(used[0].kind).toBe('scaleShot')
  })
})

describe('readFoodPhoto', () => {
  const req = readPhotoRequest(body)
  const gemini = { name: 'gemini', key: 'g', models: ['gemini-3.5-flash', 'gemini-2.5-flash'] }
  const noWait = async () => {}

  it('returns the JSON and records the tokens', async () => {
    const used: any[] = []
    const out = await readFoodPhoto(gemini, req, { fetchImpl: (async () => geminiOk()) as any, record: async (u: any) => used.push(u), wait: noWait })
    expect(out.json).toEqual(answer)
    expect(used).toEqual([{ model: 'google/gemini-3.5-flash', kind: 'foodPhoto', prompt: 900, completion: 120, cost: null }])
    // The page's validator then uses the saved food's own numbers.
    const v = validateVision(out.json, body.saved)
    expect(v.ok && v.result.items[0].kcal).toBe(520)
  })

  it('moves to the backup model on a 404 and drops thinking when refused', async () => {
    const seen: string[] = []
    const fetchImpl = (async (url: string, init: any) => {
      const b = JSON.parse(init.body)
      seen.push(`${url.split('/').pop()}:${b.generationConfig.thinkingConfig ? 'think' : 'plain'}`)
      if (seen.length === 1) return json(404, { error: { message: 'gone' } })
      if (seen.length === 2) return json(400, { error: { message: 'thinking is not supported' } })
      return geminiOk()
    }) as any
    const out = await readFoodPhoto(gemini, req, { fetchImpl, wait: noWait })
    expect(out.model).toBe('gemini-2.5-flash')
    expect(seen).toEqual(['gemini-3.5-flash:generateContent:think', 'gemini-2.5-flash:generateContent:think', 'gemini-2.5-flash:generateContent:plain'])
  })

  it('retries once on a busy provider or bad JSON, never twice', async () => {
    let n = 0
    const once = (async () => (++n === 1 ? json(503, { error: { message: 'busy' } }) : geminiOk())) as any
    expect((await readFoodPhoto(gemini, req, { fetchImpl: once, wait: noWait })).json).toEqual(answer)
    expect(n).toBe(2)
    let m = 0
    const bad = (async () => (m++, json(200, { candidates: [{ content: { parts: [{ text: 'not json' }] } }] }))) as any
    await expect(readFoodPhoto(gemini, req, { fetchImpl: bad, wait: noWait })).rejects.toThrow(/not valid JSON/)
    expect(m).toBe(2)
  })

  it('does not retry a refused key', async () => {
    let n = 0
    const fetchImpl = (async () => (n++, json(403, { error: { message: 'API key not valid' } }))) as any
    await expect(readFoodPhoto(gemini, req, { fetchImpl, wait: noWait })).rejects.toThrow('Gemini 403')
    expect(n).toBe(1)
  })

  it('reads Claude’s tool call', async () => {
    const fetchImpl = (async () => json(200, { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'log_meal', input: answer }], usage: { input_tokens: 1500, output_tokens: 200 } })) as any
    const used: any[] = []
    const out = await readFoodPhoto({ name: 'claude', key: 'a', models: ['claude-haiku-4-5'] }, req, { fetchImpl, record: async (u: any) => used.push(u), wait: noWait })
    expect(out.json).toEqual(answer)
    expect(used[0].model).toBe('anthropic/claude-haiku-4-5')
  })

  it('stops when the request has no time left', async () => {
    await expect(readFoodPhoto(gemini, req, { fetchImpl: (async () => geminiOk()) as any, deadline: Date.now() + 2000 })).rejects.toThrow(/too long/)
  })
})

describe('50 photos a day', () => {
  it('counts per day in sys_kv and drops old days', async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    const run = async (stmts: { sql: string; args: string[] }[]) => {
      let rows: unknown[][] = []
      for (const s of stmts) rows = db.exec(s.sql, s.args)[0]?.values ?? []
      return rows
    }
    const day1 = new Date('2026-11-09T10:00:00Z')
    for (let i = 1; i <= 50; i++) expect(await countPhoto(run, day1)).toBe(i)
    expect(overLimit(50)).toBe(false)
    expect(overLimit(await countPhoto(run, day1))).toBe(true)
    // The next day starts at 1 and yesterday's counter is gone.
    expect(await countPhoto(run, new Date('2026-11-10T08:00:00Z'))).toBe(1)
    expect(db.exec("SELECT key FROM sys_kv WHERE key LIKE 'vision:%'")[0].values).toEqual([['vision:2026-11-10']])
  })
  it('the day is the owner day (LIFE_TZ)', async () => {
    expect(photoDay(new Date('2026-11-09T23:30:00Z'), 'Europe/Chisinau')).toBe('2026-11-10')
    expect(photoDay(new Date('2026-11-09T23:30:00Z'))).toBe('2026-11-09')
    expect(photoDay(new Date('2026-11-09T23:30:00Z'), 'Not/AZone')).toBe('2026-11-09')
  })
  it('a database that does not answer is an error, not a free pass', async () => {
    await expect(countPhoto(async () => [])).rejects.toThrow('Database not reachable')
  })
})

describe('the foodPhoto op', () => {
  it('says what is missing when there is no key, with the fallback', async () => {
    const r = await foodPhoto(body, { VITEST: '1' })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/GEMINI_API_KEY is missing/), fallback: expect.stringMatching(/Copy the prompt/) })
    expect((await foodPhoto(body, { VITEST: '1', VISION_PROVIDER: 'claude' })).error).toMatch(/ANTHROPIC_API_KEY/)
  })
  it('answers {ok, result} and hides provider errors and keys', async () => {
    const ok = await foodPhoto(body, { VITEST: '1', GEMINI_API_KEY: 'SECRET-G' }, (async () => geminiOk()) as any)
    expect(ok).toMatchObject({ ok: true, result: answer })
    const bad = await foodPhoto(body, { VITEST: '1', GEMINI_API_KEY: 'SECRET-G' }, (async () => json(403, { error: { message: 'key SECRET-G not valid' } })) as any)
    expect(bad.ok).toBe(false)
    expect(JSON.stringify(bad)).not.toContain('SECRET-G')
    expect(bad.fallback).toBeTruthy()
  })
  it('refuses a bad photo before any call', async () => {
    let called = false
    const r = await foodPhoto({ ...body, image: null }, { VITEST: '1', GEMINI_API_KEY: 'g' }, (async () => ((called = true), geminiOk())) as any)
    expect(r.ok).toBe(false)
    expect(called).toBe(false)
  })
})
