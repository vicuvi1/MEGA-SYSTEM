import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { runBenEval } from './benEval'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})

describe("Ben's test harness", () => {
  it('runs every case on throwaway data and judges what Ben did', async () => {
    const today = new Date().toLocaleDateString('sv-SE')
    const script: Record<string, object> = {
      'spent 50 lei on lunch': { reply: 'Logged.', actions: ['log: lunch 50'] },
      'football today at 17:00 for an hour': { reply: 'Booked.', actions: [`event: Football | ${today} 17:00 | 60`] },
      'move my deep block to 11': { reply: 'Moved.', actions: [`move: E1 | ${today} 11:00`] },
      'finished etica': { reply: 'Nice.', actions: ['done: T1'] },
      'how many tasks do I have left today?': { reply: 'You have 3 tasks left today.', actions: [] }
    }
    const model = async (prompt: string) => {
      const said = /Victor's message: (.*)$/m.exec(prompt)?.[1]?.trim() ?? ''
      return JSON.stringify({ remember: [], ...(script[said] ?? { reply: 'Hmm.', actions: [] }) })
    }
    const r = await runBenEval(SQL, model, 20_000)
    const ok = (id: string) => r.results.find((x) => x.id === id)!
    for (const id of ['spend', 'event', 'move', 'done', 'question']) expect(ok(id).ok, `${id}: ${ok(id).trace}`).toBe(true)
    expect(ok('delete').ok).toBe(false)
    expect(r.total).toBe(20)
  }, 30_000)
})
