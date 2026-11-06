// Automation hub (AH1–AH22): ONE record for everything you can run with a tap,
// a trigger, or by asking Ben. "When X" (triggers, the recipes' half) and
// "Do Y" (steps: a webhook to n8n / Make / Pipedream / Activepieces /
// Node-RED, a safe recipe action, a Telegram or ntfy message, a task, a note,
// a link, a typed snippet, a focus timer, a music station, your own script,
// a workspace, AutoHotkey / PowerToys / Espanso).
//
// The list lives in the synced setting `automations`, WITHOUT any address or
// key: a webhook step only names its secret (`hook`). Cloud addresses and
// tokens stay on the server (sys_kv auto:flows), local / LAN ones in the
// desktop app (Electron safeStorage). Pages only ever see a name and the last
// 4 characters.
//
// Pure and tested (automations.test.ts): cleaning, params, risk and confirm
// rules, templates and chains, the loop guard, trigger matching, n8n's
// answers, scripts and their SHA-256 pins, the run log (secrets removed),
// Ben's tools and Ben's suggestions.
import type { ContextKind } from './activityContext'
import { CONTEXT_KINDS, CONTEXT_LABEL } from './activityContext'
import { privateIp } from './netGuard'
import { pcDenied } from './pcActions'
import { cleanAction, SAFE_LABEL, type Recipe, type SafeAction } from './recipes'

// ---------------------------------------------------------------- basics

const clip = (s: unknown, n: number) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n)
const clipML = (s: unknown, n: number) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f]+/g, ' ').slice(0, n)
const int = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}
const ID = /^[a-z0-9_-]{1,40}$/i
const HM = /^([01]\d|2[0-3]):[0-5]\d$/
export const newAutoId = (now = Date.now()) => `a${now.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`

export const AUTOMATIONS_MAX = 40
export const STEPS_MAX = 5
export const PARAMS_MAX = 4
/** The mini-form on the island asks at most this many things. */
export const FORM_MAX = 3
export const TRIGGERS_MAX = 3
/** AH16: the same automation starts from a trigger at most once in this time. */
export const LOOP_GUARD_MS = 30_000
export const RECENT_MAX = 20
export const LOG_MAX = 100
export const SCRIPT_TIMEOUT_MS = 60_000
export const OUTPUT_MAX = 4096
export const ANSWER_TEXT_MAX = 2000

// ---------------------------------------------------------------- presets (AH9)

export type PresetId = 'n8n' | 'make' | 'pipedream' | 'activepieces' | 'nodered' | 'zapier' | 'custom'
export const PRESET_IDS: PresetId[] = ['n8n', 'make', 'pipedream', 'activepieces', 'nodered', 'zapier', 'custom']
export interface Preset {
  label: string
  /** Where to find the address, in plain words. */
  how: string
  example: string
  /** The usual host for this service (a gentle warning when it doesn't match). */
  host?: RegExp
  /** Often runs on your own PC or network (the desktop app calls it). */
  local?: boolean
  /** The free plan can't take webhooks. */
  paid?: boolean
  /** Can answer with {text, url, image, ok} (a "Respond to Webhook" step). */
  answers: boolean
}
export const PRESETS: Record<PresetId, Preset> = {
  n8n: { label: 'n8n', how: 'Add a Webhook node, copy its Production URL, and switch the workflow on. A "Respond to Webhook" node can send back {text, url, image, ok}.', example: 'https://n8n.example.com/webhook/report', local: true, answers: true },
  make: { label: 'Make', how: 'Start a scenario with Webhooks → Custom webhook and copy its address. A Webhook response module can answer.', example: 'https://hook.eu1.make.com/abc123', host: /^hook\.[a-z0-9]+\.make\.com$/, answers: true },
  pipedream: { label: 'Pipedream', how: 'Start a workflow with an HTTP / Webhook trigger and copy its endpoint. "Return HTTP response" can answer.', example: 'https://eo1abc.m.pipedream.net', host: /\.m\.pipedream\.net$/, answers: true },
  activepieces: { label: 'Activepieces', how: 'Start a flow with the Webhook trigger and copy its URL (add /sync to wait for an answer).', example: 'https://cloud.activepieces.com/api/v1/webhooks/abc123', host: /(^|\.)activepieces\.com$/, answers: true },
  nodered: { label: 'Node-RED', how: 'Use an "http in" node (POST) wired to an "http response" node. Usually on your own PC or network.', example: 'http://192.168.1.20:1880/life', local: true, answers: true },
  zapier: { label: 'Zapier', how: 'Webhooks by Zapier needs a paid Zapier plan. Use "Catch Hook" and copy its address.', example: 'https://hooks.zapier.com/hooks/catch/123/abc', host: /^hooks\.zapier\.com$/, paid: true, answers: false },
  custom: { label: 'Other webhook', how: 'Any address that takes a JSON POST.', example: 'https://example.com/hook', answers: true }
}

/** A soft warning when the address doesn't look like the service you picked (never blocks). */
export function presetWarning(preset: PresetId, url: string): string | null {
  const p = PRESETS[preset]
  if (!p) return null
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  if (p.host && !p.host.test(host)) return `That doesn't look like a ${p.label} address (like ${new URL(p.example).hostname})`
  return null
}

/**
 * AH1: an address only the desktop app may call (your PC or your network):
 * http(s) to localhost, a private address, or a local name. A public address
 * belongs in the cloud list instead; link-local / metadata addresses never.
 */
export function localUrlProblem(raw: string): string | null {
  let u: URL
  try {
    u = new URL(String(raw ?? '').trim())
  } catch {
    return 'Not a web address'
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http:// or https:// addresses'
  if (u.username || u.password) return 'No user name or password in the address'
  if (String(raw).length > 500) return 'Address too long'
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return 'No host'
  const v4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
  if (v4 || host.includes(':')) {
    if (/^169\.254\./.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return 'Not a link-local address'
    if (/^(22[4-9]|23\d|24\d|25[0-5])\./.test(host) || /^ff/i.test(host)) return 'Not a multicast address'
    if (host === '0.0.0.0' || host === '::') return 'Not a real address'
    return privateIp(host) ? null : 'That is a public address: add it as a cloud webhook'
  }
  if (host === 'localhost' || !host.includes('.') || /\.(local|lan|home|internal|localdomain|home\.arpa)$/.test(host)) {
    if (/^metadata\b/.test(host)) return 'Not that address'
    return null
  }
  return 'That is a public address: add it as a cloud webhook'
}

/** "…ab12": the last 4 characters (what pages see of a saved address or key). */
export const last4 = (s: string) => (s ? `…${String(s).replace(/\/+$/, '').slice(-4)}` : '')

// ---------------------------------------------------------------- params (AH2)

export type ParamType = 'text' | 'number' | 'choice' | 'bool' | 'selection' | 'clipboard'
export const PARAM_TYPES: ParamType[] = ['text', 'number', 'choice', 'bool', 'selection', 'clipboard']
export const PARAM_LABEL: Record<ParamType, string> = { text: 'Text', number: 'Number', choice: 'Choice', bool: 'Yes / no', selection: 'Selected text', clipboard: 'Clipboard' }
export type ParamValue = string | number | boolean
export interface Param {
  key: string
  label: string
  type: ParamType
  choices?: string[]
  def?: ParamValue
  required?: boolean
  min?: number
  max?: number
}
/** Read from the PC (never asked in the form). */
export const isAutoParam = (p: Param) => p.type === 'selection' || p.type === 'clipboard'

const KEY = /^[a-z][a-z0-9_]{0,23}$/
export function cleanParam(p: any, i = 0): Param | null {
  if (!p || !PARAM_TYPES.includes(p.type)) return null
  const key = KEY.test(String(p.key ?? '')) ? String(p.key) : `p${i + 1}`
  const out: Param = { key, label: clip(p.label, 40) || key, type: p.type }
  if (p.required === true) out.required = true
  if (p.type === 'choice') {
    const choices = [...new Set<string>((Array.isArray(p.choices) ? p.choices : []).map((c: unknown) => clip(c, 40)).filter(Boolean))].slice(0, 8)
    if (!choices.length) return null
    out.choices = choices
    if (choices.includes(String(p.def))) out.def = String(p.def)
  } else if (p.type === 'number') {
    if (Number.isFinite(Number(p.min))) out.min = Number(p.min)
    if (Number.isFinite(Number(p.max))) out.max = Number(p.max)
    if (p.def !== undefined && p.def !== '' && Number.isFinite(Number(p.def))) out.def = Number(p.def)
  } else if (p.type === 'bool') {
    if (typeof p.def === 'boolean') out.def = p.def
  } else if (p.type === 'text' && typeof p.def === 'string' && p.def) out.def = clip(p.def, 200)
  return out
}

/** One value as its param wants it, or undefined when it can't be one. */
export function paramValue(p: Param, raw: unknown): ParamValue | undefined {
  if (raw === undefined || raw === null) return undefined
  switch (p.type) {
    case 'number': {
      if (raw === '' || typeof raw === 'boolean') return undefined
      let n = Number(raw)
      if (!Number.isFinite(n)) return undefined
      if (p.min !== undefined) n = Math.max(p.min, n)
      if (p.max !== undefined) n = Math.min(p.max, n)
      return n
    }
    case 'bool':
      if (typeof raw === 'boolean') return raw
      if (/^(true|yes|on|1)$/i.test(String(raw))) return true
      if (/^(false|no|off|0)$/i.test(String(raw))) return false
      return undefined
    case 'choice': {
      const s = String(raw)
      return p.choices?.find((c) => c === s) ?? p.choices?.find((c) => c.toLowerCase() === s.toLowerCase())
    }
    case 'selection':
    case 'clipboard': {
      const s = clipML(raw, 4000).trim()
      return s || undefined
    }
    default: {
      const s = clip(raw, 500)
      return s || undefined
    }
  }
}

/**
 * AH2: what you typed (or Ben gave) → the values for a run: each param from
 * the input, else what you used last time, else its default. Required ones
 * still missing are named.
 */
export function mapParams(params: Param[], input: Record<string, unknown> = {}, remembered: Record<string, unknown> = {}): { values: Record<string, ParamValue>; missing: string[] } {
  const values: Record<string, ParamValue> = {}
  const missing: string[] = []
  for (const p of params) {
    const v = paramValue(p, input[p.key]) ?? (isAutoParam(p) ? undefined : paramValue(p, remembered[p.key])) ?? p.def
    if (v !== undefined) values[p.key] = v
    else if (p.required || isAutoParam(p)) missing.push(p.key)
  }
  return { values, missing }
}

/** The island's mini-form: the asked params (not selection/clipboard), at most 3. */
export const formFields = (a: Pick<Automation, 'params'>) => a.params.filter((p) => !isAutoParam(p)).slice(0, FORM_MAX)
/** Which things the PC must read before the run. */
export const pcReads = (a: Pick<Automation, 'params'>) => ({ selection: a.params.some((p) => p.type === 'selection'), clipboard: a.params.some((p) => p.type === 'clipboard') })

// ---------------------------------------------------------------- steps

export interface Workspace {
  apps: string[]
  links: string[]
  files: string[]
  folder?: string
  focus?: { subject: string; minutes: number }
}
export type Step =
  | { do: 'webhook'; hook: string; where: 'cloud' | 'local'; preset: PresetId; /** AH6: follow the n8n run until it ends. */ wait?: boolean }
  | { do: 'safe'; act: SafeAction }
  | { do: 'telegram'; text: string }
  | { do: 'ntfy'; text: string }
  | { do: 'todoist'; text: string }
  | { do: 'note'; text: string; title?: string }
  | { do: 'url'; url: string }
  | { do: 'type'; text: string }
  | { do: 'focus'; subject: string; minutes: number }
  | { do: 'music'; station: string }
  | { do: 'script'; file: string; args: string[] }
  | { do: 'workspace'; ws: Workspace }
  | { do: 'ahk'; file: string; args: string[] }
  | { do: 'powertoys'; feature: PowerToysFeature }
  | { do: 'espanso'; cmd: 'search' | 'toggle' }
export type StepKind = Step['do']
export const STEP_KINDS: StepKind[] = ['webhook', 'safe', 'telegram', 'ntfy', 'todoist', 'note', 'url', 'type', 'focus', 'music', 'script', 'workspace', 'ahk', 'powertoys', 'espanso']
export const STEP_LABEL: Record<StepKind, string> = {
  webhook: 'Run a flow (n8n, Make…)',
  safe: 'A recipe action',
  telegram: 'Send me a Telegram',
  ntfy: 'Push to my phone (ntfy)',
  todoist: 'Add a Todoist task',
  note: 'Add a note',
  url: 'Open a link',
  type: 'Type a snippet',
  focus: 'Start focus',
  music: 'Play a music station',
  script: 'Run my script',
  workspace: 'Open my workspace',
  ahk: 'Run an AutoHotkey script',
  powertoys: 'Open a PowerToys feature',
  espanso: 'Espanso'
}
export const STEP_ICON: Record<StepKind, string> = { webhook: '⚡', safe: '✨', telegram: '✈️', ntfy: '📲', todoist: '✅', note: '📝', url: '🔗', type: '⌨️', focus: '⏱', music: '🎵', script: '📜', workspace: '🗂', ahk: '🅰', powertoys: '🧰', espanso: '✍️' }
/** Steps only the desktop app can do. */
export const DESKTOP_STEPS: StepKind[] = ['type', 'script', 'workspace', 'ahk', 'powertoys', 'espanso']

export const POWERTOYS_FEATURES = {
  run: 'PowerToys Run',
  colorPicker: 'Color Picker',
  fancyZones: 'FancyZones',
  textExtractor: 'Text Extractor',
  alwaysOnTop: 'Always On Top',
  screenRuler: 'Screen Ruler',
  peek: 'Peek',
  awake: 'Awake'
} as const
export type PowerToysFeature = keyof typeof POWERTOYS_FEATURES
/** PowerToys' own settings page names (PowerToys.exe --open-settings=<name>). */
export const POWERTOYS_MODULE: Record<PowerToysFeature, string> = { run: 'PowerLauncher', colorPicker: 'ColorPicker', fancyZones: 'FancyZones', textExtractor: 'PowerOCR', alwaysOnTop: 'AlwaysOnTop', screenRuler: 'MeasureTool', peek: 'Peek', awake: 'Awake' }

/** Template text (may hold {{…}}): one line, capped. */
const tpl = (s: unknown, n: number) => clip(s, n)
const pathOk = (p: string) => /^([a-z]:\\|\\\\)/i.test(p) || p.startsWith('/')

export function cleanArgs(v: unknown): string[] {
  return (Array.isArray(v) ? v : [])
    .map((a) => String(a ?? '').replace(/[\u0000\r\n]+/g, ' ').slice(0, 200))
    .filter((a) => a.length > 0)
    .slice(0, 8)
}

export function cleanWorkspace(w: any): Workspace | null {
  if (!w || typeof w !== 'object') return null
  const apps = [...new Set<string>((Array.isArray(w.apps) ? w.apps : []).map((a: unknown) => clip(a, 40)).filter((a: string) => a && !pcDenied({ kind: 'open', arg: a })))].slice(0, 8)
  const links = [...new Set<string>((Array.isArray(w.links) ? w.links : []).map((a: unknown) => clip(a, 500)).filter((a: string) => a && !pcDenied({ kind: 'url', arg: a })))].slice(0, 8)
  const files = [...new Set<string>((Array.isArray(w.files) ? w.files : []).map((a: unknown) => clip(a, 300)).filter((a: string) => a && !pcDenied({ kind: 'file', arg: a })))].slice(0, 8)
  const folder = clip(w.folder, 300)
  const out: Workspace = { apps, links, files }
  if (folder && pathOk(folder) && !/\.\.[\\/]/.test(folder)) out.folder = folder
  if (w.focus && typeof w.focus === 'object') out.focus = { subject: clip(w.focus.subject, 60) || 'Focus', minutes: int(w.focus.minutes, 5, 180, 25) }
  return apps.length || links.length || files.length || out.folder ? out : null
}

export function cleanStep(s: any): Step | null {
  switch (s?.do) {
    case 'webhook': {
      const hook = String(s.hook ?? '')
      if (!ID.test(hook)) return null
      const preset: PresetId = PRESET_IDS.includes(s.preset) ? s.preset : 'custom'
      return { do: 'webhook', hook, where: s.where === 'local' ? 'local' : 'cloud', preset, ...(s.wait === true ? { wait: true } : {}) }
    }
    case 'safe': {
      const act = cleanAction(s.act)
      return act ? { do: 'safe', act } : null
    }
    case 'telegram':
    case 'ntfy':
    case 'todoist':
    case 'type': {
      const text = tpl(s.text, s.do === 'type' ? 300 : 500)
      return text ? { do: s.do, text } : null
    }
    case 'note': {
      const text = tpl(s.text, 500)
      const title = clip(s.title, 60)
      return text ? { do: 'note', text, ...(title ? { title } : {}) } : null
    }
    case 'url': {
      const url = tpl(s.url, 500)
      // A template ({{result.url}}) is checked when it runs; a fixed link now.
      if (!url || (!url.includes('{{') && pcDenied({ kind: 'url', arg: url }))) return null
      return { do: 'url', url }
    }
    case 'focus':
      return { do: 'focus', subject: tpl(s.subject, 60) || 'Focus', minutes: int(s.minutes, 5, 180, 25) }
    case 'music': {
      const station = clip(s.station, 60)
      return station ? { do: 'music', station } : null
    }
    case 'script':
    case 'ahk': {
      const file = clip(s.file, 300)
      if (!file || !pathOk(file)) return null
      const ext = extOf(file)
      if (s.do === 'script' ? !SCRIPT_EXT.includes(ext) : ext !== '.ahk') return null
      return { do: s.do, file, args: cleanArgs(s.args) }
    }
    case 'workspace': {
      const ws = cleanWorkspace(s.ws)
      return ws ? { do: 'workspace', ws } : null
    }
    case 'powertoys':
      return s.feature in POWERTOYS_FEATURES ? { do: 'powertoys', feature: s.feature } : null
    case 'espanso':
      return { do: 'espanso', cmd: s.cmd === 'toggle' ? 'toggle' : 'search' }
    default:
      return null
  }
}

// ---------------------------------------------------------------- triggers (AH16)

export type Trigger =
  | { on: 'time'; at: string }
  | { on: 'context'; ctx: ContextKind }
  | { on: 'focus:start' | 'focus:end' | 'meeting:start' | 'meeting:end' | 'block:start' }
  | { on: 'app:open' | 'app:close'; app: string }
  | { on: 'wifi'; name: string }
  | { on: 'usb' }
  | { on: 'battery'; below: number }
  | { on: 'charger'; plugged: boolean }
  | { on: 'idle'; minutes: number }
  | { on: 'back' }
  | { on: 'calendar'; match: string; before: number }
  | { on: 'clipboard'; pattern: string }
  | { on: 'file'; folder: string; ext?: string }
export type TriggerOn = Trigger['on']
export const TRIGGER_ONS: TriggerOn[] = ['time', 'context', 'focus:start', 'focus:end', 'meeting:start', 'meeting:end', 'block:start', 'app:open', 'app:close', 'wifi', 'usb', 'battery', 'charger', 'idle', 'back', 'calendar', 'clipboard', 'file']
export const TRIGGER_LABEL: Record<TriggerOn, string> = {
  time: 'It is…',
  context: 'I start…',
  'focus:start': 'A focus timer starts',
  'focus:end': 'A focus timer ends',
  'meeting:start': 'A meeting starts',
  'meeting:end': 'A meeting ends',
  'block:start': 'A planned block starts',
  'app:open': 'I open an app',
  'app:close': 'I leave an app',
  wifi: 'I join a Wi-Fi',
  usb: 'I plug in a USB drive',
  battery: 'The battery is low',
  charger: 'The charger is plugged in / out',
  idle: "I'm away from the PC",
  back: "I'm back at the PC",
  calendar: 'A calendar event is coming',
  clipboard: 'I copy something that matches',
  file: 'A file appears in a folder'
}
/** Triggers the desktop app has to watch for (it starts only those sensors). */
export const DESKTOP_TRIGGERS: TriggerOn[] = ['wifi', 'usb', 'battery', 'charger', 'idle', 'back', 'clipboard', 'file']

export function cleanTrigger(t: any): Trigger | null {
  switch (t?.on) {
    case 'time':
      return HM.test(String(t.at ?? '')) ? { on: 'time', at: t.at } : null
    case 'context':
      return CONTEXT_KINDS.includes(t.ctx) && t.ctx !== 'idle' ? { on: 'context', ctx: t.ctx } : null
    case 'focus:start':
    case 'focus:end':
    case 'meeting:start':
    case 'meeting:end':
    case 'block:start':
    case 'usb':
    case 'back':
      return { on: t.on }
    case 'app:open':
    case 'app:close': {
      const app = clip(t.app, 40)
      return app ? { on: t.on, app } : null
    }
    case 'wifi': {
      const name = clip(t.name, 32)
      return name ? { on: 'wifi', name } : null
    }
    case 'battery':
      return { on: 'battery', below: int(t.below, 5, 95, 20) }
    case 'charger':
      return { on: 'charger', plugged: t.plugged !== false }
    case 'idle':
      return { on: 'idle', minutes: int(t.minutes, 1, 240, 10) }
    case 'calendar': {
      const match = clip(t.match, 60)
      return { on: 'calendar', match, before: int(t.before, 0, 120, 5) }
    }
    case 'clipboard': {
      const pattern = clip(t.pattern, 100)
      return pattern && clipMatcher(pattern) ? { on: 'clipboard', pattern } : null
    }
    case 'file': {
      const folder = clip(t.folder, 300)
      if (!folder || !pathOk(folder) || /\.\.[\\/]/.test(folder)) return null
      const ext = clip(t.ext, 10).toLowerCase().replace(/^\.?/, '.')
      return { on: 'file', folder, ...(ext.length > 1 && /^\.[a-z0-9]{1,8}$/.test(ext) ? { ext } : {}) }
    }
    default:
      return null
  }
}

/**
 * A clipboard pattern: "/regex/" (simple, no look-arounds or back-references,
 * so a bad one can't hang the PC) or plain words (contains, any case).
 */
export function clipMatcher(pattern: string): ((text: string) => boolean) | null {
  const m = /^\/(.{1,80})\/([i]?)$/.exec(pattern)
  if (m) {
    if (/\\\d|\(\?[=!<]|(\+|\*|\})\s*[+*{]|\)[+*]/.test(m[1])) return null
    try {
      const re = new RegExp(m[1], m[2])
      return (t) => re.test(String(t ?? '').slice(0, 2000))
    } catch {
      return null
    }
  }
  const w = pattern.toLowerCase().trim()
  return w ? (t) => String(t ?? '').toLowerCase().includes(w) : null
}

// ---------------------------------------------------------------- the record

export type Risk = 'safe' | 'ask' | 'confirm'
export const RISKS: Risk[] = ['safe', 'ask', 'confirm']
export const RISK_LABEL: Record<Risk, string> = { safe: 'Just run it', ask: 'Ask me first when not tapped', confirm: 'Always ask me' }

export interface Automation {
  id: string
  name: string
  icon: string
  /** Its triggers work (a tap always works). */
  on: boolean
  steps: Step[]
  params: Param[]
  risk: Risk
  when: Trigger[]
  /** Only on these days (0 = Sunday) / between these hours (triggers only). */
  if?: { days?: number[]; from?: string; to?: string }
  /** AH1: a one-tap button on the island. */
  pin: boolean
  /** AH20: a favourite (first on the island). */
  fav: boolean
  /** AH8: Ben may run it (the same confirm rules). */
  ben: boolean
  /** AH22: Ben suggested it (it starts switched off). */
  byBen?: boolean
  /** It has run once (an "ask" one asks on its first tap). */
  ranOnce: boolean
}

export interface AutomationStore {
  /** AH16: "Pause all automations": triggers and Ben stop; taps still work. */
  paused: boolean
  list: Automation[]
  /** AH22: suggestions you said no to (their keys). */
  dismissed: string[]
}
export const EMPTY_STORE: AutomationStore = { paused: false, list: [], dismissed: [] }

export function cleanAutomation(a: any, i = 0): Automation | null {
  if (!a || typeof a !== 'object') return null
  const steps: Step[] = (Array.isArray(a.steps) ? a.steps : []).map(cleanStep).filter((s: Step | null): s is Step => !!s).slice(0, STEPS_MAX)
  if (!steps.length) return null
  const params: Param[] = []
  for (const [j, p] of (Array.isArray(a.params) ? a.params : []).entries()) {
    const c = cleanParam(p, j)
    if (c && !params.some((x) => x.key === c.key)) params.push(c)
  }
  const when = (Array.isArray(a.when) ? a.when : []).map(cleanTrigger).filter((t: Trigger | null): t is Trigger => !!t).slice(0, TRIGGERS_MAX)
  const iff: NonNullable<Automation['if']> = {}
  if (Array.isArray(a.if?.days)) {
    const days = [...new Set<number>(a.if.days.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    if (days.length && days.length < 7) iff.days = days
  }
  if (HM.test(String(a.if?.from ?? '')) && HM.test(String(a.if?.to ?? ''))) {
    iff.from = a.if.from
    iff.to = a.if.to
  }
  const out: Automation = {
    id: ID.test(String(a.id ?? '')) ? String(a.id) : `a${i}x${Date.now().toString(36)}`,
    name: clip(a.name, 40) || STEP_LABEL[steps[0].do],
    icon: clip(a.icon, 4) || STEP_ICON[steps[0].do],
    on: a.on === true,
    steps,
    params: params.slice(0, PARAMS_MAX),
    risk: RISKS.includes(a.risk) ? a.risk : 'ask',
    when,
    pin: a.pin === true,
    fav: a.fav === true,
    ben: a.ben === true,
    ranOnce: a.ranOnce === true
  }
  if (Object.keys(iff).length) out.if = iff
  if (a.byBen === true) out.byBen = true
  return out
}

export function cleanStore(v: unknown): AutomationStore {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<AutomationStore>
  const list: Automation[] = []
  for (const [i, a] of (Array.isArray(o.list) ? o.list : []).entries()) {
    const c = cleanAutomation(a, i)
    if (c && !list.some((x) => x.id === c.id)) list.push(c)
  }
  return { paused: o.paused === true, list: list.slice(0, AUTOMATIONS_MAX), dismissed: (Array.isArray(o.dismissed) ? o.dismissed : []).map((d) => clip(d, 200)).filter(Boolean).slice(-30) }
}

export const kindOf = (a: Pick<Automation, 'steps'>): StepKind => a.steps[0].do
/** Needs the desktop app for at least one step. */
export const needsDesktop = (a: Pick<Automation, 'steps'>) => a.steps.some((s) => DESKTOP_STEPS.includes(s.do) || (s.do === 'webhook' && s.where === 'local'))
/** AH8: Ben's server can run all of it (cloud webhooks, Telegram, ntfy). */
export const serverRunnable = (a: Pick<Automation, 'steps'>) => a.steps.every((s) => (s.do === 'webhook' && s.where === 'cloud') || s.do === 'telegram' || s.do === 'ntfy')
/** The secrets (webhook ids) it uses. */
export const hooksOf = (a: Pick<Automation, 'steps'>) => a.steps.flatMap((s) => (s.do === 'webhook' ? [s.hook] : []))

// ---------------------------------------------------------------- risk and confirm

const RANK: Record<Risk, number> = { safe: 0, ask: 1, confirm: 2 }
/** At least this careful, whatever you picked: scripts always ask, typing asks when not tapped. */
export function stepRisk(s: Step): Risk {
  if (s.do === 'script' || s.do === 'ahk') return 'confirm'
  if (s.do === 'type' || s.do === 'workspace') return 'ask'
  return 'safe'
}
export function riskOf(a: Pick<Automation, 'risk' | 'steps'>): Risk {
  return a.steps.reduce<Risk>((r, s) => (RANK[stepRisk(s)] > RANK[r] ? stepRisk(s) : r), a.risk)
}
export type RunSource = 'tap' | 'trigger' | 'ben' | 'rerun' | 'test'
/**
 * Must you say yes before this run? "confirm": every time. "ask": when a
 * trigger or Ben started it, and on its very first tap. "safe": never.
 */
export function confirmNeeded(a: Pick<Automation, 'risk' | 'steps' | 'ranOnce'>, source: RunSource): boolean {
  if (source === 'test') return false
  const r = riskOf(a)
  if (r === 'confirm') return true
  if (r === 'ask') return source === 'trigger' || source === 'ben' || !a.ranOnce
  return false
}

// ---------------------------------------------------------------- templates and chains (AH18)

export interface StepResult {
  ok: boolean
  text?: string
  url?: string
  image?: string
  why?: string
  /** AH6: an n8n execution to follow. */
  exec?: string
}
export interface RunScope {
  values: Record<string, ParamValue>
  /** What the trigger saw (file name, app, Wi-Fi…). */
  trigger?: Record<string, string>
  result?: StepResult | null
}

/** "{{topic}}", "{{result.text}}", "{{trigger.file}}" → their values (unknown ones: empty). */
export function fill(s: string, scope: RunScope): string {
  return String(s ?? '').replace(/\{\{\s*([a-z][a-z0-9_]*)(?:\.([a-z][a-z0-9_]*))?\s*\}\}/gi, (_m, a: string, b?: string) => {
    if (a === 'result' && b) {
      const v = (scope.result as any)?.[b]
      return v == null ? '' : String(v)
    }
    if (a === 'trigger' && b) return String(scope.trigger?.[b] ?? '')
    if (b) return ''
    const v = scope.values[a]
    return v == null ? '' : String(v)
  })
}

/** A step with its text filled in for this run (links and typing checked again here). */
export function fillStep(s: Step, scope: RunScope): Step | { error: string } {
  const f = (t: string, n: number) => clipML(fill(t, scope), n).replace(/\n+/g, ' ').trim()
  switch (s.do) {
    case 'telegram':
    case 'ntfy':
      return { ...s, text: clipML(fill(s.text, scope), 2000).trim() || '(empty)' }
    case 'todoist':
    case 'note': {
      const text = f(s.text, 500)
      return text ? { ...s, text } : { error: 'Nothing to write' }
    }
    case 'type': {
      const text = f(s.text, 300)
      const bad = pcDenied({ kind: 'type', arg: text })
      return bad ? { error: bad } : text ? { ...s, text } : { error: 'Nothing to type' }
    }
    case 'url': {
      const url = f(s.url, 500)
      const bad = pcDenied({ kind: 'url', arg: url })
      return bad ? { error: bad } : { ...s, url }
    }
    case 'focus':
      return { ...s, subject: f(s.subject, 60) || 'Focus' }
    case 'script':
    case 'ahk':
      return { ...s, args: s.args.map((x) => fill(x, scope).replace(/[\u0000\r\n]+/g, ' ').slice(0, 200)) }
    default:
      return s
  }
}

/** The JSON a webhook gets: your values, the last step's answer, and who sent it. */
export function webhookBody(a: Pick<Automation, 'id' | 'name'>, scope: RunScope, now = new Date()) {
  return {
    automation: a.name,
    id: a.id,
    values: scope.values,
    ...(scope.trigger && Object.keys(scope.trigger).length ? { trigger: scope.trigger } : {}),
    ...(scope.result ? { prev: { text: scope.result.text ?? null, url: scope.result.url ?? null } } : {}),
    at: now.toISOString(),
    source: 'life-system' as const
  }
}

export type StepExec = (step: Step, scope: RunScope, index: number) => Promise<StepResult>
/**
 * AH18: run the steps in order; each one can use the one before's answer
 * ({{result.text}}); the chain stops at the first that fails.
 */
export async function runChain(a: Pick<Automation, 'steps'>, scope: RunScope, exec: StepExec): Promise<{ ok: boolean; results: StepResult[]; last: StepResult; failedAt?: number }> {
  const results: StepResult[] = []
  let prev: StepResult | null = scope.result ?? null
  for (const [i, raw] of a.steps.entries()) {
    const sc = { ...scope, result: prev }
    const step = fillStep(raw, sc)
    let r: StepResult
    if ('error' in step) r = { ok: false, why: step.error }
    else {
      try {
        r = await exec(step, sc, i)
      } catch (e) {
        r = { ok: false, why: String((e as Error)?.message ?? e).slice(0, 160) }
      }
    }
    results.push(r)
    if (!r.ok) return { ok: false, results, last: r, failedAt: i }
    prev = r.text || r.url || r.image ? r : prev ?? r
  }
  const last = results[results.length - 1] ?? { ok: true }
  // The card shows the last answer that said something.
  const said = [...results].reverse().find((r) => r.text || r.url || r.image) ?? last
  return { ok: true, results, last: { ...said, ok: true } }
}

// ---------------------------------------------------------------- answers (AH4)

/** An https address under 2000 characters, or undefined. */
export function httpsOnly(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 2000) return undefined
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : undefined
  } catch {
    return undefined
  }
}
/**
 * AH4: a flow's answer ("Respond to Webhook": {text, url, image, ok}) → a
 * card. Plain text works too; links and images only when https; capped.
 */
export function readFlowAnswer(status: number, contentType: string, body: string): StepResult {
  const okStatus = status >= 200 && status < 300
  const raw = String(body ?? '').slice(0, 64 * 1024)
  if (!okStatus) {
    let why = `The flow answered ${status}`
    try {
      const j = JSON.parse(raw)
      const m = j?.message ?? j?.error ?? j?.hint
      if (typeof m === 'string' && m) why = `${why}: ${m.slice(0, 120)}`
    } catch {
      /* not JSON */
    }
    return { ok: false, why }
  }
  let j: any = null
  if (/json/i.test(contentType) || /^\s*[[{]/.test(raw)) {
    try {
      j = JSON.parse(raw)
    } catch {
      j = null
    }
  }
  if (Array.isArray(j)) j = j[0] ?? null
  if (j && typeof j === 'object') {
    const pick = (...ks: string[]) => ks.map((k) => j[k]).find((v) => typeof v === 'string' && v.trim())
    let text = pick('text', 'message', 'output', 'result', 'answer') as string | undefined
    if (text === 'Workflow was started') text = 'Started'
    const out: StepResult = { ok: j.ok !== false && j.success !== false }
    if (text) out.text = clipML(text, ANSWER_TEXT_MAX).trim()
    const url = httpsOnly(j.url ?? j.link)
    if (url) out.url = url
    const image = httpsOnly(j.image ?? j.imageUrl)
    if (image) out.image = image
    const ex = j.executionId ?? j.execution_id ?? j.execution
    if ((typeof ex === 'string' || typeof ex === 'number') && /^[A-Za-z0-9_-]{1,40}$/.test(String(ex))) out.exec = String(ex)
    if (!out.ok) out.why = out.text ?? 'The flow said it failed'
    return out
  }
  const text = clipML(raw, ANSWER_TEXT_MAX).trim()
  return text ? { ok: true, text } : { ok: true, text: 'Done' }
}

// ---------------------------------------------------------------- n8n API (AH6, AH7)

export interface N8nWorkflow { id: string; name: string; active: boolean; hooks: { path: string; method: string }[] }
/** GET /api/v1/workflows → the list (with each Webhook node's path, for "make it a button"). */
export function n8nWorkflows(json: any): N8nWorkflow[] {
  const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []
  return data
    .filter((w: any) => w && (typeof w.id === 'string' || typeof w.id === 'number'))
    .map((w: any) => ({
      id: String(w.id).slice(0, 40),
      name: clip(w.name, 80) || 'Workflow',
      active: w.active === true,
      hooks: (Array.isArray(w.nodes) ? w.nodes : [])
        .filter((n: any) => n?.type === 'n8n-nodes-base.webhook' && typeof n.parameters?.path === 'string' && !n.disabled)
        .map((n: any) => ({ path: String(n.parameters.path).replace(/^\/+/, '').slice(0, 200), method: String(n.parameters.httpMethod || 'GET').toUpperCase() }))
        .slice(0, 4)
    }))
    .slice(0, 100)
}
/** A Webhook node's production address. */
export const n8nHookUrl = (base: string, path: string) => `${String(base).replace(/\/+$/, '')}/webhook/${String(path).replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`
/** A base address the API is called on: no path after the host (or …/ for a sub-folder install), no query. */
export function n8nBase(raw: string): string {
  const u = new URL(String(raw).trim())
  u.search = ''
  u.hash = ''
  return `${u.origin}${u.pathname.replace(/\/(api\/v1)?\/*$/, '').replace(/\/+$/, '')}`
}

export type ExecState = 'running' | 'ok' | 'failed'
/** GET /api/v1/executions/{id} → running, ok or failed. */
export function execState(json: any): ExecState {
  const j = json?.data ?? json
  const s = String(j?.status ?? '').toLowerCase()
  if (['error', 'crashed', 'canceled', 'cancelled', 'failed'].includes(s)) return 'failed'
  if (s === 'success') return 'ok'
  if (['running', 'waiting', 'new', 'queued'].includes(s)) return 'running'
  if (j?.finished === true) return 'ok'
  if (j?.stoppedAt && j?.finished === false) return 'failed'
  return 'running'
}

export interface N8nFail { id: string; workflowId: string; name: string; at: string }
/**
 * AH7: GET /api/v1/executions?status=error → the failures you haven't been
 * told about. The first look only remembers (no flood of old ones).
 */
export function newFailures(json: any, seen: string[] | null, names: Record<string, string> = {}): { fails: N8nFail[]; seen: string[] } {
  const data = Array.isArray(json?.data) ? json.data : []
  const all: N8nFail[] = data
    .filter((e: any) => e && (typeof e.id === 'string' || typeof e.id === 'number'))
    .map((e: any) => ({ id: String(e.id), workflowId: String(e.workflowId ?? ''), name: clip(e.workflowData?.name ?? names[String(e.workflowId ?? '')], 80) || 'A workflow', at: String(e.stoppedAt ?? e.startedAt ?? '') }))
  const ids = all.map((f) => f.id)
  if (seen == null) return { fails: [], seen: ids.slice(0, 50) }
  const fails = all.filter((f) => !seen.includes(f.id)).slice(0, 5)
  return { fails, seen: [...new Set([...ids, ...seen])].slice(0, 50) }
}
export const failText = (f: N8nFail) => `⚠️ n8n flow failed: “${f.name}”${f.at ? ` at ${f.at.slice(11, 16)} UTC` : ''}. Open n8n → Executions to see why.`

// ---------------------------------------------------------------- scripts (AH10, AH13)

export const SCRIPT_EXT = ['.ps1', '.bat', '.py']
export const extOf = (f: string) => {
  const m = /\.[A-Za-z0-9]{1,6}$/.exec(String(f ?? ''))
  return m ? m[0].toLowerCase() : ''
}
const normPath = (p: string) => String(p ?? '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

/** May this file run? Only .ps1 / .bat / .py (.ahk for AutoHotkey) right inside the one folder you chose. */
export function scriptProblem(file: string, folder: string | null, exts = SCRIPT_EXT): string | null {
  if (!folder) return 'Choose your scripts folder first'
  if (!exts.includes(extOf(file))) return `Only ${exts.join(', ')} files`
  if (/[\u0000-\u001f"<>|*?]/.test(file) || /(^|[\\/])\.\.([\\/]|$)/.test(file)) return 'Not a plain file path'
  if (/^\\\\[?.]\\/.test(file)) return 'Not a plain file path'
  const f = normPath(file)
  const d = normPath(folder)
  const parent = f.slice(0, f.lastIndexOf('\\'))
  if (parent !== d) return 'Only files right inside your scripts folder'
  return null
}

/** Characters cmd.exe would read as commands (never passed to a .bat). */
const CMD_META = /[&|<>^%!"\r\n]/
export function argsProblem(ext: string, args: string[]): string | null {
  if (args.some((a) => /[\u0000\r\n]/.test(a))) return 'One line per argument'
  if (ext === '.bat' && args.some((a) => CMD_META.test(a))) return 'A .bat argument can’t hold & | < > ^ % ! or "'
  return null
}

/** The exact program and arguments (an array: nothing is glued into one string). */
export function scriptCommand(file: string, args: string[], o: { ahkExe?: string } = {}): { exe: string; args: string[] } {
  const ext = extOf(file)
  if (ext === '.ps1') return { exe: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args] }
  if (ext === '.bat') return { exe: 'cmd.exe', args: ['/d', '/c', file, ...args] }
  if (ext === '.py') return { exe: 'py.exe', args: ['-3', file, ...args] }
  if (ext === '.ahk') return { exe: o.ahkExe || 'AutoHotkey.exe', args: [file, ...args] }
  throw new Error('Not a script this can run')
}

/** AH10: the dry-run preview: the command as you'd type it (for reading only; it runs from the array). */
export function previewCommand(c: { exe: string; args: string[] }): string {
  const q = (s: string) => (/^[A-Za-z0-9_:\\/.=-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`)
  return [c.exe, ...c.args].map(q).join(' ')
}

export type PinState = 'pinned' | 'new' | 'changed'
/** The file's SHA-256 against the one you allowed: a changed file asks again. */
export function pinState(pins: Record<string, string>, file: string, sha: string): PinState {
  const was = pins[normPath(file)]
  if (!was) return 'new'
  return was === String(sha).toLowerCase() ? 'pinned' : 'changed'
}
export const pinKey = normPath
export const SHA256 = /^[a-f0-9]{64}$/

/** What a script printed, for the island: colours stripped, at most 4 KB. */
export function capOutput(s: string, max = OUTPUT_MAX): string {
  const t = String(s ?? '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f]+/g, '')
  const enc = new TextEncoder().encode(t)
  if (enc.length <= max) return t.trim()
  return `${new TextDecoder().decode(enc.slice(0, max)).replace(/�+$/, '').trim()}\n… (cut at 4 KB)`
}

// ---------------------------------------------------------------- trigger events and the loop guard (AH16)

export type AutoEvent =
  | { t: 'tick'; at: number; events?: { title: string; start: number }[] }
  | { t: 'context'; at: number; ctx: ContextKind; conf: number }
  | { t: 'focus:start' | 'focus:end' | 'meeting:start' | 'meeting:end' | 'block:start'; at: number }
  | { t: 'app'; at: number; app: string; prev: string | null }
  | { t: 'wifi'; at: number; name: string | null; prev: string | null }
  | { t: 'usb'; at: number; drive: string }
  | { t: 'battery'; at: number; pct: number; prev: number | null }
  | { t: 'power'; at: number; plugged: boolean }
  | { t: 'idle'; at: number; minutes: number }
  | { t: 'back'; at: number }
  | { t: 'clip'; at: number; text: string }
  | { t: 'file'; at: number; folder: string; name: string }

const lc = (s: unknown) => String(s ?? '').toLowerCase().trim()
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
const dayStart = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Does this trigger fire on this event? Returns what it saw (for {{trigger.x}}) and a key for once-only triggers. */
export function matchTrigger(t: Trigger, e: AutoEvent, fired: Record<string, number> = {}, id = ''): { vars: Record<string, string>; key?: string } | null {
  switch (t.on) {
    case 'time': {
      if (e.t !== 'tick') return null
      const d = new Date(e.at)
      const m = d.getHours() * 60 + d.getMinutes()
      const at = toMin(t.at)
      // At the time or up to 30 min after (the PC slept), once a day.
      if (m < at || m - at > 30) return null
      const key = `${id}:time:${t.at}`
      if ((fired[key] ?? 0) >= dayStart(e.at)) return null
      return { vars: { time: t.at }, key }
    }
    case 'context':
      return e.t === 'context' && e.ctx === t.ctx && e.conf >= 0.5 ? { vars: { doing: CONTEXT_LABEL[t.ctx] } } : null
    case 'app:open':
      return e.t === 'app' && lc(e.app).includes(lc(t.app)) && !lc(e.prev).includes(lc(t.app)) ? { vars: { app: e.app } } : null
    case 'app:close':
      return e.t === 'app' && e.prev && lc(e.prev).includes(lc(t.app)) && !lc(e.app).includes(lc(t.app)) ? { vars: { app: e.prev } } : null
    case 'wifi':
      return e.t === 'wifi' && e.name && lc(e.name) === lc(t.name) && lc(e.prev) !== lc(t.name) ? { vars: { wifi: e.name } } : null
    case 'usb':
      return e.t === 'usb' ? { vars: { drive: e.drive } } : null
    case 'battery':
      // Crossing below the line (not every reading under it).
      return e.t === 'battery' && e.pct < t.below && (e.prev == null || e.prev >= t.below) ? { vars: { battery: String(e.pct) } } : null
    case 'charger':
      return e.t === 'power' && e.plugged === t.plugged ? { vars: { charger: e.plugged ? 'plugged in' : 'unplugged' } } : null
    case 'idle':
      return e.t === 'idle' && e.minutes >= t.minutes ? { vars: { away: String(e.minutes) } } : null
    case 'back':
      return e.t === 'back' ? { vars: {} } : null
    case 'calendar': {
      if (e.t !== 'tick' || !e.events) return null
      for (const ev of e.events) {
        if (t.match && !lc(ev.title).includes(lc(t.match))) continue
        const left = (ev.start - e.at) / 60_000
        if (left > t.before || left < t.before - 5) continue
        const key = `${id}:cal:${ev.start}:${lc(ev.title).slice(0, 30)}`
        if (fired[key]) continue
        return { vars: { event: ev.title, starts: new Date(ev.start).toTimeString().slice(0, 5) }, key }
      }
      return null
    }
    case 'clipboard': {
      if (e.t !== 'clip') return null
      const m = clipMatcher(t.pattern)
      return m && m(e.text) ? { vars: { clip: e.text.slice(0, 2000) } } : null
    }
    case 'file': {
      if (e.t !== 'file' || normPath(e.folder) !== normPath(t.folder)) return null
      if (t.ext && extOf(e.name) !== t.ext) return null
      return { vars: { file: e.name, folder: t.folder } }
    }
    default:
      return e.t === t.on ? { vars: {} } : null
  }
}

const inHours = (m: number, from: string, to: string) => {
  const a = toMin(from)
  const b = toMin(to)
  return a <= b ? m >= a && m < b : m >= a || m < b
}

/** The loop guard: may this automation start from a trigger now? (at most once per 30 s) */
export const guardOk = (fired: Record<string, number>, id: string, now: number, ms = LOOP_GUARD_MS) => now - (fired[id] ?? 0) >= ms

export interface Pick_ { auto: Automation; vars: Record<string, string>; ask: boolean }
/**
 * An event → the automations it starts (and whether each asks first), plus
 * the new "fired" map. Nothing when paused; each at most once per 30 s.
 */
export function automationsFor(store: Pick<AutomationStore, 'paused' | 'list'>, e: AutoEvent, fired: Record<string, number>): { runs: Pick_[]; fired: Record<string, number> } {
  const next = { ...fired }
  const runs: Pick_[] = []
  if (store.paused) return { runs, fired: next }
  const d = new Date(e.at)
  const m = d.getHours() * 60 + d.getMinutes()
  for (const a of store.list) {
    if (!a.on || !a.when.length) continue
    if (a.if?.days && !a.if.days.includes(d.getDay())) continue
    if (a.if?.from && a.if.to && !inHours(m, a.if.from, a.if.to)) continue
    for (const t of a.when) {
      const hit = matchTrigger(t, e, next, a.id)
      if (!hit) continue
      if (!guardOk(next, a.id, e.at)) break
      next[a.id] = e.at
      if (hit.key) next[hit.key] = e.at
      runs.push({ auto: a, vars: hit.vars, ask: confirmNeeded(a, 'trigger') })
      break
    }
  }
  // Keep the map small.
  const keys = Object.keys(next)
  if (keys.length > 200) for (const k of keys.sort((x, y) => next[x] - next[y]).slice(0, keys.length - 200)) delete next[k]
  return { runs, fired: next }
}

/** What the desktop must watch, from the automations that are on (it starts only those sensors). */
export function desktopWatch(store: Pick<AutomationStore, 'paused' | 'list'>): { wifi: boolean; usb: boolean; battery: boolean; power: boolean; idle: number[]; clipboard: string[]; folders: string[] } {
  const ts = store.paused ? [] : store.list.filter((a) => a.on).flatMap((a) => a.when)
  return {
    wifi: ts.some((t) => t.on === 'wifi'),
    usb: ts.some((t) => t.on === 'usb'),
    battery: ts.some((t) => t.on === 'battery'),
    power: ts.some((t) => t.on === 'charger'),
    idle: [...new Set(ts.flatMap((t) => (t.on === 'idle' ? [t.minutes] : t.on === 'back' ? [5] : [])))].sort((a, b) => a - b),
    clipboard: [...new Set(ts.flatMap((t) => (t.on === 'clipboard' ? [t.pattern] : [])))].slice(0, 10),
    folders: [...new Set(ts.flatMap((t) => (t.on === 'file' ? [t.folder] : [])))].slice(0, 5)
  }
}

// ---------------------------------------------------------------- words (the sentence builder)

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function triggerText(t: Trigger): string {
  switch (t.on) {
    case 'time':
      return `it is ${t.at}`
    case 'context':
      return `I start ${CONTEXT_LABEL[t.ctx].toLowerCase()}`
    case 'app:open':
      return `I open ${t.app}`
    case 'app:close':
      return `I leave ${t.app}`
    case 'wifi':
      return `I join the Wi-Fi “${t.name}”`
    case 'battery':
      return `the battery drops below ${t.below}%`
    case 'charger':
      return t.plugged ? 'I plug in the charger' : 'I unplug the charger'
    case 'idle':
      return `I'm away ${t.minutes} min`
    case 'calendar':
      return `${t.before ? `${t.before} min before ` : ''}${t.match ? `“${t.match}”` : 'any event'} starts`
    case 'clipboard':
      return `I copy something with “${t.pattern}”`
    case 'file':
      return `a ${t.ext ? `${t.ext} ` : ''}file appears in ${t.folder.split(/[\\/]/).filter(Boolean).pop() ?? t.folder}`
    default:
      return TRIGGER_LABEL[t.on].toLowerCase()
  }
}
export function stepText(s: Step, hint: (id: string) => string = () => ''): string {
  switch (s.do) {
    case 'webhook':
      return `run the ${PRESETS[s.preset].label} flow${hint(s.hook) ? ` (${hint(s.hook)})` : ''}${s.wait ? ' and wait for it' : ''}`
    case 'safe':
      return SAFE_LABEL[s.act.do].toLowerCase()
    case 'telegram':
      return `send me a Telegram “${short(s.text)}”`
    case 'ntfy':
      return `push “${short(s.text)}” to my phone`
    case 'todoist':
      return `add the task “${short(s.text)}”`
    case 'note':
      return `add the note “${short(s.text)}”`
    case 'url':
      return `open ${s.url.includes('{{') ? s.url : hostOf(s.url)}`
    case 'type':
      return `type “${short(s.text)}”`
    case 'focus':
      return `start focus “${s.subject}” ${s.minutes} min`
    case 'music':
      return `play the station “${s.station}”`
    case 'script':
      return `run my script ${fileName(s.file)}`
    case 'workspace':
      return `open my workspace (${[s.ws.apps.length && `${s.ws.apps.length} app${s.ws.apps.length > 1 ? 's' : ''}`, s.ws.links.length && `${s.ws.links.length} link${s.ws.links.length > 1 ? 's' : ''}`, s.ws.files.length && `${s.ws.files.length} file${s.ws.files.length > 1 ? 's' : ''}`, s.ws.folder && 'a folder'].filter(Boolean).join(', ')})`
    case 'ahk':
      return `run the AutoHotkey script ${fileName(s.file)}`
    case 'powertoys':
      return `open PowerToys ${POWERTOYS_FEATURES[s.feature]}`
    case 'espanso':
      return s.cmd === 'toggle' ? 'switch Espanso on or off' : "open Espanso's search"
  }
}
const short = (s: string) => (s.length > 30 ? `${s.slice(0, 30)}…` : s)
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname
  } catch {
    return u
  }
}
export const fileName = (f: string) => String(f).split(/[\\/]/).pop() ?? f

/** AH16: the plain-English sentence: "When I join the Wi-Fi “Home”, open my workspace, then send me a Telegram “Home”". */
export function sentence(a: Pick<Automation, 'when' | 'steps'> & { if?: Automation['if'] }, hint?: (id: string) => string): string {
  const steps = a.steps.map((s) => stepText(s, hint))
  const doing = steps.length > 1 ? `${steps.slice(0, -1).join(', ')}, then ${steps[steps.length - 1]}` : steps[0]
  if (!a.when.length) return `Tap to ${doing}`
  const days = a.if?.days?.length ? (a.if.days.join(',') === '1,2,3,4,5' ? ' on weekdays' : a.if.days.join(',') === '0,6' ? ' at weekends' : ` on ${a.if.days.map((d) => DAYS[d]).join(' ')}`) : ''
  const hours = a.if?.from ? ` between ${a.if.from} and ${a.if.to}` : ''
  return `When ${a.when.map(triggerText).join(' or ')}${days}${hours}, ${doing}`
}

/**
 * AH16 "Test now": what it WOULD do, step by step, with your values filled
 * in (nothing is called). The answers of earlier steps show as a placeholder.
 */
export function dryRun(a: Pick<Automation, 'steps' | 'params'>, values: Record<string, ParamValue>, o: { trigger?: Record<string, string>; hint?: (id: string) => string; ahkExe?: string } = {}): string[] {
  const placeholder: StepResult = { ok: true, text: '(the answer from the step before)', url: 'https://example.com/(the-link-from-the-step-before)' }
  return a.steps.map((raw, i) => {
    const step = fillStep(raw, { values, trigger: o.trigger, result: i ? placeholder : null })
    if ('error' in step) return `${i + 1}. Would stop here: ${step.error}`
    if (step.do === 'webhook') return `${i + 1}. Send ${JSON.stringify(values)} to the ${PRESETS[step.preset].label} flow${o.hint?.(step.hook) ? ` (${o.hint(step.hook)})` : ''}${step.where === 'local' ? ' from this PC' : ' from the server'}`
    if (step.do === 'script' || step.do === 'ahk') return `${i + 1}. Run: ${previewCommand(scriptCommand(step.file, step.args, { ahkExe: o.ahkExe }))}`
    return `${i + 1}. ${cap(stepText(step, o.hint))}`
  })
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// ---------------------------------------------------------------- runs (AH20)

export interface RunLine {
  id: string
  at: number
  auto: string
  name: string
  source: RunSource
  ok: boolean
  ms: number
  text?: string
  why?: string
  values: Record<string, ParamValue>
}

const SECRETISH = /(pass|token|secret|api_?key|^key$|pin|iban|card|cvv|auth)/i
/** Long tokens, keys in addresses and Bearer values → "…" (for the run log). */
export function scrub(text: string): string {
  return String(text ?? '')
    .replace(/(bearer|token|key|apikey|api_key|secret|password|sig|signature)(["'\s:=]+)[^\s"'&,}]+/gi, '$1$2…')
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/gi, '$1?…')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '…')
}
/** Values for the log: secret-looking names dropped, read text (selection, clipboard) cut short. */
export function redactValues(params: Param[], values: Record<string, ParamValue>): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {}
  for (const [k, v] of Object.entries(values)) {
    if (SECRETISH.test(k)) continue
    const p = params.find((x) => x.key === k)
    if (typeof v === 'string') out[k] = scrub(p && isAutoParam(p) ? (v.length > 40 ? `${v.slice(0, 40)}…` : v) : v.slice(0, 200))
    else out[k] = v
  }
  return out
}
export function logLine(a: Pick<Automation, 'id' | 'name' | 'params'>, source: RunSource, r: { ok: boolean; text?: string; why?: string }, values: Record<string, ParamValue>, at: number, ms: number): RunLine {
  return {
    id: `${a.id}:${at.toString(36)}`,
    at,
    auto: a.id,
    name: a.name,
    source,
    ok: r.ok,
    ms: Math.max(0, Math.round(ms)),
    ...(r.text ? { text: scrub(r.text).slice(0, 300) } : {}),
    ...(r.why ? { why: scrub(r.why).slice(0, 200) } : {}),
    values: redactValues(a.params, values)
  }
}
export const addRun = (log: RunLine[], line: RunLine, max = LOG_MAX) => [line, ...log.filter((l) => l.id !== line.id)].slice(0, max)
export function cleanRunLog(v: unknown): RunLine[] {
  return (Array.isArray(v) ? v : [])
    .filter((l: any) => l && typeof l.id === 'string' && typeof l.auto === 'string' && Number.isFinite(Number(l.at)))
    .map((l: any) => ({ id: l.id.slice(0, 60), at: Number(l.at), auto: l.auto.slice(0, 40), name: clip(l.name, 40), source: (['tap', 'trigger', 'ben', 'rerun', 'test'].includes(l.source) ? l.source : 'tap') as RunSource, ok: l.ok === true, ms: Number(l.ms) || 0, ...(l.text ? { text: clip(l.text, 300) } : {}), ...(l.why ? { why: clip(l.why, 200) } : {}), values: l.values && typeof l.values === 'object' ? l.values : {} }))
    .slice(0, LOG_MAX)
}

/** AH20: the last 20 runs to Re-run (full values, this PC only; secret-looking names never kept). */
export interface RecentRun { at: number; auto: string; name: string; ok: boolean; values: Record<string, ParamValue> }
export function addRecent(list: RecentRun[], r: RecentRun): RecentRun[] {
  const values = Object.fromEntries(Object.entries(r.values).filter(([k]) => !SECRETISH.test(k)))
  return [{ ...r, values }, ...list].slice(0, RECENT_MAX)
}

// ---------------------------------------------------------------- the island (AH1, AH4, AH20)

export interface IslandAutoButton { id: string; name: string; icon: string; fav: boolean; fields: Param[]; ask: boolean; kind: StepKind }
export interface IslandAutoRun { run: string; id: string; name: string; startedAt: number; state: 'running' | 'ok' | 'failed'; result?: StepResult; /** AH12: it opened a workspace ("End workspace"). */ ws?: boolean }
export interface IslandAutoView {
  paused: boolean
  buttons: IslandAutoButton[]
  runs: IslandAutoRun[]
  recent: RecentRun[]
  /** A run waiting for your yes. */
  confirm: { run: string; id: string; name: string; text: string; preview: string[] } | null
}
/** Pinned ones, favourites first (at most 12). */
export function islandButtons(store: Pick<AutomationStore, 'list'>): IslandAutoButton[] {
  return store.list
    .filter((a) => a.pin || a.fav)
    .sort((x, y) => Number(y.fav) - Number(x.fav))
    .slice(0, 12)
    .map((a) => ({ id: a.id, name: a.name, icon: a.icon, fav: a.fav, fields: formFields(a), ask: confirmNeeded(a, 'tap'), kind: kindOf(a) }))
}

/** A safe island action from the island page (the app window checks everything again). */
export type AutoIslandOp =
  | { op: 'run'; id: string; values?: Record<string, unknown>; rerun?: boolean }
  | { op: 'confirm'; run: string; yes: boolean }
  | { op: 'dismiss'; run: string }
  | { op: 'ask'; ask: string; yes: boolean }
  | { op: 'suggest'; key: string; yes: boolean }
  /** AH12: close the apps a workspace opened. */
  | { op: 'endWs'; id: string }

// ---------------------------------------------------------------- Ben (AH8)

const slug = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'flow'
/** The automations Ben may run, as tools "flow_<name>" (paused: none). */
export function benTools(store: Pick<AutomationStore, 'paused' | 'list'>): { name: string; description: string; auto: Automation }[] {
  if (store.paused) return []
  const out: { name: string; description: string; auto: Automation }[] = []
  for (const a of store.list) {
    if (!a.ben) continue
    let name = `flow_${slug(a.name)}`
    for (let i = 2; out.some((o) => o.name === name); i++) name = `flow_${slug(a.name)}_${i}`
    const args = a.params.filter((p) => !isAutoParam(p)).map((p) => `${p.key} (${p.type === 'choice' ? p.choices!.join('|') : p.type}${p.required ? ', needed' : ''})`)
    const ask = riskOf(a) !== 'safe' ? ' Asks him to tap OK first.' : ''
    out.push({ name, description: `Runs his automation “${a.name}”: ${sentence(a)}.${args.length ? ` Arguments: ${args.join(', ')}.` : ' No arguments.'}${ask}`.slice(0, 300), auto: a })
  }
  return out.slice(0, 10)
}

export interface AutoAsk { id: string; at: number; auto: string; name: string; values: Record<string, ParamValue>; /** waiting: needs your tap; go: safe, the desktop may just run it. */ status: 'waiting' | 'go' | 'allowed' | 'denied' | 'done' | 'failed' | 'expired'; why?: string }
export const AUTO_ASK_TTL_MS = 10 * 60_000
export function cleanAutoAsks(v: unknown, now: number): AutoAsk[] {
  const list = Array.isArray((v as any)?.asks) ? (v as any).asks : Array.isArray(v) ? v : []
  return list
    .filter((x: any) => x && typeof x.id === 'string' && typeof x.auto === 'string')
    .map((x: any) => {
      const at = Number(x.at) || 0
      const status = ['waiting', 'go', 'allowed', 'denied', 'done', 'failed', 'expired'].includes(x.status) ? x.status : 'waiting'
      return { id: x.id.slice(0, 40), at, auto: x.auto.slice(0, 40), name: clip(x.name, 40), values: x.values && typeof x.values === 'object' ? x.values : {}, status: (status === 'waiting' || status === 'go') && now - at > AUTO_ASK_TTL_MS ? 'expired' : status, ...(x.why ? { why: clip(x.why, 120) } : {}) } as AutoAsk
    })
    .filter((x: AutoAsk) => now - x.at < 24 * 3600_000)
    .slice(-10)
}
export function addAutoAsk(list: AutoAsk[], a: Automation, values: Record<string, ParamValue>, now: number, id = `aa${now.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`): AutoAsk[] {
  const status: AutoAsk['status'] = confirmNeeded(a, 'ben') ? 'waiting' : 'go'
  return [...list, { id, at: now, auto: a.id, name: a.name, values, status }].slice(-10)
}
export const openAutoAsks = (list: AutoAsk[], now: number) => list.filter((x) => (x.status === 'waiting' || x.status === 'go') && now - x.at < AUTO_ASK_TTL_MS)
export const setAutoAsk = (list: AutoAsk[], id: string, status: AutoAsk['status'], why?: string) => list.map((x) => (x.id === id ? { ...x, status, ...(why ? { why: why.slice(0, 120) } : {}) } : x))

// ---------------------------------------------------------------- Ben suggests (AH22)

/** One thing you did by hand, in a form a step can repeat. */
export interface DoneStep { at: number; key: string; label: string; step: Step }
export const SUGGEST_GAP_MS = 5 * 60_000
/**
 * The same 3 things in a row (each within 5 minutes of the one before), done
 * on 3 separate occasions → offer it as a button. Returns the newest one.
 */
export function findRepeat(history: DoneStep[], dismissed: string[] = [], existing: Automation[] = [], n = 3, times = 3): { key: string; steps: DoneStep[] } | null {
  const h = [...history].sort((a, b) => a.at - b.at)
  const seqs = new Map<string, { count: number; lastEnd: number; steps: DoneStep[] }>()
  for (let i = 0; i + n <= h.length; i++) {
    const w = h.slice(i, i + n)
    if (w.some((s, j) => j > 0 && s.at - w[j - 1].at > SUGGEST_GAP_MS)) continue
    if (new Set(w.map((s) => s.key)).size < n) continue
    const key = w.map((s) => s.key).join(' > ')
    const cur = seqs.get(key) ?? { count: 0, lastEnd: -1, steps: w }
    // Separate occasions: no overlap with the last counted one.
    if (i > cur.lastEnd) {
      cur.count++
      cur.lastEnd = i + n - 1
      cur.steps = w
    }
    seqs.set(key, cur)
  }
  const have = new Set(existing.map((a) => a.steps.map((s) => JSON.stringify(s)).join('|')))
  let best: { key: string; steps: DoneStep[] } | null = null
  for (const [key, v] of seqs) {
    if (v.count < times || dismissed.includes(key)) continue
    if (have.has(v.steps.map((s) => JSON.stringify(s.step)).join('|'))) continue
    if (!best || v.steps[0].at > best.steps[0].at) best = { key, steps: v.steps }
  }
  return best
}
/** The offered button: switched off, made by Ben, asks on its first run. */
export function suggestedAutomation(seq: { steps: DoneStep[] }, now = Date.now()): Automation {
  const names = seq.steps.map((s) => s.label)
  return cleanAutomation({ id: newAutoId(now), name: names.join(' + ').slice(0, 40), icon: '✨', on: false, steps: seq.steps.map((s) => s.step), params: [], risk: 'ask', when: [], pin: false, fav: false, ben: false, byBen: true, ranOnce: false })!
}

// ---------------------------------------------------------------- recipes become "When X" (AH16)

/** An old Smart island recipe → the same thing as an automation (one engine). */
export function fromRecipe(r: Recipe): Automation | null {
  const when: Trigger[] = []
  if (r.when.on === 'time' && r.when.at) when.push({ on: 'time', at: r.when.at })
  else if (r.when.on === 'context' && r.when.ctx) when.push({ on: 'context', ctx: r.when.ctx })
  else if (r.when.on !== 'time' && r.when.on !== 'context') when.push({ on: r.when.on })
  return cleanAutomation({
    id: `r_${r.id}`.replace(/[^a-z0-9_-]/gi, '').slice(0, 40),
    name: r.name,
    icon: '✨',
    on: r.on,
    steps: r.then.map((act) => ({ do: 'safe', act })),
    params: [],
    risk: r.confirmFirst ? 'ask' : 'safe',
    when,
    ...(r.if ? { if: { days: r.if.days, from: r.if.from, to: r.if.to } } : {}),
    pin: false,
    fav: false,
    ben: false,
    ranOnce: r.ranOnce,
    ...(r.byBen ? { byBen: true } : {})
  })
}

/** Starter automations for the "Add" menu (they start off and unpinned). */
export const AUTOMATION_TEMPLATES: { label: string; make: () => Partial<Automation> }[] = [
  { label: 'Home Wi-Fi → start my evening', make: () => ({ name: 'Home', icon: '🏠', when: [{ on: 'wifi', name: 'Home' }], steps: [{ do: 'safe', act: { do: 'open', page: 'today' } }], risk: 'ask' }) },
  { label: 'Battery low → push to my phone', make: () => ({ name: 'Battery low', icon: '🔋', when: [{ on: 'battery', below: 15 }], steps: [{ do: 'ntfy', text: 'Battery at {{trigger.battery}}%: plug in' }], risk: 'safe' }) },
  { label: 'Copied a link → save it as a note', make: () => ({ name: 'Save links', icon: '🔗', when: [{ on: 'clipboard', pattern: 'https://' }], steps: [{ do: 'note', title: 'Inbox', text: '{{trigger.clip}}' }], risk: 'ask' }) },
  { label: 'Before "Lecture" → focus pack', make: () => ({ name: 'Lecture', icon: '🎓', when: [{ on: 'calendar', match: 'Lecture', before: 5 }], steps: [{ do: 'safe', act: { do: 'focusPack' } }], risk: 'safe' }) }
]
