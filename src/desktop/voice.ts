// Voice on the desktop (JV1, JV6): tells the windows when the PC is locked,
// asleep or nobody is at it (the island's mic closes), and presses the media
// keys for "pause music" / "next song" (Windows only, one short PowerShell).
import { BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { spawn } from 'node:child_process'

const KEYS: Record<string, number> = { playpause: 0xb3, next: 0xb0, prev: 0xb1, mute: 0xad, voldown: 0xae, volup: 0xaf }

export function setupVoice(): void {
  let locked = false
  const send = () => {
    const idleSec = powerMonitor.getSystemIdleTime()
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        if (!w.isDestroyed()) w.webContents.send('voice:power', { locked, idleSec })
      } catch {
        /* closing */
      }
    }
  }
  powerMonitor.on('lock-screen', () => ((locked = true), send()))
  powerMonitor.on('suspend', () => ((locked = true), send()))
  powerMonitor.on('unlock-screen', () => ((locked = false), send()))
  powerMonitor.on('resume', () => ((locked = false), send()))
  setInterval(send, 20_000)
  ipcMain.handle('voice:media', (e, key: unknown) => {
    if (!String(e.senderFrame?.url ?? '').startsWith('life-system://app/')) return false
    const vk = KEYS[String(key)]
    if (!vk || process.platform !== 'win32') return false
    const ps = `$t=Add-Type -MemberDefinition '[DllImport("user32.dll")]public static extern void keybd_event(byte k,byte s,uint f,UIntPtr e);' -Name K -Namespace LsVoice -PassThru; $t::keybd_event(${vk},0,1,[UIntPtr]::Zero); $t::keybd_event(${vk},0,3,[UIntPtr]::Zero)`
    try {
      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, stdio: 'ignore' }).unref()
      return true
    } catch {
      return false
    }
  })
}
