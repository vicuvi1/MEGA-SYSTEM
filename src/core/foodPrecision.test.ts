// Food photo precision (made-up meals, pinned clock): ranges and labels in the
// AI's answer, merging with his saved foods, his usual portions learned from his
// fixes, the one short question, the short prompt, and the cost controls
// (small thinking first, one careful second look, a fixed image size).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyPortions, cleanPortions, foodKey, learnPortions, pickSaved, portionFor, portionHints, questionFor, rangeOf, toFoodItems, validateVision, type SavedFoodRef, type VisionItem } from './foodVision'
import { askGrams, confidenceBadge, lockerPhotoIds, multiplyPhoto, photoDraft, photoDraftText, photoSavedText, readAskAnswer, removePhotoItem, cleanFoodBen } from './foodBen'
import { cleanFoodLog } from './food'
// @ts-expect-error plain JS server helper
import { buildVisionRequest, foodPhotoPrompt, mediaResolution, needsSecondLook, readFoodPhoto, readPhotoRequest, usageOf, THINK_HIGH, THINK_LOW } from '../../api/_vision.mjs'

afterEach(() => vi.useRealTimers())
const pin = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
  return Date.parse(iso)
}

const SAVED: SavedFoodRef[] = [
  { id: 'sf-oats', name: 'Oat porridge bowl', portion: '1 bowl (300 g)', kcal: 330, protein: 12, carbs: 54, fat: 7 },
  { id: 'sf-shake', name: 'Protein shake', portion: '1 bottle (330 g)', kcal: 160, protein: 30, carbs: 6, fat: 2 }
]
const est = (name: string, grams: number, confidence: 'high' | 'medium' | 'low' = 'medium', extra: Partial<VisionItem> = {}): VisionItem => ({ name, matchedSavedFoodId: null, qty: 1, unit: 'serving', grams, kcal: grams, protein: grams / 10, carbs: grams / 5, fat: grams / 50, confidence, src: 'estimate', ...extra })

describe('reading the answer', () => {
  it('keeps a sane range, makes one from the confidence otherwise, and a label is exact', () => {
    const r = validateVision({
      items: [
        { name: 'rice', grams: 200, gramsLow: 160, gramsHigh: 250, kcal: 260, protein: 5, carbs: 57, fat: 1, confidence: 'medium' },
        { name: 'chicken', grams: 150, gramsLow: 10, gramsHigh: 900, kcal: 250, protein: 46, carbs: 0, fat: 5, confidence: 'low' },
        { name: 'yogurt cup', grams: 150, kcal: 138, protein: 15, carbs: 6, fat: 6, confidence: 'low', fromLabel: true }
      ],
      totals: { kcal: 1, protein: 1 },
      message: 'Lunch.'
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.result.items[0]).toMatchObject({ lo: 160, hi: 250, src: 'estimate' })
    // A silly range (15× wide) is replaced by ±40 % for a low-confidence guess.
    expect(r.result.items[1]).toMatchObject({ lo: 90, hi: 210 })
    expect(r.result.items[2]).toMatchObject({ src: 'label', confidence: 'high', lo: 135, hi: 165 })
    // The AI's totals are ignored: summed again from the items.
    expect(r.result.totals).toEqual({ kcal: 648, protein: 66, carbs: 63, fat: 12 })
    // One short question for the food it could not see well (never for a label).
    expect(r.result.question).toEqual({ index: 1, text: 'About how many grams of chicken?' })
    // The range reaches the food counter's items.
    expect(toFoodItems(r.result.items)[0]).toMatchObject({ grams: 200, lo: 160, hi: 250 })
    expect(cleanFoodLog({ meals: [{ id: 'fd-p1', day: '2030-03-12', at: '2030-03-12T12:00:00Z', items: toFoodItems(r.result.items), photos: ['fpabcn1', 'bad id!'] }] }).meals[0]).toMatchObject({ photos: ['fpabcn1'], items: [{ lo: 160, hi: 250 }, {}, {}] })
  })

  it('a saved food uses his numbers × qty, sure and with a narrow range', () => {
    const r = validateVision({ items: [{ name: 'porridge', matchedSavedFoodId: 'sf-oats', qty: 1.5, unit: 'bowl', grams: 999, kcal: 1, protein: 1, confidence: 'medium' }], message: '' }, SAVED)
    if (!r.ok) throw new Error(r.error)
    expect(r.result.items[0]).toMatchObject({ name: 'Oat porridge bowl', grams: 450, kcal: 495, protein: 18, src: 'saved', lo: 405, hi: 495 })
    expect(rangeOf(0, 'low')).toEqual({})
  })
})

describe('his usual portions', () => {
  it('food keys ignore cooking words, plurals and order', () => {
    expect(foodKey('Boiled white rice')).toBe('rice white')
    expect(foodKey('White Rice, cooked')).toBe('rice white')
    expect(foodKey('Potatoes')).toBe('potato')
    expect(foodKey('Berries')).toBe('berry')
  })

  it('learns only the foods he fixed (not saved foods or labels), newest fix counts most', () => {
    const t = pin('2030-03-12T13:00:00')
    const base = [est('white rice', 150), est('chicken breast', 150), { ...est('yogurt', 150), src: 'label' as const }, { ...est('Oat porridge bowl', 300), matchedSavedFoodId: 'sf-oats' }]
    const now = [est('white rice', 220), est('chicken breast', 152), { ...base[2], grams: 300 }, { ...base[3], grams: 600 }]
    const m1 = learnPortions(null, base, now, t)
    expect(m1).toEqual({ 'rice white': { g: 220, n: 1, at: t } })
    const m2 = learnPortions(m1, [est('rice', 150)], [est('rice white', 260)], t + 1)
    expect(m2['rice white']).toEqual({ g: 244, n: 2, at: t + 1 })
    expect(cleanPortions({ ...m2, 'BAD KEY': { g: 100 }, ok: { g: 2 } })).toEqual(m2)
  })

  it('his portion replaces a guess (macros scale), never a sure read, a label or a saved food', () => {
    const mem = { 'rice white': { g: 220, n: 2, at: 1 } }
    expect(portionFor(mem, 'Steamed white rice with sesame')).toBe(mem['rice white'])
    expect(portionFor(mem, 'rice')).toBeNull()
    const out = applyPortions([est('white rice', 110), est('white rice', 110, 'high'), { ...est('white rice', 110), src: 'label' }], mem)
    expect(out[0]).toMatchObject({ grams: 220, kcal: 220, protein: 22, src: 'memory', confidence: 'medium', lo: 198, hi: 242 })
    expect(out[1].grams).toBe(110)
    expect(out[2].grams).toBe(110)
    // validateVision applies it when handed the memory; no question then.
    const r = validateVision({ items: [{ name: 'white rice', grams: 100, kcal: 130, protein: 3, carbs: 28, fat: 0, confidence: 'low' }], message: '' }, [], 1, mem)
    if (!r.ok) throw new Error(r.error)
    expect(r.result.items[0]).toMatchObject({ grams: 220, kcal: 286, src: 'memory' })
    expect(r.result.question).toBeNull()
  })

  it('hints: the foods his note names first, at most 8; saved foods: the named ones first', () => {
    const mem = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`food${String.fromCharCode(97 + i)}`, { g: 100 + i, n: 1, at: i }]))
    mem['rice white'] = { g: 220, n: 1, at: 0 }
    const h = portionHints(mem, 'rice and stuff')
    expect(h).toHaveLength(8)
    expect(h[0]).toEqual({ name: 'rice white', g: 220 })
    expect(pickSaved(SAVED, 'had my protein shake', 1).map((s) => s.id)).toEqual(['sf-shake'])
    expect(pickSaved(SAVED, '', 1).map((s) => s.id)).toEqual(['sf-oats'])
  })
})

describe('the Telegram preview and fixes', () => {
  const D = photoDraft('ab12', Date.parse('2030-03-12T13:05:00'), [est('white rice', 200, 'medium', { lo: 160, hi: 250 }), est('salad', 80, 'low')], 'Lunch.', { ask: 1, n: 2 })

  it('shows the meal and when, ranges, totals, the badge and the one question', () => {
    pin('2030-03-12T13:05:00')
    const t = photoDraftText(D, 'lunch')
    expect(t).toMatch(/^📸 <b>Lunch<\/b> · Tue 12 Mar, 13:05\n\n1\. <b>White rice<\/b> · 200 g <i>\(160–250\)<\/i>\n {4}200 kcal · P 20 · C 40 · F 4/)
    expect(t).toMatch(/<b>Total ~280 kcal · 28 g protein<\/b>\nCarbs 56 g · Fat 6 g · 🔴 rough guess/)
    expect(t).toMatch(/❓ <b>About how many grams of salad\?<\/b>/)
    expect(confidenceBadge([{ confidence: 'high' }, { confidence: 'sure' }]).dot).toBe('🟢')
    expect(confidenceBadge([{ confidence: 'medium' }]).dot).toBe('🟡')
  })

  it('½× / 2×, Remove, Change grams with a bare number; photo ids are stable', () => {
    const half = multiplyPhoto(D, 0, 0.5, [])
    expect(half.photo!.now[0]).toMatchObject({ grams: 100, kcal: 100, lo: 80, hi: 125 })
    expect(half.items[0].grams).toBe(100)
    const rm = removePhotoItem(D, 0)!
    expect(rm.photo!.now.map((i) => i.name)).toEqual(['salad'])
    expect(rm.photo!.ask).toBe(0)
    expect(removePhotoItem(rm, 0)).toBeNull()
    const asked = askGrams(D, 0)
    expect(readAskAnswer('180', asked)).toEqual({ index: 0, grams: 180 })
    expect(readAskAnswer('180 g', asked)).toEqual({ index: 0, grams: 180 })
    expect(readAskAnswer('rice 180', asked)).toBeNull()
    expect(readAskAnswer('2', asked)).toBeNull()
    expect(lockerPhotoIds('ab12', 2)).toEqual(['fpab12n1', 'fpab12n2'])
    // The draft keeps the question and the photo count through the setting.
    expect(cleanFoodBen({ draft: D, muteUntil: null }).draft!.photo).toMatchObject({ ask: 1, n: 2 })
  })

  it('the saved message lists every food with its macros, and the day line', () => {
    const t = photoSavedText(D.photo!.now, 'lunch', Date.parse('2030-03-12T13:05:00'), 'Today: 900 / 2,700 kcal, 60 / 150 g. ~1,800 kcal left, 90 g protein.')
    expect(t.split('\n')).toEqual([
      '✅ <b>Lunch saved</b> · Tue 12 Mar, 13:05',
      '• White rice 200 g: 200 kcal · P 20 · C 40 · F 4',
      '• Salad 80 g: 80 kcal · P 8 · C 16 · F 2',
      '<b>280 kcal · 28 g protein</b> · C 56 · F 6 · 🔴',
      '🏅 Score <b>A</b>: Add fibre: a handful of vegetables, beans or a slice of rye bread.',
      'Today: 900 / 2,700 kcal, 60 / 150 g. ~1,800 kcal left, 90 g protein.'
    ])
  })
})

describe('the request and its cost', () => {
  const img = { mime: 'image/jpeg', data: 'AAAA' }
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `sf-${i}`, name: `Saved food ${i}`, portion: '1 box (300 g)', kcal: 400, protein: 30 }))

  it('a short prompt: 8 saved foods (the named ones first), his usual portions, no today or goals', () => {
    const req = readPhotoRequest({ image: img, note: 'buckwheat box again', saved: [...many.slice(0, 33), { id: 'sf-33', name: 'Buckwheat box', portion: '1 box (300 g)', kcal: 400, protein: 15 }], portions: [{ name: 'rice white', g: 220 }, { name: '', g: 5 }], today: { kcal: 1, protein: 1 } })
    const { system, user } = foodPhotoPrompt(req)
    expect(user.match(/^- id /gm)).toHaveLength(8)
    expect(user).toMatch(/^- id sf-33:/m)
    expect(user).toContain('HIS USUAL PORTIONS: rice white 220 g')
    expect(user).not.toMatch(/Today so far|Goals today/)
    expect(system.length + user.length).toBeLessThan(2600)
  })

  it('Gemini: a small thinking budget and a medium image size by default (VISION_MEDIA, VISION_MODEL change them)', () => {
    const req = readPhotoRequest({ image: img })
    const r = buildVisionRequest({ name: 'gemini', key: 'K', models: [] }, 'gemini-3.5-flash', req)
    expect(r.body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: THINK_LOW })
    expect(r.body.generationConfig.mediaResolution).toBe('MEDIA_RESOLUTION_MEDIUM')
    expect(r.body.generationConfig.responseSchema.properties.totals).toBeUndefined()
    expect(mediaResolution({ VISION_MEDIA: 'low' })).toBe('MEDIA_RESOLUTION_LOW')
  })

  it('needs a second look for a food it could not see well or a meal over 900 kcal, not for a label', () => {
    expect(needsSecondLook({ items: [{ kcal: 500, confidence: 'medium' }] })).toBe(false)
    expect(needsSecondLook({ items: [{ kcal: 500, confidence: 'low' }] })).toBe(true)
    expect(needsSecondLook({ items: [{ kcal: 500, confidence: 'low', fromLabel: true }] })).toBe(false)
    expect(needsSecondLook({ items: [{ kcal: 600 }, { kcal: 400 }] })).toBe(true)
  })

  const reply = (items: any[], usage = { promptTokenCount: 900, candidatesTokenCount: 200, thoughtsTokenCount: 100, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 340 }, { modality: 'IMAGE', tokenCount: 560 }] }) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items, message: '' }) }] } }], usageMetadata: usage }) })

  it('an easy photo: one call with the small budget; a hard one: one more with the bigger budget, both counted', async () => {
    const p = { name: 'gemini', key: 'K', models: ['m1'] }
    const req = readPhotoRequest({ image: img })
    const bodies: any[] = []
    const records: any[] = []
    const easy = await readFoodPhoto(p, req, { fetchImpl: async (_u: string, i: any) => (bodies.push(JSON.parse(i.body)), reply([{ name: 'egg', kcal: 80, confidence: 'high' }])), record: async (u: any) => void records.push(u), env: {} })
    expect(easy.second).toBe(false)
    expect(bodies).toHaveLength(1)
    expect(easy.usage[0]).toMatchObject({ prompt: 900, image: 560, completion: 200, thoughts: 100 })
    expect(records[0]).toMatchObject({ kind: 'foodPhoto', prompt: 900, completion: 300 })

    bodies.length = 0
    let n = 0
    const hard = await readFoodPhoto(p, req, { fetchImpl: async (_u: string, i: any) => (bodies.push(JSON.parse(i.body)), reply(n++ ? [{ name: 'stew', kcal: 600, confidence: 'medium' }] : [{ name: 'stew', kcal: 600, confidence: 'low' }])), record: async (u: any) => void records.push(u), env: {} })
    expect(hard.second).toBe(true)
    expect(bodies.map((b) => b.generationConfig.thinkingConfig.thinkingBudget)).toEqual([THINK_LOW, THINK_HIGH])
    expect(hard.json.items[0].confidence).toBe('medium')
    expect(records.map((r) => r.kind)).toEqual(['foodPhoto', 'foodPhoto', 'foodPhoto2'])
    expect(usageOf({ name: 'claude' }, { usage: { input_tokens: 5, output_tokens: 6 } })).toEqual({ prompt: 5, image: null, completion: 6, thoughts: 0 })
  })

  it('a model that refuses the image size setting is asked again without it', async () => {
    const p = { name: 'gemini', key: 'K', models: ['m1'] }
    const sent: any[] = []
    const out = await readFoodPhoto(p, readPhotoRequest({ image: img }), {
      fetchImpl: async (_u: string, i: any) => {
        const b = JSON.parse(i.body)
        sent.push(b)
        return b.generationConfig.mediaResolution ? { ok: false, status: 400, json: async () => ({ error: { message: 'mediaResolution is not supported' } }) } : reply([{ name: 'egg', kcal: 80, confidence: 'high' }])
      },
      env: {}
    })
    expect(out.json.items[0].name).toBe('egg')
    expect(sent.map((b) => !!b.generationConfig.mediaResolution)).toEqual([true, false])
  })
})

describe('phase 2: repeat meals, hidden calories, unclear photos', () => {
  it('a dark or blurry photo asks for a better one; a hidden fat is asked about once and one tap adds it', async () => {
    const { UNCLEAR_PHOTO, HIDDEN } = await import('./foodVision')
    const { addHidden } = await import('./foodBen')
    expect(validateVision({ items: [], unclear: true, message: '' })).toEqual({ ok: false, error: UNCLEAR_PHOTO })
    const r = validateVision({ items: [{ name: 'fried rice', grams: 300, kcal: 500, protein: 12, carbs: 70, fat: 18, confidence: 'medium' }], hidden: 'oil', message: '' })
    if (!r.ok) throw new Error(r.error)
    expect(r.result.hidden).toBe('oil')
    // Already in the list: not asked again; 'none' or junk: nothing.
    const again = validateVision({ items: [{ name: 'olive oil', grams: 10, kcal: 90, protein: 0, carbs: 0, fat: 10 }], hidden: 'oil', message: '' })
    expect(again.ok && again.result.hidden).toBeNull()
    expect((validateVision({ items: [{ name: 'egg', grams: 50, kcal: 70 }], hidden: 'none', message: '' }) as any).result.hidden).toBeNull()
    pin('2030-03-12T13:05:00')
    const d = photoDraft('hd1', Date.now(), r.result.items, '', { hidden: 'oil' })
    expect(photoDraftText(d, 'lunch')).toMatch(/🫒 Cooked with oil\? Tap ➕ 1 tbsp oil if so\./)
    const kb = (await import('./foodBen')).photoDraftKeyboard(d).inline_keyboard
    expect(kb.find((row) => row[0].callback_data === 'fd|o|hd1')?.[0].text).toBe('➕ 1 tbsp oil')
    const added = addHidden(d)
    expect(added.photo!.now.map((i) => i.name)).toEqual(['fried rice', 'cooking oil'])
    expect(added.photo!.hidden).toBeNull()
    expect(added.items[1]).toMatchObject({ grams: 14, kcal: HIDDEN.oil.item.kcal, fat: 14 })
    expect(addHidden(added)).toBe(added)
  })

  it('a logged photo meal kept as a saved meal keeps its picture', async () => {
    const { savedMealFrom, cleanSaved, seedSaved } = await import('./foodSaved')
    const s = savedMealFrom(seedSaved(), { name: 'Rice bowl', type: 'lunch', items: [{ name: 'white rice', grams: 220, protein: 6, carbs: 62, fat: 1, kcal: 286, confidence: 'roughly' }], photo: 'fpab12n1' })
    const m = s.meals.find((x) => x.name === 'Rice bowl')!
    expect(m.photo).toBe('fpab12n1')
    expect(cleanSaved({ ...s, meals: [{ ...m, photo: 'bad id!' }] }).meals[0].photo).toBeUndefined()
  })
})
