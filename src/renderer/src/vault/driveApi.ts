// Photo Locker: Google Drive, called straight from this device with a
// short-lived Drive-only key from our server (api/google.mjs driveToken).
// Files never pass through Vercel (its 4.5 MB body limit). Uploads are
// resumable: in 8 MiB pieces with progress, and a reload picks up where it
// stopped (Google's session link is kept with the item). With the drive.file
// permission the app sees only files and folders it made itself.
import { CHUNK_BYTES, type RemoteFile } from '@core/vaultSync'

export const DRIVE_BASE = 'https://www.googleapis.com'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const FILE_FIELDS = 'id,name,mimeType,size,parents,appProperties'

export type Progress = (done: number, total: number) => void

export interface DriveFolder {
  id: string
  name: string
}

export class DriveError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message)
  }
}

const plain = (status: number, what: string) =>
  status === 401 ? 'Google Drive sign-in expired: press Connect Google Drive again'
  : status === 403 ? `Google Drive said no to ${what}: check the Drive API is on and your Drive is not full`
  : status === 404 ? `Google Drive could not find ${what}`
  : status === 429 || status >= 500 ? 'Google Drive is busy: it will try again'
  : `Google Drive could not ${what} (${status})`

const toRemote = (f: any): RemoteFile => ({ fileId: String(f.id), name: String(f.name ?? ''), mime: String(f.mimeType ?? ''), sizeBytes: Number(f.size) || 0, parents: Array.isArray(f.parents) ? f.parents.map(String) : [], appProperties: f.appProperties ?? {} })

/** Quotes a value for a Drive search (ids are letters, digits, - and _ only). */
const q = (v: string) => `'${String(v).replace(/[^A-Za-z0-9_-]/g, '')}'`

export function createDrive(getToken: () => Promise<string>, fetchImpl: typeof fetch = (...a) => fetch(...a), base = DRIVE_BASE) {
  const call = async (path: string, init: RequestInit = {}, what = 'do that', retry = true): Promise<Response> => {
    const res = await fetchImpl(path.startsWith('http') ? path : base + path, { ...init, headers: { Authorization: `Bearer ${await getToken()}`, ...(init.headers as Record<string, string>) } })
    if ((res.status === 429 || res.status >= 500) && retry) {
      await new Promise((ok) => setTimeout(ok, 1500))
      return call(path, init, what, false)
    }
    if (!res.ok && res.status !== 308) throw new DriveError(plain(res.status, what), res.status)
    return res
  }
  const json = async (path: string, init: RequestInit = {}, what?: string) => (await call(path, init, what)).json() as Promise<any>

  async function listAll(query: string): Promise<RemoteFile[]> {
    const out: RemoteFile[] = []
    let page = ''
    do {
      const p = new URLSearchParams({ q: query, fields: `nextPageToken,files(${FILE_FIELDS})`, pageSize: '1000', spaces: 'drive' })
      if (page) p.set('pageToken', page)
      const j = await json(`/drive/v3/files?${p}`, {}, 'list the folder')
      for (const f of j.files ?? []) out.push(toRemote(f))
      page = j.nextPageToken ?? ''
    } while (page)
    return out
  }

  return {
    /** Every file of ours in a folder (not in the bin). */
    listFolder: (folderId: string) => listAll(`${q(folderId)} in parents and trashed = false`),
    /**
     * Every file of ours in the folder AND in the sub-folders the app made there
     * (Food → Food/2026-11), at most 3 levels down. `folders` maps each sub-folder
     * path ("Food/2026-11") to its Drive id, so an upload finds it again.
     */
    listTree: async (rootId: string): Promise<{ files: RemoteFile[]; folders: Map<string, string> }> => {
      const files: RemoteFile[] = []
      const folders = new Map<string, string>()
      const walk = async (id: string, path: string, depth: number) => {
        for (const f of await listAll(`${q(id)} in parents and trashed = false`)) {
          if (f.mime === FOLDER_MIME) {
            if (f.appProperties?.lsApp === 'locker-sub' && depth < 3) {
              const p = path ? `${path}/${f.name}` : f.name
              if (!folders.has(p)) folders.set(p, f.fileId)
              await walk(f.fileId, p, depth + 1)
            }
          } else files.push(f)
        }
      }
      await walk(rootId, '', 0)
      return { files, folders }
    },
    /** Folders this app made (drive.file sees only those), for "Use an existing folder". */
    listFolders: async (): Promise<DriveFolder[]> => (await listAll(`mimeType = '${FOLDER_MIME}' and trashed = false`)).filter((f) => f.appProperties?.lsApp !== 'locker-sub' && f.appProperties?.lsApp !== 'receipt-folder').map((f) => ({ id: f.fileId, name: f.name })),
    /** A folder: the Locker's own (no parent), or a sub-folder inside it (Food, 2026-11). */
    createFolder: async (name: string, parentId?: string): Promise<DriveFolder> => {
      const meta = { name: name.slice(0, 120) || 'Photo Locker', mimeType: FOLDER_MIME, appProperties: { lsApp: parentId ? 'locker-sub' : 'locker-folder' }, ...(parentId ? { parents: [parentId] } : {}) }
      const j = await json('/drive/v3/files?fields=id,name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) }, 'make the folder')
      return { id: String(j.id), name: String(j.name) }
    },
    /** Starts a resumable upload; returns Google's session link. */
    startUpload: async (meta: { name: string; mime: string; size: number; folderId: string; appProperties: Record<string, string> }): Promise<string> => {
      const res = await call(
        '/upload/drive/v3/files?uploadType=resumable&fields=' + FILE_FIELDS,
        { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': meta.mime, 'X-Upload-Content-Length': String(meta.size) }, body: JSON.stringify({ name: meta.name, mimeType: meta.mime, parents: [meta.folderId], appProperties: meta.appProperties }) },
        'start the upload'
      )
      const url = res.headers.get('Location') || res.headers.get('location')
      if (!url) throw new DriveError('Google Drive did not give an upload link')
      return url
    },
    /** Sends the file to a session link from where Google stopped. Resolves with the Drive file. */
    resumeUpload: async (url: string, blob: Blob, onProgress?: Progress): Promise<RemoteFile> => {
      const total = blob.size
      // Where did Google stop? (a reload in the middle, or a dropped piece)
      const ask = await call(url, { method: 'PUT', headers: { 'Content-Range': `bytes */${total}` } }, 'continue the upload')
      if (ask.status === 200 || ask.status === 201) return toRemote(await ask.json())
      let from = rangeEnd(ask.headers.get('Range'))
      onProgress?.(from, total)
      while (from < total) {
        const to = Math.min(total, from + CHUNK_BYTES)
        const res = await call(url, { method: 'PUT', headers: { 'Content-Range': `bytes ${from}-${to - 1}/${total}` }, body: blob.slice(from, to) }, 'upload the file')
        if (res.status === 200 || res.status === 201) {
          onProgress?.(total, total)
          return toRemote(await res.json())
        }
        from = rangeEnd(res.headers.get('Range'))
        onProgress?.(from, total)
      }
      throw new DriveError('Google Drive did not confirm the upload')
    },
    /** The file's bytes, with progress. */
    download: async (fileId: string, onProgress?: Progress, mime = 'application/octet-stream'): Promise<Blob> => {
      const res = await call(`/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {}, 'download the file')
      const total = Number(res.headers.get('Content-Length')) || 0
      if (!res.body || !onProgress) return new Blob([await res.arrayBuffer()], { type: mime })
      const reader = res.body.getReader()
      const parts: Uint8Array[] = []
      let done = 0
      for (;;) {
        const { value, done: end } = await reader.read()
        if (end) break
        parts.push(value)
        done += value.length
        onProgress(done, total || done)
      }
      return new Blob(parts as BlobPart[], { type: mime })
    },
    /** To Drive's bin (the owner can still restore it there for 30 days). */
    trash: async (fileId: string) => void (await call(`/drive/v3/files/${encodeURIComponent(fileId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }, 'delete the file')),
    move: async (fileId: string, from: string, to: string) =>
      void (await call(`/drive/v3/files/${encodeURIComponent(fileId)}?addParents=${encodeURIComponent(to)}&removeParents=${encodeURIComponent(from)}&fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 'move the file')),
    /** Drive's storage numbers (bytes; limit 0 = unlimited). */
    about: async (): Promise<{ usage: number; limit: number }> => {
      const j = await json('/drive/v3/about?fields=storageQuota', {}, 'read the storage')
      return { usage: Number(j.storageQuota?.usage) || 0, limit: Number(j.storageQuota?.limit) || 0 }
    }
  }
}

export type DriveApi = ReturnType<typeof createDrive>

/** "bytes=0-1048575" → 1048576 (the next byte to send); none → 0. */
export function rangeEnd(range: string | null): number {
  const m = /bytes=\d+-(\d+)/.exec(range ?? '')
  return m ? Number(m[1]) + 1 : 0
}
