// AI usage page: reads your coding tools' own log files on this PC, read-only.
// Only the token numbers, the model name and the time are kept (aiUsage.ts
// parses each line and drops the rest); nothing is uploaded or saved.
// Files are read once and then only their new lines (they only grow), and
// only files changed in the last 8 days.
import { open, readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { newCodexState, parseClaudeLine, parseCodexLine, type CodexState, type UsageEntry } from '../../core/aiUsage'

const DAY = 864e5
const CHUNK = 4 * 1024 * 1024

interface FileState { size: number; offset: number; entries: (UsageEntry & { key?: string | null })[]; codex: CodexState | null }

export function claudeRoots(): string[] {
  const home = os.homedir()
  const env = process.env.CLAUDE_CONFIG_DIR
  return [...(env ? env.split(',').map((d) => join(d.trim(), 'projects')) : []), join(home, '.claude', 'projects'), join(home, '.config', 'claude', 'projects')]
}
export function codexRoots(): string[] {
  return [join(process.env.CODEX_HOME || join(os.homedir(), '.codex'), 'sessions')]
}

/** *.jsonl files changed since `since`, at most 6 folders deep. */
async function listFiles(root: string, since: number, depth = 0, out: { path: string; size: number }[] = []): Promise<{ path: string; size: number }[]> {
  if (depth > 6 || out.length > 5000) return out
  let items: import('node:fs').Dirent[]
  try {
    items = await readdir(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const it of items) {
    const p = join(root, it.name)
    if (it.isDirectory()) await listFiles(p, since, depth + 1, out)
    else if (it.isFile() && it.name.endsWith('.jsonl')) {
      const s = await stat(p).catch(() => null)
      if (s && s.mtimeMs >= since) out.push({ path: p, size: s.size })
    }
  }
  return out
}

const exists = async (p: string) => !!(await stat(p).catch(() => null))

export function createUsageReader() {
  const files = new Map<string, FileState>()
  let at = 0
  let last: { claude: UsageEntry[] | null; codex: UsageEntry[] | null; codexLimits: CodexState['limits'] } = { claude: null, codex: null, codexLimits: null }
  let running: Promise<typeof last> | null = null

  /** Reads the new lines of one file (whole lines only). */
  async function readNew(path: string, size: number, kind: 'claude' | 'codex') {
    let st = files.get(path)
    if (!st || size < st.offset) st = { size: 0, offset: 0, entries: [], codex: kind === 'codex' ? newCodexState() : null }
    files.set(path, st)
    if (size === st.offset) return
    const fh = await open(path, 'r').catch(() => null)
    if (!fh) return
    try {
      while (st.offset < size) {
        const len = Math.min(CHUNK, size - st.offset)
        const buf = Buffer.alloc(len)
        const { bytesRead } = await fh.read(buf, 0, len, st.offset)
        if (!bytesRead) break
        const cut = buf.lastIndexOf(10, bytesRead - 1)
        if (cut < 0) {
          // One line longer than a chunk: skip it rather than hold it all.
          if (len === CHUNK) st.offset += bytesRead
          break
        }
        const text = buf.toString('utf8', 0, cut)
        st.offset += cut + 1
        for (const line of text.split('\n')) {
          const e = kind === 'claude' ? parseClaudeLine(line) : parseCodexLine(line, st.codex!)
          if (e) st.entries.push(e)
        }
      }
      st.size = size
    } finally {
      await fh.close().catch(() => {})
    }
  }

  async function refresh(now: number) {
    const since = now - 8 * DAY
    const keep = now - 7 * DAY - 3600_000
    const seen = new Set<string>()
    const read = async (roots: string[], kind: 'claude' | 'codex') => {
      let found = false
      for (const r of roots) {
        if (!(await exists(r))) continue
        found = true
        for (const f of await listFiles(r, since)) {
          seen.add(f.path)
          await readNew(f.path, f.size, kind).catch(() => {})
          const st = files.get(f.path)
          if (st) st.entries = st.entries.filter((e) => e.at >= keep)
        }
      }
      return found
    }
    const hasClaude = await read(claudeRoots(), 'claude')
    const hasCodex = await read(codexRoots(), 'codex')
    for (const p of [...files.keys()]) if (!seen.has(p)) files.delete(p)
    // Claude: the same message can be in two files (a resumed session): once only.
    const byKey = new Map<string, UsageEntry>()
    const claude: UsageEntry[] = []
    const codex: UsageEntry[] = []
    let limits: CodexState['limits'] = null
    for (const [p, st] of files) {
      const isCodex = !!st.codex
      for (const e of st.entries) {
        const clean = { at: e.at, model: e.model, t: e.t }
        if (isCodex) codex.push(clean)
        else if (e.key) byKey.set(e.key, clean)
        else claude.push(clean)
      }
      if (isCodex && st.codex?.limits && (!limits || st.codex.limits.at > limits.at)) limits = st.codex.limits
      void p
    }
    claude.push(...byKey.values())
    return { claude: hasClaude ? claude : null, codex: hasCodex ? codex : null, codexLimits: limits }
  }

  return {
    /** The last 7 days of entries per tool (null: that tool isn't on this PC). Read again at most every `maxAgeMs`. */
    async read(maxAgeMs = 60_000) {
      const now = Date.now()
      if (now - at < maxAgeMs) return last
      if (!running) {
        running = refresh(now)
          .then((r) => {
            last = r
            at = Date.now()
            return r
          })
          .finally(() => {
            running = null
          })
      }
      return running
    },
    forget() {
      files.clear()
      at = 0
      last = { claude: null, codex: null, codexLimits: null }
    }
  }
}
