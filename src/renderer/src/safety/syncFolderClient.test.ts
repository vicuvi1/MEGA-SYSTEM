// What pages call for the sync folder: a copy carries its counts, a restore
// goes through the app's own restore with the exact checked JSON, and "merge"
// can never overwrite anything (it is not built: it refuses and changes nothing).
import { describe, expect, it, vi } from 'vitest'
import type { SyncFolderIpc } from '@shared/api'
import type { SyncFolderStatus, SyncPreview } from '@core/syncFolder'
import { APP_KEYS, createSyncFolderClient } from './syncFolderClient'

const status: SyncFolderStatus = { enabled: true, folder: '/made-up/OneDrive', device: 'PC-a1b2c3', lastWrite: null, lastVerifiedOk: null, versions: 0, sizeBytes: 0, lastSizeBytes: null, error: null, missing: false, encrypt: false, passphraseSaved: false, others: [] }
const backup = JSON.stringify({ version: 2, tables: { tasks: [{ id: 1 }, { id: 2 }], ledger: [{ id: 1 }] }, financeState: { tx: [{ id: 't1', amount: 5, updatedAt: 200 }] } })
const preview: SyncPreview = { id: 'PC-a1b2c3/life-sync-20261118T090000Z.zip', at: '2026-11-18T09:00:00.000Z', device: 'PC', appVersion: '1.4.1', schemaVersion: 71, rows: 3, tables: { tasks: 2, ledger: 1 }, apps: [], sizeBytes: 100, encrypted: false }

function fakeIpc(over: Partial<SyncFolderIpc> = {}): SyncFolderIpc {
  return {
    status: vi.fn(async () => status),
    suggestions: vi.fn(async () => []),
    choose: vi.fn(async () => status),
    turnOff: vi.fn(async () => ({ ...status, enabled: false })),
    write: vi.fn(async () => status),
    touch: vi.fn(),
    listVersions: vi.fn(async () => []),
    preview: vi.fn(async () => preview),
    read: vi.fn(async () => backup),
    setEncryption: vi.fn(async () => status),
    open: vi.fn(async () => {}),
    onWant: vi.fn(),
    onChanged: vi.fn(),
    ...over
  }
}

describe('sync folder client', () => {
  it('is hidden on the website: not available, off, and nothing can be written', async () => {
    const restoreSnapshot = vi.fn()
    const c = createSyncFolderClient({ ipc: () => undefined, exportJson: async () => backup, restoreSnapshot })
    expect(c.available()).toBe(false)
    expect(await c.status()).toMatchObject({ enabled: false, folder: null })
    expect(await c.listVersions()).toEqual([])
    await expect(c.writeNow()).rejects.toThrow(/desktop app/)
    await expect(c.restore(preview.id)).rejects.toThrow(/desktop app/)
    expect(restoreSnapshot).not.toHaveBeenCalled()
  })

  it('sends a copy with its row counts, app checksums and the schema version', async () => {
    const ipc = fakeIpc()
    const c = createSyncFolderClient({ ipc: () => ipc, exportJson: async () => backup, restoreSnapshot: vi.fn(), schemaVersion: 71 })
    await c.writeNow()
    const [json, meta, force] = (ipc.write as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(json).toBe(backup)
    expect(meta).toMatchObject({ schemaVersion: 71, tables: { tasks: 2, ledger: 1 } })
    expect(meta.apps.map((a: { field: string }) => a.field)).toEqual(['financeState'])
    expect(force).toBe(true)
    await c.writeIfChanged()
    expect((ipc.write as ReturnType<typeof vi.fn>).mock.calls[1][2]).toBe(false)
  })

  it('never sends a copy of data that is not loaded', async () => {
    const ipc = fakeIpc()
    const c = createSyncFolderClient({ ipc: () => ipc, exportJson: async () => 'null', restoreSnapshot: vi.fn() })
    await expect(c.writeNow()).rejects.toThrow(/not loaded/)
    expect(ipc.write).not.toHaveBeenCalled()
  })

  it('restores a version through the app’s own restore, with the checked JSON, after its preview', async () => {
    const ipc = fakeIpc()
    const order: string[] = []
    ;(ipc.preview as ReturnType<typeof vi.fn>).mockImplementation(async () => (order.push('preview'), preview))
    ;(ipc.read as ReturnType<typeof vi.fn>).mockImplementation(async () => (order.push('read'), backup))
    const restoreSnapshot = vi.fn(async () => (order.push('restore'), true))
    const c = createSyncFolderClient({ ipc: () => ipc, exportJson: async () => backup, restoreSnapshot })
    expect(await c.restore(preview.id)).toEqual(preview)
    expect(order).toEqual(['preview', 'read', 'restore'])
    expect(restoreSnapshot).toHaveBeenCalledWith(backup)
    // The restore itself writes nothing into the folder.
    expect(ipc.write).not.toHaveBeenCalled()
  })

  it('a copy that fails its check, or is not a backup, is never restored', async () => {
    const restoreSnapshot = vi.fn()
    const bad = createSyncFolderClient({ ipc: () => fakeIpc({ preview: async () => { throw new Error('backup.json in the copy does not match its checksum') } }), exportJson: async () => backup, restoreSnapshot })
    await expect(bad.restore(preview.id)).rejects.toThrow(/checksum/)
    const notBackup = createSyncFolderClient({ ipc: () => fakeIpc({ read: async () => '{"hello":1}' }), exportJson: async () => backup, restoreSnapshot })
    await expect(notBackup.restore(preview.id)).rejects.toThrow(/not a Life System backup/)
    expect(restoreSnapshot).not.toHaveBeenCalled()
  })

  it('merge never overwrites newer data: it refuses and changes nothing here or in the folder', async () => {
    const ipc = fakeIpc({ listVersions: async () => [{ id: 'Laptop-ffffff/life-sync-20261101T090000Z.zip', device: 'Laptop-ffffff', mine: false, at: '2026-11-01T09:00:00.000Z', sizeBytes: 10, encrypted: false }] })
    const restoreSnapshot = vi.fn()
    const exportJson = vi.fn(async () => backup)
    const c = createSyncFolderClient({ ipc: () => ipc, exportJson, restoreSnapshot })
    const r = await c.merge()
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/Nothing was changed/)
    expect(restoreSnapshot).not.toHaveBeenCalled()
    expect(ipc.write).not.toHaveBeenCalled()
    expect(ipc.read).not.toHaveBeenCalled()
    expect(exportJson).not.toHaveBeenCalled()
  })

  it('watches the keys where the embedded apps keep their own data', () => {
    for (const k of ['finance-helper.state', 'finance-helper.enc', 'life_sport_tracker_v1', 'waky_web_data_v2', 'MAN_SPARTAN_DATA']) expect(APP_KEYS.has(k)).toBe(true)
  })
})
