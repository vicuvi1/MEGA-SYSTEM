import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanWallpaperPrefs, createWallpaper, decodeImage, folderImages, pickRotation, readCommand, SET_SCRIPT, setCommand, validFolderPath, validImagePath } from './wallpaper'

// A tiny made-up JPEG / PNG header (enough for the check), as data URLs.
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64')}`
const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')}`

describe('wallpaper paths', () => {
  it('accepts an absolute local Windows picture', () => {
    expect(validImagePath('C:\\Users\\Sam\\Pictures\\Beach day.jpg')).toBe('C:\\Users\\Sam\\Pictures\\Beach day.jpg')
    expect(validImagePath('D:\\walls\\city.PNG')).toBe('D:\\walls\\city.PNG')
  })
  it('refuses anything that could be a trick', () => {
    for (const bad of [
      '',
      'beach.jpg',
      '/home/sam/a.jpg',
      '\\\\server\\share\\a.jpg',
      'C:\\a\\..\\Windows\\b.jpg',
      'C:\\pics\\a.jpg"; Remove-Item C:\\ -Recurse; "',
      'C:\\pics\\$(calc).exe',
      'C:\\pics\\a.jpg:stream',
      'C:\\pics\\evil.ps1',
      'C:\\pics\\a\u0000.jpg',
      'C:\\pics\\a.jpg\n.jpg',
      `C:\\${'x'.repeat(300)}.jpg`,
      42,
      null
    ])
      expect(validImagePath(bad)).toBeNull()
    expect(validFolderPath('C:\\Users\\Sam\\Pictures\\Walls')).toBe('C:\\Users\\Sam\\Pictures\\Walls')
    expect(validFolderPath('C:\\a\\..\\b')).toBeNull()
  })
})

describe('the command (fixed code, the path only as data)', () => {
  it('never puts the path in the command line', () => {
    const p = 'C:\\Users\\Sam\\Pictures\\Beach day.jpg'
    const c = setCommand(p)
    expect(c.file).toBe('powershell.exe')
    expect(c.args.join(' ')).not.toContain('Beach')
    expect(c.args[c.args.length - 1]).toBe(SET_SCRIPT)
    expect(c.env).toEqual({ LS_WALLPAPER: p })
    expect(SET_SCRIPT).toContain('$env:LS_WALLPAPER')
    expect(SET_SCRIPT).toContain('SystemParametersInfo(20, 0, $p, 3)')
    expect(readCommand().args.join(' ')).toContain('HKCU:\\Control Panel\\Desktop')
  })
  it('throws on a path it does not accept (nothing runs)', () => {
    expect(() => setCommand('C:\\pics\\a.jpg"; calc; "')).toThrow()
  })
  it('a legal but odd name ($, `) stays plain data in the environment, never code', () => {
    const p = 'C:\\pics\\$(calc) `n.jpg'
    const c = setCommand(p)
    expect(c.args.join(' ')).not.toContain('calc')
    expect(c.env.LS_WALLPAPER).toBe(p)
  })
})

describe('pictures', () => {
  it('only real JPEG or PNG data', () => {
    expect(decodeImage(JPEG)?.ext).toBe('.jpg')
    expect(decodeImage(PNG)?.ext).toBe('.png')
    expect(decodeImage(JPEG.replace('image/jpeg', 'image/png'))).toBeNull()
    expect(decodeImage('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull()
    expect(decodeImage('https://example.com/a.jpg')).toBeNull()
  })
  it('rotation: one picture per period, in name order, stable', () => {
    const files = ['C:\\w\\a.jpg', 'C:\\w\\b.jpg', 'C:\\w\\c.jpg']
    const t = new Date(2026, 10, 13, 10, 0).getTime()
    const first = pickRotation(files, t, 60)
    expect(pickRotation(files, t + 30 * 60_000, 60)).toBe(first)
    expect(pickRotation(files, t + 60 * 60_000, 60)).not.toBe(first)
    expect(pickRotation([], t, 60)).toBeNull()
  })
  it('a folder lists only picture files directly in it', () => {
    const fs = {
      readdirSync: (() => ['b.png', 'notes.txt', 'a.jpg', 'evil.jpg.exe', 'sub']) as any,
      statSync: ((p: string) => ({ isFile: () => !p.endsWith('sub'), size: 1000 })) as any
    }
    expect(folderImages('C:\\Walls', fs)).toEqual(['C:\\Walls\\a.jpg', 'C:\\Walls\\b.png'])
    expect(folderImages('relative\\dir', fs)).toEqual([])
  })
  it('prefs: off by default; junk is dropped', () => {
    expect(cleanWallpaperPrefs(null)).toEqual({ on: false, previous: null, folders: {} })
    expect(cleanWallpaperPrefs({ on: 'yes', previous: 'C:\\a.exe', folders: { 'm1': { path: 'C:\\W', everyMin: 1 }, '../x': { path: 'C:\\W' } } })).toEqual({ on: false, previous: null, folders: { m1: { path: 'C:\\W', everyMin: 5 } } })
  })
})

describe('switching it on and off (a fake execFile)', () => {
  let dir = ''
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))
  const fake = () => {
    const calls: { file: string; args: string[]; env: Record<string, string | undefined> }[] = []
    const exec = (file: string, args: string[], opts: { env: NodeJS.ProcessEnv; shell: false }, cb: (e: Error | null, out: string) => void) => {
      calls.push({ file, args, env: opts.env })
      expect(opts.shell).toBe(false)
      // Reading the wallpaper answers with the old one.
      cb(null, args.join(' ').includes('Get-ItemProperty') ? 'C:\\Users\\Sam\\Pictures\\old.jpg' : '')
    }
    return { calls, exec }
  }

  it('does nothing while off (the default)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'wp-'))
    const f = fake()
    const w = createWallpaper({ dir, exec: f.exec, pickFolder: async () => null, platform: 'win32' })
    const st = await w.act({ op: 'apply', mode: 'study', image: JPEG })
    expect(st.on).toBe(false)
    expect(f.calls).toEqual([])
  })
  it('keeps your old wallpaper, sets the mode\'s picture from its own folder, puts the old one back when off', async () => {
    dir = mkdtempSync(join(tmpdir(), 'wp-'))
    const f = fake()
    const w = createWallpaper({ dir, exec: f.exec, pickFolder: async () => null, platform: 'win32' })
    await w.act({ op: 'setOn', on: true })
    expect(w.prefs().previous).toBe('C:\\Users\\Sam\\Pictures\\old.jpg')
    // The picture is written to the app folder. On Windows (the release runner) that folder is a real
    // Windows path, so the fixed script runs; anywhere else the path check refuses to run it.
    if (process.platform === 'win32') await expect(w.act({ op: 'apply', mode: 'study', image: JPEG })).resolves.toMatchObject({ on: true })
    else await expect(w.act({ op: 'apply', mode: 'study', image: JPEG })).rejects.toThrow()
    expect(readdirSync(join(dir, 'wallpapers')).some((n) => /^study-[0-9a-f]{12}\.jpg$/.test(n))).toBe(true)
    // A mode id that could escape the folder is refused.
    const before = f.calls.length
    await w.act({ op: 'apply', mode: '..\\..\\x', image: JPEG })
    expect(f.calls.length).toBe(before)
    await w.act({ op: 'setOn', on: false })
    expect(w.prefs()).toMatchObject({ on: false, previous: null })
  })
  it('a Windows path from a picked folder is set through the fixed script', async () => {
    dir = mkdtempSync(join(tmpdir(), 'wp-'))
    const f = fake()
    const w = createWallpaper({ dir, exec: f.exec, pickFolder: async () => 'C:\\Walls', platform: 'win32' })
    await w.act({ op: 'setOn', on: true })
    // No such folder here: picking it says so and keeps nothing.
    const st = await w.act({ op: 'pickFolder', mode: 'night' })
    expect(st.said).toMatch(/no JPG/)
    expect(w.prefs().folders).toEqual({})
  })
  it('says it works on Windows only elsewhere', async () => {
    dir = mkdtempSync(join(tmpdir(), 'wp-'))
    const f = fake()
    const w = createWallpaper({ dir, exec: f.exec, pickFolder: async () => null, platform: 'darwin' })
    expect((await w.act({ op: 'setOn', on: true })).said).toMatch(/Windows only/)
    expect(f.calls).toEqual([])
  })
})
