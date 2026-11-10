// A photo meal on Body → Food: its thumbnail on the meal row (from Photo
// Locker on this device), the big view on a tap, and the per-item list with
// the grams range, kcal and macros. A photo still on its way from Telegram
// shows a camera placeholder (it arrives with the next Photo Locker sync).
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { confidenceBadge } from '@core/foodBen'
import type { FoodItem } from '@core/food'
import './meal-photo.css'

type Loaded = { id: string; thumb: string | null; full: string | null }

/** Object URLs for a meal's Locker photos (revoked when the row goes). */
function useMealPhotos(ids: string[] | undefined): Loaded[] | null {
  const [list, setList] = useState<Loaded[] | null>(null)
  const key = (ids ?? []).join(',')
  useEffect(() => {
    if (!ids?.length) return
    let live = true
    const urls: string[] = []
    const url = (b?: Blob) => {
      if (!b) return null
      const u = URL.createObjectURL(b)
      urls.push(u)
      return u
    }
    const load = () =>
      import('../vault/driveSync')
        .then((m) => m.mealPhotos(ids))
        .then((items) => live && setList(items.map((it) => ({ id: it.id, thumb: url(it.thumb ?? it.blob), full: url(it.blob ?? it.thumb) }))))
        .catch(() => live && setList([]))
    void load()
    // A photo that arrives from Telegram while the page is open shows up.
    const again = () => void load()
    window.addEventListener('life-vault-changed', again)
    return () => {
      live = false
      window.removeEventListener('life-vault-changed', again)
      for (const u of urls) URL.revokeObjectURL(u)
    }
  }, [key])
  return ids?.length ? list : null
}

/** The thumbnail button on a meal row (tap: the photo big). */
export function MealPhotoThumb({ ids, name, sub }: { ids?: string[]; name: string; sub?: string }) {
  const list = useMealPhotos(ids)
  const [open, setOpen] = useState<number | null>(null)
  if (!ids?.length) return null
  const first = list?.find((x) => x.thumb)
  return (
    <>
      <button type="button" className="mp-thumb" aria-label={first ? `See the photo of ${name}` : 'Photo on its way to Photo Locker'} title={first ? 'See the photo' : 'The photo is on its way from Telegram (Photo Locker brings it in)'} disabled={!first} onClick={() => setOpen(list!.indexOf(first!))}>
        {first ? <img src={first.thumb!} alt="" /> : <span aria-hidden="true">📷</span>}
        {ids.length > 1 && <small className="mp-count">{ids.length}</small>}
      </button>
      {open != null && list && createPortal(<PhotoView list={list.filter((x) => x.full)} start={Math.max(0, open)} name={name} sub={sub} onClose={() => setOpen(null)} />, document.body)}
    </>
  )
}

function PhotoView({ list, start, name, sub, onClose }: { list: Loaded[]; start: number; name: string; sub?: string; onClose: () => void }) {
  const [i, setI] = useState(Math.min(start, list.length - 1))
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // Escape closes only the photo (not the sheet under it): caught first, not passed on.
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        onClose()
      }
      if (e.key === 'ArrowRight') setI((x) => Math.min(list.length - 1, x + 1))
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [list.length, onClose])
  const cur = list[i]
  if (!cur) return null
  return (
    <div className="mp-view" role="dialog" aria-modal="true" aria-label={`Photo of ${name}`} onClick={onClose}>
      <img src={cur.full!} alt={`Photo of ${name}`} onClick={(e) => e.stopPropagation()} />
      <div className="mp-view-bar" onClick={(e) => e.stopPropagation()}>
        <span className="mp-view-title">
          <b>{name}</b>
          {sub && <small className="num">{sub}</small>}
        </span>
        {list.length > 1 && (
          <span className="num">
            {i + 1} / {list.length}
          </span>
        )}
        <button type="button" className="bdy-btn quiet" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

/** The meal's confidence as a small dot: green sure, amber a fair estimate, red a rough guess. */
export function ConfidenceDot({ items }: { items: FoodItem[] }) {
  const b = confidenceBadge(items)
  const tone = b.dot === '🟢' ? 'good' : b.dot === '🔴' ? 'bad' : 'mid'
  return <span className={`mp-dot ${tone}`} title={`Estimate: ${b.word}`} aria-label={`Estimate: ${b.word}`} />
}

/** Each food with its grams (and range), kcal and macros. */
export function MealItems({ items }: { items: FoodItem[] }) {
  return (
    <ul className="mp-items" aria-label="What is in it">
      {items.map((it, k) => (
        <li key={k}>
          <span className="mp-name">
            {it.name.charAt(0).toUpperCase() + it.name.slice(1)}
            {it.qty && it.unit ? <small> · {it.qty} {it.unit}</small> : null}
          </span>
          <span className="num mp-g">
            {fmt(it.grams)} g{it.lo != null && it.hi != null ? <small> ({fmt(it.lo)}–{fmt(it.hi)})</small> : null}
          </span>
          <span className="num mp-k">{fmt(it.kcal)} kcal</span>
          <span className="num mp-m">
            P {fmt(it.protein)} · C {fmt(it.carbs)} · F {fmt(it.fat)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Repeat meals as photo tiles (saved meals kept from a photo): a click shows the
 * photo big, a double-click (or Enter) logs the same numbers again, with no AI
 * call and no cost.
 */
export function PhotoMealTiles({ meals, onLog }: { meals: { id: string; name: string; photo: string; kcal: number; protein: number }[]; onLog: (id: string) => void }) {
  const list = useMealPhotos(meals.map((m) => m.photo))
  const [open, setOpen] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    []
  )
  if (!meals.length) return null
  const shown = meals.find((m) => m.id === open)
  const pic = (photo: string) => list?.find((x) => x.id === photo)
  const shownPic = shown ? pic(shown.photo) : undefined
  return (
    <div className="mp-tiles-wrap">
      <span className="bdy-eyebrow">Repeat meals · double-click to add, click to see</span>
      <div className="mp-tiles" role="list">
        {meals.map((m) => {
          const p = pic(m.photo)
          return (
            <button
              key={m.id}
              type="button"
              role="listitem"
              className="mp-tile"
              aria-label={`${m.name}, ${fmt(m.kcal)} kcal, ${fmt(m.protein)} g protein. Double-click or Enter to log it again`}
              onClick={() => {
                if (timer.current) window.clearTimeout(timer.current)
                timer.current = window.setTimeout(() => setOpen(m.id), 260)
              }}
              onDoubleClick={() => {
                if (timer.current) window.clearTimeout(timer.current)
                timer.current = null
                onLog(m.id)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onLog(m.id)
                }
              }}
            >
              {p?.thumb ? <img src={p.thumb} alt="" /> : <span className="mp-tile-ph" aria-hidden="true">📷</span>}
              <span className="mp-tile-text">
                <b>{m.name}</b>
                <small className="num">
                  {fmt(m.kcal)} kcal · {fmt(m.protein)} g
                </small>
              </span>
            </button>
          )
        })}
      </div>
      {shown && shownPic?.full && createPortal(<PhotoView list={[shownPic]} start={0} name={shown.name} sub={`${fmt(shown.kcal)} kcal · ${fmt(shown.protein)} g protein · double-click the tile to add it`} onClose={() => setOpen(null)} />, document.body)}
    </div>
  )
}
