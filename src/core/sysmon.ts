// System page on the island (BrimDeck style): CPU per core, GPU, memory,
// network with a small line, the busiest apps, drives, temperatures, power
// and the battery. The desktop samples once a second only while the page is
// open. This file is the pure part (sysmon.test.ts): per-core CPU from two
// readings, the busiest apps from two process lists, the history line, the
// settings, and which apps are never closed.

export interface CpuTimes { user: number; nice: number; sys: number; idle: number; irq: number }

/** CPU use between two readings of os.cpus() times: the total and each core, 0–100. */
export function cpuDeltas(prev: CpuTimes[], cur: CpuTimes[]): { total: number; cores: number[] } {
  const cores: number[] = []
  let busyAll = 0
  let allAll = 0
  for (let i = 0; i < cur.length; i++) {
    const a = prev[i]
    const b = cur[i]
    if (!a || !b) {
      cores.push(0)
      continue
    }
    const busy = b.user - a.user + (b.nice - a.nice) + (b.sys - a.sys) + (b.irq - a.irq)
    const all = busy + (b.idle - a.idle)
    busyAll += Math.max(0, busy)
    allAll += Math.max(0, all)
    cores.push(all > 0 ? Math.round(Math.max(0, Math.min(100, (busy / all) * 100))) : 0)
  }
  return { total: allAll > 0 ? Math.round(Math.max(0, Math.min(100, (busyAll / allAll) * 100))) : 0, cores }
}

/** One process in a list: its total CPU seconds so far and its memory (bytes). */
export interface ProcSample { pid: number; name: string; cpuSec: number; mem: number }
export interface AppUse { name: string; cpu: number; mem: number; count: number; system: boolean }

/**
 * Programs that are part of Windows (or this app): they are shown but never
 * get a Close button, and a close action naming one is refused.
 */
export const SYSTEM_PROCS = new Set([
  'system', 'idle', 'system idle process', 'registry', 'memory compression', 'secure system', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'lsaiso',
  'svchost', 'dwm', 'explorer', 'fontdrvhost', 'sihost', 'taskhostw', 'ctfmon', 'spoolsv', 'searchhost', 'searchindexer', 'searchapp', 'startmenuexperiencehost',
  'shellexperiencehost', 'textinputhost', 'runtimebroker', 'applicationframehost', 'dllhost', 'wmiprvse', 'conhost', 'audiodg', 'wudfhost', 'msmpeng', 'mpdefendercoreservice',
  'nissrv', 'securityhealthservice', 'securityhealthsystray', 'smartscreen', 'lockapp', 'logonui', 'userinit', 'taskmgr', 'msedgewebview2', 'widgets', 'widgetservice',
  'phoneexperiencehost', 'gamebar', 'gamebarftserver', 'useroobebroker', 'backgroundtaskhost', 'compattelrunner', 'wlanext', 'unsecapp', 'dashost', 'igfxem', 'nvcontainer',
  'nvdisplay.container', 'amdrsserv', 'atiesrxx', 'atieclxx', 'rtkaudiouniversalservice', 'life system', 'life-system', 'electron', 'powershell', 'pwsh', 'cmd', 'typeperf',
  'kernel_task', 'launchd', 'windowserver', 'systemd', 'init', 'kthreadd', 'xorg', 'gnome-shell'
])
export const isSystemProc = (name: string) => {
  const n = String(name ?? '').toLowerCase().replace(/\.exe$/, '').trim()
  return !n || SYSTEM_PROCS.has(n) || n.startsWith('kworker') || n.startsWith('svchost')
}

/**
 * The busiest apps between two process lists, grouped by name (a browser is
 * many processes). CPU is the share of the whole PC (0–100), memory in bytes.
 */
export function topApps(prev: ProcSample[], cur: ProcSample[], elapsedMs: number, cores: number, by: 'cpu' | 'mem' = 'cpu', count = 5): AppUse[] {
  const before = new Map(prev.map((p) => [p.pid, p]))
  const groups = new Map<string, AppUse>()
  const span = Math.max(0.001, elapsedMs / 1000) * Math.max(1, cores)
  for (const p of cur) {
    const name = String(p.name ?? '').replace(/\.exe$/i, '').slice(0, 40)
    if (!name || /^idle$|^system idle process$/i.test(name)) continue
    const was = before.get(p.pid)
    // A new process (or a reused id with another name) has no earlier reading: no CPU yet.
    const used = was && was.name === p.name ? Math.max(0, p.cpuSec - was.cpuSec) : 0
    const key = name.toLowerCase()
    const g = groups.get(key) ?? { name, cpu: 0, mem: 0, count: 0, system: isSystemProc(name) }
    g.cpu += (used / span) * 100
    g.mem += Math.max(0, p.mem || 0)
    g.count++
    groups.set(key, g)
  }
  return [...groups.values()]
    .map((g) => ({ ...g, cpu: Math.round(Math.min(100, g.cpu) * 10) / 10 }))
    .sort((a, b) => (by === 'cpu' ? b.cpu - a.cpu || b.mem - a.mem : b.mem - a.mem || b.cpu - a.cpu))
    .slice(0, count)
}

/** Adds a value to a short history (the newest last). */
export function pushHistory(list: number[], v: number, max = 60): number[] {
  const out = [...list, Number.isFinite(v) ? v : 0]
  return out.length > max ? out.slice(out.length - max) : out
}

/** An SVG path for a small line chart of these values in a w × h box (0 at the bottom). */
export function sparkPath(values: number[], w: number, h: number, max?: number): string {
  if (!values.length) return ''
  const top = Math.max(max ?? 0, ...values, 1e-9)
  const step = values.length > 1 ? w / (values.length - 1) : 0
  return values.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(h - (Math.max(0, v) / top) * h).toFixed(1)}`).join(' ')
}

// ---- What the desktop sends the page ----

export interface DriveUse { name: string; label: string; size: number; free: number }
export interface SysSample {
  at: number
  cpu: { total: number; cores: number[]; model: string }
  mem: { used: number; total: number }
  /** null when this PC doesn't tell (not Windows, or no counters). */
  gpu: number | null
  net: { down: number; up: number } | null
  apps: AppUse[]
  drives: DriveUse[]
  /** °C, only the ones Windows (or LibreHardwareMonitor) reports. */
  temps: { cpu: number | null; gpu: number | null; ssd: number | null }
  /** Watts the battery is giving (laptops on battery), or what LibreHardwareMonitor reports. */
  power: number | null
  battery: { pct: number; charging: boolean; minutesLeft: number | null } | null
  windows: boolean
}

/** Hides readings that are missing or not believable (never made up). */
export function cleanTemp(v: unknown): number | null {
  const t = Number(v)
  return Number.isFinite(t) && t > 5 && t < 125 ? Math.round(t) : null
}

/** WMI's MSAcpi_ThermalZoneTemperature is in tenths of a kelvin. */
export const kelvinTenthsToC = (v: unknown) => cleanTemp(Number(v) / 10 - 273.15)

// ---- Settings (this PC only; Settings → Desktop island → System and AI usage) ----

export interface SysmonPrefs {
  pages: { system: boolean; ai: boolean }
  /** Which tools the AI usage page reads. */
  tools: { claude: boolean; codex: boolean; ben: boolean }
  /** On the closed island: the usage rings, and CPU / memory beside them (read every 30 s). */
  readings: { rings: boolean; cpuRam: boolean }
  alerts: { on: boolean; warn: number; crit: number }
  /** Your own tokens per 5 hours for each tool (0: compare with your busiest block). */
  limits: { claude: number; codex: number }
  topBy: 'cpu' | 'mem'
}

export const DEFAULT_SYSMON: SysmonPrefs = {
  pages: { system: true, ai: false },
  tools: { claude: true, codex: true, ben: true },
  readings: { rings: false, cpuRam: false },
  alerts: { on: true, warn: 70, crit: 90 },
  limits: { claude: 0, codex: 0 },
  topBy: 'cpu'
}

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
const pct = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Math.max(10, Math.min(100, Math.round(Number(v)))) : d)
const lim = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.min(1e10, Math.round(Number(v))) : 0)

export function cleanSysmonPrefs(v: any): SysmonPrefs {
  const d = DEFAULT_SYSMON
  let warn = pct(v?.alerts?.warn, d.alerts.warn)
  let crit = pct(v?.alerts?.crit, d.alerts.crit)
  if (warn >= crit) warn = Math.max(10, crit - 5)
  if (crit <= warn) crit = Math.min(100, warn + 5)
  return {
    pages: { system: bool(v?.pages?.system, d.pages.system), ai: bool(v?.pages?.ai, d.pages.ai) },
    tools: { claude: bool(v?.tools?.claude, d.tools.claude), codex: bool(v?.tools?.codex, d.tools.codex), ben: bool(v?.tools?.ben, d.tools.ben) },
    readings: { rings: bool(v?.readings?.rings, d.readings.rings), cpuRam: bool(v?.readings?.cpuRam, d.readings.cpuRam) },
    alerts: { on: bool(v?.alerts?.on, d.alerts.on), warn, crit },
    limits: { claude: lim(v?.limits?.claude), codex: lim(v?.limits?.codex) },
    topBy: v?.topBy === 'mem' ? 'mem' : 'cpu'
  }
}

/** Reading local AI logs is needed only for the AI page or the rings. */
export const readsLocalUsage = (p: SysmonPrefs) => (p.pages.ai || p.readings.rings) && (p.tools.claude || p.tools.codex)

// ---- Small formats ----

/** Bytes → "3.2 GB". */
export function fmtBytes(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let x = v
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024
    i++
  }
  return `${x.toFixed(x < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

/** Bytes a second → "1.2 MB/s". */
export const fmtRate = (v: number) => `${fmtBytes(v)}/s`
