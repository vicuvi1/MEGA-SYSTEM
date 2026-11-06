// Settings → PC & automation, the desktop side (AU1, AU2, AU7). One IPC
// channel ("pcx") and one listener on the focus state the app already sends.
// All OFF until switched on; nothing here polls: the music is asked when a
// focus block starts/ends and when the island asks (every 30 s while its
// panel is open), ActivityWatch when the app window asks (every 10 min).
import { BrowserWindow, ipcMain } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { addActLog, cleanPcExtra, type PcActLogLine, type PcExtraPrefs } from '../../core/pcExtra'
import { focusMediaStep, MEDIA_OPS, type MediaNow, type MediaOp } from '../../core/pcMedia'
import { pcActText, pcDenied, readPcAction } from '../../core/pcActions'
import { media } from './media'
import { runPcAct } from './actions'
import { awLastHour } from './activityWatch'

export async function registerPcExtras(o: { dir: string; win: BrowserWindow; origin: string }) {
  const file = join(o.dir, 'pc-extra.json')
  let prefs: PcExtraPrefs = cleanPcExtra(null)
  let log: PcActLogLine[] = []
  try {
    const j = JSON.parse(await readFile(file, 'utf8'))
    prefs = cleanPcExtra(j.prefs)
    log = Array.isArray(j.log) ? j.log.slice(-60) : []
  } catch {
    /* first run: everything off */
  }
  const save = () => writeFile(file, JSON.stringify({ prefs, log })).catch(() => {})

  // Our own pages only (the app window and the island), never a frame inside them.
  const ours = (e: Electron.IpcMainInvokeEvent) => !!BrowserWindow.fromWebContents(e.sender) && e.senderFrame === e.sender.mainFrame && String(e.senderFrame?.url ?? '').startsWith(`${o.origin}/`)
  const fromApp = (e: Electron.IpcMainInvokeEvent) => e.sender === o.win.webContents && ours(e)

  // ---- AU1: pause the music when focus starts, play it again when it ends ----
  let wasRunning = false
  let pausedByUs = false
  ipcMain.on('pc:focus', (e, f: { running?: boolean }) => {
    if (e.sender !== o.win.webContents) return
    const running = !!f?.running
    if (running === wasRunning) return
    const was = wasRunning
    wasRunning = running
    if (!prefs.pauseMusic) return void (pausedByUs = false)
    void (async () => {
      const { now } = await media('get')
      const step = focusMediaStep({ wasRunning: was, running, media: now, pausedByUs })
      if (step === 'pause') {
        await media('pause')
        pausedByUs = true
      } else if (step === 'resume') {
        await media('play')
        pausedByUs = false
      } else if (!running) pausedByUs = false
    })()
  })

  ipcMain.handle('pcx', async (e, op: string, arg?: any) => {
    if (!ours(e)) return null
    // The island and the app: what's playing, and the buttons.
    if (op === 'media') {
      if (!prefs.islandMedia && !fromApp(e)) return null
      const want = MEDIA_OPS.includes(arg) ? (arg as MediaOp) : 'get'
      const r = await media(want)
      return { now: r.now as MediaNow | null, via: r.via, windows: process.platform === 'win32' }
    }
    if (!fromApp(e)) return null
    if (op === 'prefs') return { prefs, windows: process.platform === 'win32' }
    if (op === 'setPrefs') {
      prefs = cleanPcExtra({ ...prefs, ...(arg && typeof arg === 'object' ? arg : {}) })
      await save()
      return prefs
    }
    if (op === 'log') return log.slice().reverse()
    if (op === 'clearLog') {
      log = []
      await save()
      return true
    }
    // AU2: ActivityWatch's last hour (only with the switch on).
    if (op === 'lastHour') return prefs.activityWatch ? await awLastHour().catch(() => null) : null
    if (op === 'awCheck') return !!(await awLastHour().catch(() => null))
    // AU7: run one action you allowed on the island (or log that you said no).
    if (op === 'run' || op === 'deny') {
      const act = readPcAction(`pc: ${String(arg?.kind ?? '')} ${String(arg?.arg ?? '')}`)
      if (!act) return { ok: false, why: 'Not an action Ben can do' }
      if (op === 'deny') {
        log = addActLog(log, { at: Date.now(), what: pcActText(act), result: 'denied' })
        await save()
        return { ok: true }
      }
      // Closing an app from the System page is your own tap (Allow), not Ben's: no switch needed.
      if (!prefs.benActions && !(act.kind === 'close' && arg?.mine === true)) return { ok: false, why: 'Turn on “Ben can do things on this PC” in Settings → PC & automation' }
      const r = pcDenied(act) ? { ok: false, what: pcActText(act), why: pcDenied(act)!, refused: true } : await runPcAct(act)
      log = addActLog(log, { at: Date.now(), what: r.what, result: r.ok ? 'done' : r.refused ? 'refused' : 'failed', ...(r.why ? { why: r.why } : {}) })
      await save()
      return { ok: r.ok, why: r.why ?? null }
    }
    return null
  })
}
