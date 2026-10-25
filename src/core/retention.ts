// Backup files are named life-YYYYMMDD-HHmmss.lsb so they sort by time.
const NAME = /^life-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.lsb$/

export function backupName(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `life-${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}.lsb`
}

export function isBackupName(name: string): boolean {
  return NAME.test(name)
}

/**
 * Keep the newest `keepRecent` snapshots plus the newest one of each day for
 * the last `keepDays` days. Returns the names to delete.
 */
export function namesToPrune(names: string[], now: Date, keepRecent = 10, keepDays = 30): string[] {
  const sorted = names.filter(isBackupName).sort().reverse()
  const keep = new Set(sorted.slice(0, keepRecent))
  const cutoff = new Date(now.getTime() - keepDays * 86_400_000)
  const seenDays = new Set<string>()
  for (const n of sorted) {
    const m = NAME.exec(n)!
    const day = `${m[1]}-${m[2]}-${m[3]}`
    const when = new Date(+m[1], +m[2] - 1, +m[3])
    if (when >= cutoff && !seenDays.has(day)) {
      seenDays.add(day)
      keep.add(n)
    }
  }
  return sorted.filter((n) => !keep.has(n))
}
