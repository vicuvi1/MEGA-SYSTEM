// PL5: user scripts in real workers (Node's worker_threads standing in for a
// Web Worker): the time limit ends runaway scripts, the API works, calls are
// checked, and network / storage / memory-heavy calls are gone or capped.
import { Worker } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import { checkScriptCall, runScript, type WorkerLike } from './scriptRun'
import { cleanScript, cleanScripts, SCRIPT_CODE_MAX, workerSource, type UserScript } from './scripts'

/** A Node worker that looks like a Web Worker to the script's code. */
function nodeWorker(source: string): WorkerLike {
  const shim = `const { parentPort } = require('node:worker_threads');
globalThis.postMessage = (m) => parentPort.postMessage(m);
globalThis.addEventListener = (t, fn) => { if (t === 'message') parentPort.on('message', (d) => fn({ data: d })) };
`
  const w = new Worker(shim + source, { eval: true })
  return { postMessage: (m) => w.postMessage(m), onMessage: (fn) => void w.on('message', fn), terminate: () => void w.terminate() }
}
const script = (code: string, extra: Partial<UserScript> = {}) => cleanScript({ id: 't1', name: 'Test', code, ...extra })!
const input = { now: Date.UTC(2026, 10, 5, 18), hour: 20, minute: 5, weekday: 4, today: { focus: { minutes: 30, goal: 120 } } }
const deps = (onCall = async (_c: unknown) => 'ok' as unknown) => ({ makeWorker: nodeWorker, onCall, timeMs: 1500, fetchWaitMs: 1000 })

describe('user scripts (PL5)', () => {
  it('show X when Y', async () => {
    const code = "if (life.hour >= 20 && life.today.focus.minutes < life.today.focus.goal) show(`${life.today.focus.goal - life.today.focus.minutes} min left`, '⏳')"
    const r = await runScript(script(code), input, deps())
    expect(r.error).toBeUndefined()
    expect(r.show).toEqual({ text: '90 min left', icon: '⏳' })
    const r2 = await runScript(script(code), { ...input, hour: 9 }, deps())
    expect(r2.show).toBeNull()
  })
  it('a runaway script is stopped at its time limit', async () => {
    const r = await runScript(script('while (true) {}'), input, { ...deps(), timeMs: 300 })
    expect(r.timedOut).toBe(true)
    expect(r.ms).toBeLessThan(1500)
    const r2 = await runScript(script('await new Promise(() => {})'), input, { ...deps(), timeMs: 300 })
    expect(r2.timedOut).toBe(true)
  })
  it('network, storage, other workers and channels are gone', async () => {
    const r = await runScript(script("show([typeof globalThis.fetch, typeof XMLHttpRequest, typeof WebSocket, typeof indexedDB, typeof BroadcastChannel, typeof importScripts, typeof Worker, typeof process].every((x) => x === 'undefined') ? 'all gone' : 'leak')"), input, deps())
    expect(r.show?.text).toBe('all gone')
  })
  it('the lock-down code is out of reach of the script', async () => {
    const r = await runScript(script("show([typeof post, typeof waits, typeof G, typeof api].join(','))"), input, deps())
    expect(r.show?.text).toBe('undefined,undefined,undefined,undefined')
  })
  it('memory-heavy calls are capped', async () => {
    for (const code of ['new ArrayBuffer(5e8)', 'new Uint8Array(5e8)', "'x'.repeat(5e8)", 'new Array(5e8)', "''.padStart(5e8)"]) {
      const r = await runScript(script(code), input, deps())
      expect(r.error, code).toMatch(/Too much memory/)
    }
  })
  it('fetch goes through the host, only to listed hosts', async () => {
    const calls: unknown[] = []
    const onCall = async (c: unknown) => (calls.push(c), { status: 200, body: '21' })
    const ok = await runScript(script("const r = await fetch('https://api.good-site.io/t'); show('t=' + r.body)", { hosts: ['api.good-site.io'] }), input, deps(onCall))
    expect(ok.show?.text).toBe('t=21')
    expect(calls).toEqual([{ op: 'fetch', url: 'https://api.good-site.io/t' }])
    const no = await runScript(script("await fetch('https://evil.io/x')", { hosts: ['api.good-site.io'] }), input, deps(onCall))
    expect(no.error).toMatch(/not on this widget's list/)
    const off = await runScript(script("await fetch('https://api.good-site.io/t')"), input, deps(onCall))
    expect(off.error).toMatch(/Network is off/)
    expect(calls).toHaveLength(1)
  })
  it('addTask only when allowed', async () => {
    expect(checkScriptCall(script('1'), { op: 'addTask', text: 'x' }).ok).toBe(false)
    expect(checkScriptCall(script('1', { add: true }), { op: 'addTask', text: ' Call mum ' })).toEqual({ ok: true, call: { op: 'addTask', text: 'Call mum' } })
    expect(checkScriptCall(script('1', { add: true }), { op: 'deleteAll' }).ok).toBe(false)
  })
  it('notify, errors and cleaning', async () => {
    const r = await runScript(script("notify('Drink water'); notify('second'); throw new Error('boom')"), input, deps())
    expect(r.notify).toBe('Drink water')
    expect(r.error).toBe('boom')
    expect(cleanScript({ code: '   ' })).toBeNull()
    expect(cleanScript({ code: 'x', every: 5, hosts: ['localhost', 'ok-site.io'] })).toMatchObject({ every: 60, hosts: ['ok-site.io'] })
    expect(cleanScripts([{ id: 'a', code: '1' }, { id: 'a', code: '2' }])).toHaveLength(1)
    expect(() => workerSource('x'.repeat(SCRIPT_CODE_MAX + 1))).toThrow()
  })
})
