import { describe, expect, it } from 'vitest'
import { cleanBarcode, cleanProduct, labelFoods, missLine, productAt, productFromOff, productName } from './foodBarcode'
import { validateVision } from './foodVision'
import { seedSaved } from './foodSaved'

// Made-up products; the codes only have valid check digits.
const CODE = '4006381333931'
const off = { status: 1, product: { product_name: 'Protein Bar Cocoa', brands: 'Testbrand,Other', serving_quantity: 50, nutriments: { 'energy-kcal_100g': 380, proteins_100g: 30, carbohydrates_100g: 35, fat_100g: 12, fiber_100g: 8 } } }

describe('barcodes', () => {
  it('checks the check digit (EAN-13, UPC-A, EAN-8)', () => {
    expect(cleanBarcode('4006381333931')).toBe('4006381333931')
    expect(cleanBarcode('4006381333932')).toBeNull()
    expect(cleanBarcode('036000291452')).toBe('036000291452')
    expect(cleanBarcode('96385074')).toBe('96385074')
    expect(cleanBarcode('4006 3813 3393 1')).toBe('4006381333931')
    expect(cleanBarcode('abc')).toBeNull()
    expect(cleanBarcode('00000000')).toBeNull()
  })
  it('reads Open Food Facts JSON and refuses an unknown product', () => {
    const p = productFromOff(CODE, off)!
    expect(p).toMatchObject({ code: CODE, name: 'Protein Bar Cocoa', brand: 'Testbrand', servingG: 50, per100: { kcal: 380, protein: 30, carbs: 35, fat: 12, fiber: 8 } })
    expect(productFromOff(CODE, { status: 0 })).toBeNull()
    expect(cleanProduct({ code: CODE, per100: { kcal: 'x' } })).toBeNull()
    expect(productAt(p, 50)).toEqual({ kcal: 190, protein: 15, carbs: 17.5, fat: 6, fiber: 4 })
    expect(productName(p)).toBe('Testbrand Protein Bar Cocoa')
  })
  it('a found product replaces the AI estimate for the marked food', () => {
    const product = productFromOff(CODE, off)
    const r = validateVision({ items: [{ name: 'Eggs', qty: 2, unit: 'egg', grams: 100, kcal: 143, protein: 12, confidence: 'high' }, { name: 'protein bar', qty: 1, unit: 'bar', grams: 50, kcal: 250, protein: 10, confidence: 'medium', fromBarcode: true }], message: '', barcode: CODE, product })
    if (!r.ok) throw new Error(r.error)
    expect(r.result.items[1]).toMatchObject({ name: 'Testbrand Protein Bar Cocoa', grams: 50, kcal: 190, protein: 15, src: 'barcode', confidence: 'high' })
    expect(r.result.items[0].name).toBe('Eggs')
    expect(r.result.barcode).toMatchObject({ code: CODE, miss: null })
  })
  it('offline or unknown: the AI numbers stay and the line says why', () => {
    const r = validateVision({ items: [{ name: 'Yoghurt', qty: 1, unit: 'cup', grams: 150, kcal: 120, protein: 6, confidence: 'medium', fromBarcode: true }], message: '', barcode: CODE, productMiss: 'offline' })
    if (!r.ok) throw new Error(r.error)
    expect(r.result.items[0]).toMatchObject({ name: 'Yoghurt', kcal: 120, src: 'estimate' })
    expect(r.result.barcode).toMatchObject({ product: null, miss: 'offline' })
    expect(missLine(CODE, 'offline')).toMatch(/couldn't be reached/)
    expect(missLine(CODE, 'notFound')).toMatch(/not in Open Food Facts/)
    // A bad code is ignored.
    const bad = validateVision({ items: [{ name: 'Yoghurt', grams: 150, kcal: 120, protein: 6 }], barcode: '123' })
    expect(bad.ok && bad.result.barcode).toBeFalsy()
  })
  it('label and barcode foods become saved foods once', () => {
    let n = 0
    const seed = seedSaved()
    const items = [
      { name: 'Testbrand Protein Bar Cocoa', grams: 50, kcal: 190, protein: 15, carbs: 17.5, fat: 6, src: 'barcode' },
      { name: 'Kefir 2.5%', grams: 500, kcal: 250, protein: 15, carbs: 20, fat: 12, src: 'label' },
      { name: 'Rice', grams: 150, kcal: 195, protein: 4, carbs: 42, fat: 0 }
    ]
    const a = labelFoods(seed, items, () => `sf-l${++n}`)
    expect(a.added).toEqual(['Testbrand Protein Bar Cocoa', 'Kefir 2.5%'])
    expect(a.saved.foods.find((f) => f.id === 'sf-l1')).toMatchObject({ portionLabel: '1 portion (50 g)', grams: 50, kcal: 190, protein: 15 })
    const b = labelFoods(a.saved, items, () => `sf-l${++n}`)
    expect(b.added).toEqual([])
    expect(b.saved.foods.length).toBe(a.saved.foods.length)
  })
})
