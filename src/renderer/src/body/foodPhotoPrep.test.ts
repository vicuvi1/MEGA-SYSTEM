// Food photo logging, the page side: the resize math and the server call.
import { describe, expect, it } from 'vitest'
import { MAX_PHOTOS, askFoodPhoto, b64Bytes, fitSize, imagesFrom } from './foodPhotoPrep'

describe('fitSize', () => {
  it('fits the longest side in 1024 px and keeps the shape', () => {
    expect(fitSize(4032, 3024)).toEqual({ width: 1024, height: 768 })
    expect(fitSize(3024, 4032)).toEqual({ width: 768, height: 1024 })
    expect(fitSize(4000, 1000)).toEqual({ width: 1024, height: 256 })
  })
  it('never makes a small photo bigger', () => {
    expect(fitSize(640, 480)).toEqual({ width: 640, height: 480 })
    expect(fitSize(0, 0)).toEqual({ width: 1, height: 1 })
  })
})

describe('b64Bytes', () => {
  it('counts the bytes in base64', () => {
    expect(b64Bytes(btoa('abc'))).toBe(3)
    expect(b64Bytes(btoa('abcd'))).toBe(4)
  })
})

describe('askFoodPhoto', () => {
  const ask = { images: [{ mime: 'image/jpeg', data: 'AAAA' }], note: '', saved: [], today: { kcal: 0, protein: 0 }, targets: { kcal: 2700, protein: 130 } }
  const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
  it('sends op foodPhoto and returns the result', async () => {
    let sent: any = null
    const r = await askFoodPhoto(ask, (async (_u: string, init: any) => ((sent = JSON.parse(init.body)), res(200, { ok: true, result: { items: [] } }))) as any)
    expect(sent.op).toBe('foodPhoto')
    expect(r).toEqual({ ok: true, result: { items: [] } })
  })
  it('sends several photos of one meal in ONE request', async () => {
    const sent: any[] = []
    const three = { ...ask, images: [1, 2, 3].map((i) => ({ mime: 'image/jpeg', data: `AAA${i}` })), note: 'plate, snack, drink' }
    await askFoodPhoto(three, (async (_u: string, init: any) => (sent.push(JSON.parse(init.body)), res(200, { ok: true, result: { items: [] } }))) as any)
    expect(sent).toHaveLength(1)
    expect(sent[0].images.map((x: any) => x.data)).toEqual(['AAA1', 'AAA2', 'AAA3'])
    expect(sent[0].note).toBe('plate, snack, drink')
  })
  it('passes on the limit message and the fallback', async () => {
    const r = await askFoodPhoto(ask, (async () => res(200, { ok: false, error: "You've read 50 photos today", fallback: 'Copy the prompt', limit: 'day' })) as any)
    expect(r).toEqual({ ok: false, error: "You've read 50 photos today", fallback: 'Copy the prompt', limit: 'day' })
  })
  it('never throws on a lost connection or a lock', async () => {
    expect(await askFoodPhoto(ask, (async () => { throw new TypeError('Failed to fetch') }) as any)).toMatchObject({ ok: false, error: expect.stringMatching(/No connection/) })
    expect(await askFoodPhoto(ask, (async () => res(401, { error: 'Locked' })) as any)).toMatchObject({ ok: false, error: expect.stringMatching(/PIN/) })
  })
})

describe('imagesFrom', () => {
  const file = (name: string, type: string) => new File([new Uint8Array([1, 2, 3])], name, { type })
  it('keeps only pictures, at most 6 by default', () => {
    const list = [file('a.jpg', 'image/jpeg'), file('notes.txt', 'text/plain'), ...Array.from({ length: 8 }, (_, i) => file(`p${i}.png`, 'image/png'))]
    const got = imagesFrom(list)
    expect(MAX_PHOTOS).toBe(6)
    expect(got).toHaveLength(6)
    expect(got.every((f) => f.type.startsWith('image/'))).toBe(true)
    expect(imagesFrom(list, 1).map((f) => f.name)).toEqual(['a.jpg'])
    expect(imagesFrom(null)).toEqual([])
  })
})
