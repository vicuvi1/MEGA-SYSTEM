// Custom Center: "Change my Windows wallpaper" (desktop app, Windows only,
// OFF by default). Each mode can have a picture (kept on this device), an
// evening picture, or a folder you picked on this PC to rotate through. When
// the mode changes, the app window asks here to set the right one.
//
// Safety:
// - Only fixed code runs: one PowerShell script that calls the Windows API
//   SystemParametersInfo(SPI_SETDESKWALLPAPER). The picture's path never goes
//   into the command line: it is handed over in an environment variable and
//   read by the script as data (`$env:LS_WALLPAPER`), so no path can inject
//   anything. `execFile` is used (no shell).
// - The path must be an absolute local Windows path to an existing image file
//   (.jpg .jpeg .png .bmp), with no characters Windows forbids and no "..".
// - Only pictures you picked: a picture you chose in the Custom Center (the app
//   window sends its bytes; this file writes it into the app's own folder) or a
//   file inside a folder you picked here with the Windows folder dialog.
//   Nothing is ever downloaded.
// - Your wallpaper from before is kept and put back when you switch it off.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { createHash } from 'node:crypto'

export const WALLPAPER_EXTS = ['.jpg', '.jpeg', '.png', '.bmp'] as const
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_FOLDER_FILES = 500
const DATA_URL_MAX = 14_000_000

/** The one script that sets the wallpaper. It reads the path from the environment, never from its own text. */
export const SET_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '$p = $env:LS_WALLPAPER',
  'if (-not $p -or -not (Test-Path -LiteralPath $p -PathType Leaf)) { exit 2 }',
  "Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class LsWallpaper { [DllImport(\"user32.dll\", CharSet = CharSet.Unicode, SetLastError = true)] public static extern int SystemParametersInfo(int a, int b, string c, int d); }'",
  // SPI_SETDESKWALLPAPER = 20; SPIF_UPDATEINIFILE | SPIF_SENDCHANGE = 3
  'if ([LsWallpaper]::SystemParametersInfo(20, 0, $p, 3) -eq 0) { exit 1 }'
].join('; ')

/** The one script that reads the wallpaper you have now (to put it back later). */
export const READ_SCRIPT = "(Get-ItemProperty -LiteralPath 'HKCU:\\Control Panel\\Desktop' -Name WallPaper).WallPaper"

const BASE_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']

/**
 * A path we may hand to Windows: absolute (C:\…), an image by its extension,
 * no forbidden characters, no control characters, no "..", not too long.
 * Returns the path, or null.
 */
export function validImagePath(p: unknown): string | null {
  if (typeof p !== 'string') return null
  if (p.length < 4 || p.length > 259) return null
  if (!/^[A-Za-z]:\\/.test(p)) return null
  // Windows forbids < > : " | ? * and control characters (the drive's colon is the only colon).
  if (/[<>"|?*\u0000-\u001f]/.test(p) || p.indexOf(':', 2) !== -1) return null
  const parts = p.slice(3).split('\\')
  if (parts.some((x) => x === '..' || x === '.' || x === '' || /[. ]$/.test(x))) return null
  if (!(WALLPAPER_EXTS as readonly string[]).includes(extname(p).toLowerCase())) return null
  return p
}

/** A folder path we accept (same rules, no extension). */
export function validFolderPath(p: unknown): string | null {
  if (typeof p !== 'string' || p.length < 3 || p.length > 240 || !/^[A-Za-z]:\\/.test(p)) return null
  if (/[<>"|?*\u0000-\u001f]/.test(p) || p.indexOf(':', 2) !== -1) return null
  const parts = p.slice(3).split('\\').filter((x, i, a) => !(x === '' && i === a.length - 1))
  if (parts.some((x) => x === '..' || x === '.' || (x === '' && parts.length > 1))) return null
  return p
}

export interface Command {
  file: string
  args: string[]
  env: Record<string, string>
}

/** The fixed command that sets `path` as the wallpaper (throws on a path we don't accept). */
export function setCommand(path: string): Command {
  const ok = validImagePath(path)
  if (!ok) throw new Error('That picture cannot be used as the wallpaper')
  return { file: 'powershell.exe', args: [...BASE_ARGS, SET_SCRIPT], env: { LS_WALLPAPER: ok } }
}

/** The fixed command that reads the current wallpaper's path. */
export const readCommand = (): Command => ({ file: 'powershell.exe', args: [...BASE_ARGS, READ_SCRIPT], env: {} })

/** Which picture of a folder shows now: one per `everyMin` minutes, in name order (stable across restarts). */
export function pickRotation(files: string[], now: number, everyMin: number): string | null {
  if (!files.length) return null
  const step = Math.max(5, Math.min(24 * 60, Math.round(everyMin) || 60)) * 60_000
  const local = now - new Date(now).getTimezoneOffset() * 60_000
  return files[Math.floor(local / step) % files.length]
}

/** A data URL of a JPEG or PNG the app window sent: its bytes and extension, or null. */
export function decodeImage(dataUrl: unknown): { bytes: Buffer; ext: '.jpg' | '.png' } | null {
  if (typeof dataUrl !== 'string' || dataUrl.length > DATA_URL_MAX) return null
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) return null
  const bytes = Buffer.from(m[2], 'base64')
  // Check the file really starts like a JPEG or a PNG.
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  if (m[1] === 'jpeg' ? !jpeg : !png) return null
  return { bytes, ext: m[1] === 'jpeg' ? '.jpg' : '.png' }
}

export interface WallpaperPrefs {
  /** "Change my Windows wallpaper" (off by default). */
  on: boolean
  /** Your wallpaper from before it was switched on, to put back. */
  previous: string | null
  /** A folder to rotate through, per mode (this PC only). */
  folders: Record<string, { path: string; everyMin: number }>
}
export const DEFAULT_WALLPAPER_PREFS: WallpaperPrefs = { on: false, previous: null, folders: {} }

export function cleanWallpaperPrefs(raw: unknown): WallpaperPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const folders: WallpaperPrefs['folders'] = {}
  for (const [k, v] of Object.entries(r.folders && typeof r.folders === 'object' ? r.folders : {}).slice(0, 16)) {
    const path = validFolderPath((v as any)?.path)
    if (/^[A-Za-z0-9_-]{1,40}$/.test(k) && path) folders[k] = { path, everyMin: Math.max(5, Math.min(1440, Math.round(Number((v as any).everyMin) || 60))) }
  }
  return { on: r.on === true, previous: validImagePath(r.previous), folders }
}

/** Image files directly inside a folder (no sub-folders), sorted by name. */
export function folderImages(dir: string, fs: { readdirSync: typeof readdirSync; statSync: typeof statSync } = { readdirSync, statSync }): string[] {
  const ok = validFolderPath(dir)
  if (!ok) return []
  try {
    const base = ok.endsWith('\\') ? ok : `${ok}\\`
    return fs
      .readdirSync(ok)
      .filter((n) => (WALLPAPER_EXTS as readonly string[]).includes(extname(String(n)).toLowerCase()))
      .sort((a, b) => String(a).localeCompare(String(b)))
      .slice(0, MAX_FOLDER_FILES)
      .map((n) => `${base}${n}`)
      .filter((p) => {
        if (!validImagePath(p)) return false
        try {
          const st = fs.statSync(p)
          return st.isFile() && st.size > 0 && st.size <= MAX_FILE_BYTES
        } catch {
          return false
        }
      })
  } catch {
    return []
  }
}

type ExecFile = (file: string, args: string[], opts: { env: NodeJS.ProcessEnv; windowsHide: boolean; timeout: number; shell: false }, cb: (err: Error | null, stdout: string) => void) => unknown

/** Runs a fixed command (no shell) and gives its output. */
export function run(cmd: Command, exec: ExecFile): Promise<string> {
  return new Promise((ok, no) => {
    exec(cmd.file, cmd.args, { env: { ...process.env, ...cmd.env }, windowsHide: true, timeout: 15_000, shell: false }, (err, out) => (err ? no(new Error('Windows did not change the wallpaper')) : ok(String(out ?? '').trim())))
  })
}

/** Sets a checked picture as the wallpaper. */
export async function setWallpaper(path: string, exec: ExecFile): Promise<void> {
  await run(setCommand(path), exec)
}

/** The current wallpaper's path, or null (none, a slideshow, or not readable). */
export async function currentWallpaper(exec: ExecFile): Promise<string | null> {
  try {
    return validImagePath(await run(readCommand(), exec))
  } catch {
    return null
  }
}

/** What the app window asks for (one channel, `wallpaper`). */
export type WallpaperOp =
  | { op: 'get' }
  | { op: 'setOn'; on: boolean }
  | { op: 'apply'; mode: string; image: string | null }
  | { op: 'pickFolder'; mode: string }
  | { op: 'clearFolder'; mode: string }
  | { op: 'every'; mode: string; minutes: number }

export interface WallpaperState {
  available: boolean
  on: boolean
  folders: Record<string, { name: string; everyMin: number; count: number }>
  /** What happened last (a plain line), or null. */
  said: string | null
}

const safeMode = (m: unknown) => (typeof m === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(m) ? m : null)

/**
 * The desktop side. `exec` and `pickFolder` are passed in (tests use fakes).
 * `dir`: the app's own folder (userData); pictures sent by the app window are
 * written under `dir\wallpapers` only.
 */
export function createWallpaper(o: { dir: string; exec: ExecFile; pickFolder: () => Promise<string | null>; platform?: string; now?: () => number }) {
  const file = join(o.dir, 'wallpaper.json')
  const store = join(o.dir, 'wallpapers')
  const available = (o.platform ?? process.platform) === 'win32'
  const now = o.now ?? Date.now
  let prefs: WallpaperPrefs = DEFAULT_WALLPAPER_PREFS
  try {
    if (existsSync(file)) prefs = cleanWallpaperPrefs(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    prefs = DEFAULT_WALLPAPER_PREFS
  }
  let last: string | null = null
  let said: string | null = null
  const save = () => {
    try {
      writeFileSync(file, JSON.stringify(prefs, null, 2))
    } catch {
      /* fine: it stays for this session */
    }
  }
  const state = (): WallpaperState => ({
    available,
    on: prefs.on,
    folders: Object.fromEntries(Object.entries(prefs.folders).map(([k, v]) => [k, { name: basename(v.path) || v.path, everyMin: v.everyMin, count: folderImages(v.path).length }])),
    said
  })
  /** Writes a picture the app window sent into our own folder (old ones cleared), returns its path. */
  const keep = (mode: string, dataUrl: string): string | null => {
    const img = decodeImage(dataUrl)
    if (!img) return null
    mkdirSync(store, { recursive: true })
    const name = `${mode}-${createHash('sha256').update(img.bytes).digest('hex').slice(0, 12)}${img.ext}`
    const path = join(store, name)
    if (!existsSync(path)) writeFileSync(path, img.bytes)
    try {
      const old = readdirSync(store).filter((n) => n !== name).map((n) => ({ n, t: statSync(join(store, n)).mtimeMs })).sort((a, b) => b.t - a.t).slice(8)
      for (const x of old) unlinkSync(join(store, x.n))
    } catch {
      /* fine */
    }
    return path
  }
  const put = async (path: string) => {
    if (path === last) return
    await setWallpaper(path, o.exec)
    last = path
  }
  async function act(a: WallpaperOp): Promise<WallpaperState> {
    said = null
    if (!available) return { ...state(), said: 'Changing the wallpaper works on Windows only' }
    switch (a.op) {
      case 'get':
        break
      case 'setOn': {
        if (a.on && !prefs.on) {
          prefs = { ...prefs, on: true, previous: prefs.previous ?? (await currentWallpaper(o.exec)) }
          said = 'Your wallpaper now follows your modes'
        } else if (!a.on && prefs.on) {
          const back = prefs.previous && existsSync(prefs.previous) ? prefs.previous : null
          prefs = { ...prefs, on: false, previous: null }
          last = null
          if (back) await setWallpaper(back, o.exec).catch(() => {})
          said = back ? 'Your old wallpaper is back' : 'Wallpaper changes are off'
        }
        save()
        break
      }
      case 'apply': {
        const mode = safeMode(a.mode)
        if (!prefs.on || !mode) break
        const folder = prefs.folders[mode]
        const pick = folder ? pickRotation(folderImages(folder.path), now(), folder.everyMin) : typeof a.image === 'string' ? keep(mode, a.image) : null
        if (pick) {
          await put(pick)
          said = 'Wallpaper changed'
        }
        break
      }
      case 'pickFolder': {
        const mode = safeMode(a.mode)
        if (!mode) break
        const path = validFolderPath(await o.pickFolder())
        if (!path) break
        const n = folderImages(path).length
        if (!n) {
          said = 'That folder has no JPG, PNG or BMP pictures'
          break
        }
        prefs = { ...prefs, folders: { ...prefs.folders, [mode]: { path, everyMin: prefs.folders[mode]?.everyMin ?? 60 } } }
        last = null
        save()
        said = `${n} picture${n === 1 ? '' : 's'} to rotate`
        break
      }
      case 'clearFolder': {
        const mode = safeMode(a.mode)
        if (!mode) break
        const { [mode]: _drop, ...rest } = prefs.folders
        prefs = { ...prefs, folders: rest }
        last = null
        save()
        break
      }
      case 'every': {
        const mode = safeMode(a.mode)
        const f = mode ? prefs.folders[mode] : null
        if (!mode || !f) break
        prefs = { ...prefs, folders: { ...prefs.folders, [mode]: { ...f, everyMin: Math.max(5, Math.min(1440, Math.round(Number(a.minutes) || 60))) } } }
        save()
        break
      }
    }
    return state()
  }
  return { act, prefs: () => prefs }
}

/** Main process: the `wallpaper` channel, answered only for the app window. */
export async function registerWallpaper(o: { dir: string; appWindow: import('electron').BrowserWindow }): Promise<void> {
  const { dialog, ipcMain } = await import('electron')
  const { execFile } = await import('node:child_process')
  const w = createWallpaper({
    dir: o.dir,
    exec: execFile as unknown as ExecFile,
    pickFolder: async () => {
      const r = await dialog.showOpenDialog(o.appWindow, { title: 'Pick a folder of pictures', properties: ['openDirectory'] })
      return r.canceled ? null : r.filePaths[0] ?? null
    }
  })
  ipcMain.handle('wallpaper', async (e, a: WallpaperOp) => {
    if (o.appWindow.isDestroyed() || e.sender !== o.appWindow.webContents) return null
    if (!a || typeof a !== 'object' || typeof (a as { op?: unknown }).op !== 'string') return null
    try {
      return await w.act(a)
    } catch (err) {
      return { available: true, on: w.prefs().on, folders: {}, said: (err as Error).message || 'Windows did not change the wallpaper' }
    }
  })
}
