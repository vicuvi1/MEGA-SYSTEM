import { describe, expect, it } from 'vitest'
import {
  addAutoAsk, addRecent, addRun, argsProblem, automationsFor, benTools, capOutput, cleanAutomation, cleanAutoAsks, cleanStep, cleanStore, cleanTrigger, cleanWorkspace,
  clipMatcher, confirmNeeded, desktopWatch, dryRun, execState, fill, fillStep, findRepeat, formFields, fromRecipe, guardOk, islandButtons, last4, localUrlProblem,
  logLine, mapParams, matchTrigger, n8nBase, n8nHookUrl, n8nWorkflows, needsDesktop, newFailures, openAutoAsks, paramValue, pinState, pinKey, presetWarning,
  previewCommand, readFlowAnswer, redactValues, riskOf, runChain, scriptCommand, scriptProblem, scrub, sentence, serverRunnable, suggestedAutomation, webhookBody,
  type Automation, type AutoEvent, type DoneStep, type Param, type Step, type StepResult
} from './automations'
import type { Recipe } from './recipes'

const hookStep: Step = { do: 'webhook', hook: 'h1', where: 'cloud', preset: 'n8n' }
const make = (over: Partial<Automation> = {}): Automation => cleanAutomation({ id: 'a1', name: 'Report', steps: [hookStep], params: [], risk: 'safe', when: [], on: true, ...over })!

describe('cleaning', () => {
  it('keeps a good record and drops what is not allowed', () => {
    const a = cleanAutomation({ id: 'x1', name: '  Daily report  ', steps: [hookStep, { do: 'rm -rf' }, { do: 'telegram', text: 'Done: {{result.text}}' }], params: [{ key: 'topic', label: 'Topic', type: 'text' }, { key: 'topic', type: 'number' }], risk: 'weird', pin: true })!
    expect(a.name).toBe('Daily report')
    expect(a.steps.map((s) => s.do)).toEqual(['webhook', 'telegram'])
    expect(a.params).toHaveLength(1)
    expect(a.risk).toBe('ask')
    expect(a.pin).toBe(true)
    expect(a.on).toBe(false)
  })
  it('refuses a record with no steps', () => {
    expect(cleanAutomation({ name: 'x', steps: [] })).toBeNull()
    expect(cleanAutomation(null)).toBeNull()
  })
  it('never keeps an address in a webhook step (only the secret id)', () => {
    const s = cleanStep({ do: 'webhook', hook: 'abc', url: 'https://n8n.example.com/webhook/x', token: 'sekret', preset: 'make' }) as any
    expect(s).toEqual({ do: 'webhook', hook: 'abc', where: 'cloud', preset: 'make' })
    expect(cleanStep({ do: 'webhook', hook: 'bad id!' })).toBeNull()
  })
  it('only takes https links and plain script files', () => {
    expect(cleanStep({ do: 'url', url: 'http://example.com' })).toBeNull()
    expect(cleanStep({ do: 'url', url: 'https://mybank.example.com' })).toBeNull()
    expect(cleanStep({ do: 'url', url: '{{result.url}}' })).toEqual({ do: 'url', url: '{{result.url}}' })
    expect(cleanStep({ do: 'script', file: 'C:\\Scripts\\backup.ps1', args: ['a', '', 'b\nc'] })).toEqual({ do: 'script', file: 'C:\\Scripts\\backup.ps1', args: ['a', 'b c'] })
    expect(cleanStep({ do: 'script', file: 'C:\\Scripts\\evil.exe' })).toBeNull()
    expect(cleanStep({ do: 'script', file: 'backup.ps1' })).toBeNull()
    expect(cleanStep({ do: 'ahk', file: 'C:\\Scripts\\keys.ahk' })).toMatchObject({ do: 'ahk' })
    expect(cleanStep({ do: 'powertoys', feature: 'colorPicker' })).toEqual({ do: 'powertoys', feature: 'colorPicker' })
    expect(cleanStep({ do: 'powertoys', feature: 'registry' })).toBeNull()
  })
  it('cleans a workspace with the never list', () => {
    const ws = cleanWorkspace({ apps: ['Code', 'KeePass', 'Spotify'], links: ['https://docs.example.com', 'http://x.com'], files: ['C:\\Notes\\plan.md', 'C:\\x\\run.exe'], folder: 'C:\\Uni', focus: { subject: 'Study', minutes: 999 } })!
    expect(ws.apps).toEqual(['Code', 'Spotify'])
    expect(ws.links).toEqual(['https://docs.example.com'])
    expect(ws.files).toEqual(['C:\\Notes\\plan.md'])
    expect(ws.folder).toBe('C:\\Uni')
    expect(ws.focus).toEqual({ subject: 'Study', minutes: 180 })
    expect(cleanWorkspace({ apps: [] })).toBeNull()
  })
  it('cleans the store and keeps ids unique', () => {
    const s = cleanStore({ paused: true, list: [make(), make(), { junk: 1 }], dismissed: ['a > b'] })
    expect(s.paused).toBe(true)
    expect(s.list).toHaveLength(1)
    expect(cleanStore(null)).toEqual({ paused: false, list: [], dismissed: [] })
  })
  it('cleans triggers', () => {
    expect(cleanTrigger({ on: 'time', at: '25:00' })).toBeNull()
    expect(cleanTrigger({ on: 'battery', below: 3 })).toEqual({ on: 'battery', below: 5 })
    expect(cleanTrigger({ on: 'file', folder: 'C:\\Downloads', ext: 'PDF' })).toEqual({ on: 'file', folder: 'C:\\Downloads', ext: '.pdf' })
    expect(cleanTrigger({ on: 'file', folder: 'C:\\x\\..\\y' })).toBeNull()
    expect(cleanTrigger({ on: 'clipboard', pattern: '/(a+)+$/' })).toBeNull()
    expect(cleanTrigger({ on: 'wifi', name: 'Home' })).toEqual({ on: 'wifi', name: 'Home' })
  })
})

describe('params (AH2)', () => {
  const params: Param[] = [
    { key: 'topic', label: 'Topic', type: 'text', required: true },
    { key: 'n', label: 'How many', type: 'number', min: 1, max: 10, def: 3 },
    { key: 'mode', label: 'Mode', type: 'choice', choices: ['fast', 'slow'] },
    { key: 'sel', label: 'Selection', type: 'selection' }
  ]
  it('maps input, then last values, then defaults', () => {
    expect(mapParams(params, { topic: ' Algebra ', n: '42', mode: 'SLOW', sel: 'picked text' })).toEqual({ values: { topic: 'Algebra', n: 10, mode: 'slow', sel: 'picked text' }, missing: [] })
    expect(mapParams(params, {}, { topic: 'Last time', mode: 'fast', sel: 'old' })).toEqual({ values: { topic: 'Last time', n: 3, mode: 'fast' }, missing: ['sel'] })
    expect(mapParams(params, { mode: 'other' }).missing).toEqual(['topic', 'sel'])
  })
  it('coerces each type', () => {
    expect(paramValue({ key: 'b', label: 'b', type: 'bool' }, 'yes')).toBe(true)
    expect(paramValue({ key: 'b', label: 'b', type: 'bool' }, 'maybe')).toBeUndefined()
    expect(paramValue({ key: 'n', label: 'n', type: 'number' }, 'abc')).toBeUndefined()
    expect(paramValue({ key: 'n', label: 'n', type: 'number' }, '')).toBeUndefined()
    expect(paramValue({ key: 't', label: 't', type: 'text' }, 'a\nb')).toBe('a b')
    expect((paramValue({ key: 's', label: 's', type: 'clipboard' }, 'x'.repeat(9000)) as string).length).toBe(4000)
  })
  it('the form asks at most 3 and never the selection or clipboard', () => {
    const a = make({ params: [...params, { key: 'z', label: 'Z', type: 'text' }] as any })
    expect(formFields(a).map((p) => p.key)).toEqual(['topic', 'n', 'mode'])
  })
})

describe('risk and confirm', () => {
  it('scripts always ask, typing asks unless tapped', () => {
    expect(riskOf(make({ risk: 'safe', steps: [{ do: 'script', file: 'C:\\S\\a.ps1', args: [] }] }))).toBe('confirm')
    expect(riskOf(make({ risk: 'safe', steps: [{ do: 'type', text: 'hi' }] }))).toBe('ask')
    expect(riskOf(make({ risk: 'confirm' }))).toBe('confirm')
  })
  it('follows safe / ask / confirm', () => {
    const safe = make({ risk: 'safe' })
    expect(['tap', 'trigger', 'ben'].map((s) => confirmNeeded(safe, s as any))).toEqual([false, false, false])
    const ask = make({ risk: 'ask', ranOnce: true })
    expect(['tap', 'trigger', 'ben', 'rerun'].map((s) => confirmNeeded(ask, s as any))).toEqual([false, true, true, false])
    expect(confirmNeeded(make({ risk: 'ask', ranOnce: false }), 'tap')).toBe(true)
    const always = make({ risk: 'confirm', ranOnce: true })
    expect(['tap', 'trigger', 'ben', 'rerun'].map((s) => confirmNeeded(always, s as any))).toEqual([true, true, true, true])
    expect(confirmNeeded(always, 'test')).toBe(false)
  })
  it('knows what needs the desktop or can run on the server', () => {
    expect(needsDesktop(make({ steps: [{ do: 'webhook', hook: 'h', where: 'local', preset: 'nodered' }] }))).toBe(true)
    expect(needsDesktop(make())).toBe(false)
    expect(serverRunnable(make({ steps: [hookStep, { do: 'telegram', text: 'x' }] }))).toBe(true)
    expect(serverRunnable(make({ steps: [hookStep, { do: 'note', text: 'x' }] }))).toBe(false)
  })
})

describe('templates and chains (AH18)', () => {
  it('fills values, the last answer and the trigger', () => {
    const scope = { values: { topic: 'Rust' }, result: { ok: true, text: 'All good', url: 'https://x.example/r' }, trigger: { file: 'a.pdf' } }
    expect(fill('{{topic}}: {{result.text}} {{ result.url }} {{trigger.file}} {{nope}} {{values.x}}', scope)).toBe('Rust: All good https://x.example/r a.pdf  ')
  })
  it('checks a filled link and typed text again', () => {
    expect(fillStep({ do: 'url', url: '{{result.url}}' }, { values: {}, result: { ok: true, url: 'javascript:alert(1)' } })).toEqual({ error: 'Only https links' })
    expect(fillStep({ do: 'type', text: 'my password is {{p}}' }, { values: { p: 'x' } })).toHaveProperty('error')
  })
  it('passes each answer on and stops at the first failure', async () => {
    const a = make({ steps: [hookStep, { do: 'telegram', text: 'Got: {{result.text}}' }, { do: 'note', text: 'never' }] })
    const seen: Step[] = []
    const r = await runChain(a, { values: {} }, async (s) => {
      seen.push(s)
      if (s.do === 'webhook') return { ok: true, text: 'report ready' }
      if (s.do === 'telegram') return { ok: false, why: 'Telegram is down' }
      return { ok: true }
    })
    expect((seen[1] as any).text).toBe('Got: report ready')
    expect(seen).toHaveLength(2)
    expect(r).toMatchObject({ ok: false, failedAt: 1, last: { why: 'Telegram is down' } })
  })
  it('a throwing step is a failure, and the card shows the last answer that said something', async () => {
    const boom = await runChain(make(), { values: {} }, async () => {
      throw new Error('timeout')
    })
    expect(boom).toMatchObject({ ok: false, last: { why: 'timeout' } })
    const ok = await runChain(make({ steps: [hookStep, { do: 'note', text: '{{result.text}}' }] }), { values: {} }, async (s) => (s.do === 'webhook' ? { ok: true, text: 'answer', url: 'https://a.example' } : { ok: true }))
    expect(ok.last).toEqual({ ok: true, text: 'answer', url: 'https://a.example' })
  })
  it('the webhook body carries values and the step before', () => {
    const b = webhookBody({ id: 'a1', name: 'Report' }, { values: { topic: 'x' }, result: { ok: true, text: 'prev' } }, new Date('2026-11-05T10:00:00Z'))
    expect(b).toEqual({ automation: 'Report', id: 'a1', values: { topic: 'x' }, prev: { text: 'prev', url: null }, at: '2026-11-05T10:00:00.000Z', source: 'life-system' })
  })
})

describe('flow answers (AH4)', () => {
  it('reads Respond to Webhook', () => {
    expect(readFlowAnswer(200, 'application/json', JSON.stringify({ text: 'Done', url: 'https://r.example/1', image: 'https://img.example/a.png', ok: true }))).toEqual({ ok: true, text: 'Done', url: 'https://r.example/1', image: 'https://img.example/a.png' })
  })
  it('drops non-https links and images', () => {
    const r = readFlowAnswer(200, 'application/json', JSON.stringify({ text: 'x', url: 'http://r.example', image: 'data:image/png;base64,AAA' }))
    expect(r.url).toBeUndefined()
    expect(r.image).toBeUndefined()
  })
  it('reads arrays, plain text, "started" and failures', () => {
    expect(readFlowAnswer(200, 'application/json', '[{"message":"Workflow was started"}]').text).toBe('Started')
    expect(readFlowAnswer(200, 'text/plain', 'hello')).toEqual({ ok: true, text: 'hello' })
    expect(readFlowAnswer(200, '', '')).toEqual({ ok: true, text: 'Done' })
    expect(readFlowAnswer(404, 'application/json', '{"message":"webhook not registered"}')).toEqual({ ok: false, why: 'The flow answered 404: webhook not registered' })
    expect(readFlowAnswer(200, 'application/json', '{"ok":false,"text":"No data"}')).toMatchObject({ ok: false, why: 'No data' })
    expect(readFlowAnswer(200, 'application/json', '{"text":"x","executionId":"123"}').exec).toBe('123')
  })
  it('caps the text', () => {
    expect(readFlowAnswer(200, 'text/plain', 'a'.repeat(9000)).text!.length).toBe(2000)
  })
})

describe('n8n API (AH6, AH7)', () => {
  it('lists workflows with their webhook paths', () => {
    const list = n8nWorkflows({ data: [{ id: '7', name: 'Report', active: true, nodes: [{ type: 'n8n-nodes-base.webhook', parameters: { path: '/report', httpMethod: 'POST' } }, { type: 'n8n-nodes-base.set' }] }, { id: 8, name: 'Off', active: false, nodes: [] }] })
    expect(list).toEqual([{ id: '7', name: 'Report', active: true, hooks: [{ path: 'report', method: 'POST' }] }, { id: '8', name: 'Off', active: false, hooks: [] }])
    expect(n8nHookUrl('https://n8n.example.com/', 'a b/c')).toBe('https://n8n.example.com/webhook/a%20b/c')
    expect(n8nBase('https://n8n.example.com/api/v1/?x=1')).toBe('https://n8n.example.com')
    expect(n8nBase('https://example.com/n8n/')).toBe('https://example.com/n8n')
  })
  it('reads an execution state', () => {
    expect(execState({ status: 'success' })).toBe('ok')
    expect(execState({ data: { status: 'error' } })).toBe('failed')
    expect(execState({ status: 'running' })).toBe('running')
    expect(execState({ finished: true })).toBe('ok')
  })
  it('tells each failure once, and the first look only remembers', () => {
    const page = { data: [{ id: '1', workflowId: '7', workflowData: { name: 'Report' }, stoppedAt: '2026-11-05T09:30:00Z' }] }
    expect(newFailures(page, null)).toEqual({ fails: [], seen: ['1'] })
    const next = { data: [{ id: '2', workflowId: '7', stoppedAt: '2026-11-05T10:00:00Z' }, ...page.data] }
    const r = newFailures(next, ['1'], { '7': 'Report' })
    expect(r.fails).toEqual([{ id: '2', workflowId: '7', name: 'Report', at: '2026-11-05T10:00:00Z' }])
    expect(newFailures(next, r.seen).fails).toEqual([])
  })
})

describe('addresses', () => {
  it('local webhooks only go to your PC or network', () => {
    expect(localUrlProblem('http://localhost:5678/webhook/x')).toBeNull()
    expect(localUrlProblem('http://192.168.1.20:1880/life')).toBeNull()
    expect(localUrlProblem('http://nas.local:5678/x')).toBeNull()
    expect(localUrlProblem('http://10.0.0.5/x')).toBeNull()
    expect(localUrlProblem('https://n8n.example.com/x')).toMatch(/public/)
    expect(localUrlProblem('http://8.8.8.8/x')).toMatch(/public/)
    expect(localUrlProblem('http://169.254.169.254/latest')).toMatch(/link-local/)
    expect(localUrlProblem('ftp://localhost/x')).toMatch(/http/)
    expect(localUrlProblem('http://user:pw@localhost/x')).toMatch(/password/)
  })
  it('warns gently when a preset does not match', () => {
    expect(presetWarning('make', 'https://hook.eu1.make.com/abc')).toBeNull()
    expect(presetWarning('make', 'https://evil.example.com/abc')).toMatch(/Make/)
    expect(presetWarning('n8n', 'https://anything.example.com')).toBeNull()
  })
  it('shows only the last 4 characters', () => {
    expect(last4('https://n8n.example.com/webhook/abcd1234')).toBe('…1234')
    expect(last4('')).toBe('')
  })
})

describe('scripts and SHA pinning (AH10, AH13)', () => {
  const dir = 'C:\\Users\\Me\\Scripts'
  it('runs only plain files right inside the chosen folder', () => {
    expect(scriptProblem('C:\\Users\\Me\\Scripts\\backup.ps1', dir)).toBeNull()
    expect(scriptProblem('c:/users/me/scripts/tidy.py', dir)).toBeNull()
    expect(scriptProblem('C:\\Users\\Me\\Scripts\\sub\\x.ps1', dir)).toMatch(/right inside/)
    expect(scriptProblem('C:\\Users\\Me\\Scripts\\..\\x.ps1', dir)).toMatch(/plain/)
    expect(scriptProblem('C:\\Users\\Me\\Scripts\\x.exe', dir)).toMatch(/Only/)
    expect(scriptProblem('C:\\Users\\Me\\Scripts\\x.ps1', null)).toMatch(/folder/)
    expect(scriptProblem('C:\\Other\\x.ps1', dir)).toMatch(/right inside/)
    expect(scriptProblem('C:\\Users\\Me\\Scripts\\keys.ahk', dir, ['.ahk'])).toBeNull()
  })
  it('builds the command as an array (nothing glued into a string)', () => {
    expect(scriptCommand('C:\\S\\a.ps1', ['x y', '-Force'])).toEqual({ exe: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\S\\a.ps1', 'x y', '-Force'] })
    expect(scriptCommand('C:\\S\\a.bat', ['1'])).toEqual({ exe: 'cmd.exe', args: ['/d', '/c', 'C:\\S\\a.bat', '1'] })
    expect(scriptCommand('C:\\S\\a.py', [])).toEqual({ exe: 'py.exe', args: ['-3', 'C:\\S\\a.py'] })
    expect(scriptCommand('C:\\S\\k.ahk', [], { ahkExe: 'C:\\AHK\\AutoHotkey64.exe' }).exe).toBe('C:\\AHK\\AutoHotkey64.exe')
    expect(() => scriptCommand('C:\\S\\a.exe', [])).toThrow()
  })
  it('refuses cmd characters in .bat arguments', () => {
    expect(argsProblem('.bat', ['a & del x'])).toMatch(/bat/)
    expect(argsProblem('.bat', ['100%'])).toMatch(/bat/)
    expect(argsProblem('.ps1', ['a & b'])).toBeNull()
  })
  it('previews the exact command', () => {
    expect(previewCommand(scriptCommand('C:\\My Scripts\\a.ps1', ['hello world']))).toBe('powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\\My Scripts\\a.ps1" "hello world"')
  })
  it('a changed file asks again', () => {
    const sha = 'a'.repeat(64)
    const pins = { [pinKey('C:\\S\\a.ps1')]: sha }
    expect(pinState(pins, 'c:/s/a.ps1', sha)).toBe('pinned')
    expect(pinState(pins, 'C:\\S\\a.ps1', 'b'.repeat(64))).toBe('changed')
    expect(pinState(pins, 'C:\\S\\b.ps1', sha)).toBe('new')
  })
  it('caps output at 4 KB and strips colours', () => {
    expect(capOutput('\u001b[32mok\u001b[0m\r\n')).toBe('ok')
    const big = capOutput('é'.repeat(5000))
    expect(new TextEncoder().encode(big).length).toBeLessThan(4200)
    expect(big).toMatch(/cut at 4 KB/)
  })
  it('the dry run shows the command before the first run', () => {
    const lines = dryRun(make({ steps: [{ do: 'script', file: 'C:\\S\\a.ps1', args: ['{{topic}}'] }], params: [{ key: 'topic', label: 'T', type: 'text' }] }), { topic: 'math' })
    expect(lines).toEqual(['1. Run: powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\\S\\a.ps1 math'])
  })
})

describe('triggers and the loop guard (AH16)', () => {
  const at = new Date(2026, 10, 5, 9, 0).getTime()
  it('matches the new triggers', () => {
    expect(matchTrigger({ on: 'wifi', name: 'Home' }, { t: 'wifi', at, name: 'home', prev: 'Uni' })).toEqual({ vars: { wifi: 'home' } })
    expect(matchTrigger({ on: 'wifi', name: 'Home' }, { t: 'wifi', at, name: 'Home', prev: 'Home' })).toBeNull()
    expect(matchTrigger({ on: 'battery', below: 20 }, { t: 'battery', at, pct: 19, prev: 21 })).not.toBeNull()
    expect(matchTrigger({ on: 'battery', below: 20 }, { t: 'battery', at, pct: 18, prev: 19 })).toBeNull()
    expect(matchTrigger({ on: 'charger', plugged: true }, { t: 'power', at, plugged: true })).not.toBeNull()
    expect(matchTrigger({ on: 'app:open', app: 'code' }, { t: 'app', at, app: 'Visual Studio Code', prev: 'Chrome' })).toEqual({ vars: { app: 'Visual Studio Code' } })
    expect(matchTrigger({ on: 'app:close', app: 'code' }, { t: 'app', at, app: 'Chrome', prev: 'Visual Studio Code' })).toEqual({ vars: { app: 'Visual Studio Code' } })
    expect(matchTrigger({ on: 'file', folder: 'C:\\Downloads', ext: '.pdf' }, { t: 'file', at, folder: 'c:/downloads/', name: 'paper.pdf' })).toEqual({ vars: { file: 'paper.pdf', folder: 'C:\\Downloads' } })
    expect(matchTrigger({ on: 'file', folder: 'C:\\Downloads', ext: '.pdf' }, { t: 'file', at, folder: 'C:\\Downloads', name: 'a.zip' })).toBeNull()
    expect(matchTrigger({ on: 'clipboard', pattern: '/^[A-Z]{3}-\\d+$/' }, { t: 'clip', at, text: 'ABC-42' })).not.toBeNull()
    expect(matchTrigger({ on: 'idle', minutes: 10 }, { t: 'idle', at, minutes: 5 })).toBeNull()
    expect(matchTrigger({ on: 'focus:start' }, { t: 'focus:start', at })).toEqual({ vars: {} })
  })
  it('time fires once a day, calendar once per event', () => {
    const t = { on: 'time' as const, at: '09:00' }
    const hit = matchTrigger(t, { t: 'tick', at }, {}, 'a')!
    expect(hit.key).toBe('a:time:09:00')
    expect(matchTrigger(t, { t: 'tick', at: at + 60_000 }, { [hit.key!]: at }, 'a')).toBeNull()
    const ev = { title: 'Lecture: Algebra', start: at + 5 * 60_000 }
    const cal = { on: 'calendar' as const, match: 'lecture', before: 5 }
    const c = matchTrigger(cal, { t: 'tick', at, events: [ev] }, {}, 'b')!
    expect(c.vars.event).toBe('Lecture: Algebra')
    expect(matchTrigger(cal, { t: 'tick', at: at + 60_000, events: [ev] }, { [c.key!]: at }, 'b')).toBeNull()
  })
  it('the same automation starts at most once per 30 s, and nothing when paused', () => {
    const a = make({ when: [{ on: 'usb' }], risk: 'safe' })
    const e: AutoEvent = { t: 'usb', at, drive: 'E:' }
    const first = automationsFor({ paused: false, list: [a] }, e, {})
    expect(first.runs).toHaveLength(1)
    expect(first.runs[0]).toMatchObject({ vars: { drive: 'E:' }, ask: false })
    expect(automationsFor({ paused: false, list: [a] }, { ...e, at: at + 10_000 }, first.fired).runs).toHaveLength(0)
    expect(automationsFor({ paused: false, list: [a] }, { ...e, at: at + 31_000 }, first.fired).runs).toHaveLength(1)
    expect(automationsFor({ paused: true, list: [a] }, e, {}).runs).toHaveLength(0)
    expect(guardOk({ a1: at }, 'a1', at + 29_999)).toBe(false)
  })
  it('a chain that triggers itself is stopped by the guard', () => {
    // A clipboard automation that copies again would loop: only one run in 30 s.
    const a = make({ when: [{ on: 'clipboard', pattern: 'x' }] })
    let fired: Record<string, number> = {}
    let runs = 0
    for (let i = 0; i < 20; i++) {
      const r = automationsFor({ paused: false, list: [a] }, { t: 'clip', at: at + i * 1000, text: 'x' }, fired)
      runs += r.runs.length
      fired = r.fired
    }
    expect(runs).toBe(1)
  })
  it('respects days, hours and off', () => {
    const a = make({ when: [{ on: 'usb' }], if: { days: [0] } })
    expect(automationsFor({ paused: false, list: [a] }, { t: 'usb', at, drive: 'E:' }, {}).runs).toHaveLength(0)
    expect(automationsFor({ paused: false, list: [make({ when: [{ on: 'usb' }], on: false })] }, { t: 'usb', at, drive: 'E:' }, {}).runs).toHaveLength(0)
  })
  it('a trigger run of an "ask" automation asks', () => {
    const a = make({ when: [{ on: 'back' }], risk: 'ask', ranOnce: true })
    expect(automationsFor({ paused: false, list: [a] }, { t: 'back', at }, {}).runs[0].ask).toBe(true)
  })
  it('tells the desktop only the sensors in use', () => {
    const list = [make({ when: [{ on: 'wifi', name: 'Home' }, { on: 'idle', minutes: 15 }] }), make({ id: 'a2', when: [{ on: 'file', folder: 'C:\\In' }], on: false })]
    expect(desktopWatch({ paused: false, list })).toEqual({ wifi: true, usb: false, battery: false, power: false, idle: [15], clipboard: [], folders: [] })
    expect(desktopWatch({ paused: true, list }).wifi).toBe(false)
  })
  it('a clipboard regex that could hang is refused', () => {
    expect(clipMatcher('/(a+)+b/')).toBeNull()
    expect(clipMatcher('/(.*)\\1/')).toBeNull()
    expect(clipMatcher('hello')!('Say HELLO')).toBe(true)
  })
})

describe('words', () => {
  it('says it in plain English', () => {
    expect(sentence(make({ when: [{ on: 'wifi', name: 'Home' }], steps: [hookStep, { do: 'telegram', text: 'Home now' }], if: { days: [1, 2, 3, 4, 5] } }), () => '…ab12')).toBe('When I join the Wi-Fi “Home” on weekdays, run the n8n flow (…ab12), then send me a Telegram “Home now”')
    expect(sentence(make())).toBe('Tap to run the n8n flow')
  })
})

describe('run log (AH20)', () => {
  it('removes secrets', () => {
    expect(scrub('Bearer abc.def token=xyz https://h.example/x?key=1 ' + 'k'.repeat(40))).toBe('Bearer … token=… https://h.example/x?… …')
    const params: Param[] = [{ key: 'sel', label: 's', type: 'selection' }]
    expect(redactValues(params, { api_key: 'x', password: 'y', sel: 'ab cd '.repeat(20), n: 3 })).toEqual({ sel: `${'ab cd '.repeat(20).slice(0, 40)}…`, n: 3 })
  })
  it('keeps 100 lines and the last 20 runs', () => {
    const a = make()
    let log = [] as ReturnType<typeof logLine>[]
    for (let i = 0; i < 120; i++) log = addRun(log, logLine(a, 'tap', { ok: true, text: 'token=abc' }, { token: 's' }, 1000 + i, 5))
    expect(log).toHaveLength(100)
    expect(log[0].text).toBe('token=…')
    expect(log[0].values).toEqual({})
    let recent: any[] = []
    for (let i = 0; i < 30; i++) recent = addRecent(recent, { at: i, auto: 'a1', name: 'R', ok: true, values: { topic: `t${i}`, secret: 'x' } })
    expect(recent).toHaveLength(20)
    expect(recent[0].values).toEqual({ topic: 't29' })
  })
})

describe('island and Ben', () => {
  it('island buttons: pinned ones, favourites first', () => {
    const list = [make({ id: 'p', pin: true, name: 'P' }), make({ id: 'f', fav: true, name: 'F' }), make({ id: 'n', name: 'N' })]
    expect(islandButtons({ list }).map((b) => b.id)).toEqual(['f', 'p'])
  })
  it("Ben's tools are only the ticked ones, with unique names", () => {
    const store = { paused: false, list: [make({ id: 'x', name: 'Daily report', ben: true }), make({ id: 'y', name: 'Daily report', ben: true }), make({ id: 'z', name: 'Secret', ben: false })] }
    expect(benTools(store).map((t) => t.name)).toEqual(['flow_daily_report', 'flow_daily_report_2'])
    expect(benTools({ ...store, paused: true })).toEqual([])
    expect(benTools({ paused: false, list: [make({ ben: true, risk: 'ask' })] })[0].description).toMatch(/tap OK/)
  })
  it('Ben asks wait for a tap unless the automation is safe', () => {
    const now = 1_000_000
    let asks = addAutoAsk([], make({ risk: 'safe' }), {}, now, 'q1')
    asks = addAutoAsk(asks, make({ risk: 'ask', ranOnce: true }), { topic: 'x' }, now, 'q2')
    expect(asks.map((a) => a.status)).toEqual(['go', 'waiting'])
    expect(openAutoAsks(cleanAutoAsks({ asks }, now + 11 * 60_000), now + 11 * 60_000)).toEqual([])
    expect(cleanAutoAsks({ asks }, now + 11 * 60_000)[1].status).toBe('expired')
  })
})

describe('Ben suggests (AH22)', () => {
  const step = (key: string): Step => ({ do: 'url', url: `https://${key}.example.com` })
  const seq = (start: number): DoneStep[] => ['a', 'b', 'c'].map((k, i) => ({ at: start + i * 60_000, key: k, label: k.toUpperCase(), step: step(k) }))
  it('offers a button after the same 3 steps on 3 occasions', () => {
    const h = [...seq(0), ...seq(3600_000), { at: 5000_000, key: 'z', label: 'Z', step: step('z') }, ...seq(7200_000)]
    const r = findRepeat(h)!
    expect(r.key).toBe('a > b > c')
    expect(r.steps[0].at).toBe(7200_000)
    const a = suggestedAutomation(r, 1)
    expect(a).toMatchObject({ on: false, byBen: true, pin: false, risk: 'ask', name: 'A + B + C' })
    expect(a.steps).toHaveLength(3)
  })
  it('not twice, not after no, not when too spread out', () => {
    expect(findRepeat([...seq(0), ...seq(3600_000)])).toBeNull()
    const h = [...seq(0), ...seq(3600_000), ...seq(7200_000)]
    expect(findRepeat(h, ['a > b > c'])).toBeNull()
    expect(findRepeat(h, [], [suggestedAutomation({ steps: seq(0) })])).toBeNull()
    const slow = (s: number): DoneStep[] => ['a', 'b', 'c'].map((k, i) => ({ at: s + i * 10 * 60_000, key: k, label: k, step: step(k) }))
    expect(findRepeat([...slow(0), ...slow(1e8), ...slow(2e8)])).toBeNull()
  })
})

describe('recipes become automations', () => {
  it('keeps the trigger, the actions and the ask', () => {
    const r: Recipe = { id: 't-coding', name: 'Coding mornings', on: true, when: { on: 'context', ctx: 'coding' }, if: { days: [1, 2, 3, 4, 5], from: '09:00', to: '12:00' }, then: [{ do: 'focus', subject: 'Coding', minutes: 50 }], confirmFirst: true, ranOnce: true }
    const a = fromRecipe(r)!
    expect(a).toMatchObject({ id: 'r_t-coding', on: true, when: [{ on: 'context', ctx: 'coding' }], risk: 'ask', if: { days: [1, 2, 3, 4, 5], from: '09:00', to: '12:00' } })
    expect(a.steps).toEqual([{ do: 'safe', act: { do: 'focus', subject: 'Coding', minutes: 50 } }])
    expect(fromRecipe({ ...r, when: { on: 'focus:end' } })!.when).toEqual([{ on: 'focus:end' }])
  })
})

describe('chain results', () => {
  it('fills a link from the answer', async () => {
    const got: StepResult[] = []
    await runChain(make({ steps: [hookStep, { do: 'url', url: '{{result.url}}' }] }), { values: {} }, async (s) => {
      if (s.do === 'url') got.push({ ok: true, url: s.url })
      return s.do === 'webhook' ? { ok: true, url: 'https://report.example/42' } : { ok: true }
    })
    expect(got[0].url).toBe('https://report.example/42')
  })
})
