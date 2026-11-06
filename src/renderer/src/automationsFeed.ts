// Automation hub, the app window's part: the one engine that runs your
// automations (src/core/automations.ts) from an island tap, a trigger, a
// Re-run or Ben's ask. It reads the synced list, asks the desktop for local
// things (local webhooks, the selection, scripts, workspaces, sensors) and the
// server for cloud ones (/api/mcp?op=flows: the page never sees an address or
// key). The island window only shows what this sends in the snapshot.
//
// Kept on THIS device only (localStorage): the last values per automation,
// the last 20 runs (Re-run), the run log (secrets removed), the loop guard's
// times, and what you did by hand (for Ben's "Make this a button?").
import {
  addRecent, addRun, automationsFor, cleanRunLog, cleanStore, confirmNeeded, desktopWatch, dryRun, DESKTOP_STEPS, EMPTY_STORE, findRepeat, islandButtons, mapParams,
  openAutoAsks, pcReads, runChain, suggestedAutomation, webhookBody, logLine, type AutoEvent, type Automation, type AutomationStore, type AutoIslandOp, type DoneStep, type IslandAutoRun,
  type IslandAutoView, type ParamValue, type RecentRun, type RunLine, type RunScope, type RunSource, type Step, type StepResult
} from '@core/automations'
import type { IslandAction, IslandAlert } from '@core/islandModel'
import { currentSession } from './web/session'
import { life } from './bridge'
import { runSafe } from './smartIsland'

const LS = { last: 'ls.autoLast', recent: 'ls.autoRecent', log: 'ls.autoLog', fired: 'ls.autoFired', done: 'ls.autoDone' }
const get = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k)
    return v ? (JSON.parse(v) as T) : d
  } catch {
    return d
  }
}
const put = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* private window */
  }
}
const desk = () => (typeof window !== 'undefined' ? window.desktop : undefined)

let store: AutomationStore = EMPTY_STORE
let storeAt = 0
let changed: () => void = () => {}
let watchKey = ''
const runs: IslandAutoRun[] = []
interface Pending { run: string; auto: Automation; values: Record<string, ParamValue>; vars: Record<string, string>; source: RunSource; preview: string[]; pins: { file: string; sha: string }[]; ask?: string }
let pending: Pending | null = null
let suggestion: { key: string; auto: Automation } | null = null

/** The server's automation door (your app session). */
export async function flowsCall(body: unknown): Promise<any> {
  const r = await fetch('/api/mcp?op=flows', { method: 'POST', headers: { Authorization: `Bearer ${currentSession()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(25_000) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Life System answered ${r.status}`)
  return j
}
/** The desktop's automation channel (an error message becomes a thrown error). */
export async function deskAuto(op: string, arg?: unknown): Promise<any> {
  const d = desk()
  if (!d?.auto) throw new Error('This needs the desktop app')
  const r = await d.auto(op, arg)
  if (r && r.ok === false && r.error) throw new Error(r.error)
  return r
}

export async function loadStore(force = false): Promise<AutomationStore> {
  if (!life.automations) return store
  if (!force && Date.now() - storeAt < 30_000) return store
  store = await life.automations.get().catch(() => store)
  storeAt = Date.now()
  syncWatch()
  return store
}
export async function saveStore(next: AutomationStore): Promise<AutomationStore> {
  if (!life.automations) throw new Error('This version cannot save automations yet')
  store = await life.automations.save(cleanStore(next))
  storeAt = Date.now()
  syncWatch()
  changed()
  return store
}
/** The desktop starts only the sensors your automations use. */
function syncWatch() {
  if (!desk()?.auto) return
  const w = desktopWatch(store)
  const key = JSON.stringify(w)
  if (key === watchKey) return
  watchKey = key
  void desk()!.auto!('watch', w).catch(() => {})
}

export const runLog = (): RunLine[] => cleanRunLog(get(LS.log, []))
export const clearRunLog = () => put(LS.log, [])
export const recentRuns = (): RecentRun[] => get<RecentRun[]>(LS.recent, [])
export const lastValues = (id: string): Record<string, ParamValue> => get<Record<string, Record<string, ParamValue>>>(LS.last, {})[id] ?? {}

// ---- doing one step ----

async function appendNote(title: string, text: string) {
  const notes = await life.notes!.list()
  const n = notes.find((x) => x.title.toLowerCase() === title.toLowerCase())
  const line = `- ${text}`
  await life.notes!.save(n ? { id: n.id, title: n.title, body: `${n.body.replace(/\s*$/, '')}\n${line}\n` } : { title, body: `# ${title}\n\n${line}\n` })
}

async function followN8n(where: 'cloud' | 'local', exec: string, run: IslandAutoRun): Promise<StepResult> {
  // AH6: a status ring while it runs, then a tick or a red dot (2 minutes at most).
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    const st = where === 'cloud' ? (await flowsCall({ action: 'n8nExec', exec }).catch(() => null))?.state : (await deskAuto('n8nExec', { exec }).catch(() => null))?.state
    if (st === 'ok') return { ok: true, text: 'The flow finished' }
    if (st === 'failed') return { ok: false, why: 'The flow failed in n8n (see its Executions)' }
    run.state = 'running'
  }
  return { ok: false, why: 'Still running after 2 minutes (it may finish later)' }
}

function execFor(a: Automation, run: IslandAutoRun) {
  return async (s: Step, scope: RunScope): Promise<StepResult> => {
    if (DESKTOP_STEPS.includes(s.do) && !desk()?.auto) return { ok: false, why: 'This step needs the desktop app' }
    switch (s.do) {
      case 'webhook': {
        let r: StepResult
        if (s.where === 'cloud') r = (await flowsCall({ action: 'run', hook: s.hook, auto: { id: a.id, name: a.name }, scope: { values: scope.values, trigger: scope.trigger, result: scope.result ? { text: scope.result.text, url: scope.result.url } : null } })).result
        else {
          if (!desk()?.auto) return { ok: false, why: 'This flow is on your PC: run it from the desktop app' }
          r = await deskAuto('run', { hook: s.hook, body: webhookBody(a, scope) })
        }
        if (r?.ok && s.wait && r.exec) {
          const f = await followN8n(s.where, r.exec, run)
          return f.ok ? { ...r, ok: true } : f
        }
        return r ?? { ok: false, why: 'No answer' }
      }
      case 'safe':
        return { ok: true, text: await runSafe([s.act], a.name) }
      case 'telegram':
      case 'ntfy':
        return (await flowsCall({ action: 'notify', via: s.do, text: s.text })).result
      case 'todoist': {
        if (!life.todoist) return { ok: false, why: 'Connect Todoist first' }
        const t = await (life.todoist as any).quickAdd(s.text)
        return { ok: true, text: `Task added: ${t?.content ?? s.text}` }
      }
      case 'note':
        if (!life.notes) return { ok: false, why: 'The notebook is not ready' }
        await appendNote(s.title || 'Inbox', s.text)
        return { ok: true, text: `Saved in Notebook → ${s.title || 'Inbox'}` }
      case 'url':
        window.open(s.url, '_blank', 'noopener')
        return { ok: true, url: s.url }
      case 'type':
        return deskAuto('type', { text: s.text })
      case 'focus':
        await life.focus.start(s.subject, s.minutes, null)
        window.dispatchEvent(new Event('life-focus-changed'))
        return { ok: true, text: `Focus “${s.subject}” ${s.minutes} min` }
      case 'music': {
        // The music player's play-station API, when this version has it.
        const m = (window as any).lifeMusic
        if (typeof m?.playStation === 'function') {
          await m.playStation(s.station)
          return { ok: true, text: `Playing ${s.station}` }
        }
        window.dispatchEvent(new CustomEvent('life-music-station', { detail: { station: s.station } }))
        return { ok: true, text: `Asked the music player for ${s.station}` }
      }
      case 'script':
      case 'ahk':
        return deskAuto('scriptRun', { file: s.file, args: s.args })
      case 'workspace': {
        const r = await deskAuto('workspace', { id: a.id, ws: s.ws })
        if (r?.ok && s.ws.focus) await life.focus.start(s.ws.focus.subject, s.ws.focus.minutes, null).catch(() => null)
        run.ws = true
        return r
      }
      case 'powertoys':
        return deskAuto('powertoys', { feature: s.feature })
      case 'espanso':
        return deskAuto('espanso', { cmd: s.cmd })
    }
  }
}

// ---- running ----

const newRunId = () => `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`

/** The confirm card's preview (for scripts: the exact command, and allowing pins that version). */
async function previewFor(a: Automation, values: Record<string, ParamValue>, vars: Record<string, string>): Promise<{ lines: string[]; pins: { file: string; sha: string }[] }> {
  const lines = dryRun(a, values, { trigger: vars })
  const pins: { file: string; sha: string }[] = []
  for (const s of a.steps) {
    if ((s.do !== 'script' && s.do !== 'ahk') || !desk()?.auto) continue
    const p = await deskAuto('scriptPreview', { file: s.file, args: s.args }).catch((e: Error) => ({ problem: e.message }))
    if (p?.problem) lines.push(`⚠ ${p.problem}`)
    else if (p?.pin !== 'pinned') {
      lines.push(p.pin === 'changed' ? '⚠ This file changed since you allowed it: yes allows the new version' : 'First run: yes allows this exact file (it asks again if it changes)')
      pins.push({ file: s.file, sha: p.hash })
    }
  }
  return { lines, pins }
}

/**
 * Start a run: values from you (or the last time), the selection / clipboard
 * read when asked, a yes first when the rules say so, then the chain.
 */
export async function startRun(a: Automation, input: Record<string, unknown>, source: RunSource, vars: Record<string, string> = {}, ask?: string): Promise<string> {
  const reads = pcReads(a)
  const extra: Record<string, unknown> = {}
  if (reads.selection || reads.clipboard) {
    if (!desk()?.auto) throw new Error('Reading the selection needs the desktop app')
    for (const p of a.params) {
      if (p.type === 'selection') extra[p.key] = (await deskAuto('selection'))?.text ?? ''
      if (p.type === 'clipboard') extra[p.key] = (await deskAuto('clipboard'))?.text ?? ''
    }
  }
  const { values, missing } = mapParams(a.params, { ...input, ...extra }, source === 'rerun' ? {} : lastValues(a.id))
  if (missing.length) throw new Error(`Needs ${missing.map((k) => a.params.find((p) => p.key === k)?.label ?? k).join(', ')}${reads.selection ? ' (select some text first)' : ''}`)
  if (confirmNeeded(a, source)) {
    const pv = await previewFor(a, values, vars)
    pending = { run: newRunId(), auto: a, values, vars, source, preview: pv.lines, pins: pv.pins, ask }
    changed()
    return `${a.name}: waiting for your yes`
  }
  return go(a, values, source, vars, ask)
}

async function go(a: Automation, values: Record<string, ParamValue>, source: RunSource, vars: Record<string, string>, ask?: string): Promise<string> {
  const run: IslandAutoRun = { run: newRunId(), id: a.id, name: a.name, startedAt: Date.now(), state: 'running' }
  runs.unshift(run)
  runs.splice(4)
  changed()
  const t0 = Date.now()
  // Remember the values for next time (not what was read from the PC).
  const last = get<Record<string, Record<string, ParamValue>>>(LS.last, {})
  last[a.id] = Object.fromEntries(Object.entries(values).filter(([k]) => !a.params.find((p) => p.key === k && (p.type === 'selection' || p.type === 'clipboard'))))
  put(LS.last, Object.fromEntries(Object.entries(last).slice(-40)))
  const r = await runChain(a, { values, trigger: vars }, execFor(a, run))
  run.state = r.ok ? 'ok' : 'failed'
  run.result = r.ok ? r.last : { ok: false, why: r.last.why ?? 'It failed' }
  put(LS.log, addRun(runLog(), logLine(a, source, r.ok ? { ok: true, text: r.last.text } : { ok: false, why: r.last.why }, values, t0, Date.now() - t0)))
  put(LS.recent, addRecent(recentRuns(), { at: t0, auto: a.id, name: a.name, ok: r.ok, values }))
  if (ask) await life.automations?.setAsk(ask, r.ok ? 'done' : 'failed', r.ok ? undefined : r.last.why).catch(() => {})
  if (!a.ranOnce) await saveStore({ ...store, list: store.list.map((x) => (x.id === a.id ? { ...x, ranOnce: true } : x)) }).catch(() => {})
  changed()
  // A finished card goes away by itself after 2 minutes.
  setTimeout(() => {
    const i = runs.indexOf(run)
    if (i >= 0 && run.state !== 'running') {
      runs.splice(i, 1)
      changed()
    }
  }, 120_000)
  if (!r.ok) throw new Error(`${a.name}: ${r.last.why ?? 'it failed'}`)
  return `${a.icon} ${a.name}: ${r.last.text ? r.last.text.slice(0, 80) : 'done'}`
}

// ---- triggers (AH16) ----

async function onEvent(e: AutoEvent) {
  await loadStore()
  const fired = get<Record<string, number>>(LS.fired, {})
  const r = automationsFor(store, e, fired)
  put(LS.fired, r.fired)
  for (const h of r.runs) void startRun(h.auto, {}, 'trigger', h.vars).catch(() => {})
}

let wired = false
let prev = { running: false, call: false, block: '' }
/** Once: the desktop's sensors and the app in front become events. */
export function startAutomations(onChange: () => void) {
  changed = onChange
  if (wired) return
  wired = true
  const d = desk()
  d?.onAuto?.((ev) => void onEvent(ev))
  let app: string | null = null
  d?.onActivity?.((ev) => {
    if (ev.t !== 'app') return
    if (ev.label !== app) {
      void onEvent({ t: 'app', at: ev.at, app: ev.label, prev: app })
      app = ev.label
    }
    void onEvent({ t: 'context', at: ev.at, ctx: ev.context, conf: ev.conf })
  })
  void loadStore(true)
}

/** Every island build (~15 s): time / calendar triggers, focus and meetings starting or ending, Ben's asks. */
export async function autoTick(o: { now: number; running: boolean; call: boolean; block: string; events: { title: string; start: number }[] }) {
  if (!life.automations) return
  await loadStore()
  const evs: AutoEvent[] = [{ t: 'tick', at: o.now, events: o.events.filter((e) => e.start > o.now).slice(0, 20) }]
  if (o.running !== prev.running) evs.push({ t: o.running ? 'focus:start' : 'focus:end', at: o.now })
  if (o.call !== prev.call) evs.push({ t: o.call ? 'meeting:start' : 'meeting:end', at: o.now })
  if (o.block && o.block !== prev.block) evs.push({ t: 'block:start', at: o.now })
  // The first look only remembers (a timer already running is not a new start).
  const first = !tickedOnce
  tickedOnce = true
  prev = { running: o.running, call: o.call, block: o.block }
  for (const e of first ? evs.slice(0, 1) : evs) await onEvent(e)
  // AH8: Ben's asks (from this device's copy of the database, no server call).
  if (!store.paused && desk()?.auto) {
    const asks = openAutoAsks(await life.automations.asks().catch(() => []), o.now)
    for (const q of asks) {
      if (pending?.ask === q.id || handled.has(q.id)) continue
      handled.add(q.id)
      const a = store.list.find((x) => x.id === q.auto && x.ben)
      if (!a) {
        await life.automations.setAsk(q.id, 'failed', 'No such automation for Ben').catch(() => {})
        continue
      }
      await life.automations.setAsk(q.id, 'allowed').catch(() => {})
      void startRun(a, q.values, 'ben', {}, q.id).catch((e) => void life.automations?.setAsk(q.id, 'failed', String((e as Error).message)).catch(() => {}))
    }
  }
}
let tickedOnce = false
const handled = new Set<string>()

// ---- Ben suggests (AH22) ----

/** What you did by hand on the island, in a form a button can repeat (never logging water, reps or points). */
export function noteDone(a: IslandAction) {
  let d: Omit<DoneStep, 'at'> | null = null
  if (a.kind === 'start' && !a.flow) d = { key: `focus:${a.subject.toLowerCase()}:${a.minutes}`, label: `Focus ${a.subject}`, step: { do: 'focus', subject: a.subject, minutes: a.minutes } }
  else if (a.kind === 'kitLink') {
    try {
      d = { key: `url:${a.url}`, label: new URL(a.url).hostname.replace(/^www\./, ''), step: { do: 'url', url: a.url } }
    } catch {
      d = null
    }
  } else if (a.kind === 'open' && a.page) d = { key: `page:${a.page}`, label: `Open ${a.page}`, step: { do: 'safe', act: { do: 'open', page: a.page as any } } }
  else if (a.kind === 'auto' && a.op === 'run') {
    const x = store.list.find((y) => y.id === a.id)
    if (x && x.steps.length === 1 && !x.params.length) d = { key: `auto:${x.id}`, label: x.name, step: x.steps[0] }
  }
  if (!d) return
  const h = [...get<DoneStep[]>(LS.done, []), { ...d, at: Date.now() }].slice(-80)
  put(LS.done, h)
  if (suggestion) return
  const r = findRepeat(h, store.dismissed, store.list)
  if (r) {
    suggestion = { key: r.key, auto: suggestedAutomation(r) }
    changed()
  }
}

// ---- the island ----

export function autoIslandView(): IslandAutoView | null {
  if (!life.automations || (!store.list.length && !runs.length && !pending)) return null
  return {
    paused: store.paused,
    buttons: islandButtons(store),
    runs: runs.map((r) => ({ ...r })),
    recent: recentRuns().slice(0, 5),
    confirm: pending ? { run: pending.run, id: pending.auto.id, name: pending.auto.name, text: pending.source === 'ben' ? 'Ben wants to run it' : pending.source === 'trigger' ? 'A trigger wants to run it' : 'Run it?', preview: pending.preview.slice(0, 6) } : null
  }
}

/** A yes waiting (a trigger, Ben, a script) or Ben's idea, as an island card. */
export function autoAlert(now: number, dismissed: Record<string, number>): IslandAlert | null {
  if (pending) {
    const id = `auto:${pending.run}`
    if ((dismissed[id] ?? 0) > now) return null
    return {
      id,
      kind: pending.source === 'ben' ? 'ben' : 'suggest',
      title: pending.source === 'ben' ? 'Ben wants to run' : 'Run this?',
      text: `${pending.auto.icon} ${pending.auto.name} · ${pending.preview[0]?.replace(/^1\. /, '') ?? ''}`.slice(0, 160),
      face: '⚡',
      actions: [
        { label: 'Run', primary: true, action: { kind: 'auto', op: 'confirm', run: pending.run, yes: true } },
        { label: 'No', action: { kind: 'auto', op: 'confirm', run: pending.run, yes: false } }
      ]
    }
  }
  if (suggestion) {
    const id = `autosug:${suggestion.key}`
    if ((dismissed[id] ?? 0) > now) return null
    return {
      id,
      kind: 'ben',
      title: 'Make this a button?',
      text: `You often do: ${suggestion.auto.name}. One tap could do all three (it starts switched off).`,
      face: '✨',
      actions: [
        { label: 'Make it', primary: true, action: { kind: 'auto', op: 'suggest', key: suggestion.key, yes: true } },
        { label: 'No thanks', action: { kind: 'auto', op: 'suggest', key: suggestion.key, yes: false } }
      ]
    }
  }
  return null
}

/** What the island asked (everything is checked again here). */
export async function autoAct(a: Extract<IslandAction, { kind: 'auto' }>): Promise<string | null> {
  await loadStore()
  const op = a as AutoIslandOp
  switch (op.op) {
    case 'run': {
      const x = store.list.find((y) => y.id === op.id)
      if (!x) throw new Error('That automation is gone')
      noteDone(a)
      return startRun(x, op.values ?? {}, op.rerun ? 'rerun' : 'tap')
    }
    case 'confirm': {
      if (!pending || pending.run !== op.run) throw new Error('That run is gone')
      const p = pending
      pending = null
      changed()
      if (!op.yes) {
        if (p.ask) await life.automations?.setAsk(p.ask, 'denied').catch(() => {})
        return 'Not run'
      }
      for (const pin of p.pins) await deskAuto('scriptPin', pin)
      return go(p.auto, p.values, p.source, p.vars, p.ask)
    }
    case 'dismiss': {
      const i = runs.findIndex((r) => r.run === op.run)
      if (i >= 0) runs.splice(i, 1)
      changed()
      return null
    }
    case 'endWs': {
      const r = await deskAuto('workspaceEnd', { id: op.id })
      return r?.text ?? 'Closed'
    }
    case 'suggest': {
      const s = suggestion
      suggestion = null
      if (!s || s.key !== op.key) return null
      if (op.yes) {
        await saveStore({ ...store, list: [...store.list, s.auto] })
        return '✨ Added to Settings → PC & automation (switched off: pin it to use it)'
      }
      await saveStore({ ...store, dismissed: [...store.dismissed, s.key] })
      return 'OK, Ben won’t offer that one again'
    }
    case 'ask':
      return null
  }
}

/** Settings → "Test now": run the chain for real from Settings, or just show what it would do. */
export const testLines = (a: Automation, values: Record<string, ParamValue>) => dryRun(a, values)

