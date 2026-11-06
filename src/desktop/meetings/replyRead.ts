// AI17: what "Help me reply" reads, only on your tap. First the text you
// selected (UI Automation's TextPattern on the focused element and up to 3 of
// its parents), else the window's text through the eyes' own reader. Your
// private list is checked inside the script against the app and the title
// BEFORE any text is read; password boxes are never read. One short
// PowerShell run, killed after 3 s.
import { runPowerShell, readActiveWindow } from '../eyes/uia'

export interface Selection {
  proc: string
  title: string
  sel: string
  denied?: boolean
}

export function selectionScript(denyRe: string): string {
  const re = denyRe.replace(/['"`]/g, '.')
  return [
    "$ErrorActionPreference='Stop'",
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes',
    '$A=[System.Windows.Automation.AutomationElement]',
    '$W=[System.Windows.Automation.TreeWalker]::ControlViewWalker',
    '$root=$A::RootElement',
    '$f=$A::FocusedElement; $e=$f; $win=$null',
    'while($e -ne $null){ $p=$W.GetParent($e); if($p -eq $null -or $root.Equals($p)){ $win=$e; break }; $e=$p }',
    "if($win -eq $null){ Write-Output '{}'; exit }",
    '$c=$win.Current; $title=[string]$c.Name; $pn=""',
    'try { $pn=(Get-Process -Id $c.ProcessId).ProcessName } catch {}',
    `if(("$pn $title") -match '${re}'){ @{proc=$pn; denied=$true; title=''; sel=''} | ConvertTo-Json -Compress; exit }`,
    '$sel=""; $x=$f; $k=0',
    'while($x -ne $null -and $k -lt 4 -and -not $sel){',
    ' $k++',
    ' try {',
    '  if(-not $x.Current.IsPassword){',
    '   $tp=$x.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)',
    '   foreach($r in $tp.GetSelection()){ $sel+=$r.GetText(1500) }',
    '  }',
    ' } catch {}',
    ' if($root.Equals($x) -or $win.Equals($x)){ break }',
    ' try { $x=$W.GetParent($x) } catch { $x=$null }',
    '}',
    '@{proc=$pn; title=$title; sel=$sel.Trim()} | ConvertTo-Json -Compress'
  ].join('\n')
}

export function parseSelection(out: string): Selection | null {
  const line = String(out ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .pop()
  if (!line) return null
  try {
    const j = JSON.parse(line)
    if (!j || typeof j.proc !== 'string' || !j.proc) return null
    return { proc: j.proc.slice(0, 80), title: String(j.title ?? '').slice(0, 300), sel: String(j.sel ?? '').slice(0, 1500), ...(j.denied === true ? { denied: true } : {}) }
  } catch {
    return null
  }
}

/** The selection, else the window's text (Windows only; elsewhere null). */
export async function readForReply(denyRe: string): Promise<{ proc: string; title: string; text: string; from: 'selection' | 'window'; denied?: boolean } | null> {
  if (process.platform !== 'win32') return null
  const s = parseSelection(await runPowerShell(selectionScript(denyRe), 3000))
  if (s?.denied) return { proc: s.proc, title: '', text: '', from: 'selection', denied: true }
  if (s && s.sel.replace(/\s+/g, '').length >= 2) return { proc: s.proc, title: s.title, text: s.sel, from: 'selection' }
  const w = await readActiveWindow(denyRe, true)
  if (!w) return null
  return { proc: w.proc, title: w.title, text: w.text, from: 'window', ...(w.denied ? { denied: true } : {}) }
}
