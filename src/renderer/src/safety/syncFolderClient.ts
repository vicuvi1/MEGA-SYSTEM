// Sync folder (desktop, 2026-11-18): what pages call. A live copy of all data
// in a folder you choose; see docs/areas/data-sync.md "Sync folder".
//   syncFolder.available()            false on the website and on older desktops
//   syncFolder.status()               { enabled, folder, lastWrite, lastVerifiedOk, versions, sizeBytes, error, … }
//   syncFolder.choose(path?)          the folder picker (or one of suggestions())
//   syncFolder.writeNow()             one copy now
//   syncFolder.listVersions()         every version, newest first
//   syncFolder.preview(versionId)     date and row counts, after a checksum check
//   syncFolder.restore(versionId)     through the app's own restore (backup first, all or nothing, restore id)
//   syncFolder.merge()                not built yet: always refuses, changes nothing (DECISIONS.md)
import { MIGRATIONS } from '@core/schema'
import { APP_BLOBS } from '@core/backupPlan'
import { copyMeta, type SyncFolderStatus, type SyncPreview, type SyncSuggestion, type SyncVersion } from '@core/syncFolder'
import type { SyncFolderIpc } from '@shared/api'

export interface SyncFolderDeps {
  ipc: () => SyncFolderIpc | undefined
  exportJson: () => Promise<string>
  restoreSnapshot: (text: string) => Promise<unknown>
  schemaVersion?: number
}

const OFF: SyncFolderStatus = { enabled: false, folder: null, device: '', lastWrite: null, lastVerifiedOk: null, versions: 0, sizeBytes: 0, lastSizeBytes: null, error: null, missing: false, encrypt: false, passphraseSaved: false, others: [] }

export function createSyncFolderClient(d: SyncFolderDeps) {
  const need = (): SyncFolderIpc => {
    const ipc = d.ipc()
    if (!ipc) throw new Error('The sync folder is in the desktop app')
    return ipc
  }
  /** One copy: the backup JSON (everything) and its counts go to the desktop, which adds the database file. */
  const write = async (force: boolean): Promise<SyncFolderStatus> => {
    const ipc = need()
    const json = await d.exportJson()
    const snap = JSON.parse(json)
    if (!snap || typeof snap.tables !== 'object') throw new Error('The data is not loaded yet')
    return ipc.write(json, copyMeta(snap, d.schemaVersion ?? MIGRATIONS.length), force)
  }
  return {
    available: () => !!d.ipc(),
    status: async (): Promise<SyncFolderStatus> => d.ipc()?.status() ?? OFF,
    suggestions: async (): Promise<SyncSuggestion[]> => d.ipc()?.suggestions() ?? [],
    choose: (path?: string | null) => need().choose(path ?? null),
    turnOff: () => need().turnOff(),
    /** Writes a copy now, even when nothing changed. */
    writeNow: () => write(true),
    /** The desktop asked (a change, quit, sleep, lock): a copy only when something changed. */
    writeIfChanged: () => write(false),
    listVersions: async (): Promise<SyncVersion[]> => d.ipc()?.listVersions() ?? [],
    preview: (versionId: string): Promise<SyncPreview> => need().preview(versionId),
    /**
     * Puts a version back through the app's own restore: a backup of today is
     * saved first, the tables change all or nothing, and every app copy gets a
     * restore id so no device merges its old data back in.
     */
    async restore(versionId: string): Promise<SyncPreview> {
      const ipc = need()
      const preview = await ipc.preview(versionId)
      const text = await ipc.read(versionId)
      const snap = JSON.parse(text)
      if (!snap || typeof snap.tables !== 'object') throw new Error('This copy is not a Life System backup')
      await d.restoreSnapshot(text)
      return preview
    },
    /**
     * "Merge from sync folder" (another PC's copy, while the server is down) is
     * not built: a safe merge of the tables needs a shared base both PCs agree
     * on. It refuses and changes nothing; the design is in docs/DECISIONS.md.
     */
    async merge(): Promise<{ ok: false; reason: string }> {
      return { ok: false, reason: "Merging another PC's copy is not available yet. Nothing was changed. You can still restore one of its versions." }
    },
    setEncryption: (on: boolean, passphrase?: string | null) => need().setEncryption(on, passphrase ?? null),
    open: () => need().open()
  }
}

/** The keys in this window's storage that hold an app's own data (a change there needs a new copy). */
export const APP_KEYS: ReadonlySet<string> = new Set(APP_BLOBS.map((b) => b.localKey))
