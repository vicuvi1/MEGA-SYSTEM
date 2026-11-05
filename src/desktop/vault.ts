// MC16 Your Obsidian vault on this PC: you pick the folder once; the app reads
// its markdown notes (read-only) and keeps only each note's title, headings
// and first lines. The full path stays on this PC; only the folder's name goes
// into your data. Nothing is ever written into the vault.
import { dialog, type BrowserWindow } from 'electron'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { noteSummary, skipDir, type VaultData, type VaultNote } from '../plugins/notes/vault'

const MAX_FILES = 400
const MAX_NOTES = 60
const MAX_BYTES = 300_000

export function createVault(userData: string) {
  const prefFile = join(userData, 'vault.json')
  let folder: string | null = null
  const ready = readFile(prefFile, 'utf8')
    .then((t) => {
      folder = JSON.parse(t)?.folder ?? null
    })
    .catch(() => {})

  async function walk(dir: string, out: string[], depth = 0): Promise<void> {
    if (depth > 6 || out.length >= MAX_FILES) return
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (out.length >= MAX_FILES) return
      if (e.isDirectory()) {
        if (!skipDir(e.name)) await walk(join(dir, e.name), out, depth + 1)
      } else if (e.isFile() && /\.md$/i.test(e.name)) out.push(join(dir, e.name))
    }
  }

  async function scan(): Promise<VaultData | null> {
    await ready
    if (!folder) return null
    const files: string[] = []
    await walk(folder, files)
    const withTime = await Promise.all(files.map(async (f) => ({ f, s: await stat(f).catch(() => null) })))
    const newest = withTime.filter((x) => x.s && x.s.size <= MAX_BYTES).sort((a, b) => b.s!.mtimeMs - a.s!.mtimeMs).slice(0, MAX_NOTES)
    const notes: VaultNote[] = []
    for (const { f, s } of newest) {
      const text = await readFile(f, 'utf8').catch(() => null)
      if (text != null) notes.push(noteSummary(relative(folder, f), text, s!.mtime))
    }
    return { folder: basename(folder), at: new Date().toISOString(), count: files.length, notes }
  }

  return {
    scan,
    async choose(win: BrowserWindow): Promise<VaultData | null> {
      await ready
      const r = await dialog.showOpenDialog(win, { title: 'Choose your Obsidian vault folder', properties: ['openDirectory'] })
      if (r.canceled || !r.filePaths[0]) return null
      folder = r.filePaths[0]
      await writeFile(prefFile, JSON.stringify({ folder })).catch(() => {})
      return scan()
    },
    async forget(): Promise<void> {
      folder = null
      await writeFile(prefFile, JSON.stringify({ folder: null })).catch(() => {})
    }
  }
}
