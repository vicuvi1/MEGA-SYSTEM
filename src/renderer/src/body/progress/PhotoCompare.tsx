// Progress → photos side by side: pick two dates (default: your first and
// your latest photo), a drag slider or two photos next to each other. The
// photos live only in this device's IndexedDB (body/bodyPhotos.ts): nothing
// is uploaded, synced or backed up, and this view only reads them.
import { useEffect, useMemo, useState } from 'react'
import { daysBetween } from '@core/dates'
import { listPhotos, type StoredPhoto } from '../bodyPhotos'

export function PhotoCompare() {
  const [photos, setPhotos] = useState<StoredPhoto[]>([])
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [mode, setMode] = useState<'slide' | 'side'>('slide')
  const [split, setSplit] = useState(50)
  useEffect(() => {
    const load = () => void listPhotos().then(setPhotos)
    load()
    window.addEventListener('life-photos-changed', load)
    return () => window.removeEventListener('life-photos-changed', load)
  }, [])
  const urls = useMemo(() => new Map(photos.map((p) => [p.id, URL.createObjectURL(p.blob)])), [photos])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])
  const before = photos.find((p) => p.id === a) ?? photos[0]
  const after = photos.find((p) => p.id === b) ?? photos[photos.length - 1]
  const label = (p: StoredPhoto) => p.day
  return (
    <section className="card bpg-card" aria-label="Progress photos side by side">
      <header className="bpg-head">
        <h2>Progress photos</h2>
        <span className="bpg-lock">Photos stay on this device. Never uploaded.</span>
      </header>
      {photos.length < 2 || !before || !after ? (
        <p className="bpg-empty">{photos.length ? 'One photo so far. Take another in two weeks and the two show here side by side.' : 'No photos yet. Take a check-in photo (under More) and the first one is your starting point.'}</p>
      ) : (
        <>
          <div className="bpg-ph-pick">
            <label>
              <small>Before</small>
              <select value={before.id} onChange={(e) => setA(e.target.value)} aria-label="Before photo date">
                {photos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {label(p)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <small>After</small>
              <select value={after.id} onChange={(e) => setB(e.target.value)} aria-label="After photo date">
                {photos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {label(p)}
                  </option>
                ))}
              </select>
            </label>
            <div className="bpg-seg" role="tablist" aria-label="View">
              <button type="button" role="tab" aria-selected={mode === 'slide'} className={mode === 'slide' ? 'on' : ''} onClick={() => setMode('slide')}>
                Slider
              </button>
              <button type="button" role="tab" aria-selected={mode === 'side'} className={mode === 'side' ? 'on' : ''} onClick={() => setMode('side')}>
                Side by side
              </button>
            </div>
          </div>
          {mode === 'slide' ? (
            <div className="bpg-ph-frame" style={{ aspectRatio: `${before.w} / ${before.h}` }}>
              <img src={urls.get(before.id)} alt={`Before, ${before.day}`} />
              <img src={urls.get(after.id)} alt={`After, ${after.day}`} className="after" style={{ clipPath: `inset(0 0 0 ${split}%)` }} />
              <i className="bpg-ph-split" style={{ left: `${split}%` }} aria-hidden="true" />
              <span className="tag l">{before.day}</span>
              <span className="tag r">{after.day}</span>
            </div>
          ) : (
            <div className="bpg-ph-two">
              {[before, after].map((p, i) => (
                <figure key={p.id + i}>
                  <img src={urls.get(p.id)} alt={`${i ? 'After' : 'Before'}, ${p.day}`} style={{ aspectRatio: `${p.w} / ${p.h}` }} />
                  <figcaption>{p.day}</figcaption>
                </figure>
              ))}
            </div>
          )}
          {mode === 'slide' && (
            <label className="bpg-ph-range">
              <small>Slide between before and after</small>
              <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Slide between before and after" />
            </label>
          )}
          <p className="bpg-foot">{Math.round(daysBetween(before.day, after.day) / 7)} weeks apart.</p>
        </>
      )}
    </section>
  )
}
