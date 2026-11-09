// Food photo logging, the page side: the resize math and the server call.
import { describe, expect, it } from 'vitest'
import { askFoodPhoto, b64Bytes, fitSize } from './foodPhotoPrep'

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
  const ask = { image: { mime: 'image/jpeg', data: 'AAAA' }, note: '', saved: [], today: { kcal: 0, protein: 0 }, targets: { kcal: 2700, protein: 130 } }
  const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
  it('sends op foodPhoto and returns the result', async () => {
    let sent: any = null
    const r = await askFoodPhoto(ask, (async (_u: string, init: any) => ((sent = JSON.parse(init.body)), res(200, { ok: true, result: { items: [] } }))) as any)
    expect(sent.op).toBe('foodPhoto')
    expect(r).toEqual({ ok: true, result: { items: [] } })
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
