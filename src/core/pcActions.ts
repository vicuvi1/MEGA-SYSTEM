// AU7: Ben can do small things on your PC, only with your OK. Pure and tested.
// Ben writes an action line ("pc: open spotify"); it becomes an ask, kept in
// the synced setting `pc_asks` for 10 minutes; the desktop island shows
// "Ben wants to: open Spotify  [Allow] [Deny]" and nothing runs without that
// tap. The desktop checks everything again before running it: the deny list
// (banking, password managers, Windows Security, the registry, shells,
// anything with "pass" or "bank"), at most a few actions a minute, https
// links only, no programs as files. Every run or refusal goes to a log on
// that PC (Settings → PC & automation).

export type PcActKind = 'open' | 'url' | 'file' | 'type' | 'keys' | 'feature'
export interface PcAct { kind: PcActKind; arg: string }
export interface PcAsk { id: string; at: number; act: PcAct; status: 'waiting' | 'allowed' | 'denied' | 'done' | 'failed' | 'expired'; why?: string }

export const PC_ASK_TTL_MS = 10 * 60_000
export const PC_ACTS_PER_MIN = 4

/** Words that are never touched: money, passwords, security, system internals and shells. */
export const DENY_WORDS = [
  'bank', 'pass', 'paypal', 'revolut', 'wise', 'crypto', 'wallet', 'coinbase', 'binance', 'metamask', 'ledger live',
  'bitwarden', 'keepass', 'lastpass', 'dashlane', 'keeper', 'enpass', 'vault', 'authenticator', 'authy', 'credential',
  'windows security', 'defender', 'securityhealth', 'windowsdefender', 'firewall', 'uac', 'bitlocker',
  'regedit', 'registry', 'gpedit', 'secpol', 'cmd', 'powershell', 'pwsh', 'wsl', 'bash', 'mshta', 'wscript', 'cscript', 'rundll32', 'regsvr32', 'certutil', 'bcdedit', 'diskpart', 'format', 'taskschd', 'schtasks', 'netsh', 'sudo', 'msiexec'
]
/** File types that run something when opened: never opened by Ben. */
const RUNNABLE = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|lnk|url|reg|hta|cpl|jar|appref-ms|pif|dll|sys|inf)$/i

/** Apps Ben can open by name, and how (a protocol link or a program name). Others: by their plain name. */
export const KNOWN_APPS: Record<string, { label: string; uri?: string; exe?: string }> = {
  spotify: { label: 'Spotify', uri: 'spotify:' },
  calculator: { label: 'Calculator', exe: 'calc.exe' },
  calc: { label: 'Calculator', exe: 'calc.exe' },
  notepad: { label: 'Notepad', exe: 'notepad.exe' },
  'vs code': { label: 'VS Code', exe: 'code' },
  vscode: { label: 'VS Code', exe: 'code' },
  code: { label: 'VS Code', exe: 'code' },
  explorer: { label: 'File Explorer', exe: 'explorer.exe' },
  files: { label: 'File Explorer', exe: 'explorer.exe' },
  'file explorer': { label: 'File Explorer', exe: 'explorer.exe' },
  settings: { label: 'Windows Settings', uri: 'ms-settings:' },
  'task manager': { label: 'Task Manager', exe: 'taskmgr.exe' },
  paint: { label: 'Paint', exe: 'mspaint.exe' },
  word: { label: 'Word', exe: 'winword' },
  excel: { label: 'Excel', exe: 'excel' },
  powerpoint: { label: 'PowerPoint', exe: 'powerpnt' },
  obsidian: { label: 'Obsidian', uri: 'obsidian:' },
  discord: { label: 'Discord', uri: 'discord:' },
  steam: { label: 'Steam', uri: 'steam:' },
  telegram: { label: 'Telegram', uri: 'tg:' },
  chrome: { label: 'Chrome', exe: 'chrome' },
  edge: { label: 'Edge', uri: 'microsoft-edge:' },
  firefox: { label: 'Firefox', exe: 'firefox' },
  clock: { label: 'Clock', uri: 'ms-clock:' },
  calendar: { label: 'Calendar', uri: 'outlookcal:' },
  mail: { label: 'Mail', uri: 'mailto:' },
  'snipping tool': { label: 'Snipping Tool', uri: 'ms-screenclip:' },
  powertoys: { label: 'PowerToys', exe: 'PowerToys' }
}

/**
 * Windows features Ben can open: their own settings pages and tools (uri),
 * PowerToys Run by its default shortcut (keys, Alt+Space), PowerToys itself
 * (only when it is installed; the desktop looks for it).
 */
export const FEATURES: Record<string, { label: string; uri?: string; keys?: string; powertoys?: boolean }> = {
  'focus assist': { label: 'Focus / Do not disturb', uri: 'ms-settings:quiethours' },
  'do not disturb': { label: 'Focus / Do not disturb', uri: 'ms-settings:quiethours' },
  focus: { label: 'Focus / Do not disturb', uri: 'ms-settings:quiethours' },
  'night light': { label: 'Night light', uri: 'ms-settings:nightlight' },
  display: { label: 'Display settings', uri: 'ms-settings:display' },
  sound: { label: 'Sound settings', uri: 'ms-settings:sound' },
  bluetooth: { label: 'Bluetooth', uri: 'ms-settings:bluetooth' },
  wifi: { label: 'Wi-Fi', uri: 'ms-settings:network-wifi' },
  battery: { label: 'Battery saver', uri: 'ms-settings:batterysaver' },
  'battery saver': { label: 'Battery saver', uri: 'ms-settings:batterysaver' },
  notifications: { label: 'Notifications', uri: 'ms-settings:notifications' },
  snip: { label: 'Screen snip', uri: 'ms-screenclip:' },
  screenshot: { label: 'Screen snip', uri: 'ms-screenclip:' },
  'clock timer': { label: 'Clock (timers)', uri: 'ms-clock:' },
  'powertoys run': { label: 'PowerToys Run', keys: '% ' },
  'command palette': { label: 'PowerToys Run', keys: '% ' },
  powertoys: { label: 'PowerToys', powertoys: true }
}

/** Keys allowed in a combo ("ctrl+shift+esc"). The Windows key can't be pressed this way. */
const KEY_NAMES: Record<string, string> = {
  enter: '{ENTER}', esc: '{ESC}', escape: '{ESC}', tab: '{TAB}', space: ' ', backspace: '{BACKSPACE}', delete: '{DELETE}', del: '{DELETE}',
  up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}', home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}',
  f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}', f5: '{F5}', f6: '{F6}', f7: '{F7}', f8: '{F8}', f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}'
}
const MODS: Record<string, string> = { ctrl: '^', control: '^', shift: '+', alt: '%' }
/** Combos that are never pressed (close the app without asking, log out, task switching tricks). */
const BAD_COMBOS = new Set(['alt+f4', 'ctrl+alt+delete', 'ctrl+alt+del', 'ctrl+shift+delete'])

const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Ben's line → an action, or null. "pc: open spotify", "pc: url https://…", "pc: keys ctrl+shift+t". */
export function readPcAction(line: string): PcAct | null {
  const m = /^\s*pc\s*:\s*(open|launch|start|url|link|file|type|keys?|press|feature)\s*[:\s]\s*(.+)$/i.exec(String(line ?? ''))
  if (!m) return null
  const verb = m[1].toLowerCase()
  const arg = m[2].trim().replace(/^["']|["']$/g, '').trim()
  if (!arg) return null
  const kind: PcActKind = verb === 'launch' || verb === 'start' ? 'open' : verb === 'link' ? 'url' : verb === 'key' || verb === 'press' ? 'keys' : (verb as PcActKind)
  const max = kind === 'type' ? 200 : kind === 'url' || kind === 'file' ? 400 : 60
  if (arg.length > max) return null
  return { kind, arg }
}

/** "open Spotify", "type “hello”", "press Ctrl+Shift+T": what the card says. */
export function pcActText(a: PcAct): string {
  if (a.kind === 'open') return `open ${KNOWN_APPS[norm(a.arg)]?.label ?? a.arg}`
  if (a.kind === 'url') {
    try {
      return `open ${new URL(a.arg).hostname.replace(/^www\./, '')}`
    } catch {
      return `open ${a.arg.slice(0, 40)}`
    }
  }
  if (a.kind === 'file') return `open the file ${a.arg.split(/[\\/]/).pop()}`
  if (a.kind === 'type') return `type “${a.arg.length > 40 ? `${a.arg.slice(0, 40)}…` : a.arg}”`
  if (a.kind === 'keys') return `press ${a.arg.split('+').map((k) => k.trim()).map((k) => (k.length <= 3 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1))).join('+')}`
  return `open ${FEATURES[norm(a.arg)]?.label ?? a.arg}`
}

/** Why this action is refused (deny list, bad link or file, unknown key), or null when it may be asked. */
export function pcDenied(a: PcAct): string | null {
  const text = norm(a.arg)
  const word = DENY_WORDS.find((w) => text.split(' ').some((t) => t.includes(w.replace(/\s+/g, ''))) || text.includes(w))
  if (word && a.kind !== 'type') return `“${word}” is on the never list`
  if (a.kind === 'type') {
    if (/[\r\n]/.test(a.arg)) return 'One line only'
    if (/\b(pass(word)?|pin|bank|iban|card|cvv)\b/i.test(a.arg)) return 'Ben never types passwords, PINs or bank details'
    return null
  }
  if (a.kind === 'url') {
    let u: URL
    try {
      u = new URL(a.arg)
    } catch {
      return 'Not a link'
    }
    if (u.protocol !== 'https:') return 'Only https links'
    if (u.username || u.password) return 'No links with sign-in details'
    if (DENY_WORDS.some((w) => u.hostname.includes(w.replace(/\s+/g, '')))) return 'That site is on the never list'
    return null
  }
  if (a.kind === 'file') {
    if (!/^([a-z]:\\|\\\\|\/|~[\\/])/i.test(a.arg)) return 'Give the full path'
    if (RUNNABLE.test(a.arg.trim())) return 'Ben never opens programs or scripts as files'
    if (/\.\.[\\/]/.test(a.arg)) return 'No “..” in paths'
    return null
  }
  if (a.kind === 'open') {
    if (KNOWN_APPS[text]) return null
    if (!/^[\p{L}\p{N} ._+-]{2,40}$/u.test(a.arg)) return 'Use the plain name of the app'
    if (RUNNABLE.test(a.arg) && !/\.exe$/i.test(a.arg)) return 'Not an app name'
    return null
  }
  if (a.kind === 'keys') return keysToSend(a.arg) ? null : 'Those keys are not allowed'
  return FEATURES[text] ? null : 'Not a feature Ben knows'
}

/** "ctrl+shift+t" → SendKeys "^+t"; null when a key isn't allowed. */
export function keysToSend(combo: string): string | null {
  const c = String(combo ?? '').toLowerCase().replace(/\s+/g, '')
  if (!c || BAD_COMBOS.has(c)) return null
  const parts = c.split('+').filter(Boolean)
  if (!parts.length || parts.length > 4) return null
  let mods = ''
  let key: string | null = null
  for (const p of parts) {
    if (MODS[p]) {
      if (mods.includes(MODS[p])) return null
      mods += MODS[p]
    } else if (key == null && /^[a-z0-9]$/.test(p)) key = p
    else if (key == null && KEY_NAMES[p] !== undefined) key = KEY_NAMES[p]
    else return null
  }
  return key == null ? null : `${mods}${key}`
}

/** Text → SendKeys with its special characters escaped (+ ^ % ~ ( ) { } [ ]). */
export function textToSend(t: string): string {
  return String(t ?? '').replace(/[+^%~(){}[\]]/g, (ch) => `{${ch}}`)
}

/** Rate limit: at most N runs in the last minute. */
export function rateOk(times: number[], now: number, max = PC_ACTS_PER_MIN): boolean {
  return times.filter((t) => now - t < 60_000).length < max
}

/** The asks list as stored (synced), cleaned, with old ones dropped (20 kept). */
export function cleanAsks(v: unknown, now: number): PcAsk[] {
  const list = Array.isArray(v) ? v : []
  const out: PcAsk[] = []
  for (const x of list) {
    const act = x?.act && readPcAction(`pc: ${x.act.kind} ${x.act.arg}`)
    if (!act || typeof x.id !== 'string' || !Number.isFinite(Number(x.at))) continue
    const status = ['waiting', 'allowed', 'denied', 'done', 'failed', 'expired'].includes(x.status) ? x.status : 'waiting'
    const at = Number(x.at)
    if (now - at > 24 * 3600_000) continue
    out.push({ id: x.id.slice(0, 24), at, act, status: status === 'waiting' && now - at > PC_ASK_TTL_MS ? 'expired' : status, ...(typeof x.why === 'string' ? { why: x.why.slice(0, 120) } : {}) })
  }
  return out.slice(-20)
}

/** A new ask, added to the list (the same waiting action isn't asked twice). */
export function addAsk(list: PcAsk[], act: PcAct, now: number, id = `pa${now.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`): { list: PcAsk[]; ask: PcAsk | null } {
  const same = list.find((a) => a.status === 'waiting' && a.act.kind === act.kind && a.act.arg === act.arg && now - a.at < PC_ASK_TTL_MS)
  if (same) return { list, ask: null }
  const ask: PcAsk = { id, at: now, act, status: 'waiting' }
  return { list: [...list, ask].slice(-20), ask }
}

/** The oldest waiting ask still fresh: the one the island shows. */
export function nextAsk(list: PcAsk[], now: number): PcAsk | null {
  return list.filter((a) => a.status === 'waiting' && now - a.at < PC_ASK_TTL_MS && now - a.at > -60_000).sort((a, b) => a.at - b.at)[0] ?? null
}

export function setAskStatus(list: PcAsk[], id: string, status: PcAsk['status'], why?: string): PcAsk[] {
  return list.map((a) => (a.id === id ? { ...a, status, ...(why ? { why: why.slice(0, 120) } : {}) } : a))
}

/** Ben's help line (in the live part of his prompt). */
export const PC_ACTIONS_HELP =
  'PC actions (desktop app only; he must tap Allow on the island first, nothing runs without it): "pc: open <app>" (spotify, vs code, notepad…), "pc: url <https link>", "pc: file <full path>", "pc: type <short text>", "pc: keys <combo like ctrl+shift+t>", "pc: feature <focus assist|night light|snip|powertoys run…>". Only when he asks for it. Never banking, passwords or security apps.'

/** The synced setting `pc_asks`: Ben's asks, and whether a desktop app can answer them (it says so every 10 min). */
export interface PcState { desk: { on: boolean; at: number } | null; asks: PcAsk[] }

export function cleanPcState(v: unknown, now: number): PcState {
  const o = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, any>
  const d = o.desk
  return { desk: d && typeof d === 'object' && Number.isFinite(Number(d.at)) ? { on: d.on === true, at: Number(d.at) } : null, asks: cleanAsks(Array.isArray(v) ? v : o.asks, now) }
}

/** A desktop app with Ben's actions on was seen in the last 30 minutes. */
export const deskReady = (s: PcState, now: number) => !!s.desk?.on && now - s.desk.at < 30 * 60_000
