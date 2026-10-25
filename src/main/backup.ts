import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import Database from 'better-sqlite3'
import { decryptBackup, encryptBackup } from '@core/backupCrypto'
import { backupName, isBackupName, namesToPrune } from '@core/retention'
import type { BackupStatus, VerifyResult } from '@shared/api'
import type { DB } from './db'

export interface BackupOptions {
  db: () => DB
  /** The synced Drive folder, e.g. G:\My Drive. Never created by us. */
  driveRoot: string
  /** e.g. G:\My Drive\Life System\backups */
  dir: string
  /** Used while Google Drive is not mounted; moved into `dir` once it is. */
  pendingDir: string
  passphrase: () => string | null
  now?: () => Date
}

function sqlPath(p: string): string {
  return p.split(sep).join('/').replace(/'/g, "''")
}

function tempFile(tag: string): string {
  return join(tmpdir(), `life-system-${tag}-${process.pid}-${Date.now()}.db`)
}

/** Reads a decrypted snapshot and reports what is in it. */
function inspect(file: string): string {
  const snap = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const integrity = snap.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') throw new Error(`Integrity check failed: ${integrity}`)
    const { n } = snap.prepare('SELECT COUNT(*) AS n FROM ledger').get() as { n: number }
    return `${n} wallet entries, integrity ok`
  } finally {
    snap.close()
  }
}

export class Backups {
  private last: { name: string; at: string } | null = null
  private lastError: string | null = null
  private changesAtLast = -1

  constructor(private o: BackupOptions) {}

  driveAvailable(): boolean {
    return existsSync(this.o.driveRoot)
  }

  private list(dir: string): string[] {
    if (!existsSync(dir)) return []
    return readdirSync(dir).filter(isBackupName).sort()
  }

  names(): string[] {
    return this.list(this.o.dir)
  }

  status(): BackupStatus {
    const names = this.names()
    const latest = names[names.length - 1]
    if (!this.last && latest) this.last = { name: latest, at: statSync(join(this.o.dir, latest)).mtime.toISOString() }
    return {
      dir: this.o.dir,
      driveAvailable: this.driveAvailable(),
      passphraseSet: !!this.o.passphrase(),
      last: this.last,
      pending: this.list(this.o.pendingDir).length,
      count: names.length,
      lastError: this.lastError
    }
  }

  private changes(): number {
    return (this.o.db().prepare('SELECT total_changes() AS n').get() as { n: number }).n
  }

  /** Writes a snapshot unless nothing changed since the last one (`force` skips that check). */
  run(force = false): BackupStatus {
    try {
      const pass = this.o.passphrase()
      if (!pass) throw new Error('Set a backup passphrase in Settings to turn on backups')
      if (!force && this.changes() === this.changesAtLast) return this.status()

      const now = (this.o.now ?? (() => new Date()))()
      const tmp = tempFile('snap')
      this.o.db().exec(`VACUUM INTO '${sqlPath(tmp)}'`)
      const enc = encryptBackup(readFileSync(tmp), pass)
      rmSync(tmp, { force: true })
      const name = backupName(now)

      if (this.driveAvailable()) {
        mkdirSync(this.o.dir, { recursive: true })
        for (const p of this.list(this.o.pendingDir)) renameSync(join(this.o.pendingDir, p), join(this.o.dir, p))
        writeFileSync(join(this.o.dir, name), enc)
        for (const old of namesToPrune(this.names(), now)) rmSync(join(this.o.dir, old), { force: true })
        this.lastError = null
      } else {
        mkdirSync(this.o.pendingDir, { recursive: true })
        writeFileSync(join(this.o.pendingDir, name), enc)
        for (const old of namesToPrune(this.list(this.o.pendingDir), now)) rmSync(join(this.o.pendingDir, old), { force: true })
        this.lastError = 'Google Drive not found. Backups are kept on this PC until it is back'
      }
      this.last = { name, at: now.toISOString() }
      this.changesAtLast = this.changes()
    } catch (e) {
      this.lastError = (e as Error).message
    }
    return this.status()
  }

  private decryptTo(name: string, passphrase: string): string {
    if (!isBackupName(name)) throw new Error('Not a backup file name')
    const file = existsSync(join(this.o.dir, name)) ? join(this.o.dir, name) : join(this.o.pendingDir, name)
    const tmp = tempFile('verify')
    writeFileSync(tmp, decryptBackup(readFileSync(file), passphrase))
    return tmp
  }

  verifyLatest(): VerifyResult {
    const names = this.names()
    const name = names[names.length - 1] ?? this.list(this.o.pendingDir).pop() ?? null
    const pass = this.o.passphrase()
    if (!name) return { ok: false, name: null, detail: 'No backups yet' }
    if (!pass) return { ok: false, name, detail: 'No backup passphrase set' }
    let tmp: string | null = null
    try {
      tmp = this.decryptTo(name, pass)
      return { ok: true, name, detail: inspect(tmp) }
    } catch (e) {
      return { ok: false, name, detail: (e as Error).message }
    } finally {
      if (tmp) rmSync(tmp, { force: true })
    }
  }

  /**
   * Decrypts and checks a backup, then returns the path of a ready database
   * file. The caller swaps it in while the live database is closed.
   */
  prepareRestore(name: string, passphrase: string): string {
    const tmp = this.decryptTo(name, passphrase)
    try {
      inspect(tmp)
    } catch (e) {
      rmSync(tmp, { force: true })
      throw e
    }
    return tmp
  }
}
