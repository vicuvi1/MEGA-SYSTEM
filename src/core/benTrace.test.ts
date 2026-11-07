import { describe, expect, it } from 'vitest'
import { createTrace, roughTokens, timingLine } from './benTrace'
import { readMoveEdit } from './benTalk'

describe("Ben's timing trace", () => {
  it('times each step and each model call, with the prompt size', async () => {
    let t = 1000
    const tr = createTrace(() => t)
    t += 120
    tr.mark('fetch')
    const out = await tr.call('chat', false, 'x'.repeat(400), async (first) => {
      t += 300
      first()
      t += 200
      return 'ok'
    })
    tr.text()
    t += 30
    const s = tr.summary('log', 'model')
    expect(out).toBe('ok')
    expect(s.totalMs).toBe(650)
    expect(s.spans).toEqual([
      { name: 'fetch', ms: 120 },
      { name: 'finish', ms: 530 }
    ])
    expect(s.calls).toEqual([{ kind: 'chat', strong: false, ms: 500, chars: 400, tokens: 100, firstTextMs: 420, ok: true }])
    expect(s.firstTextMs).toBe(620)
    expect(roughTokens(9)).toBe(3)
    expect(timingLine(s)).toBe('ben log model 650ms first 620ms | fetch 120 · finish 530 | chat quick 500ms 100tok')
  })

  it('a failed call is recorded as failed and still throws', async () => {
    const tr = createTrace()
    await expect(tr.call('chat-deep', true, 'p', async () => Promise.reject(new Error('502')))).rejects.toThrow('502')
    expect(tr.summary('advice', 'failed').calls[0]).toMatchObject({ kind: 'chat-deep', strong: true, ok: false })
  })
})

describe('"move gym to 18:00" is read in code', () => {
  it('a named thing to a clock time', () => {
    expect(readMoveEdit('move gym to 18:00')).toEqual({ verb: 'move', target: 'gym', value: '18:00' })
    expect(readMoveEdit('please move my lab session to 4pm')).toEqual({ verb: 'move', target: 'lab', value: '16:00' })
  })
  it('never a pronoun, the whole day, or a day instead of a time', () => {
    expect(readMoveEdit('move it to 18:00')).toBeNull()
    expect(readMoveEdit('push the rest of my day to 15')).toBeNull()
    expect(readMoveEdit('move gym to tomorrow')).toBeNull()
  })
})
