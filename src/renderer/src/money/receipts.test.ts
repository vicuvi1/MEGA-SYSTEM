// Money receipts, the IO with a fake Drive and an in-memory device store:
// kept on the device at once, uploaded when Drive is there, never twice,
// never lost when Drive is away or an upload fails. Made-up files only.
import { describe, expect, it } from 'vitest'
import { mergeReceipts, cleanReceipts, emptyReceipts, type ReceiptIndex } from '@core/receiptIndex'
import { createReceipts, createReceiptDrive, type ReceiptDrive, type StoredReceipt } from './receipts'

function memoryStore() {
  const m = new Map<string, StoredReceipt>()
  return { m, get: async (id: string) => m.get(id), put: async (r: StoredReceipt) => void m.set(r.id, r), list: async () => [...m.values()] }
}
function memoryIndex() {
  let saved: ReceiptIndex = emptyReceipts()
  return { read: async () => saved, save: async (next: ReceiptIndex) => (saved = mergeReceipts(saved, cleanReceipts(next))), peek: () => saved }
}
function fakeDrive(opts: { failUpload?: boolean } = {}) {
  const files: { id: string; name: string; folderId: string; props: Record<string, string>; bytes: number }[] = []
  const folders: string[] = []
  let n = 0
  const drive: ReceiptDrive = {
    folder: async (path) => (folders.push(path.join('/')), `fold:${path.join('/')}`),
    findByIds: async (ids) => Object.fromEntries(files.filter((f) => ids.includes(f.props.lsId)).map((f) => [f.props.lsId, f.id])),
    upload: async (meta, blob) => {
      if (opts.failUpload) throw new Error('Google Drive is busy')
      const id = `drv${++n}`
      files.push({ id, name: meta.name, folderId: meta.folderId, props: meta.appProperties, bytes: blob.size })
      return id
    },
    download: async (id, mime) => new Blob([`file ${id}`], { type: mime })
  }
  return { drive, files, folders }
}
const input = (rid: string, over: Record<string, unknown> = {}) => ({ rid, txId: 't1', date: '2026-11-03', note: 'Printer paper', name: 'paper.jpg', mime: 'image/jpeg', bytes: new Blob(['made-up receipt']), ...over })

describe('money receipts: device first, then Drive', () => {
  it('without Drive the receipt is kept on the device and waits; nothing is lost', async () => {
    const store = memoryStore()
    const index = memoryIndex()
    const r = createReceipts({ store, index, drive: async () => null, now: () => 100 })
    const { rid, entry } = await r.add(input('r-off001'))
    expect(rid).toBe('r-off001')
    expect(entry.driveId).toBeUndefined()
    expect(store.m.get('r-off001')?.blob.size).toBeGreaterThan(0)
    expect(index.peek().items['r-off001']).toMatchObject({ tx: 't1', name: 'paper.jpg', mime: 'image/jpeg', date: '2026-11-03' })
    expect(await r.uploadPending()).toEqual({ uploaded: 0, waiting: 1, error: null })
    // Still openable from this device.
    const f = await r.open('r-off001')
    expect(new TextDecoder().decode(f.bytes)).toBe('made-up receipt')
  })

  it('once Drive is connected it uploads into Life System/Receipts/YYYY-MM and links the Drive id', async () => {
    const store = memoryStore()
    const index = memoryIndex()
    const fake = fakeDrive()
    let on = false
    const r = createReceipts({ store, index, drive: async () => (on ? fake.drive : null), now: () => 200 })
    await r.add(input('r-up0001'))
    await r.add(input('r-up0002', { date: '2026-10-30', mime: 'application/pdf', name: 'bill.pdf' }))
    on = true
    expect(await r.uploadPending()).toEqual({ uploaded: 2, waiting: 0, error: null })
    expect(fake.files.map((f) => [f.name, f.folderId])).toEqual([
      ['2026-11-03 paper r-up0001.jpg', 'fold:Life System/Receipts/2026-11'],
      ['2026-10-30 bill r-up0002.pdf', 'fold:Life System/Receipts/2026-10']
    ])
    expect(fake.files[0].props).toEqual({ lsApp: 'receipt', lsId: 'r-up0001', lsTx: 't1' })
    const items = await r.entries()
    expect(items['r-up0001']).toMatchObject({ driveId: 'drv1', webLink: 'https://drive.google.com/file/d/drv1/view' })
    // The device copy stays (fast to open), and a second run uploads nothing again.
    expect(store.m.has('r-up0001')).toBe(true)
    expect(await r.uploadPending()).toEqual({ uploaded: 0, waiting: 0, error: null })
    expect(fake.files).toHaveLength(2)
  })

  it('a file Drive already has (found by its id) is linked, not uploaded twice', async () => {
    const fake = fakeDrive()
    fake.files.push({ id: 'drvOld', name: 'x', folderId: 'f', props: { lsApp: 'receipt', lsId: 'r-dup001' }, bytes: 3 })
    const index = memoryIndex()
    const r = createReceipts({ store: memoryStore(), index, drive: async () => fake.drive, now: () => 300 })
    await r.add(input('r-dup001'))
    await r.uploadPending()
    expect(fake.files).toHaveLength(1)
    expect(index.peek().items['r-dup001'].driveId).toBe('drvOld')
  })

  it('a failed upload keeps the file and reports the error; the next try sends it', async () => {
    const store = memoryStore()
    const index = memoryIndex()
    let fake = fakeDrive({ failUpload: true })
    const r = createReceipts({ store, index, drive: async () => fake.drive, now: () => 400 })
    await r.add(input('r-fail01'))
    const first = await r.uploadPending()
    expect(first).toMatchObject({ uploaded: 0, waiting: 1, error: 'Google Drive is busy' })
    expect(store.m.has('r-fail01')).toBe(true)
    fake = fakeDrive()
    expect((await r.uploadPending()).uploaded).toBe(1)
    expect(index.peek().items['r-fail01'].driveId).toBe('drv1')
  })

  it('another device opens it from Drive and keeps a copy', async () => {
    const index = memoryIndex()
    await index.save({ v: 1, items: { 'r-far001': { tx: 't2', name: 'far.pdf', mime: 'application/pdf', size: 9, date: '2026-09-01', driveId: 'drvFar', updatedAt: 5 } } })
    const store = memoryStore()
    const r = createReceipts({ store, index, drive: async () => fakeDrive().drive, now: () => 500 })
    const f = await r.open('r-far001')
    expect(new TextDecoder().decode(f.bytes)).toBe('file drvFar')
    expect(f.webLink).toBe('https://drive.google.com/file/d/drvFar/view')
    expect(store.m.has('r-far001')).toBe(true)
    const noDrive = createReceipts({ store: memoryStore(), index, drive: async () => null })
    await expect(noDrive.open('r-far001')).rejects.toThrow(/Connect Google Drive/)
  })

  it('refuses what is not a receipt', async () => {
    const r = createReceipts({ store: memoryStore(), index: memoryIndex(), drive: async () => null })
    await expect(r.add(input('r-bad001', { mime: 'text/html' }))).rejects.toThrow(/photo/)
    await expect(r.add(input('bad id'))).rejects.toThrow(/receipt id/)
  })

  it('photos can be made smaller first; a failed shrink keeps the original', async () => {
    const store = memoryStore()
    const r = createReceipts({ store, index: memoryIndex(), drive: async () => null, shrink: async () => ({ blob: new Blob(['s'], { type: 'image/jpeg' }), mime: 'image/jpeg' }) })
    await r.add(input('r-small1'))
    expect(store.m.get('r-small1')?.size).toBe(1)
    const r2 = createReceipts({ store, index: memoryIndex(), drive: async () => null, shrink: async () => { throw new Error('no canvas') } })
    await r2.add(input('r-big001'))
    expect(store.m.get('r-big001')?.size).toBe('made-up receipt'.length)
  })
})

describe('the real Drive calls (fake fetch)', () => {
  it('makes each folder once (by its app path), then uploads with the ids in appProperties', async () => {
    const calls: { url: string; method: string; body?: any }[] = []
    let n = 0
    const fetchImpl = (async (url: string, init: any = {}) => {
      const method = init.method || 'GET'
      calls.push({ url, method, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body })
      const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers })
      if (method === 'GET' && url.includes('/drive/v3/files?')) return json({ files: [] })
      if (method === 'POST' && url.includes('/drive/v3/files?fields=id')) return json({ id: `f${++n}` })
      if (method === 'POST' && url.includes('/upload/')) return json({}, 200, { Location: 'https://www.googleapis.com/upload/session1' })
      if (method === 'PUT') return json({ id: 'drvNew' })
      return json({}, 404)
    }) as unknown as typeof fetch
    const d = createReceiptDrive(async () => 'k', fetchImpl)
    const folder = await d.folder(['Life System', 'Receipts', '2026-11'])
    expect(folder).toBe('f3')
    const made = calls.filter((c) => c.method === 'POST' && c.url.includes('fields=id')).map((c) => c.body)
    expect(made.map((b) => [b.name, b.appProperties.lsPath, b.parents?.[0] ?? null])).toEqual([
      ['Life System', 'Life System', null],
      ['Receipts', 'Life System/Receipts', 'f1'],
      ['2026-11', 'Life System/Receipts/2026-11', 'f2']
    ])
    await d.folder(['Life System', 'Receipts', '2026-11'])
    expect(calls.filter((c) => c.method === 'POST' && c.url.includes('fields=id'))).toHaveLength(3)
    const id = await d.upload({ name: 'x.jpg', mime: 'image/jpeg', size: 3, folderId: folder, appProperties: { lsApp: 'receipt', lsId: 'r-new001' } }, new Blob(['abc']))
    expect(id).toBe('drvNew')
    expect(calls.find((c) => c.url.includes('/upload/') && c.method === 'POST')!.body).toMatchObject({ parents: ['f3'], appProperties: { lsId: 'r-new001' } })
  })
})
