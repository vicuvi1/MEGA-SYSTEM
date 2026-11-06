// System page and AI usage page, the desktop side: one IPC channel
// ("sysmon") for the island and the app window, and settings kept in a file
// on this PC (sysmon.json). Nothing here runs on its own: the System page asks
// once a second while it is open, the closed island asks every 30 s only when
// its readings are switched on, and the AI logs are read only when the AI page
// or its rings are on.
import { BrowserWindow, ipcMain } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { toolUsage, type ToolUsage } from '../../core/aiUsage'
import { cleanSysmonPrefs, readsLocalUsage, type SysmonPrefs } from '../../core/sysmon'
import { createCollector } from './collect'
import { createUsageReader } from './usageFiles'

export async function registerSysmon(o: { dir: string; origin: string }) {
  const file = join(o.dir, 'sysmon.json')
  let prefs: SysmonPrefs = cleanSysmonPrefs(null)
  try {
    prefs = cleanSysmonPrefs(JSON.parse(await readFile(file, 'utf8')))
  } catch {
    /* first run: the defaults */
  }
  const collector = createCollector()
  const usage = createUsageReader()

  // Our own pages only (the app window and the island), never a frame inside them.
  const ours = (e: Electron.IpcMainInvokeEvent) => !!BrowserWindow.fromWebContents(e.sender) && e.senderFrame === e.sender.mainFrame && String(e.senderFrame?.url ?? '').startsWith(`${o.origin}/`)

  ipcMain.handle('sysmon', async (e, op: string, arg?: any) => {
    if (!ours(e)) return null
    if (op === 'prefs') return prefs
    if (op === 'setPrefs') {
      prefs = cleanSysmonPrefs({ ...prefs, ...(arg && typeof arg === 'object' ? arg : {}) })
      await writeFile(file, JSON.stringify(prefs)).catch(() => {})
      if (!prefs.pages.system) collector.stop()
      if (!readsLocalUsage(prefs)) usage.forget()
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('sysmon:prefs', prefs)
      return prefs
    }
    if (op === 'sample') return prefs.pages.system ? collector.sample(prefs.topBy) : null
    if (op === 'stop') return void collector.stop()
    if (op === 'light') return prefs.readings.cpuRam ? collector.light() : null
    if (op === 'usage') {
      if (!readsLocalUsage(prefs)) return { tools: [], found: { claude: false, codex: false } }
      const r = await usage.read(arg?.fresh ? 15_000 : 60_000)
      const now = Date.now()
      const tools: ToolUsage[] = []
      if (prefs.tools.claude && r.claude) tools.push(toolUsage('claude', r.claude, now, { limit: prefs.limits.claude }))
      if (prefs.tools.codex && r.codex) tools.push(toolUsage('codex', r.codex, now, { limit: prefs.limits.codex, codex: r.codexLimits }))
      return { tools, found: { claude: !!r.claude, codex: !!r.codex } }
    }
    return null
  })
}
