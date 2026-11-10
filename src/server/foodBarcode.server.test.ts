// Barcodes (Open Food Facts), the month's photo counter and the cost op, on fakes only.
import { describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
// @ts-expect-error plain JS module without types
import { barcodeDigits, countPhoto, foodPhotoPrompt, lookupBarcode, readPhotoRequest, withBarcode, GEMINI_SCHEMA } from '../../api/_vision.mjs'
// @ts-expect-error plain JS module without types
import { foodPhoto, photoCost } from '../../api/ai.mjs'
import { validateVision } from '@core/foodVision'
import { cleanBarcode } from '@core/foodBarcode'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const CODE = '4006381333931'
const OFF = { status: 1, product: { product_name: 'Oat Drink', brands: 'Madeup', serving_quantity: 250, nutriments: { 'energy-kcal_100g': 46, proteins_100g: 1, carbohydrates_100g: 6.7, fat_100g: 1.5, fiber_100g: 0.8 } } }
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('barcode lookup', () => {
  it('uses the same check digit rule as the page', () => {
    for (const c of [CODE, '036000291452', '96385074', '4006381333932', '12', '00000000']) expect(barcodeDigits(c)).toBe(cleanBarcode(c))
  })
  it('finds a product, sends only the code and a plain app name', async () => {
    let url = ''
    let ua = ''
    const r = await lookupBarcode(CODE, (async (u: string, o: any) => ((url = u), (ua = o.headers['User-Agent']), json(200, OFF))) as any)
    expect(url).toBe(`https://world.openfoodfacts.org/api/v2/product/${CODE}.json?fields=product_name,brands,nutriments,serving_quantity`)
    expect(ua).toBe('LifeSystem/1.0 (personal food log)')
    expect(r.product).toEqual({ code: CODE, name: 'Oat Drink', brand: 'Madeup', servingG: 250, per100: { kcal: 46, protein: 1, carbs: 6.7, fat: 1.5, fiber: 0.8 } })
  })
  it('unknown, blocked, offline or slow: no product, and why', async () => {
    expect(await lookupBarcode(CODE, (async () => json(200, { status: 0 })) as any)).toEqual({ miss: 'notFound' })
    expect(await lookupBarcode(CODE, (async () => json(404, {})) as any)).toEqual({ miss: 'notFound' })
    expect(await lookupBarcode(CODE, (async () => json(403, 'blocked')) as any)).toEqual({ miss: 'offline' })
    expect(await lookupBarcode(CODE, (async () => {
      throw new TypeError('fetch failed')
    }) as any)).toEqual({ miss: 'offline' })
    const slow = (async (_u: string, o: any) => new Promise((_ok, no) => o.signal.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))))) as any
    expect(await lookupBarcode(CODE, slow, 50)).toEqual({ miss: 'offline' })
    expect(await lookupBarcode('123', (async () => json(200, OFF)) as any)).toEqual({ miss: 'notFound' })
  })
  it('attaches the product to the answer; the page check uses it', async () => {
    const ans = { items: [{ name: 'oat milk', qty: 1, unit: 'glass', grams: 250, kcal: 130, protein: 3, carbs: 16, fat: 5, confidence: 'medium', fromBarcode: true }], message: 'A glass of oat drink.', barcode: CODE }
    const out = await withBarcode(ans, (async () => json(200, OFF)) as any)
    const r = validateVision(out)
    if (!r.ok) throw new Error(r.error)
    expect(r.result.items[0]).toMatchObject({ name: 'Madeup Oat Drink', grams: 250, kcal: 115, src: 'barcode' })
    const off = await withBarcode(ans, (async () => json(500, {})) as any)
    expect(off.productMiss).toBe('offline')
    expect(await withBarcode({ items: [] }, (async () => json(200, OFF)) as any)).toEqual({ items: [] })
  })
  it('the foodPhoto op looks the barcode up after the read', async () => {
    const calls: string[] = []
    const answer = { items: [{ name: 'Oat drink', matchedSavedFoodId: null, qty: 1, unit: 'glass', grams: 250, gramsLow: 200, gramsHigh: 300, kcal: 130, protein: 3, carbs: 16, fat: 5, confidence: 'medium', fromBarcode: true }], message: 'Oat drink.', barcode: CODE }
    const fetchImpl = (async (u: string) => {
      calls.push(u.includes('openfoodfacts') ? 'off' : 'gemini')
      return u.includes('openfoodfacts') ? json(200, OFF) : json(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 120 } })
    }) as any
    const r = await foodPhoto({ image: { mime: 'image/png', data: PIXEL }, note: '' }, { VITEST: '1', GEMINI_API_KEY: 'k' }, fetchImpl)
    expect(r.ok).toBe(true)
    expect(calls).toEqual(['gemini', 'off'])
    expect(r.result.product.name).toBe('Oat Drink')
  })
  it('the prompt and schema ask for the barcode, fibre, processing and leftovers', () => {
    const p = foodPhotoPrompt(readPhotoRequest({ image: { mime: 'image/png', data: PIXEL } }))
    expect(p.system).toMatch(/barcode = its digits/)
    expect(p.system).toMatch(/leftovers: true only when/)
    expect(p.system).toMatch(/fiber = grams of fibre; ultra = true/)
    expect(Object.keys(GEMINI_SCHEMA.properties)).toEqual(expect.arrayContaining(['barcode', 'leftovers']))
    expect(Object.keys(GEMINI_SCHEMA.properties.items.items.properties)).toEqual(expect.arrayContaining(['fromBarcode', 'fiber', 'ultra']))
  })
})

describe('the month of photos and the cost op', () => {
  const sqlRun = async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    const run = async (stmts: { sql: string; args: string[] }[]) => {
      let rows: unknown[][] = []
      for (const s of stmts) {
        const r = db.exec(s.sql, s.args)
        rows = r[0]?.values ?? []
      }
      return rows
    }
    return { db, run }
  }
  it('countPhoto also counts the month (kept until the next month)', async () => {
    const { db, run } = await sqlRun()
    await countPhoto(run, new Date('2030-03-10T10:00:00Z'), '', 3)
    await countPhoto(run, new Date('2030-03-11T10:00:00Z'), '', 2)
    expect(db.exec("SELECT value FROM sys_kv WHERE key = 'photos:2030-03'")[0].values[0][0]).toBe('5')
    await countPhoto(run, new Date('2030-04-01T10:00:00Z'))
    expect(db.exec("SELECT key, value FROM sys_kv WHERE key LIKE 'photos:%'")[0].values).toEqual([['photos:2030-04', '1']])
  })
  it('photoCost sums the photo reads and the month counter (nothing set up: empty)', async () => {
    expect(await photoCost({}, (async () => json(200, {})) as any, new Date('2030-03-15T12:00:00Z'))).toEqual({ month: '2030-03', photos: null, rows: [] })
    let sent: any = null
    const cell = (v: string | number) => ({ type: 'text', value: String(v) })
    const fetchImpl = (async (_u: string, o: any) => {
      sent = JSON.parse(o.body)
      return json(200, { results: [{}, { type: 'ok', response: { result: { rows: [[cell('foodPhoto'), cell(12), cell(18000), cell(4800)], [cell('foodPhoto2'), cell(2), cell(3000), cell(2600)]] } } }, {}, { type: 'ok', response: { result: { rows: [[cell(15)]] } } }] })
    }) as any
    const r = await photoCost({ TURSO_URL: 'https://db.example', TURSO_TOKEN: 't' }, fetchImpl, new Date('2030-03-15T12:00:00Z'))
    expect(r).toEqual({ month: '2030-03', photos: 15, rows: [{ kind: 'foodPhoto', calls: 12, prompt: 18000, completion: 4800 }, { kind: 'foodPhoto2', calls: 2, prompt: 3000, completion: 2600 }] })
    expect(JSON.stringify(sent)).toContain('photos:2030-03')
  })
})
