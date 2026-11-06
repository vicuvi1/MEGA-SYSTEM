// Coach power: the lookups Ben can ask for with "need" (made-up data):
// goals, one day in numbers, money this week, sleep for 7 days, water, a Todoist project.
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { addDays } from '@core/dates'
import { evalWorld } from './benEval'
import { setSetting } from '../main/settings'
import { answerMore } from '../renderer/src/web/benDigest'
import type { AskModel } from '../renderer/src/web/webBots'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})

describe("Ben's lookups", () => {
  it('answers goals, a day, sleep, money and water from the data', async () => {
    const world = await evalWorld(SQL, (async () => '{}') as AskModel)
    const { mirror, services, today } = world
    const y = addDays(today, -1)
    await mirror.write((db: any) => {
      setSetting(db, 'coach_history', JSON.stringify({ days: { [y]: { score: 71, mustdos: [2, 3] } } }))
      db.prepare('INSERT INTO focus_goals (title, subject, deadline, hours, created_day, archived) VALUES (?, ?, ?, ?, ?, 0)').run('Pass the algebra exam', 'Algebra', addDays(today, 20), 20, addDays(today, -10))
      db.prepare('INSERT INTO focus_sessions (day, subject, minutes, started_at, ended_at, coins) VALUES (?, ?, ?, ?, ?, 0)').run(y, 'Algebra', 40, `${y}T10:00:00`, `${y}T10:40:00`)
      db.prepare('INSERT INTO sleep_logs (day, wake_time, wake_target, on_time, bed_time, bed_target, bed_on_time, quality, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(y, '07:20', '07:30', 1, '23:50', '23:30', 0, 4, new Date().toISOString())
    })
    const ask = (need: string) => mirror.read((db: any) => answerMore(need, db, services.services(db), null))
    expect(await ask('goals')).toMatch(/Pass the algebra exam \(Algebra, due/)
    const day = await ask('day yesterday')
    expect(day).toMatch(/Day score: 71\/100/)
    expect(day).toMatch(/Focus: 40 min/)
    expect(day).toMatch(/bed 23:50, up 07:20 \(on time\), 7.5 h/)
    expect(await ask('sleep7')).toMatch(/bed 23:50 up 07:20 7.5h[\s\S]*Average 7.5 h/)
    expect(await ask('money week')).toMatch(/Money this week/)
    expect(await ask('water')).toMatch(/Water goal .* met on 0\/7 days/)
    expect(await ask('spending 2026-01-01 2026-01-02')).toBeNull()
  })

  it('a "need" for a day and a Todoist project is looked up, then Ben answers', async () => {
    const prompts: string[] = []
    const model: AskModel = async (prompt) => {
      prompts.push(prompt)
      if (prompts.length === 1) return JSON.stringify({ reply: '', actions: [], remember: [], need: ['day yesterday', 'todoist inbox'] })
      return JSON.stringify({ reply: 'Yesterday was quiet; 3 inbox tasks wait.', actions: [], remember: [] })
    }
    const world = await evalWorld(SQL, model)
    const r = await world.bots.think('compare yesterday with my inbox tasks, honestly', 'lookup:1')
    expect(r.ok).toBe(true)
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toMatch(/Day \(\d{4}-\d{2}-\d{2}\) from his data/)
    expect(prompts[1]).toMatch(/Todoist, project "inbox": 3 open tasks/)
  })
})
