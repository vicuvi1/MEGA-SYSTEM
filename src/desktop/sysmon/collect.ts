// System page: the readings. CPU per core and memory come from Node (os) on
// every ask. On Windows, while the page is open, ONE PowerShell process runs a
// loop that prints a line a second (GPU and network counters; the process list
// every 2 s; drives, battery, temperatures every 15 s; power every 2 s). It is
// stopped as soon as the page stops asking (5 s), so nothing runs while the
// page is closed. Temperatures and power appear only when Windows (or
// LibreHardwareMonitor / OpenHardwareMonitor, if you run one) reports them.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import os from 'node:os'
import { cleanTemp, cpuDeltas, kelvinTenthsToC, topApps, type CpuTimes, type DriveUse, type ProcSample, type SysSample } from '../../core/sysmon'

const LIVE_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$paths = @('\GPU Engine(*engtype_3D)\Utilization Percentage', '\Network Interface(*)\Bytes Received/sec', '\Network Interface(*)\Bytes Sent/sec')
$i = 0
while ($true) {
  $o = @{}
  $c = Get-Counter -Counter $paths -SampleInterval 1 -MaxSamples 1
  if (-not $c -and $paths.Count -eq 3) { $paths = $paths[1..2]; $c = Get-Counter -Counter $paths -SampleInterval 1 -MaxSamples 1 }
  if ($c) {
    $g = 0; $d = 0; $u = 0; $hasG = $false
    foreach ($s in $c.CounterSamples) {
      $p = $s.Path
      if ($p -like '*gpu engine*') { $g += $s.CookedValue; $hasG = $true }
      elseif ($s.InstanceName -match 'isatap|loopback|teredo|pseudo') { }
      elseif ($p -like '*bytes received*') { $d += $s.CookedValue }
      elseif ($p -like '*bytes sent*') { $u += $s.CookedValue }
    }
    if ($hasG) { $o.gpu = [math]::Round([math]::Min(100, $g), 1) }
    $o.down = [math]::Round($d); $o.up = [math]::Round($u)
  } else { Start-Sleep -Milliseconds 900 }
  if ($i % 2 -eq 0) {
    $o.procs = @(Get-Process | Where-Object { $_.Id -gt 4 } | ForEach-Object { ,@($_.Id, $_.ProcessName, [math]::Round([double]$_.CPU, 2), $_.WorkingSet64) })
    $bs = Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus | Select-Object -First 1
    if ($bs -and $bs.Discharging -and $bs.DischargeRate -gt 0) { $o.bpower = [math]::Round($bs.DischargeRate / 1000, 1) }
    $hw = $null
    foreach ($ns in 'root/LibreHardwareMonitor', 'root/OpenHardwareMonitor') { if (-not $hw) { $hw = Get-CimInstance -Namespace $ns -ClassName Sensor } }
    if ($hw) {
      $o.hw = @($hw | Where-Object { $_.SensorType -eq 'Temperature' -or $_.SensorType -eq 'Power' } | ForEach-Object { ,@($_.SensorType, $_.Name, $_.Identifier, [math]::Round([double]$_.Value, 1)) })
    }
  }
  if ($i % 15 -eq 0) {
    $o.drives = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { ,@($_.DeviceID, $_.VolumeName, $_.Size, $_.FreeSpace) })
    $b = Get-CimInstance Win32_Battery | Select-Object -First 1
    if ($b) { $o.bat = @($b.EstimatedChargeRemaining, $b.BatteryStatus, $b.EstimatedRunTime) }
    $z = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature | Select-Object -First 1
    if ($z) { $o.zone = $z.CurrentTemperature }
  }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4))
  $i++
}
`

const times = (): CpuTimes[] => os.cpus().map((c) => ({ user: c.times.user, nice: c.times.nice, sys: c.times.sys, idle: c.times.idle, irq: c.times.irq }))

interface Live {
  gpu: number | null
  net: { down: number; up: number } | null
  procs: { at: number; list: ProcSample[] } | null
  prevProcs: { at: number; list: ProcSample[] } | null
  drives: DriveUse[]
  battery: SysSample['battery']
  temps: SysSample['temps']
  power: number | null
}
const emptyLive = (): Live => ({ gpu: null, net: null, procs: null, prevProcs: null, drives: [], battery: null, temps: { cpu: null, gpu: null, ssd: null }, power: null })

/** LibreHardwareMonitor sensors → CPU / GPU / SSD temperatures and the power draw. */
export function readHw(rows: [string, string, string, number][]): { temps: SysSample['temps']; power: number | null } {
  const temp = (want: RegExp, name?: RegExp) => {
    const r = rows.filter(([t, n, id]) => t === 'Temperature' && want.test(id) && (!name || name.test(n)))
    return r.length ? cleanTemp(Math.max(...r.map((x) => Number(x[3])))) : null
  }
  const pw = rows.filter(([t, n, id]) => t === 'Power' && ((/cpu/i.test(id) && /package/i.test(n)) || (/gpu/i.test(id) && /(package|power|board)/i.test(n))))
  const watts = pw.reduce((s, x) => s + (Number(x[3]) || 0), 0)
  return {
    temps: { cpu: temp(/cpu/i, /package|tctl|tdie|core \(max\)|average/i) ?? temp(/cpu/i), gpu: temp(/gpu/i, /core|hot spot/i) ?? temp(/gpu/i), ssd: temp(/nvme|hdd|ssd/i) },
    power: pw.length && watts > 0 && watts < 2000 ? Math.round(watts * 10) / 10 : null
  }
}

export function createCollector() {
  let ps: ChildProcessWithoutNullStreams | null = null
  let live = emptyLive()
  let lastAsk = 0
  let watch: ReturnType<typeof setInterval> | null = null
  let prevCpu = { at: Date.now(), t: times() }
  let lightCpu = { at: Date.now(), t: times() }

  const onLine = (line: string) => {
    let j: any
    try {
      j = JSON.parse(line)
    } catch {
      return
    }
    live.gpu = Number.isFinite(j.gpu) ? Number(j.gpu) : live.gpu
    if (Number.isFinite(j.down)) live.net = { down: Number(j.down), up: Number(j.up) || 0 }
    if (Array.isArray(j.procs)) {
      live.prevProcs = live.procs
      live.procs = { at: Date.now(), list: j.procs.filter(Array.isArray).map((p: any[]) => ({ pid: Number(p[0]), name: String(p[1] ?? ''), cpuSec: Number(p[2]) || 0, mem: Number(p[3]) || 0 })) }
      const hw = Array.isArray(j.hw) ? readHw(j.hw) : null
      if (hw) live.temps = { ...live.temps, ...Object.fromEntries(Object.entries(hw.temps).filter(([, v]) => v != null)) }
      live.power = hw?.power ?? (Number.isFinite(j.bpower) ? Number(j.bpower) : null)
    }
    if (Array.isArray(j.drives)) live.drives = j.drives.filter(Array.isArray).map((d: any[]) => ({ name: String(d[0] ?? ''), label: String(d[1] ?? ''), size: Number(d[2]) || 0, free: Number(d[3]) || 0 })).filter((d: DriveUse) => d.size > 0)
    if (Array.isArray(j.bat)) {
      // Win32_Battery BatteryStatus: 2 = on the charger; 6–9 = charging.
      const st = Number(j.bat[1])
      const run = Number(j.bat[2])
      live.battery = { pct: Math.max(0, Math.min(100, Number(j.bat[0]) || 0)), charging: st === 2 || (st >= 6 && st <= 9), minutesLeft: run > 0 && run < 71582 ? run : null }
    }
    if (j.zone != null && live.temps.cpu == null) live.temps = { ...live.temps, cpu: kelvinTenthsToC(j.zone) }
  }

  const stop = () => {
    if (watch) clearInterval(watch)
    watch = null
    if (ps) {
      try {
        ps.kill()
      } catch {
        /* gone */
      }
    }
    ps = null
    live = emptyLive()
  }

  const start = () => {
    if (ps || process.platform !== 'win32') return
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(LIVE_SCRIPT, 'utf16le').toString('base64')], { windowsHide: true })
    ps = child
    let buf = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => {
      buf += d
      if (buf.length > 1_000_000) buf = ''
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (line) onLine(line)
      }
    })
    child.stderr.on('data', () => {})
    child.on('exit', () => {
      if (ps === child) ps = null
    })
    // Nobody asked for 5 s (the page closed, the island hid): stop sampling.
    watch = setInterval(() => {
      if (Date.now() - lastAsk > 5000) stop()
    }, 2000)
  }

  return {
    /** The full reading for the open System page (starts the live loop on Windows). */
    sample(topBy: 'cpu' | 'mem'): SysSample {
      lastAsk = Date.now()
      start()
      const now = Date.now()
      const t = times()
      const cpu = cpuDeltas(prevCpu.t, t)
      prevCpu = { at: now, t }
      const p = live.procs
      const q = live.prevProcs
      return {
        at: now,
        cpu: { ...cpu, model: (os.cpus()[0]?.model ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) },
        mem: { used: os.totalmem() - os.freemem(), total: os.totalmem() },
        gpu: live.gpu,
        net: live.net,
        apps: p && q ? topApps(q.list, p.list, p.at - q.at, t.length, topBy) : p ? topApps(p.list, p.list, 1000, t.length, topBy) : [],
        drives: live.drives,
        temps: live.temps,
        power: live.power,
        battery: live.battery,
        windows: process.platform === 'win32'
      }
    },
    /** The closed island's CPU / memory reading (Node only, no PowerShell). */
    light(): { cpu: number; mem: number } {
      const t = times()
      const cpu = cpuDeltas(lightCpu.t, t).total
      lightCpu = { at: Date.now(), t }
      return { cpu, mem: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100) }
    },
    stop
  }
}
