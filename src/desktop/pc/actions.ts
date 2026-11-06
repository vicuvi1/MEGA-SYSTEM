// AU7: the small set of things Ben may do on this PC, run only after your tap
// on the island. Checked again here (the never list, https only, no programs
// as files, a few a minute), whatever the page says.
import { shell } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { FEATURES, KNOWN_APPS, keysToSend, pcActText, pcDenied, rateOk, textToSend, type PcAct } from '../../core/pcActions'
import { runPs } from './ps'

const runs: number[] = []
const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** `start "" <name>` through cmd, for an app by its plain name (checked: letters, digits, space . _ + - only). */
const startByName = (name: string) =>
  new Promise<boolean>((resolve) => {
    if (!/^[\p{L}\p{N} ._+-]{1,40}$/u.test(name)) return resolve(false)
    execFile('cmd.exe', ['/d', '/c', 'start', '""', name], { windowsHide: true, timeout: 8000 }, (err) => resolve(!err))
  })

const powerToysExe = () => {
  const places = [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'PowerToys', 'PowerToys.exe'), process.env.ProgramFiles && join(process.env.ProgramFiles, 'PowerToys', 'PowerToys.exe')].filter(Boolean) as string[]
  return places.find((p) => existsSync(p)) ?? null
}

/** Presses keys / types text in the window in front (Windows' own SendKeys). */
const sendKeys = async (keys: string) => (await runPs(`$w=New-Object -ComObject WScript.Shell; Start-Sleep -Milliseconds 300; $w.SendKeys('${keys.replace(/'/g, "''")}')`, { timeoutMs: 6000 })) != null

export async function runPcAct(a: PcAct, now = Date.now()): Promise<{ ok: boolean; what: string; why?: string; refused?: boolean }> {
  const what = pcActText(a)
  const denied = pcDenied(a)
  if (denied) return { ok: false, what, why: denied, refused: true }
  if (process.platform !== 'win32' && (a.kind === 'type' || a.kind === 'keys')) return { ok: false, what, why: 'Typing and keys work on Windows only', refused: true }
  if (!rateOk(runs, now)) return { ok: false, what, why: 'Too many in a minute: wait a little', refused: true }
  runs.push(now)
  while (runs.length > 20) runs.shift()
  try {
    if (a.kind === 'url') {
      await shell.openExternal(new URL(a.arg).toString())
      return { ok: true, what }
    }
    if (a.kind === 'file') {
      if (!existsSync(a.arg)) return { ok: false, what, why: 'No such file on this PC' }
      const err = await shell.openPath(a.arg)
      return err ? { ok: false, what, why: err.slice(0, 100) } : { ok: true, what }
    }
    if (a.kind === 'open') {
      const k = KNOWN_APPS[norm(a.arg)]
      if (k?.label === 'PowerToys') {
        const exe = powerToysExe()
        if (!exe) return { ok: false, what, why: 'PowerToys is not installed' }
        const err = await shell.openPath(exe)
        return err ? { ok: false, what, why: err.slice(0, 100) } : { ok: true, what }
      }
      if (k?.uri) {
        await shell.openExternal(k.uri)
        return { ok: true, what }
      }
      const ok = process.platform === 'win32' ? await startByName(k?.exe ?? a.arg) : false
      return ok ? { ok: true, what } : { ok: false, what, why: 'Could not start it (is it installed?)' }
    }
    if (a.kind === 'feature') {
      const f = FEATURES[norm(a.arg)]!
      if (f.powertoys) {
        const exe = powerToysExe()
        if (!exe) return { ok: false, what, why: 'PowerToys is not installed' }
        const err = await shell.openPath(exe)
        return err ? { ok: false, what, why: err.slice(0, 100) } : { ok: true, what }
      }
      if (f.keys) {
        if (!powerToysExe()) return { ok: false, what, why: 'PowerToys is not installed' }
        return (await sendKeys(f.keys)) ? { ok: true, what } : { ok: false, what, why: 'Windows did not take the keys' }
      }
      await shell.openExternal(f.uri!)
      return { ok: true, what }
    }
    if (a.kind === 'close') {
      // Asks the app to close (like its X button: it can still ask to save). Never forced.
      if (process.platform !== 'win32') return { ok: false, what, why: 'Closing apps works on Windows only', refused: true }
      const exe = /\.exe$/i.test(a.arg) ? a.arg : `${a.arg}.exe`
      const ok = await new Promise<boolean>((resolve) => execFile('taskkill.exe', ['/IM', exe], { windowsHide: true, timeout: 8000 }, (err) => resolve(!err)))
      return ok ? { ok: true, what } : { ok: false, what, why: 'It did not close (it may be asking to save)' }
    }
    if (a.kind === 'keys') {
      const k = keysToSend(a.arg)!
      return (await sendKeys(k)) ? { ok: true, what } : { ok: false, what, why: 'Windows did not take the keys' }
    }
    return (await sendKeys(textToSend(a.arg))) ? { ok: true, what } : { ok: false, what, why: 'Windows did not take the text' }
  } catch (e) {
    return { ok: false, what, why: String((e as Error)?.message ?? 'failed').slice(0, 100) }
  }
}
