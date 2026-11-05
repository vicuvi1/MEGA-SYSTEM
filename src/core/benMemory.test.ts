import { describe, expect, it } from 'vitest'
import { BLOCK_CAP, applyBlockOp, applyTidy, blocksText, capFacts, cleanBlocks, keywordRecall, logChanges, memoryDocs, parseTidy, planSync, readBlockOp, textHash, tidyPrompt, undoChange, type MemChange } from './benMemory'
import type { Fact } from './factTypes'

const NOW = new Date('2026-11-05T03:30:00Z')
const fact = (t: string, at = '2026-10-01', extra: Partial<Fact> = {}): Fact => ({ t, at, conf: 0.6, seen: 1, ...extra })

describe('memory blocks (BR4)', () => {
  it('always has the four blocks, each within its cap', () => {
    const b = cleanBlocks([{ name: 'People', text: 'x'.repeat(900) }, { name: 'Nope', text: 'y' }])
    expect(b.map((x) => x.name)).toEqual(['About you', 'Goals now', 'How to coach you', 'People'])
    expect(b[3].text.length).toBe(BLOCK_CAP)
    expect(blocksText(b)).toContain('[About you] (0/600)\n(empty)')
  })

  it('reads the actions strictly', () => {
    expect(readBlockOp('blockadd: People | Dan: lab partner')).toEqual({ op: 'add', name: 'People', text: 'Dan: lab partner' })
    expect(readBlockOp('blockadd: goals | Pass the networks exam')).toMatchObject({ name: 'Goals now' })
    expect(readBlockOp('blockfix: About you | wakes at 8 => wakes at 7')).toEqual({ op: 'fix', name: 'About you', old: 'wakes at 8', text: 'wakes at 7' })
    expect(readBlockOp('blockfix: About you | no arrow here')).toBeNull()
    expect(readBlockOp('blockadd: Secrets | something')).toBeNull()
    expect(readBlockOp('blockadd: People | ')).toBeNull()
    expect(readBlockOp(`blockset: People | ${'z'.repeat(BLOCK_CAP + 1)}`)).toBeNull()
    expect(readBlockOp('log: water 250')).toBeNull()
  })

  it('adds, fixes and rewrites, refusing pinned and full blocks', () => {
    let blocks = cleanBlocks([])
    let r = applyBlockOp(blocks, { op: 'add', name: 'People', text: 'Dan: lab partner' }, 'ben', NOW)
    expect(r.change).toMatchObject({ by: 'ben', what: 'block', name: 'People', before: '', after: 'Dan: lab partner' })
    blocks = r.blocks
    r = applyBlockOp(blocks, { op: 'fix', name: 'People', old: 'lab partner', text: 'best friend' }, 'ben', NOW)
    expect(r.blocks[3].text).toBe('Dan: best friend')
    expect(applyBlockOp(r.blocks, { op: 'fix', name: 'People', old: 'not there', text: 'x' }, 'ben', NOW).line).toMatch(/isn't in/)
    const full = cleanBlocks([{ name: 'Goals now', text: 'g'.repeat(BLOCK_CAP - 5) }])
    expect(applyBlockOp(full, { op: 'add', name: 'Goals now', text: 'one more goal' }, 'ben', NOW)).toMatchObject({ change: null, line: expect.stringMatching(/full/) })
    const pinned = cleanBlocks([{ name: 'About you', text: 'Student', pinned: true }])
    expect(applyBlockOp(pinned, { op: 'set', name: 'About you', text: 'Something else' }, 'ben', NOW)).toMatchObject({ change: null, line: expect.stringMatching(/pinned/) })
    expect(applyBlockOp(pinned, { op: 'set', name: 'About you', text: 'Something else' }, 'you', NOW).blocks[0].text).toBe('Something else')
  })

  it('undo puts a block back and marks the change', () => {
    const r = applyBlockOp(cleanBlocks([{ name: 'Goals now', text: 'Old goal' }]), { op: 'set', name: 'Goals now', text: 'New goal' }, 'ben', NOW)
    const log = logChanges([], [r.change])
    const u = undoChange({ blocks: r.blocks, facts: [], log }, r.change!.id, NOW)
    expect(u.ok).toBe(true)
    expect(u.blocks[1].text).toBe('Old goal')
    expect(u.log[0].undone).toBe(true)
    expect(u.log[1]).toMatchObject({ by: 'you', why: 'undo' })
    expect(undoChange(u, r.change!.id, NOW).ok).toBe(false)
  })

  it('undo brings back a deleted fact and removes an added one', () => {
    const del: MemChange = { id: 'a', at: NOW.toISOString(), by: 'tidy', what: 'fact', name: 'fact', before: 'Likes running at night', after: null }
    const add: MemChange = { id: 'b', at: NOW.toISOString(), by: 'ben', what: 'fact', name: 'fact', before: null, after: 'Has a cat' }
    const s = { blocks: cleanBlocks([]), facts: [fact('Has a cat')], log: [del, add] }
    const u1 = undoChange(s, 'a', NOW)
    expect(u1.facts.map((f) => f.t)).toEqual(['Has a cat', 'Likes running at night'])
    const u2 = undoChange(u1, 'b', NOW)
    expect(u2.facts.map((f) => f.t)).toEqual(['Likes running at night'])
  })

  it('the log is capped', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, at: '', by: 'ben' as const, what: 'fact' as const, name: 'fact', before: null, after: `f${i}` }))
    const log = logChanges(many, [])
    expect(log.length).toBe(80)
    expect(log[79].id).toBe('c99')
  })
})

describe('facts: pins and the cap', () => {
  it('drops the weakest unpinned facts, never a pinned one', () => {
    const facts = [fact('pinned old', '2025-01-01', { pin: true, conf: 0.1 }), fact('weak', '2025-02-01', { conf: 0.1 }), fact('strong', '2025-03-01', { conf: 1, seen: 4 }), fact('new', '2026-11-01')]
    const r = capFacts(facts, 3)
    expect(r.facts.map((f) => f.t)).toEqual(['pinned old', 'strong', 'new'])
    expect(r.dropped.map((f) => f.t)).toEqual(['weak'])
  })
})

describe('nightly tidy-up (BR2), with a fake model', () => {
  const facts = [fact('Exam in networks on 20 Nov'), fact('Best friend is Dan', '2026-09-01', { pin: true }), fact('Likes coffee'), fact('Networks exam moved to 25 Nov', '2026-11-04'), fact('Drank 2 glasses of water today', '2026-11-04')]
  const fresh = facts.slice(3)
  const similar = facts.slice(0, 3)

  /** The fake model: what a good answer looks like (plus junk it must ignore). */
  const fakeModel = (ids: Map<string, Fact>) => {
    const id = (t: string) => [...ids].find(([, f]) => f.t === t)![0]
    return JSON.stringify({
      decisions: [
        { op: 'UPDATE', id: id('Exam in networks on 20 Nov'), text: 'Networks exam on 25 Nov (moved from 20 Nov)', why: 'date changed' },
        { op: 'DELETE', id: id('Networks exam moved to 25 Nov'), why: 'merged' },
        { op: 'DELETE', id: id('Drank 2 glasses of water today'), why: 'one-off log' },
        { op: 'DELETE', id: id('Best friend is Dan'), why: 'trying to delete a pinned one' },
        { op: 'UPDATE', id: 'F99', text: 'no such fact' },
        { op: 'EXPLODE', id: 'F1' },
        { op: 'NOOP', id: id('Likes coffee') }
      ]
    })
  }

  it('builds one prompt with F-numbers, marks pinned facts', () => {
    const { prompt, ids } = tidyPrompt(fresh, similar, '2026-11-05')
    expect(ids.size).toBe(5)
    expect(prompt).toContain('F1: Networks exam moved to 25 Nov')
    expect(prompt).toMatch(/F\d \(pinned: keep\): Best friend is Dan/)
    expect(prompt).toContain('ADD')
  })

  it('reads only valid decisions', () => {
    const { ids } = tidyPrompt(fresh, similar, '2026-11-05')
    const d = parseTidy(`Sure! ${fakeModel(ids)}`, ids)
    expect(d.map((x) => x.op)).toEqual(['UPDATE', 'DELETE', 'DELETE', 'DELETE'])
    expect(parseTidy('not json', ids)).toEqual([])
  })

  it('applies them, never touching a pinned fact, and logs each change for undo', () => {
    const { ids } = tidyPrompt(fresh, similar, '2026-11-05')
    const r = applyTidy(facts, parseTidy(fakeModel(ids), ids), ids, 80, NOW)
    expect(r.facts.map((f) => f.t)).toEqual(['Networks exam on 25 Nov (moved from 20 Nov)', 'Best friend is Dan', 'Likes coffee'])
    expect(r.changes.map((c) => [c.by, c.before, c.after])).toEqual([
      ['tidy', 'Exam in networks on 20 Nov', 'Networks exam on 25 Nov (moved from 20 Nov)'],
      ['tidy', 'Networks exam moved to 25 Nov', null],
      ['tidy', 'Drank 2 glasses of water today', null]
    ])
    // And each one can be undone.
    let s = { blocks: cleanBlocks([]), facts: r.facts, log: r.changes }
    for (const c of r.changes) s = undoChange(s, c.id, NOW)
    expect(s.facts.map((f) => f.t).sort()).toEqual(facts.map((f) => f.t).sort())
  })

  it('caps the memory and logs what the cap dropped', () => {
    const many = Array.from({ length: 12 }, (_, i) => fact(`fact number ${i}`, `2026-10-${String(i + 10).padStart(2, '0')}`))
    const r = applyTidy(many, [{ op: 'ADD', text: 'A merged fact' }], new Map(), 10, NOW)
    expect(r.facts.length).toBe(10)
    expect(r.changes.filter((c) => c.why?.startsWith('memory full')).length).toBe(3)
  })
})

describe('pieces of memory to embed (BR1)', () => {
  const src = {
    facts: [fact('Networks exam on 25 Nov')],
    mind: { people: [{ name: 'Dan', note: 'lab partner' }], goals: [], works: [{ t: '25-min blocks before noon' }], fails: [], patterns: [] },
    notes: [{ id: 'n1', title: 'Rust', body: 'Ownership\nBorrowing' }, { id: 'n2', title: 'Empty', body: '  ' }],
    log: [
      { role: 'me' as const, text: 'I feel tired', at: '2026-11-03T10:00:00Z' },
      { role: 'coach' as const, text: 'Sleep at 23:00 tonight', at: '2026-11-03T10:00:05Z' },
      { role: 'me' as const, text: 'today', at: '2026-11-05T09:00:00Z' }
    ],
    tasks: [{ id: 't9', content: 'Finish the lab report', due: '2026-11-07' }]
  }

  it('makes stable pieces, a chat day only once it is over', () => {
    const docs = memoryDocs(src)
    expect(docs.map((d) => d.kind)).toEqual(['fact', 'mind', 'mind', 'note', 'chat', 'task'])
    expect(docs.find((d) => d.kind === 'chat')!.text).toBe('Chat on 2026-11-03: Victor: I feel tired · Ben: Sleep at 23:00 tonight')
    expect(memoryDocs(src).map((d) => d.id)).toEqual(docs.map((d) => d.id))
  })

  it('embeds only new or changed pieces, and drops the ones gone', () => {
    const docs = memoryDocs(src)
    const stored = new Map(docs.map((d) => [d.id, textHash(d.text)]))
    stored.set('fact:gone', 'x')
    expect(planSync(docs, stored)).toEqual({ embed: [], drop: ['fact:gone'] })
    const changed = memoryDocs({ ...src, tasks: [{ id: 't9', content: 'Finish the lab report and send it', due: '2026-11-07' }] })
    expect(planSync(changed, stored).embed.map((d) => d.id)).toEqual(['task:t9'])
  })

  it('keyword recall finds the piece that shares words with the question', () => {
    const hits = keywordRecall(memoryDocs(src), 'when is my networks exam?', 2)
    expect(hits[0].text).toContain('Networks exam')
    expect(keywordRecall(memoryDocs(src), 'the and for', 2)).toEqual([])
  })
})
