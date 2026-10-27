// The three apps that live inside Life System: Finance Helper and MAN run
// from apps/ in their own storage partitions; Waky runs from your installed
// Waky folder so its alarm and wake task keep working.
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, protocol } from 'electron'
import { FINANCE_PARTITION } from './finance'

export const MAN_PARTITION = 'persist:man'
export const WAKY_PARTITION = 'persist:waky'
export const WAKY_URL = 'http://127.0.0.1:48990'

/** Must run before the app is ready. */
export function registerEmbeddedSchemes(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

/** apps/ ships next to the app (outside the asar) in the installed version. */
export function appsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'apps') : join(app.getAppPath(), 'apps')
}

export function manUrl(): string {
  return pathToFileURL(join(appsDir(), 'man', 'index.html')).toString()
}

const partitionDir = (partition: string) => join(app.getPath('userData'), 'Partitions', partition.replace(/^persist:/, ''))

/**
 * First run only: copy the standalone app's saved data (Chrome localStorage)
 * into the embedded copy's partition. The originals are left untouched.
 * The embedded pages use the same origins (app://finance, file://), so the
 * copied data is theirs.
 */
function copyLocalStorage(fromProfile: string, partition: string): 'copied' | 'exists' | 'missing' {
  const target = join(partitionDir(partition), 'Local Storage')
  const source = join(fromProfile, 'Local Storage')
  if (!existsSync(source)) return 'missing'

  if (existsSync(target)) {
    const targetLevelDb = join(target, 'leveldb')
    const sourceLevelDb = join(source, 'leveldb')
    let shouldOverwrite = false
    try {
      if (existsSync(sourceLevelDb)) {
        const srcFiles = readdirSync(sourceLevelDb)
        const srcManifest = srcFiles.find((f) => f.startsWith('MANIFEST'))
        const srcManifestSize = srcManifest ? statSync(join(sourceLevelDb, srcManifest)).size : 0

        const tgtFiles = existsSync(targetLevelDb) ? readdirSync(targetLevelDb) : []
        const tgtManifest = tgtFiles.find((f) => f.startsWith('MANIFEST'))
        const tgtManifestSize = tgtManifest ? statSync(join(targetLevelDb, tgtManifest)).size : 0

        if (srcManifestSize > 5000 && tgtManifestSize < 1000) {
          shouldOverwrite = true
        }
      }
    } catch {
      // ignore
    }
    if (!shouldOverwrite) return 'exists'
  }

  cpSync(source, target, { recursive: true, force: true, filter: (p) => !p.endsWith('LOCK') })
  return 'copied'
}

export interface MigrationResult {
  finance: 'copied' | 'exists' | 'missing'
  man: 'copied' | 'exists' | 'missing'
}

export function migrateStandaloneData(): MigrationResult {
  const home = homedir()
  const financeProfile = join(app.getPath('appData'), 'finance-helper-app')
  const financeAppDir = join(app.getPath('userData'), 'apps', 'finance')

  try {
    if (existsSync(financeProfile)) {
      mkdirSync(financeAppDir, { recursive: true })
      const prefsSrc = join(financeProfile, 'prefs.json')
      const prefsDst = join(financeAppDir, 'prefs.json')
      if (existsSync(prefsSrc) && (!existsSync(prefsDst) || statSync(prefsDst).size === 0)) {
        cpSync(prefsSrc, prefsDst)
      }
      const tgSrc = join(financeProfile, 'telegram.bin')
      const tgDst = join(financeAppDir, 'telegram.bin')
      if (existsSync(tgSrc) && (!existsSync(tgDst) || statSync(tgDst).size === 0)) {
        cpSync(tgSrc, tgDst)
      }
    }
  } catch (e) {
    console.error('Failed to copy finance app preferences/tokens:', e)
  }

  return {
    finance: copyLocalStorage(financeProfile, FINANCE_PARTITION),
    man: copyLocalStorage(join(home, '.gemini', 'antigravity', 'scratch', 'ManDesktop', 'profile', 'Default'), MAN_PARTITION)
  }
}

/** The embedded MAN's own saved data, for the Discipline start-date import. */
export function embeddedManLevelDb(): string {
  return join(partitionDir(MAN_PARTITION), 'Local Storage', 'leveldb')
}

// ---------------- Waky ----------------

export async function wakyRunning(): Promise<boolean> {
  try {
    const r = await fetch(`${WAKY_URL}/api/ping`, { signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch {
    return false
  }
}

/** Waky's folder from the path of its waky.json (…/Waky-/data/waky.json). */
export function wakyRoot(wakyJson: string | null): string | null {
  if (!wakyJson) return null
  const root = dirname(dirname(wakyJson))
  return existsSync(join(root, 'app', 'server.py')) ? root : null
}

function pythonw(): string {
  // pythonw has no console window; fall back to python.
  const local = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python')
  if (existsSync(local)) {
    for (const d of readdirSync(local).sort().reverse()) {
      const exe = join(local, d, 'pythonw.exe')
      if (existsSync(exe)) return exe
    }
  }
  return 'pythonw'
}

/** Starts Waky's own server (no window of its own) if it isn't running yet. */
export async function ensureWaky(root: string | null): Promise<{ ok: boolean; error: string | null }> {
  if (await wakyRunning()) return { ok: true, error: null }
  if (!root) return { ok: false, error: 'Waky folder not found' }
  try {
    const child = spawn(pythonw(), [join(root, 'app', 'server.py'), '--no-window', '--stay'], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
  } catch (e) {
    return { ok: false, error: `Could not start Waky: ${(e as Error).message}` }
  }
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250))
    if (await wakyRunning()) return { ok: true, error: null }
  }
  return { ok: false, error: 'Waky did not start. Is Python installed?' }
}
