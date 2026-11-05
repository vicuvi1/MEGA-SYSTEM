// Plugins: the registry, Ben's plugin actions and the server job runner (made-up data only).
import { describe, expect, it } from 'vitest'
import { PLUGINS, findPluginCommand, pluginActionInText, pluginContext, pluginForFile, readPluginAction, runPluginAction, undoPluginAction } from './index'
import { runPluginJobs, type PluginStatus } from './run'
import { setOn } from './store'
import { readAction } from '../renderer/src/web/botBrain'
import { fakeDb } from './testDb'

describe('plugin registry', () => {
  it('has unique ids, action verbs and command names', () => {
    const ids = PLUGINS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    const verbs = PLUGINS.flatMap((p) => Object.keys(p.actions ?? {}))
    expect(new Set(verbs).size).toBe(verbs.length)
    const cmds = PLUGINS.flatMap((p) => Object.keys(p.commands ?? {}))
    expect(new Set(cmds).size).toBe(cmds.length)
  })

  it('never names a secret value, only env var names', () => {
    for (const p of PLUGINS) for (const e of p.settings?.env ?? []) expect(e).toMatch(/^[A-Z][A-Z0-9_]+$/)
  })

  it('adds context lines only for plugins that are on', () => {
    const db = fakeDb()
    db.rows.set('plugin_health_data', JSON.stringify({ days: { '2026-11-05': { steps: 6200, at: 'x' } } }))
    const now = new Date('2026-11-05T12:00:00')
    expect(pluginContext(db, now)).toEqual([])
    setOn(db, 'health', true)
    expect(pluginContext(db, now)[0]).toContain('6,200 steps today')
  })

  it('finds commands and files only when the plugin is on', () => {
    const db = fakeDb()
    expect(findPluginCommand(db, '/steps')).toBeNull()
    setOn(db, 'health', true)
    expect(findPluginCommand(db, '/steps@SomeBot')?.plugin.id).toBe('health')
    expect(pluginForFile(db, 'statement.csv', 'text/csv')).toBeNull()
    setOn(db, 'bank', true)
    expect(pluginForFile(db, 'statement.csv', '')?.id).toBe('bank')
    expect(pluginForFile(db, 'photo.jpg', 'image/jpeg')).toBeNull()
  })
})

describe("Ben's plugin actions", () => {
  it('readAction checks plugin verbs before the built-ins', () => {
    expect(readAction('steps: 8000')).toEqual({ kind: 'plugin', plugin: 'health', verb: 'steps', args: { steps: 8000 } })
    expect(readAction('steps: lots')).toBeNull()
    expect(readAction('water: 250')).toEqual({ kind: 'water', ml: 250 })
    expect(readPluginAction('log: 30 pushups')).toBeNull()
  })

  it('only runs with numbers he wrote himself', () => {
    const a = readPluginAction('steps: 8000')!
    expect(pluginActionInText('walked 8,000 steps today', a)).toBe(true)
    expect(pluginActionInText('go for a walk', a)).toBe(false)
  })

  it('runs and undoes, and refuses while the plugin is off', () => {
    const db = fakeDb()
    const now = new Date('2026-11-05T20:00:00')
    const call = readPluginAction('steps: 9000')!
    expect(runPluginAction({ db, now }, call)?.line).toMatch(/off/)
    setOn(db, 'health', true)
    const r = runPluginAction({ db, now }, call)!
    expect(r.line).toBe('👟 Steps today: 9,000')
    expect(JSON.parse(db.rows.get('plugin_health_data')).days['2026-11-05'].steps).toBe(9000)
    expect(undoPluginAction({ db, now }, 'health', 'steps', r.undo)).toBe('↩ Steps removed')
    expect(JSON.parse(db.rows.get('plugin_health_data')).days['2026-11-05'].steps).toBeUndefined()
  })
})

describe('plugin job runner', () => {
  const deps = (opts: { hour: number; on?: Record<string, boolean>; claimed?: Set<string> }) => {
    const store = new Map<string, string>()
    const status: Record<string, PluginStatus> = {}
    const sent: string[] = []
    const claimed = opts.claimed ?? new Set<string>()
    const now = new Date(2026, 10, 5, opts.hour, 0)
    const plugins = [
      { id: 'a', title: 'A', icon: 'sun', about: '', jobs: { morning: async () => ({ note: 'fine', message: 'hello' }), tick: async () => ({ note: 'tick' }), tickEvery: 60 } },
      { id: 'b', title: 'B', icon: 'sun', about: '', jobs: { morning: async () => { throw new Error('boom') } } },
      { id: 'c', title: 'C', icon: 'sun', about: '', jobs: { morning: async () => ({ need: ['X_TOKEN'] }) } }
    ]
    return {
      status,
      sent,
      d: {
        plugins,
        on: (id: string) => (opts.on ?? { a: true, b: true, c: true })[id] === true,
        claim: async (key: string) => (claimed.has(key) ? false : (claimed.add(key), true)),
        ctx: { now, get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => void store.set(k, v), env: () => undefined, fetch },
        saveStatus: async (id: string, st: PluginStatus) => void (status[id] = st),
        send: async (t: string) => void sent.push(t)
      }
    }
  }

  it('runs morning jobs once a day after 05:00, saves status and sends messages', async () => {
    const claimed = new Set<string>()
    const t = deps({ hour: 7, claimed })
    expect(await runPluginJobs(t.d)).toEqual(['a:morning', 'b:morning:failed', 'c:morning'])
    expect(t.status.a).toMatchObject({ ok: true, note: 'fine' })
    expect(t.status.b).toMatchObject({ ok: false, note: 'boom' })
    expect(t.status.c.need).toEqual(['X_TOKEN'])
    expect(t.sent).toEqual(['hello'])
    // Next tick: the morning is done, a's tick job runs.
    expect(await runPluginJobs(deps({ hour: 7, claimed }).d)).toEqual(['a:tick'])
  })

  it('waits until 05:00 for the morning and skips plugins that are off', async () => {
    const t = deps({ hour: 3, on: { a: true } })
    expect(await runPluginJobs(t.d)).toEqual(['a:tick'])
  })

  it('"Refresh now" runs every job at once without messages', async () => {
    const t = deps({ hour: 2 })
    expect(await runPluginJobs(t.d, { force: true })).toEqual(['a:now', 'b:now:failed', 'c:now'])
    expect(t.sent).toEqual([])
  })
})
