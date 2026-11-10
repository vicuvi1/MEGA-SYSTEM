// Photo Locker (docs/areas/vault.md): progress photos, short videos and
// private files, kept on every device and backed up to a folder in your own
// Google Drive. NOT encrypted (your choice). Timeline by month, filters,
// search and tags, an item view, a pose guide for progress photos, the Drive
// status and a "Not backed up yet" warning. No points.
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { byMonth, cleanTags, filterItems, mb, PROGRESS_TAG, VIDEO_MAX_SECONDS, type VaultFilter } from '@core/vaultSync'
import { weekBody, weekBodyLine } from '@core/vaultBody'
import type { DayPoint } from '@core/bodyComp'
import { dayKey } from '@core/dates'
import { life } from '../bridge'
import { PageHeader } from '../blocks'
import { askConfirm, askText } from '../confirmSheet'
import { timeAgo, useAction, useToast } from '../ui'
import { prepare } from './mediaPrep'
import { listItems, type VaultItem } from './vaultStore'
import {
  addItems, checkConnected, chooseFolder, deleteItem, downloadOne, editItem, importProgressPhotos, listDriveFolders, onSync, syncNow, syncState, warningLine, type SyncState
} from './driveSync'
import type { DriveFolder } from './driveApi'
import './locker.css'

const FILTERS: { id: VaultFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'progress', label: 'Progress photos' },
  { id: 'food', label: 'Food' },
  { id: 'video', label: 'Videos' },
  { id: 'file', label: 'Files' }
]
const secs = (s?: number) => (s == null ? '' : `0:${String(Math.round(s)).padStart(2, '0')}`)
const when = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** Object URLs for blobs, released when the list changes. */
function useUrls(items: VaultItem[], pick: (it: VaultItem) => Blob | undefined) {
  const urls = useMemo(() => {
    const m = new Map<string, string>()
    for (const it of items) {
      const b = pick(it)
      if (b) m.set(it.id, URL.createObjectURL(b))
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])
  return urls
}

export function PhotoLocker() {
  const act = useAction()
  const toast = useToast()
  const [items, setItems] = useState<VaultItem[]>([])
  const [sync, setSync] = useState<SyncState>(syncState())
  const [filter, setFilter] = useState<VaultFilter>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [camera, setCamera] = useState(false)
  const [points, setPoints] = useState<DayPoint[]>([])
  const pickFile = useRef<HTMLInputElement>(null)
  const pickCam = useRef<HTMLInputElement>(null)
  const pickProgress = useRef<HTMLInputElement>(null)

  const load = useCallback(() => void listItems().then((l) => setItems(l.filter((it) => it.blob || it.driveFileId || !it.removedHere))), [])
  useEffect(() => {
    load()
    const off = onSync(setSync)
    const changed = () => load()
    // Another device saved the index: look again (a light pass, Drive is listed once).
    let t: ReturnType<typeof setTimeout> | null = null
    const remote = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => void syncNow(), 1500)
    }
    window.addEventListener('life-vault-changed', changed)
    window.addEventListener('life-data-changed', remote)
    window.addEventListener('online', remote)
    void (async () => {
      await importProgressPhotos().catch(() => 0)
      await checkConnected()
      void syncNow()
    })()
    void life.coach?.bodyComp?.view().then((v) => setPoints(v.points)).catch(() => {})
    return () => {
      off()
      if (t) clearTimeout(t)
      window.removeEventListener('life-vault-changed', changed)
      window.removeEventListener('life-data-changed', remote)
      window.removeEventListener('online', remote)
    }
  }, [load])

  const shown = useMemo(() => filterItems(items, filter, q), [items, filter, q])
  const months = useMemo(() => byMonth(shown), [shown])
  const thumbs = useUrls(items, (it) => it.thumb ?? (it.kind === 'photo' ? it.blob : undefined))
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, filterItems(items, f.id, '').length])), [items])
  const warn = warningLine(sync)

  const add = async (files: File[] | FileList | null, opts: { progress?: boolean } = {}) => {
    const list = Array.from(files ?? [])
    if (!list.length) return
    const ready: VaultItem[] = []
    for (const [i, f] of list.entries()) {
      setBusy(`Getting ${f.name || 'it'} ready (${i + 1} of ${list.length})…`)
      try {
        ready.push(await prepare(f, opts))
      } catch (e) {
        toast((e as Error).message, 'bad')
      }
    }
    setBusy(null)
    if (!ready.length) return
    await act(() => addItems(ready), `${ready.length === 1 ? 'Added' : `${ready.length} added`}${sync.connected && sync.folder ? ': backing up to Drive' : ' on this device'}`)
    load()
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    void add(e.dataTransfer.files)
  }

  return (
    <div className={`locker${drag ? ' dragging' : ''}`} onDragOver={(e) => (e.preventDefault(), setDrag(true))} onDragLeave={(e) => e.currentTarget === e.target && setDrag(false)} onDrop={onDrop} data-testid="photo-locker">
      <PageHeader
        title="Photo Locker"
        sub="Progress photos, short videos and private files, on every device and backed up to your Google Drive."
        actions={
          <>
            <button type="button" className="btn primary" onClick={() => pickFile.current?.click()}>Upload</button>
            <button type="button" className="btn" onClick={() => setCamera(true)}>Progress photo</button>
          </>
        }
      />
      <input ref={pickFile} type="file" multiple hidden aria-label="Upload photos, videos or files" data-testid="locker-upload" onChange={(e) => (void add(e.target.files), (e.target.value = ''))} />
      <input ref={pickCam} type="file" accept="image/*,video/*" capture="environment" hidden aria-label="Use the camera" onChange={(e) => (void add(e.target.files), (e.target.value = ''))} />
      <input ref={pickProgress} type="file" accept="image/*" capture="user" hidden aria-label="Progress photo from the camera" onChange={(e) => (void add(e.target.files, { progress: true }), (e.target.value = ''))} />

      <p className="lk-plain" role="note">
        <b>Not encrypted:</b> anyone with access to your Google Drive can see these files.
      </p>

      <DriveCard sync={sync} />

      {warn && (
        <div className="lk-warn" role="status" data-testid="locker-warning">
          <span>{warn}</span>
          {sync.connected && sync.folder ? (
            <button type="button" className="btn small primary" disabled={sync.running} onClick={() => void syncNow()}>
              Upload now
            </button>
          ) : null}
        </div>
      )}
      {(sync.running || busy) && (
        <div className="lk-progress" role="status" aria-live="polite">
          <span>{busy ?? sync.line}</span>
          {!busy && sync.total > 0 && <progress max={sync.total} value={sync.done} aria-label="Progress" />}
        </div>
      )}
      {sync.error && !sync.running && <p className="lk-error" role="alert">{sync.error}</p>}

      <div className="lk-bar">
        <div className="lk-filters" role="tablist" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={`lk-chip${filter === f.id ? ' on' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label} <small>{counts[f.id] || ''}</small>
            </button>
          ))}
        </div>
        <input className="lk-search" type="search" placeholder="Search names and #tags" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the Locker" />
      </div>

      {items.length === 0 && (
        <div className="lk-empty">
          <p>Nothing here yet. Drop photos, videos (up to {VIDEO_MAX_SECONDS} seconds) or files here, or:</p>
          <div className="lk-empty-actions">
            <button type="button" className="btn" onClick={() => pickCam.current?.click()}>Camera</button>
            <button type="button" className="btn" onClick={() => pickFile.current?.click()}>Choose files</button>
          </div>
        </div>
      )}
      {items.length > 0 && shown.length === 0 && <p className="hint">Nothing matches.</p>}

      {months.map((m) => (
        <section key={m.key} className="lk-month" aria-label={m.label}>
          <h3>{m.label}</h3>
          <ul className="lk-grid">
            {m.items.map((it) => (
              <li key={it.id}>
                <button type="button" className={`lk-tile k-${it.kind}`} onClick={() => setOpen(it.id)} aria-label={`Open ${it.name}`} data-testid="locker-tile">
                  {thumbs.get(it.id) ? <img src={thumbs.get(it.id)} alt="" loading="lazy" /> : <span className="lk-icon" aria-hidden="true">{it.kind === 'video' ? '▶' : it.kind === 'photo' ? '🖼' : '📄'}</span>}
                  {it.kind === 'video' && <span className="lk-dur">{secs(it.durationS)}</span>}
                  {it.kind === 'file' && <span className="lk-fname">{it.name}</span>}
                  <span className={`lk-state ${it.driveFileId ? 'in' : 'out'}`} title={it.driveFileId ? (it.blob ? 'In Google Drive and on this device' : 'In Google Drive only') : 'Not backed up yet'}>
                    {it.driveFileId ? (it.blob ? '✓' : '☁') : '!'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {drag && <div className="lk-drop" aria-hidden="true">Drop to add to Photo Locker</div>}
      {open && <ItemSheet id={open} items={items} points={points} onClose={() => setOpen(null)} onChanged={load} />}
      {camera && (
        <PoseCamera
          onClose={() => setCamera(false)}
          onShot={(f) => (setCamera(false), void add([f], { progress: true }))}
          onFallback={() => (setCamera(false), pickProgress.current?.click())}
        />
      )}
    </div>
  )
}

function DriveCard({ sync }: { sync: SyncState }) {
  const act = useAction()
  const [folders, setFolders] = useState<DriveFolder[] | null>(null)
  const [changing, setChanging] = useState(false)
  if (!life.google?.driveToken) return <p className="hint">Google Drive backup works in the website and the desktop app.</p>
  const pick = !sync.folder || changing
  const loadFolders = () => void act(() => listDriveFolders()).then((f) => setFolders(f ?? []))
  const create = async () => {
    const name = await askText('Name the Google Drive folder (you can move it anywhere in your Drive later):', 'Photo Locker', { ok: 'Make folder' })
    if (!name?.trim()) return
    if (await act(() => chooseFolder({ create: name.trim() }), `Backing up to "${name.trim()}"`)) setChanging(false)
  }
  return (
    <section className="card lk-drive" aria-label="Google Drive">
      <header className="card-head">
        <h2>Google Drive</h2>
        <span className={`chip ${sync.connected ? 'ok' : 'muted'}`}>{sync.connected == null ? 'Checking…' : sync.connected ? 'Connected' : 'Not connected'}</span>
      </header>
      {sync.connected === false && (
        <div className="lk-row">
          <p className="hint">Connect once. The app can only see the files and folder it makes in your Drive, nothing else. Your calendar stays connected.</p>
          <button type="button" className="btn primary" onClick={() => void act(() => life.google!.connectDrive!())}>Connect Google Drive</button>
        </div>
      )}
      {sync.connected && sync.folder && !changing && (
        <dl className="lk-facts">
          <div>
            <dt>Folder</dt>
            <dd>
              <a href={`https://drive.google.com/drive/folders/${encodeURIComponent(sync.folder.id)}`} target="_blank" rel="noreferrer noopener" data-testid="locker-folder">
                My Drive › {sync.folder.name}
              </a>
            </dd>
          </div>
          <div>
            <dt>Last sync</dt>
            <dd>{sync.lastSync ? timeAgo(new Date(sync.lastSync).toISOString()) : 'Not yet'}</dd>
          </div>
          {sync.storage && (
            <div>
              <dt>Storage</dt>
              <dd>
                Locker {mb(sync.storage.locker)}
                {sync.storage.usage ? ` · Drive ${mb(sync.storage.usage)}${sync.storage.limit ? ` of ${mb(sync.storage.limit)}` : ''} used` : ''}
              </dd>
            </div>
          )}
          <div className="lk-drive-actions">
            <button type="button" className="btn small" disabled={sync.running} onClick={() => void syncNow({ downloadAll: true })}>Sync now</button>
            <button type="button" className="btn small ghost" onClick={() => (setChanging(true), loadFolders())}>Change folder</button>
          </div>
        </dl>
      )}
      {sync.connected && pick && (
        <div className="lk-pick">
          <p className="hint">
            {changing ? 'Pick the new folder. Files already backed up are moved there (nothing is uploaded again).' : 'Pick where your Locker lives in Google Drive.'}
          </p>
          <div className="lk-row">
            <button type="button" className="btn primary small" onClick={() => void create()}>New folder…</button>
            {folders === null ? (
              <button type="button" className="btn small" onClick={loadFolders}>Use a folder made before</button>
            ) : (
              folders.filter((f) => f.id !== sync.folder?.id).map((f) => (
                <button key={f.id} type="button" className="btn small" onClick={() => void act(() => chooseFolder(f), `Backing up to "${f.name}"`).then((x) => x && setChanging(false))}>
                  {f.name}
                </button>
              ))
            )}
            {folders?.length === 0 && <span className="hint">No folders made by Life System yet.</span>}
            {changing && <button type="button" className="btn small ghost" onClick={() => setChanging(false)}>Cancel</button>}
          </div>
        </div>
      )}
    </section>
  )
}

function ItemSheet({ id, items, points, onClose, onChanged }: { id: string; items: VaultItem[]; points: DayPoint[]; onClose: () => void; onChanged: () => void }) {
  const act = useAction()
  const it = items.find((x) => x.id === id)
  const [zoom, setZoom] = useState(false)
  const [tags, setTags] = useState((it?.tags ?? []).join(', '))
  const url = useMemo(() => (it?.blob ? URL.createObjectURL(it.blob) : null), [it?.blob])
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  if (!it) return null
  const progress = it.kind === 'photo' && it.tags.includes(PROGRESS_TAG)
  const body = progress ? weekBodyLine(weekBody(points, dayKey(new Date(it.takenAt)))) : null
  const remove = async () => {
    if (!(await askConfirm(`Delete "${it.name}"?`, { ok: 'Delete' }))) return
    const everywhere = it.driveFileId ? await askConfirm('Delete from Google Drive too? That removes it from every device (it sits in Drive’s bin for 30 days). "No" removes it from this device only.', { ok: 'Delete from Drive too' }) : true
    if ((await act(() => deleteItem(it.id, everywhere), everywhere ? 'Deleted' : 'Removed from this device (still in Google Drive)')) !== undefined) (onClose(), onChanged())
  }
  const saveTags = async () => {
    const next = cleanTags(tags)
    if (next.join(',') === it.tags.join(',')) return
    await act(() => editItem(it.id, { tags: next }), 'Tags saved')
    onChanged()
  }
  const rename = async () => {
    const name = await askText('Name', it.name, { ok: 'Rename' })
    if (name?.trim() && name.trim() !== it.name) (await act(() => editItem(it.id, { name: name.trim().slice(0, 80) }), 'Renamed'), onChanged())
  }
  return (
    <div className="sheet lk-sheet" role="dialog" aria-modal="true" aria-label={it.name} onClick={(e) => e.target === e.currentTarget && onClose()} data-testid="locker-item">
      <div className="lk-view">
        <header className="lk-view-head">
          <button type="button" className="lk-name" onClick={() => void rename()} title="Rename">{it.name}</button>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className={`lk-media${zoom ? ' zoomed' : ''}`}>
          {!url && (
            <div className="lk-cloud">
              <p>{it.driveFileId ? 'In Google Drive, not on this device yet.' : 'Only on another device, not backed up yet.'}</p>
              {it.driveFileId && <button type="button" className="btn primary" onClick={() => void act(() => downloadOne(it.id), 'Downloaded').then(onChanged)}>Download to this device</button>}
            </div>
          )}
          {url && it.kind === 'photo' && <img src={url} alt={it.name} onClick={() => setZoom(!zoom)} title={zoom ? 'Fit' : 'Zoom'} />}
          {url && it.kind === 'video' && <video src={url} controls playsInline preload="metadata" />}
          {url && it.kind === 'file' && (
            <div className="lk-file">
              <span className="lk-icon big" aria-hidden="true">📄</span>
              <div className="lk-row">
                <a className="btn primary" href={url} download={it.name}>Download</a>
                <a className="btn" href={url} target="_blank" rel="noopener">Open</a>
              </div>
            </div>
          )}
        </div>
        <div className="lk-meta">
          <p className="lk-sub">
            {when(it.takenAt)} · {mb(it.sizeBytes)}
            {it.durationS != null ? ` · ${Math.round(it.durationS)} s` : ''}
            {it.w && it.h ? ` · ${it.w}×${it.h}` : ''} · {it.driveFileId ? 'Backed up to Google Drive' : 'Not backed up yet'}
          </p>
          {body && <p className="lk-body" data-testid="locker-week">{body}</p>}
          <label className="lk-tags">
            <span>Tags</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} onBlur={() => void saveTags()} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} placeholder="Add tags, e.g. front, legs" />
          </label>
          <div className="lk-row">
            <button type="button" className="btn small lk-danger" onClick={() => void remove()}>Delete</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The camera with a simple standing outline, so every progress photo is taken the same way. */
function PoseCamera({ onClose, onShot, onFallback }: { onClose: () => void; onShot: (f: File) => void; onFallback: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [guide, setGuide] = useState(true)
  useEffect(() => {
    let off = false
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user', height: { ideal: 1920 } }, audio: false })
      .then((s) => {
        if (off) return s.getTracks().forEach((t) => t.stop())
        stream.current = s
        if (video.current) (video.current.srcObject = s), void video.current.play().catch(() => {})
      })
      .catch(onFallback) ?? onFallback()
    return () => {
      off = true
      stream.current?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const shoot = () => {
    const v = video.current
    if (!v?.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    c.toBlob((b) => b && onShot(new File([b], `Progress ${new Date().toISOString().slice(0, 10)}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })), 'image/jpeg', 0.92)
  }
  return (
    <div className="sheet lk-sheet" role="dialog" aria-modal="true" aria-label="Progress photo">
      <div className="lk-view lk-cam">
        <div className="lk-cam-box">
          <video ref={video} playsInline muted />
          {guide && <PoseGuide />}
        </div>
        <p className="hint">Same spot, same light, same pose: line up with the outline.</p>
        <div className="lk-row">
          <button type="button" className="btn primary" onClick={shoot}>Take photo</button>
          <button type="button" className="btn" onClick={() => setGuide(!guide)}>{guide ? 'Hide outline' : 'Show outline'}</button>
          <button type="button" className="btn ghost" onClick={onFallback}>Choose a photo</button>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

/** A plain standing figure, arms a little out (original drawing). */
export function PoseGuide() {
  return (
    <svg className="lk-pose" viewBox="0 0 100 200" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="50" cy="22" rx="10" ry="12" />
        <path d="M44 33 L44 38 Q30 40 27 46 L20 84 M56 33 L56 38 Q70 40 73 46 L80 84" />
        <path d="M30 47 Q32 70 36 94 L38 104 Q36 140 39 190 M70 47 Q68 70 64 94 L62 104 Q64 140 61 190" />
        <path d="M38 104 Q50 108 62 104 M50 108 L49 150" />
        <line x1="20" y1="196" x2="80" y2="196" />
      </g>
    </svg>
  )
}
