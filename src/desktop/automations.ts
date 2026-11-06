// Automation hub, the desktop's part (one IPC channel, "auto"):
// - AH1 / AH6: webhooks and an n8n on THIS PC or your network (Vercel can't
//   reach them): the address and key are kept with Electron safeStorage
//   (Windows locks them to your account); pages see a name and the last 4.
// - AH2: the selected text (UI Automation first, then Ctrl+C with your
//   clipboard put back) and the clipboard, read only for a run that asks.
// - AH10 / AH13: your own scripts from ONE folder you chose, each pinned by its
//   SHA-256 (a changed file asks again), run as a program + an argument
//   array, 60 s at most, 4 KB of output. AutoHotkey, PowerToys and Espanso
//   are found if installed (never bundled).
// - AH12: a workspace: apps, https links, files and a folder in one tap;
//   "End workspace" closes only the apps it opened.
// - AH16: the sensors your automations use (Wi-Fi name, USB drives, battery,
//   charger, away/back, clipboard patterns, new files in a folder). Only the
//   ones in use run, each on a slow clock.
import { BrowserWindow, clipboard, dialog, ipcMain, powerMonitor, safeStorage, shell } from 'electron'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  argsProblem, capOutput, clipMatcher, execState, extOf, last4, localUrlProblem, n8nBase, n8nHookUrl, n8nWorkflows, pinKey, pinState, POWERTOYS_MODULE, previewCommand,
  readFlowAnswer, SCRIPT_EXT, SCRIPT_TIMEOUT_MS, scriptCommand, scriptProblem, SHA256, cleanWorkspace, type AutoEvent, type PowerToysFeature, type StepResult, type Workspace
} from '../core/automations'
import { parseWifiName } from '../core/islandKitExtras'
import { KNOWN_APPS, pcDenied } from '../core/pcActions'
import { runPcAct } from './pc/actions'
import { runPs } from './pc/ps'

type Watch = { wifi: boolean; usb: boolean; battery: boolean; power: boolean; idle: number[]; clipboard: string[]; folders: string[] }
interface LocalHook { label: string; preset: string; enc: string; at: number }
interface Saved { hooks: Record<string, LocalHook>; n8n: string | null; folder: string | null; pins: Record<string, string> }

const ID = /^[a-z0-9_-]{1,40}$/i
const win32 = process.platform === 'win32'
const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export async function registerAutomations(o: { dir: string; win: BrowserWindow; origin: string }) {
  const file = join(o.dir, 'auto-local.json')
  let saved: Saved = { hooks: {}, n8n: null, folder: null, pins: {} }
  try {
    const j = JSON.parse(await readFile(file, 'utf8'))
    saved = { hooks: j.hooks && typeof j.hooks === 'object' ? j.hooks : {}, n8n: typeof j.n8n === 'string' ? j.n8n : null, folder: typeof j.folder === 'string' ? j.folder : null, pins: j.pins && typeof j.pins === 'object' ? j.pins : {} }
  } catch {
    /* first run */
  }
  const save = () => writeFile(file, JSON.stringify(saved)).catch(() => {})
  const lock = (v: unknown) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("This PC can't lock secrets away (safe storage is not available)")
    return safeStorage.encryptString(JSON.stringify(v)).toString('base64')
  }
  const unlock = <T,>(enc: string | null): T | null => {
    if (!enc) return null
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(enc, 'base64'))) as T
    } catch {
      return null
    }
  }
  const view = () => {
    const n = unlock<{ base: string; key: string }>(saved.n8n)
    return {
      hooks: Object.entries(saved.hooks).map(([id, h]) => {
        const s = unlock<{ url: string; key: string }>(h.enc)
        return { id, label: h.label, preset: h.preset, hint: last4(s?.url ?? ''), host: hostOf(s?.url ?? ''), hasToken: !!s?.key, at: h.at }
      }),
      n8n: n ? { on: true, host: hostOf(n.base), keyHint: last4(n.key) } : { on: false, host: '', keyHint: '' },
      folder: saved.folder,
      windows: win32,
      safe: safeStorage.isEncryptionAvailable()
    }
  }
  const ours = (e: Electron.IpcMainInvokeEvent) => e.sender === o.win.webContents && e.senderFrame === e.sender.mainFrame && String(e.senderFrame?.url ?? '').startsWith(`${o.origin}/`)
  const emit = (ev: AutoEvent) => {
    if (!o.win.isDestroyed()) o.win.webContents.send('auto:event', ev)
  }

  // ---- local calls (AH1, AH6) ----
  const localFetch = async (url: string, init: RequestInit, ms = 15_000): Promise<Response> => {
    const bad = localUrlProblem(url)
    if (bad) throw new Error(bad)
    return fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(ms) })
  }
  const capped = async (res: Response, max: number) => (await res.text()).slice(0, max)
  const n8nLocal = async (path: string, method: 'GET' | 'POST' = 'GET') => {
    const n = unlock<{ base: string; key: string }>(saved.n8n)
    if (!n) throw new Error('Connect the n8n on this PC first')
    if (!/^\/api\/v1\/(workflows|executions)(\/[A-Za-z0-9_-]{1,40}(\/(activate|deactivate))?)?(\?[A-Za-z0-9_=&-]*)?$/.test(path)) throw new Error('Not an n8n call this can make')
    const res = await localFetch(`${n.base}${path}`, { method, headers: { 'X-N8N-API-KEY': n.key, Accept: 'application/json' } }, 10_000)
    if (res.status === 401 || res.status === 403) throw new Error('n8n refused the API key')
    if (!res.ok) throw new Error(`n8n answered ${res.status}`)
    return JSON.parse(await capped(res, 512 * 1024))
  }

  // ---- AH2: the selection and the clipboard ----
  const UIA = `Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$e=[System.Windows.Automation.AutomationElement]::FocusedElement
$p=$null
if($e -and $e.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern,[ref]$p)){$s=$p.GetSelection();if($s.Length -gt 0){$s[0].GetText(4000)}}`
  const selection = async (): Promise<string> => {
    if (!win32) return ''
    const viaUia = String((await runPs(UIA, { timeoutMs: 4000, lane: 'uia' })) ?? '').trim()
    if (viaUia) return viaUia.slice(0, 4000)
    // Fallback: Ctrl+C in the app in front, then your clipboard back as it was.
    const before = await clipboard.read().catch(() => [] as Electron.ClipboardItem[])
    await clipboard.writeText('')
    await runPs(`$w=New-Object -ComObject WScript.Shell; $w.SendKeys('^c')`, { timeoutMs: 3000 })
    await new Promise((r) => setTimeout(r, 250))
    const got = await clipboard.readText().catch(() => '')
    if (before.length) await clipboard.write(before).catch(() => {})
    return got.slice(0, 4000)
  }

  // ---- AH10 / AH13: scripts and installed tools ----
  const sha = async (f: string) => {
    const st = await stat(f)
    if (!st.isFile() || st.size > 5 * 1024 * 1024) throw new Error('Not a script file (or over 5 MB)')
    return createHash('sha256').update(await readFile(f)).digest('hex')
  }
  const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean) as string[]
  const find = (rel: string[]) => {
    for (const base of programFiles) for (const r of rel) if (existsSync(join(base, r))) return join(base, r)
    return null
  }
  const tools = () =>
    win32
      ? {
          ahk: find(['AutoHotkey\\v2\\AutoHotkey64.exe', 'AutoHotkey\\v2\\AutoHotkey.exe', 'AutoHotkey\\AutoHotkey64.exe', 'AutoHotkey\\AutoHotkey.exe']),
          powertoys: find(['PowerToys\\PowerToys.exe']),
          espanso: find(['Espanso\\espansod.exe', 'espanso\\espansod.exe'])
        }
      : { ahk: null, powertoys: null, espanso: null }
  const run = (exe: string, args: string[], cwd?: string) =>
    new Promise<{ ok: boolean; out: string; why?: string }>((resolve) => {
      execFile(exe, args, { windowsHide: true, timeout: SCRIPT_TIMEOUT_MS, maxBuffer: 1024 * 1024, cwd, shell: false }, (err, stdout, stderr) => {
        const out = capOutput(`${String(stdout ?? '')}${stderr ? `\n${String(stderr)}` : ''}`)
        if (!err) return resolve({ ok: true, out })
        const killed = (err as any).killed || (err as any).signal === 'SIGTERM'
        resolve({ ok: false, out, why: killed ? 'Stopped after 60 s' : `It ended with code ${(err as any).code ?? '?'}` })
      })
    })
  /** The checks for a script or .ahk run: the folder, the type, the arguments, the pin. */
  const scriptCheck = async (f: string, args: string[], exts: string[]) => {
    const p = scriptProblem(f, saved.folder, exts) ?? argsProblem(extOf(f), args)
    if (p) return { problem: p }
    if (!existsSync(f)) return { problem: 'That file is not there any more' }
    const hash = await sha(f)
    const cmd = scriptCommand(f, args, { ahkExe: tools().ahk ?? undefined })
    return { hash, cmd, preview: previewCommand(cmd), pin: pinState(saved.pins, f, hash) }
  }

  // ---- AH12: workspaces ----
  const opened = new Map<string, number[]>()
  const procs = async (): Promise<{ Id: number; ProcessName: string }[]> => {
    const out = await runPs('Get-Process | Select-Object Id,ProcessName | ConvertTo-Json -Compress', { timeoutMs: 8000, lane: 'procs' })
    try {
      const j = JSON.parse(String(out ?? '[]'))
      return Array.isArray(j) ? j : []
    } catch {
      return []
    }
  }
  const startApp = (name: string) =>
    new Promise<boolean>((resolve) => {
      const k = KNOWN_APPS[norm(name)]
      if (k?.uri) return void shell.openExternal(k.uri).then(() => resolve(true), () => resolve(false))
      const n = k?.exe ?? name
      if (!win32 || !/^[\p{L}\p{N} ._+-]{1,40}$/u.test(n)) return resolve(false)
      execFile('cmd.exe', ['/d', '/c', 'start', '""', n], { windowsHide: true, timeout: 8000 }, (err) => resolve(!err))
    })
  const openWorkspace = async (id: string, ws: Workspace) => {
    const before = new Set((win32 ? await procs() : []).map((p) => p.Id))
    const done: string[] = []
    const failed: string[] = []
    for (const a of ws.apps) {
      if (pcDenied({ kind: 'open', arg: a })) continue
      ;((await startApp(a)) ? done : failed).push(a)
    }
    for (const l of ws.links) if (!pcDenied({ kind: 'url', arg: l })) await shell.openExternal(new URL(l).toString()).then(() => done.push(new URL(l).hostname), () => failed.push(l))
    for (const f of ws.files) if (!pcDenied({ kind: 'file', arg: f }) && existsSync(f)) ((await shell.openPath(f)) ? failed : done).push(f.split(/[\\/]/).pop() ?? f)
    if (ws.folder && existsSync(ws.folder)) ((await shell.openPath(ws.folder)) ? failed : done).push('the folder')
    // The apps it opened (new processes with a matching name), so "End workspace" closes only those.
    if (win32 && ws.apps.length) {
      setTimeout(() => {
        void procs().then((after) => {
          const words = ws.apps.map((a) => (KNOWN_APPS[norm(a)]?.exe ?? a).toLowerCase().replace(/\.exe$/, '').split(/\s+/)[0])
          opened.set(id, after.filter((p) => !before.has(p.Id) && words.some((w) => w && p.ProcessName.toLowerCase().includes(w))).map((p) => p.Id).slice(0, 30))
        })
      }, 5000)
    }
    return { ok: failed.length === 0 || done.length > 0, text: `Opened ${done.length}${failed.length ? ` · could not open ${failed.join(', ')}` : ''}`, why: done.length ? undefined : 'Nothing could be opened' }
  }
  const endWorkspace = async (id: string) => {
    const pids = opened.get(id) ?? []
    opened.delete(id)
    if (!pids.length) return { ok: true, text: 'Nothing to close (it opened no apps here)' }
    await runPs(`foreach($i in @(${pids.map(Number).filter(Number.isInteger).join(',')})){ $p=Get-Process -Id $i -ErrorAction SilentlyContinue; if($p){ [void]$p.CloseMainWindow() } }`, { timeoutMs: 8000 })
    return { ok: true, text: `Asked ${pids.length} app${pids.length > 1 ? 's' : ''} to close` }
  }

  // ---- AH16: sensors (only those in use) ----
  let watching: Watch = { wifi: false, usb: false, battery: false, power: false, idle: [], clipboard: [], folders: [] }
  const timers: NodeJS.Timeout[] = []
  const watchers: FSWatcher[] = []
  let powerOn = false
  const stopAll = () => {
    for (const t of timers.splice(0)) clearInterval(t)
    for (const w of watchers.splice(0)) w.close()
  }
  const every = (ms: number, fn: () => void) => {
    timers.push(setInterval(fn, ms))
    fn()
  }
  const onAc = () => watching.power && emit({ t: 'power', at: Date.now(), plugged: true })
  const onBattery = () => watching.power && emit({ t: 'power', at: Date.now(), plugged: false })
  const startWatch = (w: Watch) => {
    stopAll()
    watching = w
    if (w.power && !powerOn) {
      powerOn = true
      powerMonitor.on('on-ac', onAc)
      powerMonitor.on('on-battery', onBattery)
    }
    if (w.wifi && win32) {
      let prev: string | null | undefined
      every(60_000, () =>
        execFile('netsh', ['wlan', 'show', 'interfaces'], { windowsHide: true, timeout: 5000 }, (err, out) => {
          const name = err ? null : parseWifiName(String(out))
          if (prev !== undefined && name !== prev) emit({ t: 'wifi', at: Date.now(), name, prev })
          prev = name
        })
      )
    }
    if (w.usb && win32) {
      let known: Set<string> | null = null
      every(20_000, () =>
        void runPs('Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2" | ForEach-Object { $_.DeviceID }', { timeoutMs: 6000, lane: 'usb' }).then((out) => {
          if (out == null) return
          const now = new Set(String(out).split(/\s+/).filter((d) => /^[A-Z]:$/.test(d)))
          if (known) for (const d of now) if (!known.has(d)) emit({ t: 'usb', at: Date.now(), drive: d })
          known = now
        })
      )
    }
    if (w.battery && win32) {
      let prev: number | null = null
      every(120_000, () =>
        void runPs('(Get-CimInstance Win32_Battery | Select-Object -First 1).EstimatedChargeRemaining', { timeoutMs: 6000, lane: 'battery' }).then((out) => {
          const pct = Number(String(out ?? '').trim())
          if (!String(out ?? '').trim() || !Number.isFinite(pct)) return
          emit({ t: 'battery', at: Date.now(), pct, prev })
          prev = pct
        })
      )
    }
    if (w.idle.length) {
      const told = new Set<number>()
      let away = false
      every(30_000, () => {
        const sec = powerMonitor.getSystemIdleTime()
        for (const m of w.idle)
          if (sec >= m * 60 && !told.has(m)) {
            told.add(m)
            away = true
            emit({ t: 'idle', at: Date.now(), minutes: m })
          }
        if (away && sec < 60) {
          away = false
          told.clear()
          emit({ t: 'back', at: Date.now() })
        }
      })
    }
    if (w.clipboard.length) {
      const tests = w.clipboard.map(clipMatcher).filter((f): f is (t: string) => boolean => !!f)
      let last: string | null = null
      every(2000, () => void clipboard.readText().then((t) => {
        if (last === null) return void (last = t)
        if (t === last) return
        last = t
        // Only text that matches one of your patterns leaves this process.
        if (t && t.length <= 20_000 && tests.some((f) => f(t))) emit({ t: 'clip', at: Date.now(), text: t.slice(0, 2000) })
      }, () => {}))
    }
    for (const folder of w.folders) {
      if (!existsSync(folder)) continue
      const seen = new Map<string, number>()
      try {
        watchers.push(
          watch(folder, { persistent: false }, (kind, name) => {
            if (kind !== 'rename' || !name) return
            const n = String(name)
            if (Date.now() - (seen.get(n) ?? 0) < 5000) return
            seen.set(n, Date.now())
            if (seen.size > 200) seen.clear()
            setTimeout(() => void stat(join(folder, n)).then((s) => s.isFile() && emit({ t: 'file', at: Date.now(), folder, name: n }), () => {}), 1000)
          })
        )
      } catch {
        /* a folder that can't be watched */
      }
    }
  }
  o.win.on('closed', stopAll)

  ipcMain.handle('auto', async (e, op: string, arg?: any): Promise<any> => {
    if (!ours(e)) return null
    try {
      switch (op) {
        case 'view':
          return { ...view(), tools: tools() }
        // ---- local webhooks and n8n ----
        case 'hookSet': {
          const url = String(arg?.url ?? '').trim()
          const id = ID.test(String(arg?.id ?? '')) ? String(arg.id) : `l${Math.random().toString(36).slice(2, 10)}`
          const was = unlock<{ url: string; key: string }>(saved.hooks[id]?.enc ?? null)
          if (!url && !was) throw new Error('Paste the address')
          if (url) {
            const bad = localUrlProblem(url)
            if (bad) throw new Error(bad)
          }
          saved.hooks[id] = { label: String(arg?.label ?? '').slice(0, 40), preset: String(arg?.preset ?? 'n8n').slice(0, 20), enc: lock({ url: url || was!.url, key: arg?.key == null ? was?.key ?? '' : String(arg.key).slice(0, 2000) }), at: Date.now() }
          await save()
          return { ...view(), id }
        }
        case 'hookRemove':
          delete saved.hooks[String(arg?.id)]
          await save()
          return view()
        case 'run': {
          const h = saved.hooks[String(arg?.hook)]
          const s = unlock<{ url: string; key: string }>(h?.enc ?? null)
          if (!s) return { ok: false, why: 'That webhook is not saved on this PC' } satisfies StepResult
          const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/plain;q=0.9' }
          if (s.key) headers.Authorization = /^\w+\s/.test(s.key) ? s.key : `Bearer ${s.key}`
          try {
            const res = await localFetch(s.url, { method: 'POST', headers, body: JSON.stringify(arg?.body ?? {}) })
            if (res.status >= 300 && res.status < 400) return { ok: false, why: 'The flow tried to send it elsewhere (redirects are not followed)' }
            return readFlowAnswer(res.status, res.headers.get('content-type') ?? '', await capped(res, 64 * 1024))
          } catch (err) {
            const m = String((err as Error)?.message ?? 'failed')
            return { ok: false, why: /abort|timeout/i.test(m) ? 'The flow took longer than 15 s' : /fetch failed|ECONNREFUSED/i.test(m) ? 'Nothing answered at that address (is it running?)' : m.slice(0, 120) }
          }
        }
        case 'n8nSet': {
          if (arg?.off) {
            saved.n8n = null
            await save()
            return view()
          }
          const base = n8nBase(String(arg?.base ?? ''))
          const bad = localUrlProblem(base)
          if (bad) throw new Error(bad)
          const key = String(arg?.key ?? '').trim() || unlock<{ key: string }>(saved.n8n)?.key || ''
          if (!key) throw new Error('Paste an n8n API key (n8n → Settings → n8n API)')
          const prev = saved.n8n
          saved.n8n = lock({ base, key })
          try {
            const workflows = n8nWorkflows(await n8nLocal('/api/v1/workflows?limit=100'))
            await save()
            return { ...view(), workflows }
          } catch (err) {
            saved.n8n = prev
            throw err
          }
        }
        case 'n8nList':
          return { ...view(), workflows: n8nWorkflows(await n8nLocal('/api/v1/workflows?limit=100')) }
        case 'n8nActivate': {
          const id = String(arg?.id ?? '')
          if (!ID.test(id)) throw new Error('No such workflow')
          await n8nLocal(`/api/v1/workflows/${id}/${arg?.on ? 'activate' : 'deactivate'}`, 'POST')
          return { ...view(), workflows: n8nWorkflows(await n8nLocal('/api/v1/workflows?limit=100')) }
        }
        case 'n8nUse': {
          const n = unlock<{ base: string; key: string }>(saved.n8n)
          if (!n) throw new Error('Connect the n8n on this PC first')
          const path = String(arg?.path ?? '').replace(/^\/+/, '')
          if (!path || path.length > 200 || /\.\.|[?#\s]/.test(path)) throw new Error('That workflow has no usable Webhook node')
          const id = `l${Math.random().toString(36).slice(2, 10)}`
          saved.hooks[id] = { label: String(arg?.label ?? '').slice(0, 40), preset: 'n8n', enc: lock({ url: n8nHookUrl(n.base, path), key: '' }), at: Date.now() }
          await save()
          return { ...view(), id }
        }
        case 'n8nExec': {
          const id = String(arg?.exec ?? '')
          if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error('No such run')
          return { state: execState(await n8nLocal(`/api/v1/executions/${id}`)) }
        }
        // ---- AH2 ----
        case 'selection':
          return { text: await selection() }
        case 'clipboard':
          return { text: (await clipboard.readText().catch(() => '')).slice(0, 4000) }
        case 'type': {
          const r = await runPcAct({ kind: 'type', arg: String(arg?.text ?? '').slice(0, 300) })
          return r.ok ? { ok: true, text: 'Typed' } : { ok: false, why: r.why }
        }
        // ---- AH10 / AH13 ----
        case 'scriptsFolder': {
          const r = await dialog.showOpenDialog(o.win, { title: 'Your scripts folder', properties: ['openDirectory'] })
          if (r.canceled || !r.filePaths[0]) return view()
          if (saved.folder !== r.filePaths[0]) saved.pins = {}
          saved.folder = r.filePaths[0]
          await save()
          return view()
        }
        case 'scripts': {
          if (!saved.folder || !existsSync(saved.folder)) return { folder: saved.folder, files: [] }
          const names = (await readdir(saved.folder)).filter((n) => [...SCRIPT_EXT, '.ahk'].includes(extOf(n))).slice(0, 60)
          const files = []
          for (const n of names) {
            const f = join(saved.folder, n)
            const h = await sha(f).catch(() => null)
            if (h) files.push({ file: f, name: n, ext: extOf(n), pin: pinState(saved.pins, f, h) })
          }
          return { folder: saved.folder, files }
        }
        case 'scriptPreview': {
          const f = String(arg?.file ?? '')
          const args = Array.isArray(arg?.args) ? arg.args.map(String) : []
          return await scriptCheck(f, args, extOf(f) === '.ahk' ? ['.ahk'] : SCRIPT_EXT)
        }
        case 'scriptPin': {
          // Only the exact file you saw in the preview (its SHA-256) is allowed.
          const f = String(arg?.file ?? '')
          const want = String(arg?.sha ?? '').toLowerCase()
          if (!SHA256.test(want)) throw new Error('No preview seen')
          const c = await scriptCheck(f, [], extOf(f) === '.ahk' ? ['.ahk'] : SCRIPT_EXT)
          if ('problem' in c) throw new Error(c.problem)
          if (c.hash !== want) throw new Error('The file changed since the preview: look again')
          saved.pins[pinKey(f)] = want
          await save()
          return { ok: true }
        }
        case 'scriptUnpin':
          delete saved.pins[pinKey(String(arg?.file ?? ''))]
          await save()
          return { ok: true }
        case 'scriptRun': {
          if (!win32) return { ok: false, why: 'Scripts run on Windows only' }
          const f = String(arg?.file ?? '')
          const ahk = extOf(f) === '.ahk'
          if (ahk && !tools().ahk) return { ok: false, why: 'AutoHotkey is not installed' }
          const args = Array.isArray(arg?.args) ? arg.args.map(String) : []
          const c = await scriptCheck(f, args, ahk ? ['.ahk'] : SCRIPT_EXT)
          if ('problem' in c) return { ok: false, why: c.problem }
          if (c.pin !== 'pinned') return { ok: false, why: c.pin === 'changed' ? 'The file changed: look at it again and allow it' : 'Allow this script first (see the preview)', needsPin: true, preview: c.preview, sha: c.hash }
          const r = await run(c.cmd.exe, c.cmd.args, saved.folder ?? undefined)
          return { ok: r.ok, text: r.out || (r.ok ? 'Done (no output)' : ''), why: r.why }
        }
        case 'powertoys': {
          const exe = tools().powertoys
          if (!exe) return { ok: false, why: 'PowerToys is not installed' }
          const mod = POWERTOYS_MODULE[String(arg?.feature) as PowerToysFeature]
          if (!mod) return { ok: false, why: 'Not a PowerToys feature this knows' }
          execFile(exe, [`--open-settings=${mod}`], { windowsHide: true, timeout: 8000 }, () => {})
          return { ok: true, text: 'Opened in PowerToys' }
        }
        case 'espanso': {
          const exe = tools().espanso
          if (!exe) return { ok: false, why: 'Espanso is not installed' }
          const r = await run(exe, ['cmd', arg?.cmd === 'toggle' ? 'toggle' : 'search'])
          return r.ok ? { ok: true, text: 'Done' } : { ok: false, why: r.why }
        }
        // ---- AH12 ----
        case 'workspace': {
          const ws = cleanWorkspace(arg?.ws)
          if (!ws) return { ok: false, why: 'An empty workspace' }
          return await openWorkspace(String(arg?.id ?? 'ws').slice(0, 40), ws)
        }
        case 'workspaceEnd':
          return await endWorkspace(String(arg?.id ?? 'ws').slice(0, 40))
        // ---- AH16 ----
        case 'watch': {
          const w = arg && typeof arg === 'object' ? arg : {}
          startWatch({ wifi: !!w.wifi, usb: !!w.usb, battery: !!w.battery, power: !!w.power, idle: (Array.isArray(w.idle) ? w.idle : []).map(Number).filter((n: number) => n >= 1 && n <= 240).slice(0, 5), clipboard: (Array.isArray(w.clipboard) ? w.clipboard : []).map(String).slice(0, 10), folders: (Array.isArray(w.folders) ? w.folders : []).map(String).filter((f: string) => /^([a-z]:\\|\\\\|\/)/i.test(f)).slice(0, 5) })
          return { ok: true }
        }
        default:
          return null
      }
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message ?? err).slice(0, 160) }
    }
  })
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname
  } catch {
    return ''
  }
}
