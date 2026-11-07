// BD10: a private progress photo every 2 weeks. Same spot, same pose: the
// last photo shows as a ghost over the camera (or over the new photo) so you
// can line up. Every 8 weeks a side-by-side with a slider. Photos stay on
// THIS DEVICE ONLY (bodyPhotos.ts): never synced, never uploaded.
import { useEffect, useMemo, useRef, useState } from 'react'
import { photoPlan } from '@core/bodyPhotos'
import { dayKey } from '@core/dates'
import { deletePhoto, listPhotos, savePhoto, shrink, type StoredPhoto } from './bodyPhotos'
import { askConfirm } from '../confirmSheet'
import { useAction } from '../ui'

type Mode = 'idle' | 'camera' | 'review' | 'compare'

export function PhotoCheckin({ every = 14 }: { every?: number }) {
  const act = useAction()
  const [photos, setPhotos] = useState<StoredPhoto[]>([])
  const [mode, setMode] = useState<Mode>('idle')
  const [ghost, setGhost] = useState(35)
  const [draft, setDraft] = useState<{ blob: Blob; w: number; h: number; url: string } | null>(null)
  const [split, setSplit] = useState(50)
  const [pair, setPair] = useState<[string, string] | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const load = () => void listPhotos().then(setPhotos)
  useEffect(() => {
    load()
    // Another tab (or a test) changed this device's photos.
    window.addEventListener('life-photos-changed', load)
    return () => window.removeEventListener('life-photos-changed', load)
  }, [])
  // One object URL per photo, released when the list changes.
  const urls = useMemo(() => new Map(photos.map((p) => [p.id, URL.createObjectURL(p.blob)])), [photos])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])
  useEffect(() => () => stopCamera(), [])
  const today = dayKey(new Date())
  const plan = photoPlan(photos, today, every)
  const last = plan.last ? urls.get(plan.last.id) : null

  function stopCamera() {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }
  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', height: { ideal: 1280 } }, audio: false })
      stream.current = s
      setMode('camera')
      requestAnimationFrame(() => {
        if (video.current) {
          video.current.srcObject = s
          void video.current.play().catch(() => {})
        }
      })
    } catch {
      // No camera here (or not allowed): pick a photo instead.
      file.current?.click()
    }
  }
  const capture = async () => {
    if (!video.current) return
    const shot = await shrink(video.current)
    stopCamera()
    setDraft({ ...shot, url: URL.createObjectURL(shot.blob) })
    setMode('review')
  }
  const picked = async (f: File | undefined) => {
    if (!f) return
    const shot = await act(() => shrink(f))
    if (!shot) return
    setDraft({ ...shot, url: URL.createObjectURL(shot.blob) })
    setMode('review')
  }
  const keep = async () => {
    if (!draft) return
    const ok = await act(() => savePhoto({ id: `ph-${Date.now().toString(36)}`, day: today, at: Date.now(), blob: draft.blob, w: draft.w, h: draft.h }), 'Photo kept on this device')
    URL.revokeObjectURL(draft.url)
    setDraft(null)
    setMode('idle')
    if (ok !== undefined) load()
  }
  const cmp = (() => {
    if (pair) {
      const a = photos.find((p) => p.id === pair[0])
      const b = photos.find((p) => p.id === pair[1])
      if (a && b) return { before: a, after: b, weeks: Math.round((Date.parse(b.day) - Date.parse(a.day)) / (7 * 864e5)) }
    }
    return plan.compare ? { before: photos.find((p) => p.id === plan.compare!.before.id)!, after: photos.find((p) => p.id === plan.compare!.after.id)!, weeks: plan.compare.weeks } : null
  })()

  return (
    <section className="card ph-card" aria-label="Progress photos">
      <header className="card-head">
        <h2>Progress photos</h2>
        <span className="ph-lock">🔒 Photos stay on this device. They are never uploaded or synced.</span>
      </header>
      <input ref={file} type="file" accept="image/*" capture="user" hidden onChange={(e) => void picked(e.target.files?.[0])} />

      {mode === 'idle' && (
        <>
          <p className={`ph-plan${plan.due ? ' due' : ''}`}>
            {plan.due ? '📸 ' : '🗓️ '}
            {plan.line}
            {plan.compareDue ? ` ${plan.compare!.weeks} weeks since the photo it compares with: have a look.` : ''}
          </p>
          <div className="ph-actions">
            <button type="button" className={`btn ${plan.due ? 'primary' : ''} small`} onClick={() => void startCamera()}>
              Take check-in photo
            </button>
            <button type="button" className="btn ghost small" onClick={() => file.current?.click()}>
              Choose a photo
            </button>
            {photos.length >= 2 && (
              <button type="button" className={`btn ${plan.compareDue ? 'primary' : 'ghost'} small`} onClick={() => (setPair(null), setMode('compare'))}>
                Compare
              </button>
            )}
          </div>
          {photos.length > 0 && (
            <ul className="ph-strip" aria-label="Your photos on this device">
              {photos.slice(-6).map((p) => (
                <li key={p.id}>
                  <img src={urls.get(p.id)} alt={`Progress photo, ${p.day}`} />
                  <small>{p.day.slice(5)}</small>
                  <button
                    type="button"
                    className="icon-btn ph-del"
                    aria-label={`Delete the photo from ${p.day}`}
                    onClick={async () => {
                      if (!(await askConfirm(`Delete the photo from ${p.day} from this device? It can't be brought back.`))) return
                      await act(() => deletePhoto(p.id), 'Photo deleted')
                      load()
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {mode === 'camera' && (
        <div className="ph-stage">
          <div className="ph-frame">
            <video ref={video} playsInline muted className="ph-live" />
            {last && <img src={last} alt="" className="ph-ghost" style={{ opacity: ghost / 100 }} />}
            <i className="ph-guide" aria-hidden="true" />
          </div>
          <GhostSlider value={ghost} onChange={setGhost} has={!!last} />
          <div className="ph-actions">
            <button type="button" className="btn primary small" onClick={() => void capture()}>
              Capture
            </button>
            <button type="button" className="btn ghost small" onClick={() => (stopCamera(), setMode('idle'))}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'review' && draft && (
        <div className="ph-stage">
          <div className="ph-frame">
            <img src={draft.url} alt="Your new photo" className="ph-live" />
            {last && <img src={last} alt="" className="ph-ghost" style={{ opacity: ghost / 100 }} />}
          </div>
          <GhostSlider value={ghost} onChange={setGhost} has={!!last} />
          <div className="ph-actions">
            <button type="button" className="btn primary small" onClick={() => void keep()}>
              Keep on this device
            </button>
            <button type="button" className="btn ghost small" onClick={() => (URL.revokeObjectURL(draft.url), setDraft(null), void startCamera())}>
              Retake
            </button>
          </div>
        </div>
      )}

      {mode === 'compare' && cmp && (
        <div className="ph-stage">
          <div className="ph-frame ph-compare" aria-label={`Before ${cmp.before.day} and after ${cmp.after.day}`}>
            <img src={urls.get(cmp.before.id)} alt={`Before, ${cmp.before.day}`} className="ph-live" />
            <img src={urls.get(cmp.after.id)} alt={`After, ${cmp.after.day}`} className="ph-live ph-after" style={{ clipPath: `inset(0 0 0 ${split}%)` }} />
            <i className="ph-split" style={{ left: `${split}%` }} aria-hidden="true" />
            <span className="ph-tag l">{cmp.before.day}</span>
            <span className="ph-tag r">{cmp.after.day}</span>
          </div>
          <label className="ph-slider">
            <small>Before ← → After · {cmp.weeks} weeks apart</small>
            <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Slide between before and after" />
          </label>
          <div className="ph-actions">
            {photos.length > 2 && (
              <span className="ph-pick">
                <small>Before:</small>
                {photos.filter((p) => p.id !== cmp.after.id).slice(-5).map((p) => (
                  <button key={p.id} type="button" className={`chip-btn${p.id === cmp.before.id ? ' on' : ''}`} onClick={() => setPair([p.id, cmp.after.id])}>
                    {p.day.slice(5)}
                  </button>
                ))}
              </span>
            )}
            <button type="button" className="btn ghost small" onClick={() => setMode('idle')}>
              Done
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function GhostSlider({ value, onChange, has }: { value: number; onChange: (n: number) => void; has: boolean }) {
  if (!has) return <small className="muted">Your first photo: stand 2 m from the camera, arms relaxed, same light each time.</small>
  return (
    <label className="ph-slider">
      <small>Ghost of the last photo: line up your shoulders and feet</small>
      <input type="range" min={0} max={70} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Ghost strength" />
    </label>
  )
}
