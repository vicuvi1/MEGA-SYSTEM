import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { safeStorage } from 'electron'

/**
 * The backup passphrase, kept with Windows DPAPI (safeStorage) so backups can
 * run unattended. You still need to remember it to restore on another PC.
 */
export class SecretStore {
  private cached: string | null | undefined

  constructor(private file: string) {}

  get(): string | null {
    if (this.cached !== undefined) return this.cached
    this.cached = null
    if (existsSync(this.file) && safeStorage.isEncryptionAvailable()) {
      try {
        this.cached = safeStorage.decryptString(readFileSync(this.file))
      } catch {
        this.cached = null
      }
    }
    return this.cached
  }

  set(value: string): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is not available')
    writeFileSync(this.file, safeStorage.encryptString(value))
    this.cached = value
  }
}
