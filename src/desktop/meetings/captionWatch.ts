// MT1: the Live Captions watcher. One PowerShell process, started only while
// you caption and killed when you stop, when the call ends, on quit and on the
// release check's quick exit. It opens Windows 11 Live Captions if it isn't
// open, finds its window (class LiveCaptionsDesktopWindow) and the caption
// text (AutomationId CaptionsTextBlock; if Windows names it differently, the
// longest text element in that window), reads it about once a second and
// writes a line only when the text changed. It ends by itself if the app is
// gone (checked every 10 s), so it can never be left behind.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const liveCaptionsExe = () => join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'LiveCaptions.exe')

/** Is Windows Live Captions on this PC (Windows 11 22H2 and later)? */
export const hasLiveCaptions = () => process.platform === 'win32' && existsSync(liveCaptionsExe())

export type WatchLine = { s: 'ok'; t: string } | { s: 'nowin' } | { s: 'found'; via: 'id' | 'search' } | { s: 'launched' } | { s: 'noexe' }

export function watchScript(exe: string, parentPid: number): string {
  const e = exe.replace(/'/g, "''")
  return [
    "$ErrorActionPreference='SilentlyContinue'",
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes',
    '$A=[System.Windows.Automation.AutomationElement]; $S=[System.Windows.Automation.TreeScope]; $P=[System.Windows.Automation.PropertyCondition]',
    '$root=$A::RootElement',
    "$wc=$P::new($A::ClassNameProperty,'LiveCaptionsDesktopWindow')",
    "$ic=$P::new($A::AutomationIdProperty,'CaptionsTextBlock')",
    '$tc=$P::new($A::ControlTypeProperty,[System.Windows.Automation.ControlType]::Text)',
    "$win=$null; $tb=$null; $via=''; $prev=$null; $n=0; $launched=$false",
    'function Say($o){ [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }',
    'while($true){',
    ' $n++',
    ` if(($n % 10) -eq 0 -and -not (Get-Process -Id ${Math.max(1, Math.floor(parentPid))} -ErrorAction SilentlyContinue)){ exit }`,
    ' if($win -eq $null){',
    '  $win=$root.FindFirst($S::Children,$wc); $tb=$null',
    "  if($win -eq $null -and -not $launched){ $launched=$true; try { Start-Process -FilePath '" + e + "' -ErrorAction Stop; Say @{s='launched'} } catch { Say @{s='noexe'}; exit } }",
    ' }',
    // The text element: by its id, else the longest text in the window (looked for again every 10 s).
    " if($win -ne $null -and $via -eq 'search' -and ($n % 10) -eq 0){ $tb=$null }",
    ' if($win -ne $null -and $tb -eq $null){',
    "  $tb=$win.FindFirst($S::Descendants,$ic); $via='id'",
    "  if($tb -eq $null){ $bl=-1; foreach($x in $win.FindAll($S::Descendants,$tc)){ $l=([string]$x.Current.Name).Length; if($l -gt $bl){ $bl=$l; $tb=$x } }; $via='search' }",
    "  if($tb -ne $null){ Say @{s='found'; via=$via} }",
    ' }',
    " if($win -eq $null){ if($prev -ne '#nowin'){ $prev='#nowin'; Say @{s='nowin'} } }",
    ' elseif($tb -ne $null){',
    '  $t=$null; try { $t=[string]$tb.Current.Name } catch { $t=$null }',
    // The window or the element went away: look for them again.
    '  if($t -eq $null){ try { [void]$win.Current.ClassName } catch { $win=$null }; $tb=$null }',
    "  elseif($t -ne $prev){ $prev=$t; if($t.Length -gt 4000){ $t=$t.Substring($t.Length-4000) }; Say @{s='ok'; t=$t} }",
    ' }',
    ' Start-Sleep -Milliseconds 1000',
    '}'
  ].join('\n')
}

export function parseWatchLine(line: string): WatchLine | null {
  const l = String(line ?? '').trim()
  if (!l.startsWith('{')) return null
  try {
    const j = JSON.parse(l)
    if (j?.s === 'ok') return { s: 'ok', t: String(j.t ?? '').slice(-4000) }
    if (j?.s === 'found') return { s: 'found', via: j.via === 'search' ? 'search' : 'id' }
    if (j?.s === 'nowin' || j?.s === 'launched' || j?.s === 'noexe') return { s: j.s }
  } catch {
    /* not ours */
  }
  return null
}

/** Starts the watcher; `onLine` gets each line, `onExit` when it ends. Returns a stop function. */
export function startCaptionWatch(onLine: (l: WatchLine) => void, onExit: () => void): () => void {
  let child: ChildProcess | null = null
  try {
    const script = watchScript(liveCaptionsExe(), process.pid)
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    setTimeout(onExit, 0)
    return () => {}
  }
  let buf = ''
  child.stdout?.on('data', (d: Buffer) => {
    buf += d.toString('utf8')
    if (buf.length > 64_000) buf = buf.slice(-16_000)
    const lines = buf.split(/\r?\n/)
    buf = lines.pop() ?? ''
    for (const l of lines) {
      const w = parseWatchLine(l)
      if (w) onLine(w)
    }
  })
  let ended = false
  const end = () => {
    if (ended) return
    ended = true
    onExit()
  }
  child.on('exit', end)
  child.on('error', end)
  return () => {
    try {
      child?.kill()
    } catch {
      /* already gone */
    }
    child = null
  }
}
