import { describe, expect, it } from 'vitest'
import {
  byMonth, checkFile, checkVideo, cleanIndex, deletePlan, driveProps, emptyIndex, filterItems, folderMovePlan, fromRemote, mergeIndex, notBackedUpLine, planSync,
  FILE_MAX_BYTES, INDEX_MAX_BYTES, VIDEO_MAX_BYTES, type LocalMeta, type RemoteFile, type VaultIndex
} from './vaultSync'

const NOW = 1_800_000_000_000
const local = (id: string, extra: Partial<LocalMeta> = {}): LocalMeta => ({ id, kind: 'photo', name: `${id}.jpg`, tags: ['progress'], takenAt: NOW - 1000, sizeBytes: 500_000, mime: 'image/jpeg', hasBlob: true, updatedAt: NOW - 1000, ...extra })
/** A fake Drive folder: files carrying our app id in appProperties. */
const remote = (id: string, fileId: string, folder = 'fold1', extra: Partial<RemoteFile> = {}): RemoteFile => ({
  fileId, name: `${id}.jpg`, mime: 'image/jpeg', sizeBytes: 500_000, parents: [folder],
  appProperties: driveProps({ id, kind: 'photo', takenAt: NOW - 1000, tags: ['progress'] }), ...extra
})
const withFolder = (ix: VaultIndex = emptyIndex()): VaultIndex => ({ ...ix, folder: { id: 'fold1', name: 'Photo Locker' } })

describe('Photo Locker sync plan', () => {
  it('uploads local-only items to the chosen folder', () => {
    const p = planSync({ local: [local('vA1'), local('vA2')], index: withFolder(), remote: [], folderId: 'fold1', now: NOW })
    expect(p.uploads).toEqual(['vA1', 'vA2'])
    expect(p.notBackedUp).toMatchObject({ here: 2, elsewhere: 0 })
    expect(Object.keys(p.index.items)).toEqual(['vA1', 'vA2'])
  })

  it('never uploads twice: a file already in Drive with the same app id is linked, not uploaded', () => {
    const p = planSync({ local: [local('vA1')], index: withFolder(), remote: [remote('vA1', 'file111')], folderId: 'fold1', now: NOW })
    expect(p.uploads).toEqual([])
    expect(p.adopt).toEqual([{ id: 'vA1', fileId: 'file111', folderId: 'fold1' }])
    expect(p.index.items.vA1.driveFileId).toBe('file111')
    // Two Drive files with one app id (a crash mid-save): still no third copy.
    const twice = planSync({ local: [local('vA1')], index: withFolder(), remote: [remote('vA1', 'file111'), remote('vA1', 'file222')], folderId: 'fold1', now: NOW })
    expect(twice.uploads).toEqual([])
    expect(twice.index.items.vA1.driveFileId).toBe('file111')
  })

  it('downloads items in Drive that this device lacks; files of other apps are ignored', () => {
    const stranger: RemoteFile = { fileId: 'other999', name: 'cv.pdf', mime: 'application/pdf', sizeBytes: 10, parents: ['fold1'], appProperties: {} }
    const p = planSync({ local: [], index: withFolder(), remote: [remote('vB1', 'file333'), stranger], folderId: 'fold1', now: NOW })
    expect(p.downloads).toEqual([{ id: 'vB1', fileId: 'file333', kind: 'photo', sizeBytes: 500_000 }])
    expect(p.learn.map((e) => e.id)).toEqual(['vB1'])
    expect(p.index.items.other999).toBeUndefined()
  })

  it('downloads from the index too when Drive is not listed yet, and a row without its file', () => {
    const ix = withFolder()
    ix.items.vB2 = { id: 'vB2', kind: 'video', name: 'squat.mp4', tags: [], takenAt: NOW, sizeBytes: 9e6, mime: 'video/mp4', driveFileId: 'file444', updatedAt: NOW }
    const p = planSync({ local: [local('vB3', { hasBlob: false, driveFileId: 'file555' })], index: ix, remote: null, folderId: 'fold1', now: NOW })
    expect(p.downloads.map((d) => d.id).sort()).toEqual(['vB2', 'vB3'])
    expect(p.uploads).toEqual([]) // offline: nothing goes up
  })

  it('removed from this device only: not downloaded again by itself', () => {
    const p = planSync({ local: [local('vC1', { hasBlob: false, removedHere: true })], index: withFolder(), remote: [remote('vC1', 'file666')], folderId: 'fold1', now: NOW })
    expect(p.downloads).toEqual([])
  })

  it('a tombstone from another device drops the item here', () => {
    const ix = withFolder()
    ix.items.vD1 = { id: 'vD1', kind: 'photo', name: 'x', tags: [], takenAt: NOW, sizeBytes: 1, mime: 'image/jpeg', deletedAt: NOW, updatedAt: NOW }
    const p = planSync({ local: [local('vD1')], index: ix, remote: [], folderId: 'fold1', now: NOW })
    expect(p.drop).toEqual(['vD1'])
    expect(p.uploads).toEqual([])
  })

  it('warns when something exists on one device only', () => {
    const ix = withFolder()
    ix.items.vE1 = { id: 'vE1', kind: 'file', name: 'scan.pdf', tags: [], takenAt: NOW, sizeBytes: 1000, mime: 'application/pdf', updatedAt: NOW }
    const p = planSync({ local: [local('vE2')], index: ix, remote: null, folderId: null, now: NOW })
    expect(p.notBackedUp).toMatchObject({ here: 1, elsewhere: 1 })
    expect(notBackedUpLine(p.notBackedUp, false)).toBe('Not backed up yet: 1 item on this device, 1 on another device (connect Google Drive to back them up)')
    expect(notBackedUpLine({ here: 0, elsewhere: 0, bytes: 0 }, true)).toBeNull()
    // Next time the row learned from the other device is listed here (no file yet): still "elsewhere".
    const again = planSync({ local: [local('vE2'), local('vE1', { hasBlob: false, kind: 'file' })], index: p.index, remote: null, folderId: null, now: NOW })
    expect(again.notBackedUp).toMatchObject({ here: 1, elsewhere: 1 })
  })

  it('a file deleted in Drive by hand goes up again from the device that still has it', () => {
    const p = planSync({ local: [local('vF1', { driveFileId: 'gone777', driveFolderId: 'fold1' })], index: withFolder(), remote: [], folderId: 'fold1', now: NOW })
    expect(p.uploads).toEqual(['vF1'])
    expect(p.index.items.vF1.driveFileId).toBeUndefined()
  })
})

describe('Photo Locker delete and folder change', () => {
  const entry = { id: 'vG1', kind: 'photo' as const, name: 'a', tags: [], takenAt: NOW, sizeBytes: 1, mime: 'image/jpeg', driveFileId: 'file888', updatedAt: NOW - 5 }
  it('"Delete from Drive too" trashes the Drive file and leaves a tombstone for every device', () => {
    const d = deletePlan(entry, undefined, true, NOW)
    expect(d).toMatchObject({ trashFileId: 'file888', removeLocal: 'all' })
    expect(d.entry?.deletedAt).toBe(NOW)
  })
  it('"This device only" keeps the Drive copy; an item never backed up is gone for good', () => {
    expect(deletePlan(entry, undefined, false, NOW)).toEqual({ trashFileId: null, entry: null, removeLocal: 'blob' })
    const lonely = { ...entry, driveFileId: undefined }
    expect(deletePlan(lonely, undefined, false, NOW)).toMatchObject({ trashFileId: null, removeLocal: 'all', entry: { deletedAt: NOW } })
  })
  it('changing the folder moves our files (no re-upload); other files stay', () => {
    const files = [remote('vH1', 'file901', 'old1'), remote('vH2', 'file902', 'old1'), { ...remote('vH3', 'file903', 'old1'), appProperties: {} }]
    expect(folderMovePlan(files, 'old1', 'new1')).toEqual([{ fileId: 'file901', from: 'old1' }, { fileId: 'file902', from: 'old1' }])
    expect(folderMovePlan(files, 'new1', 'new1')).toEqual([])
    expect(folderMovePlan(files, null, 'new1')).toEqual([])
  })
})

describe('Photo Locker limits and index', () => {
  it('refuses a video over 60 seconds with a plain message', () => {
    expect(checkVideo(59.9, 10e6)).toBeNull()
    expect(checkVideo(61, 10e6)).toMatch(/61 seconds long\. Videos can be at most 60 seconds/)
    expect(checkVideo(30, VIDEO_MAX_BYTES + 1)).toMatch(/at most 150 MB/)
    expect(checkVideo(NaN, 1)).toMatch(/can't be read/)
  })
  it('files up to 200 MB', () => {
    expect(checkFile(FILE_MAX_BYTES)).toBeNull()
    expect(checkFile(FILE_MAX_BYTES + 1)).toMatch(/at most 200 MB/)
    expect(checkFile(0)).toMatch(/empty/)
  })
  it('the synced index keeps metadata only and stays under its size cap', () => {
    const raw: any = { folder: { id: 'fold1', name: 'Locker' }, items: {} }
    for (let i = 0; i < 4000; i++) raw.items[`v${i}xx`] = { kind: 'photo', name: 'n'.repeat(200), tags: ['progress'], takenAt: i, sizeBytes: 1, mime: 'image/jpeg', updatedAt: i, blob: 'data:image/jpeg;base64,AAAA', thumb: 'x' }
    const ix = cleanIndex(raw)
    expect(JSON.stringify(ix).length).toBeLessThanOrEqual(INDEX_MAX_BYTES)
    expect(JSON.stringify(ix)).not.toContain('base64')
    const one = Object.values(ix.items)[0] as any
    expect(one.blob).toBeUndefined()
    expect(one.name.length).toBeLessThanOrEqual(80)
    // The newest stay.
    expect(ix.items['v3999xx']).toBeDefined()
    expect(cleanIndex({ items: { 'bad id!': { kind: 'photo' } } }).items).toEqual({})
  })
  it('two devices saving the index at once: both items stay, a Drive link is never lost, a tombstone wins', () => {
    const a = cleanIndex({ items: { vI1: { kind: 'photo', name: 'a', updatedAt: 5, driveFileId: 'file123' }, vI3: { kind: 'photo', name: 'c', updatedAt: 5 } } })
    const b = cleanIndex({ items: { vI1: { kind: 'photo', name: 'renamed', updatedAt: 9 }, vI2: { kind: 'video', name: 'b', updatedAt: 1 }, vI3: { kind: 'photo', name: 'c', updatedAt: 4, deletedAt: 4 } } })
    const m = mergeIndex(a, b)
    expect(Object.keys(m.items).sort()).toEqual(['vI1', 'vI2', 'vI3'])
    expect(m.items.vI1).toMatchObject({ name: 'renamed', driveFileId: 'file123' })
    expect(m.items.vI3.deletedAt).toBe(4)
  })
  it('Drive appProperties round-trip and stay within Drive limits', () => {
    const props = driveProps({ id: 'vJ1', kind: 'video', takenAt: NOW, tags: Array.from({ length: 8 }, (_, i) => `tag-number-${i}-long`), durationS: 42 })
    for (const [k, v] of Object.entries(props)) expect(new TextEncoder().encode(k + v).length).toBeLessThanOrEqual(124)
    const back = fromRemote({ fileId: 'f12345', name: 'clip.mp4', mime: 'video/mp4', sizeBytes: 3, parents: ['fold1'], appProperties: props })
    expect(back).toMatchObject({ id: 'vJ1', kind: 'video', durationS: 42, driveFileId: 'f12345', driveFolderId: 'fold1' })
  })
  it('filters, search and the month timeline', () => {
    const items = [
      { kind: 'photo' as const, name: 'front.jpg', tags: ['progress'], takenAt: new Date(2026, 10, 3).getTime() },
      { kind: 'video' as const, name: 'squat form', tags: ['legs'], takenAt: new Date(2026, 9, 20).getTime() },
      { kind: 'file' as const, name: 'blood test.pdf', tags: ['health'], takenAt: new Date(2026, 10, 1).getTime() }
    ]
    expect(filterItems(items, 'progress', '').map((i) => i.name)).toEqual(['front.jpg'])
    expect(filterItems(items, 'all', '#legs').map((i) => i.name)).toEqual(['squat form'])
    expect(filterItems(items, 'all', 'blood').map((i) => i.name)).toEqual(['blood test.pdf'])
    expect(byMonth(items).map((g) => [g.label, g.items.length])).toEqual([['November 2026', 2], ['October 2026', 1]])
  })
})
