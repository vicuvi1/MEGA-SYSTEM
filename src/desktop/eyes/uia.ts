// EY1: the text of the window in front, from Windows UI Automation (built
// into Windows, nothing to download). One short PowerShell run, only when
// the window in front changed and the guard allows it; killed after 3 s.
// Your private list is checked inside the script against the app and the
// title BEFORE any text is read. Password boxes and off-screen parts are
// skipped; at most ~2000 characters come back, and only a 120-character
// summary is kept (eyesGuard).
import { execFile } from 'node:child_process'

export interface WindowRead {
  proc: string
  title: string
  /** The window handle (to capture just this window for EY2/EY3). */
  hwnd: number
  text: string
  /** The private list matched (no text was read). */
  denied?: boolean
}

export const UIA_TIMEOUT_MS = 3000
export const UIA_MAX_CHARS = 2000

/** The script. `textToo` false: only app, title and handle (before a screen capture). */
export function uiaScript(denyRe: string, textToo = true, maxChars = UIA_MAX_CHARS): string {
  // denyRe comes from denyRegex(): no quotes of any kind can be in it.
  const re = denyRe.replace(/['"`]/g, '.')
  return [
    "$ErrorActionPreference='Stop'",
    '$sw=[System.Diagnostics.Stopwatch]::StartNew()',
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes',
    '$A=[System.Windows.Automation.AutomationElement]',
    '$W=[System.Windows.Automation.TreeWalker]::ControlViewWalker',
    '$root=$A::RootElement',
    // The top-level window that holds the focus (no compiled code needed).
    '$e=$A::FocusedElement; $win=$null',
    'while($e -ne $null){ $p=$W.GetParent($e); if($p -eq $null -or $root.Equals($p)){ $win=$e; break }; $e=$p }',
    "if($win -eq $null){ Write-Output '{}'; exit }",
    '$c=$win.Current; $title=[string]$c.Name; $hwnd=[int64]$c.NativeWindowHandle; $pn=""',
    'try { $pn=(Get-Process -Id $c.ProcessId).ProcessName } catch {}',
    `if(("$pn $title") -match '${re}'){ @{proc=$pn; denied=$true; hwnd=0; title=''; text=''} | ConvertTo-Json -Compress; exit }`,
    ...(textToo
      ? [
          '$sb=New-Object System.Text.StringBuilder; $seen=@{}',
          '$q=New-Object System.Collections.Queue; $q.Enqueue($win); $n=0',
          `while($q.Count -gt 0 -and $n -lt 700 -and $sb.Length -lt ${maxChars} -and $sw.ElapsedMilliseconds -lt 2400){`,
          ' $x=$q.Dequeue(); $n++',
          ' try {',
          '  $k=$x.Current',
          '  if($k.IsPassword -or $k.IsOffscreen){ continue }',
          '  $ct=$k.ControlType.ProgrammaticName',
          "  if($ct -match 'Text|Hyperlink|Document|Edit|ListItem|TabItem|Header|DataItem|TreeItem|Button'){",
          '   $t=[string]$k.Name',
          "   if($ct -match 'Edit|Document'){ try { $vp=$x.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $v=[string]$vp.Current.Value; if($v){ $t=$v.Substring(0,[Math]::Min(400,$v.Length)) } } catch {} }",
          '   $t=$t.Trim(); if($t.Length -gt 1 -and -not $seen.ContainsKey($t)){ $seen[$t]=1; [void]$sb.Append($t).Append("`n") }',
          '  }',
          '  $ch=$W.GetFirstChild($x); while($ch -ne $null){ $q.Enqueue($ch); $ch=$W.GetNextSibling($ch) }',
          ' } catch {}',
          '}',
          `$txt=$sb.ToString(); if($txt.Length -gt ${maxChars}){ $txt=$txt.Substring(0,${maxChars}) }`
        ]
      : ['$txt=""']),
    '@{proc=$pn; title=$title; hwnd=$hwnd; text=$txt} | ConvertTo-Json -Compress'
  ].join('\n')
}

/** The script's one line of JSON, checked. */
export function parseRead(out: string): WindowRead | null {
  const line = String(out ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .pop()
  if (!line) return null
  try {
    const j = JSON.parse(line)
    if (!j || typeof j !== 'object' || typeof j.proc !== 'string' || !j.proc) return null
    return {
      proc: j.proc.slice(0, 80),
      title: String(j.title ?? '').slice(0, 300),
      hwnd: Number.isFinite(Number(j.hwnd)) ? Number(j.hwnd) : 0,
      text: String(j.text ?? '').slice(0, UIA_MAX_CHARS),
      ...(j.denied === true ? { denied: true } : {})
    }
  } catch {
    return null
  }
}

/** PowerShell, hidden, with a hard time limit. */
export function runPowerShell(script: string, timeoutMs: number, stdin?: string): Promise<string> {
  return new Promise((resolve) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (_err, stdout) => resolve(String(stdout ?? ''))
    )
    if (stdin != null) {
      child.stdin?.on('error', () => {})
      child.stdin?.end(stdin)
    }
  })
}

/** Reads the window in front (Windows only; elsewhere null). */
export async function readActiveWindow(denyRe: string, textToo = true): Promise<WindowRead | null> {
  if (process.platform !== 'win32') return null
  return parseRead(await runPowerShell(uiaScript(denyRe, textToo), UIA_TIMEOUT_MS))
}
