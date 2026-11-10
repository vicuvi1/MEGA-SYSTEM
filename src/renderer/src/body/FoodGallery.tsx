// Body → Food → More → Photos: the food gallery. Meals by day (newest first)
// with the day's totals; each meal is a tile (its photo from Photo Locker, or a
// plate for a meal without one) with the time, kcal and protein. A tap opens
// it: the photo big, each food with its grams, kcal and macros, the score and
// tip, and "Fix it" (the usual edit: same day and time). Read from the food
// log (core/foodInsights.ts galleryDays). No points.
import { useEffect, useState } from 'react'
import { life } from '../bridge'
import type { GalleryDay, GalleryMeal } from '@core/foodInsights'
import { MealItems, MealPhotoThumb, MealTileImage } from './MealPhoto'
import './food-gallery.css'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const TYPE: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }
const EVENTS = ['life-body-changed', 'life-vault-changed']

export function FoodGallery({ onFix }: { onFix: (m: GalleryMeal, day: string) => void }) {
  const api = life.coach?.food
  const [days, setDays] = useState<GalleryDay[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [onlyPhotos, setOnlyPhotos] = useState(false)
  useEffect(() => {
    if (!api?.gallery) return
    const load = () => api.gallery(14).then(setDays).catch(() => setDays([]))
    load()
    for (const e of EVENTS) window.addEventListener(e, load)
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, load)
    }
  }, [api])
  if (!days) return <p className="muted fdg-loading">Loading your meals…</p>
  const shown = days.map((d) => ({ ...d, meals: onlyPhotos ? d.meals.filter((m) => m.photos.length) : d.meals })).filter((d) => d.meals.length)
  return (
    <div className="fdg" aria-label="Food gallery">
      <div className="fdg-head">
        <h3 className="fd-sub-title">Meals by day</h3>
        <label className="fdg-only">
          <input type="checkbox" checked={onlyPhotos} onChange={(e) => setOnlyPhotos(e.target.checked)} /> Only photos
        </label>
      </div>
      {!shown.length && <p className="muted">{onlyPhotos ? 'No meal photos in the last 2 weeks. Send one on Telegram or drop one on Food.' : 'No meals in the last 2 weeks yet.'}</p>}
      {shown.map((d) => (
        <section key={d.day} className="fdg-day" aria-label={d.label}>
          <header className="fdg-day-head">
            <b>{d.label}</b>
            <small className="num">
              {fmt(d.totals.kcal)} kcal · {fmt(d.totals.protein)} g protein · C {fmt(d.totals.carbs)} · F {fmt(d.totals.fat)}
            </small>
          </header>
          <ul className="fdg-tiles">
            {d.meals.map((m) => {
              const key = `${d.day}:${m.id}`
              return (
                <li key={m.id} className={`fdg-tile${open === key ? ' open' : ''}`}>
                  <button type="button" className="fdg-tile-btn" aria-expanded={open === key} aria-label={`${TYPE[m.type]} at ${m.hm}: ${m.name}, ${fmt(m.totals.kcal)} kcal`} onClick={() => setOpen(open === key ? null : key)}>
                    <MealTileImage ids={m.photos} />
                    <span className="fdg-tile-text">
                      <small className="fdg-when num">
                        {TYPE[m.type]} · {m.hm}
                      </small>
                      <b className="fdg-name">{m.name}</b>
                      <small className="num">
                        {fmt(m.totals.kcal)} kcal · {fmt(m.totals.protein)} g
                      </small>
                    </span>
                    {m.score && (
                      <span className={`fd-grade g${m.score.grade}`} title={m.score.tip}>
                        {m.score.grade}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          {d.meals
            .filter((m) => open === `${d.day}:${m.id}`)
            .map((m) => (
              <div key={m.id} className="fdg-detail" aria-label={`${m.name} in detail`}>
                <div className="fdg-detail-head">
                  <MealPhotoThumb ids={m.photos} name={m.name} sub={`${d.label} · ${m.hm} · ${fmt(m.totals.kcal)} kcal · ${fmt(m.totals.protein)} g protein`} />
                  <span>
                    <b>
                      {TYPE[m.type]} · {d.label}, {m.hm}
                    </b>
                    <small className="num">
                      {fmt(m.totals.kcal)} kcal · P {fmt(m.totals.protein)} · C {fmt(m.totals.carbs)} · F {fmt(m.totals.fat)}
                    </small>
                  </span>
                </div>
                <MealItems items={m.items} />
                {m.score && (
                  <p className="fdg-score">
                    <span className={`fd-grade g${m.score.grade}`}>{m.score.grade}</span> {m.score.tip}
                  </p>
                )}
                <div className="fd-row">
                  <button type="button" className="bdy-btn fdg-fix" onClick={() => onFix(m, d.day)}>
                    Fix it
                  </button>
                </div>
              </div>
            ))}
        </section>
      ))}
    </div>
  )
}
