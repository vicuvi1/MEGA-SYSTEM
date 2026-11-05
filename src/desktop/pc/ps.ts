// One short PowerShell call that prints its answer and exits (Windows only).
// No window, a hard timeout, at most one running at a time per kind, so a
// stuck call never piles up. Nothing stays running.
import { execFile } from 'node:child_process'

const busy = new Map<string, Promise<string | null>>()

/** Runs the script; its stdout, or null (not Windows, timed out, failed). Same `lane` = wait for the one running. */
export function runPs(script: string, o: { timeoutMs?: number; lane?: string } = {}): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  const lane = o.lane ?? ''
  const running = lane ? busy.get(lane) : undefined
  if (running) return running
  const p = new Promise<string | null>((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: o.timeoutMs ?? 8000, maxBuffer: 64 * 1024 },
      (err, stdout) => resolve(err ? null : String(stdout ?? ''))
    )
  }).finally(() => {
    if (lane) busy.delete(lane)
  })
  if (lane) busy.set(lane, p)
  return p
}
