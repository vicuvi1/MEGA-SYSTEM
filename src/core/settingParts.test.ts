// Big synced settings in pieces (core/settingParts.ts): the cut places depend
// only on the text, joining gives the text back, and a damaged or missing
// piece is refused. Made-up data only.
import { describe, expect, it } from 'vitest'
import { PART_MAX, PartsError, WHOLE_UP_TO, assemble, looksLikeManifest, manifestOf, parseManifest, splitText, travelsInParts } from './settingParts'
import { hash64, textSig } from './textHash'

const record = (i: number, note = 'coffee') => ({ id: `t${i}`, type: 'expense', amount: 1000 + (i % 977), currency: 'MDL', date: `20${16 + (i % 11)}-0${1 + (i % 9)}-1${i % 9}`, category: 'food', account: 'wallet', note: `${note} ${i}`, updatedAt: 1_700_000_000_000 + i })
const blob = (n: number, edit?: (tx: any[]) => void) => {
  const tx = Array.from({ length: n }, (_, i) => record(i))
  edit?.(tx)
  return JSON.stringify({ savedAt: 1_800_000_000_000, editedAt: 1_800_000_000_000, data: { settings: { currency: 'MDL' }, tx, deleted: {} } })
}

describe('fingerprints', () => {
  it('the same text gives the same 16 letters; one changed letter gives others', () => {
    expect(hash64('made-up')).toBe(hash64('made-up'))
    expect(hash64('made-up')).toMatch(/^[0-9a-f]{16}$/)
    expect(hash64('made-up')).not.toBe(hash64('made-uq'))
    expect(textSig(null)).toBe('')
    expect(textSig('abc')).toBe(`3.${hash64('abc')}`)
  })
  it('never changes: stored piece names depend on it', () => {
    expect(hash64('Life System')).toBe('d6aa61ba66ef6118')
  })
})

describe('cutting a text into pieces', () => {
  it('a short text is one piece', () => {
    expect(splitText('{"a":1}')).toEqual(['{"a":1}'])
  })

  it('joining the pieces gives the text back, and every piece fits', () => {
    const text = blob(20_000)
    const parts = splitText(text)
    expect(parts.join('')).toBe(text)
    expect(parts.length).toBeGreaterThan(20)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(PART_MAX)
  })

  it('an edit in one record changes one or two pieces, not the rest', () => {
    const before = manifestOf('app_sync_finance', blob(20_000)).parts
    const after = manifestOf('app_sync_finance', blob(20_000, (tx) => (tx[12_345].note = 'a much longer note about a made-up dinner'))).parts
    const had = new Set(before.map((p) => p.id))
    const fresh = after.filter((p) => !had.has(p.id))
    expect(fresh.length).toBeGreaterThanOrEqual(1)
    expect(fresh.length).toBeLessThanOrEqual(2)
    // A new record at the end: only the tail.
    const added = manifestOf('app_sync_finance', blob(20_001)).parts.filter((p) => !had.has(p.id))
    expect(added.length).toBeLessThanOrEqual(2)
  })

  it('a text with no record ends is cut by size, never inside one character', () => {
    const text = '😀'.repeat(200_000)
    const parts = splitText(text)
    expect(parts.join('')).toBe(text)
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(PART_MAX)
      const last = p.charCodeAt(p.length - 1)
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
    }
  })
})

describe('the manifest', () => {
  it('is the same for the same text, and reads back', () => {
    const text = blob(5_000)
    expect(text.length).toBeGreaterThan(WHOLE_UP_TO)
    const a = manifestOf('app_sync_finance', text)
    expect(manifestOf('app_sync_finance', text).manifest).toBe(a.manifest)
    expect(looksLikeManifest(a.manifest)).toBe(true)
    const m = parseManifest(a.manifest)!
    expect(m.len).toBe(text.length)
    expect(assemble(m, (id) => a.parts.find((p) => p.id === id)?.text)).toBe(text)
  })

  it('a missing piece, a piece with other text, or pieces in another order are refused', () => {
    const text = blob(5_000)
    const a = manifestOf('app_sync_finance', text)
    const m = parseManifest(a.manifest)!
    const get = (id: string) => a.parts.find((p) => p.id === id)?.text
    expect(() => assemble(m, (id) => (id === m.p[1] ? undefined : get(id)))).toThrow(PartsError)
    expect(() => assemble(m, (id) => (id === m.p[1] ? `${get(id)!.slice(0, -1)}x` : get(id)))).toThrow(/damaged/)
    // A manifest someone changed (another order, a dropped piece) no longer matches its own sum.
    expect(parseManifest(JSON.stringify({ ...m, p: [m.p[1], m.p[0], ...m.p.slice(2)] }))).toBeNull()
    expect(parseManifest(JSON.stringify({ ...m, p: m.p.slice(1), n: m.n.slice(1) }))).toBeNull()
    expect(parseManifest(a.manifest.slice(0, -5))).toBeNull()
    expect(parseManifest('{"savedAt":1,"data":{}}')).toBeNull()
  })

  it('only the apps\' copies travel in pieces', () => {
    expect(travelsInParts('app_sync_finance')).toBe(true)
    expect(travelsInParts('app_sync_finance_sealed')).toBe(true)
    expect(travelsInParts('coach_memory')).toBe(false)
  })
})
