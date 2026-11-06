// Settings → Look → Wallpaper: a gallery of original pictures in groups, a
// live preview while you hover one, Apply, your own picture, and how the
// picture shows (strength, blur, shade, where, light/dark, motion).
import { useEffect, useRef, useState } from 'react'
import { WALLPAPERS, WALLPAPER_CATEGORIES, type WallpaperCategory, type WallpaperPrefs } from '@core/wallpaper'
import { Icon } from '../Icon'
import { Row, Saved, Segmented, Switch, useSaved } from '../settingsUi'
import { useAction } from '../ui'
import { artUrl } from './art'
import { previewWallpaper, saveWallpaper, saveWallpaperPhoto, useWallpaper, wallpaperFromFile } from './wallpaperStore'

type Tab = 'all' | WallpaperCategory | 'yours'

export function WallpaperPanel() {
  const act = useAction()
  const { prefs, photo } = useWallpaper()
  const [tab, setTab] = useState<Tab>('all')
  const [busy, setBusy] = useState(false)
  const [flash, saved] = useSaved()
  const file = useRef<HTMLInputElement>(null)
  const hoverTimer = useRef<number | undefined>(undefined)

  // Leaving the page never leaves a preview behind.
  useEffect(() => () => {
    window.clearTimeout(hoverTimer.current)
    previewWallpaper(null)
  }, [])

  const hover = (id: string | null) => {
    window.clearTimeout(hoverTimer.current)
    if (id === null) return previewWallpaper(null)
    hoverTimer.current = window.setTimeout(() => previewWallpaper(id), 160)
  }
  const apply = async (id: string) => {
    if (id === 'photo' && !photo) return file.current?.click()
    previewWallpaper(null)
    await act(() => saveWallpaper({ id }))
    saved()
  }
  const set = async (patch: Partial<WallpaperPrefs>) => {
    await act(() => saveWallpaper(patch))
    saved()
  }
  const pick = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    await act(async () => {
      const url = await wallpaperFromFile(f)
      await saveWallpaperPhoto(url)
      await saveWallpaper({ id: 'photo' })
    }, 'Your picture is the wallpaper now')
    setBusy(false)
  }

  const list = WALLPAPERS.filter((w) => tab === 'all' || w.category === tab)
  const item = (id: string, name: string, sub: string, thumb: React.ReactNode) => (
    <button
      key={id}
      type="button"
      role="radio"
      aria-checked={prefs.id === id}
      className={`wpg-item ${prefs.id === id ? 'on' : ''}`}
      data-wp={id}
      onMouseEnter={() => hover(id === 'photo' && !photo ? null : id)}
      onMouseLeave={() => hover(null)}
      onFocus={() => hover(id === 'photo' && !photo ? null : id)}
      onBlur={() => hover(null)}
      onClick={() => void apply(id)}
    >
      <span className="wpg-thumb">
        {thumb}
        <span className="wpg-apply">{id === 'photo' && !photo ? 'Upload' : 'Apply'}</span>
      </span>
      <b>{name}</b>
      <small>{sub}</small>
    </button>
  )

  return (
    <section className="panel wpg">
      <header className="panel-head">
        <h2>
          <Icon name="spark" /> Wallpaper
        </h2>
        <Saved show={flash} />
      </header>
      <p className="hint block">A picture behind the whole app. Hover one to try it, click to apply. All pictures are original art made for Life System.</p>
      <div className="wpg-cats" role="tablist" aria-label="Wallpaper groups">
        {([['all', 'All'], ...WALLPAPER_CATEGORIES.map((c) => [c.id, c.label]), ['yours', 'Yours']] as [Tab, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`wpg-cat ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="wpg-grid" role="radiogroup" aria-label="Wallpaper">
        {(tab === 'all' || tab === 'yours') && item('none', 'No wallpaper', 'The plain app colour', <span className="wpg-none">None</span>)}
        {(tab === 'all' || tab === 'yours') &&
          item(
            'photo',
            'Your own picture',
            photo ? 'Kept small and synced to your devices' : 'Upload a picture you own',
            photo ? (
              <img src={photo} alt="" loading="lazy" decoding="async" draggable={false} />
            ) : (
              <span className="wpg-own">
                <Icon name="plus" />
                Upload
              </span>
            )
          )}
        {tab !== 'yours' &&
          list.map((w) =>
            item(
              w.id,
              w.name,
              `${WALLPAPER_CATEGORIES.find((c) => c.id === w.category)?.label ?? ''}${w.fx ? ' · can move' : ''}`,
              <img src={artUrl(w.id) ?? ''} alt="" loading="lazy" decoding="async" draggable={false} />
            )
          )}
      </div>
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void pick(e.target.files?.[0]).then(() => (e.target.value = ''))} />
      {photo && (
        <div className="row" style={{ marginTop: 10, gap: 8 }}>
          <button className="btn" type="button" disabled={busy} onClick={() => file.current?.click()}>
            {busy ? 'Saving…' : 'Change your picture'}
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                if (prefs.id === 'photo') await saveWallpaper({ id: 'none' })
                await saveWallpaperPhoto(null)
              }, 'Your picture is removed')
            }
          >
            Remove your picture
          </button>
        </div>
      )}

      <div className="wpg-tune">
        <Range title="Strength" hint="How much of the picture shows" value={prefs.opacity} min={10} max={100} unit="%" onCommit={(v) => void set({ opacity: v })} />
        <Range title="Blur" hint="Soft focus, so the picture stays in the background" value={prefs.blur} min={0} max={20} unit=" px" onCommit={(v) => void set({ blur: v })} />
        <Range title="Shade" hint="Darker in dark mode, lighter in light mode" value={prefs.dim} min={0} max={80} unit="%" onCommit={(v) => void set({ dim: v })} />
        <Row title="Where" hint="Behind every page, or only on Today">
          <Segmented label="Where" value={prefs.where} options={[['all', 'Everywhere'], ['today', 'Only on Today']]} onChange={(v) => void set({ where: v })} />
        </Row>
        <Row title="Match light and dark" hint="Dark mode darkens bright pictures, light mode lightens dark ones">
          <Switch label="Match light and dark" on={prefs.followTheme} onChange={(v) => void set({ followTheme: v })} />
        </Row>
        <Row title="Gentle motion" hint="A slow drift, and rain, stars or petals on some pictures. Stops when the window is hidden or your system asks for less motion">
          <Switch label="Gentle motion" on={prefs.motion} onChange={(v) => void set({ motion: v })} />
        </Row>
        <p className="wpg-note">Text always stays readable: the app keeps a shade over the picture, however strong you set it.</p>
      </div>
    </section>
  )
}

/** A slider that shows its value at once and saves when you let go. */
function Range({ title, hint, value, min, max, unit, onCommit }: { title: string; hint: string; value: number; min: number; max: number; unit: string; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => setV(value), [value])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const change = (x: number) => {
    setV(x)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => onCommit(x), 350)
  }
  return (
    <Row title={title} hint={hint}>
      <span className="wpg-range">
        <input className="sx-range" type="range" min={min} max={max} step={1} value={v} aria-label={title} onChange={(e) => change(Number(e.target.value))} />
        <output>
          {v}
          {unit}
        </output>
      </span>
    </Row>
  )
}
