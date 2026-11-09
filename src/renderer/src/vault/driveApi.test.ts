// Photo Locker's Drive client against a fake Drive (in memory, made-up data).
import { describe, expect, it } from 'vitest'
import { CHUNK_BYTES, driveProps, planSync, emptyIndex } from '@core/vaultSync'
import { createDrive, rangeEnd } from './driveApi'

const KEY = 'made-up-key'

/** A tiny Drive: folders, files with appProperties, resumable sessions that can be cut off. */
function fakeDrive() {
  const files = new Map<string, { id: string; name: string; mimeType: string; parents: string[]; appProperties: any; data: Uint8Array; trashed?: boolean }>()
  const sessions = new Map<string, { meta: any; got: Uint8Array[]; size: number; total: number }>()
  let n = 0
  let cutAfter = Infinity // stop answering pieces after this many (a reload in the middle)
  const calls: string[] = []
  const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(status === 308 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
  const view = (f: any) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: String(f.data.length), parents: f.parents, appProperties: f.appProperties })
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url)
    const method = init.method ?? 'GET'
    calls.push(`${method} ${u.pathname}`)
    if ((init.headers as any)?.Authorization !== `Bearer ${KEY}`) return reply({}, 401)
    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const id = `s${++n}`
      sessions.set(id, { meta: JSON.parse(String(init.body)), got: [], size: 0, total: Number((init.headers as any)['X-Upload-Content-Length']) })
      return reply({}, 200, { Location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${id}` })
    }
    if (u.pathname === '/upload/drive/v3/files' && method === 'PUT') {
      const s = sessions.get(u.searchParams.get('upload_id')!)
      if (!s) return reply({}, 404)
      const range = String((init.headers as any)['Content-Range'])
      const done = () => {
        const id = `f${++n}`
        const data = new Uint8Array(s.got.reduce((t, p) => t + p.length, 0))
        let o = 0
        for (const p of s.got) (data.set(p, o), (o += p.length))
        files.set(id, { id, name: s.meta.name, mimeType: s.meta.mimeType, parents: s.meta.parents, appProperties: s.meta.appProperties, data })
        return reply(view(files.get(id)), 200)
      }
      if (range.startsWith('bytes */')) return s.size === s.total ? done() : reply(null, 308, s.size ? { Range: `bytes=0-${s.size - 1}` } : {})
      if (cutAfter-- <= 0) throw new TypeError('Failed to fetch') // the page was closed
      const part = new Uint8Array(await (init.body as Blob).arrayBuffer())
      s.got.push(part)
      s.size += part.length
      return s.size === s.total ? done() : reply(null, 308, { Range: `bytes=0-${s.size - 1}` })
    }
    const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname)
    if (m && u.searchParams.get('alt') === 'media') {
      const f = files.get(m[1])
      return f ? new Response(f.data as BodyInit, { status: 200, headers: { 'Content-Length': String(f.data.length) } }) : reply({}, 404)
    }
    if (m && method === 'PATCH') {
      const f = files.get(m[1])!
      const body = JSON.parse(String(init.body || '{}'))
      if (body.trashed) f.trashed = true
      if (u.searchParams.get('addParents')) f.parents = [u.searchParams.get('addParents')!]
      return reply({ id: f.id })
    }
    if (u.pathname === '/drive/v3/files' && method === 'POST') {
      const meta = JSON.parse(String(init.body))
      const id = `d${++n}`
      files.set(id, { id, name: meta.name, mimeType: meta.mimeType, parents: [], appProperties: meta.appProperties, data: new Uint8Array() })
      return reply({ id, name: meta.name })
    }
    if (u.pathname === '/drive/v3/files') {
      const q = u.searchParams.get('q')!
      const parent = /'([^']+)' in parents/.exec(q)?.[1]
      const list = [...files.values()].filter((f) => !f.trashed && (parent ? f.parents.includes(parent) : /folder/.test(q) ? f.mimeType.includes('folder') : true))
      return reply({ files: list.map(view) })
    }
    return reply({}, 404)
  }) as unknown as typeof fetch
  return { fetchImpl, files, calls, cut: (k: number) => (cutAfter = k) }
}

const bytes = (size: number) => new Blob([new Uint8Array(size).map((_, i) => i % 251)])

describe('Photo Locker Drive client (fake Drive)', () => {
  it('makes a folder, uploads in 8 MiB pieces with progress, lists it with our app id and downloads it whole', async () => {
    const fd = fakeDrive()
    const d = createDrive(async () => KEY, fd.fetchImpl)
    const folder = await d.createFolder('Photo Locker')
    const blob = bytes(CHUNK_BYTES * 2 + 1000)
    const url = await d.startUpload({ name: 'clip.mp4', mime: 'video/mp4', size: blob.size, folderId: folder.id, appProperties: driveProps({ id: 'vK1', kind: 'video', takenAt: 1, tags: [], durationS: 30 }) })
    const seen: number[] = []
    const f = await d.resumeUpload(url, blob, (done) => seen.push(done))
    expect(seen.at(-1)).toBe(blob.size)
    expect(fd.calls.filter((c) => c === 'PUT /upload/drive/v3/files')).toHaveLength(4) // 1 "where were we" + 3 pieces
    const listed = await d.listFolder(folder.id)
    expect(listed).toHaveLength(1)
    expect(listed[0].appProperties.lsId).toBe('vK1')
    const back = await d.download(f.fileId, () => {})
    expect(back.size).toBe(blob.size)
    expect(new Uint8Array(await back.arrayBuffer())[1000]).toBe(1000 % 251)
  })

  it('a reload in the middle: the same session link carries on from where Google stopped, one file in Drive', async () => {
    const fd = fakeDrive()
    const d = createDrive(async () => KEY, fd.fetchImpl)
    const blob = bytes(CHUNK_BYTES * 3)
    const url = await d.startUpload({ name: 'a.mp4', mime: 'video/mp4', size: blob.size, folderId: 'fold1', appProperties: driveProps({ id: 'vL1', kind: 'video', takenAt: 1, tags: [] }) })
    fd.cut(1)
    await expect(d.resumeUpload(url, blob)).rejects.toThrow()
    fd.cut(Infinity)
    const seen: number[] = []
    await d.resumeUpload(url, blob, (done) => seen.push(done))
    expect(seen[0]).toBe(CHUNK_BYTES) // started after the piece Google already had
    const listed = await d.listFolder('fold1')
    expect(listed).toHaveLength(1)
    expect((await d.download(listed[0].fileId)).size).toBe(blob.size)
    // The next sync sees it in Drive by app id and plans no second upload.
    const plan = planSync({ local: [{ id: 'vL1', kind: 'video', name: 'a.mp4', tags: [], takenAt: 1, sizeBytes: blob.size, mime: 'video/mp4', hasBlob: true, updatedAt: 1 }], index: emptyIndex(), remote: listed, folderId: 'fold1', now: 2 })
    expect(plan.uploads).toEqual([])
  })

  it('moves files to a new folder and trashes on delete; a wrong key is a plain message', async () => {
    const fd = fakeDrive()
    const d = createDrive(async () => KEY, fd.fetchImpl)
    const url = await d.startUpload({ name: 'p.jpg', mime: 'image/jpeg', size: 10, folderId: 'old1', appProperties: driveProps({ id: 'vM1', kind: 'photo', takenAt: 1, tags: [] }) })
    const f = await d.resumeUpload(url, bytes(10))
    await d.move(f.fileId, 'old1', 'new1')
    expect(await d.listFolder('old1')).toHaveLength(0)
    expect(await d.listFolder('new1')).toHaveLength(1)
    await d.trash(f.fileId)
    expect(await d.listFolder('new1')).toHaveLength(0)
    const wrong = createDrive(async () => 'other', fd.fetchImpl)
    await expect(wrong.listFolder('new1')).rejects.toThrow(/sign-in expired/)
    expect(rangeEnd('bytes=0-99')).toBe(100)
    expect(rangeEnd(null)).toBe(0)
  })
})
