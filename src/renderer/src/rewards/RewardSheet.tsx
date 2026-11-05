// Add or edit a reward (RF5): a bottom sheet on the phone, a panel on the
// desktop, with a live preview. Name, emoji or photo (made small on the
// device) or an image link, the real price with the points filled in from
// what a point is worth (or kept as you typed them), category, once or
// repeat with a cooldown and a monthly limit, a bundle, a note and a link.
import { useEffect, useMemo, useRef, useState } from 'react'
import { m } from 'framer-motion'
import { createPortal } from 'react-dom'
import type { RewardInput } from '@shared/api'
import { REWARD_CATEGORIES, rewardEmoji, type Reward, type RewardCategory } from '@core/shop'
import { suggestPoints } from '@core/funBudget'
import { Cover } from './RewardCard'
import { isPhotoUrl, shrinkPhoto } from './photo'
import type { ValueInfo } from './useRewards'

const EMOJIS = ['🎮', '🍕', '🎧', '🎟️', '🧴', '🏔️', '🍔', '☕', '🎬', '📚', '👟', '✈️', '⌚', '🛹', '💆', '🎁']

interface Form {
  title: string
  emoji: string
  imageUrl: string
  lei: string
  price: string
  priceLocked: boolean
  category: RewardCategory | null
  oneTime: boolean
  cooldownDays: string
  monthLimit: string
  bundle: number[]
  note: string
  productUrl: string
}

const fromReward = (r: Reward | null): Form => ({
  title: r?.title ?? '',
  emoji: r?.emoji ?? '',
  imageUrl: r?.imageUrl ?? '',
  lei: r?.realCost ? String(r.realCost) : '',
  price: r ? String(r.price) : '',
  priceLocked: r ? r.priceLocked !== false : false,
  category: r?.category ?? null,
  oneTime: r ? !!r.oneTime : false,
  cooldownDays: r?.cooldownDays ? String(r.cooldownDays) : '',
  monthLimit: r?.monthLimit ? String(r.monthLimit) : '',
  bundle: r?.bundle ?? [],
  note: r?.note ?? '',
  productUrl: r?.productUrl ?? ''
})

export function RewardSheet({
  reward,
  all,
  value,
  currency,
  onSave,
  onClose,
  onRemove,
  lockSlot
}: {
  reward: Reward | null
  all: Reward[]
  value: ValueInfo
  currency: string
  onSave: (input: RewardInput) => Promise<boolean>
  onClose: () => void
  onRemove?: () => void
  lockSlot?: React.ReactNode
}) {
  const [f, setF] = useState<Form>(() => fromReward(reward))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const first = useRef<HTMLInputElement>(null)
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }))

  useEffect(() => {
    first.current?.focus()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  // Points follow the real price until you keep your own number.
  const suggested = Number(f.lei) > 0 ? suggestPoints(Number(f.lei), value.value) : null
  const bundleSum = useMemo(() => all.filter((r) => f.bundle.includes(r.id)).reduce((s, r) => s + r.price, 0), [all, f.bundle])
  const points = f.priceLocked ? Number(f.price) || 0 : suggested ?? (f.bundle.length ? bundleSum : Number(f.price) || 0)
  const preview = { title: f.title || 'Your reward', emoji: f.emoji || null, imageUrl: isPhotoUrl(f.imageUrl) ? f.imageUrl : null, category: f.category }
  const ok = f.title.trim() && points > 0

  const pick = async (fl: File | undefined) => {
    if (!fl) return
    try {
      set({ imageUrl: await shrinkPhoto(fl) })
      setErr(null)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const save = async () => {
    if (!ok || busy) return
    if (f.imageUrl && !isPhotoUrl(f.imageUrl)) return setErr('The image link must start with https://')
    setBusy(true)
    const input: RewardInput = {
      ...(reward ? { id: reward.id } : {}),
      title: f.title.trim(),
      price: Math.round(points),
      tier: reward?.tier ?? 'bronze',
      realCost: Math.max(0, Math.round(Number(f.lei) || 0)),
      pinned: reward?.pinned ?? false,
      note: f.note.trim() || null,
      imageUrl: f.imageUrl.trim() || null,
      productUrl: f.productUrl.trim() || null,
      currency: reward?.currency ?? currency,
      emoji: f.emoji.trim() || null,
      category: f.category,
      oneTime: f.oneTime,
      cooldownDays: f.oneTime ? 0 : Math.max(0, Math.min(365, Math.round(Number(f.cooldownDays) || 0))),
      monthLimit: f.oneTime ? 0 : Math.max(0, Math.min(365, Math.round(Number(f.monthLimit) || 0))),
      bundle: f.bundle.length ? f.bundle : null,
      priceLocked: f.priceLocked
    }
    const done = await onSave(input)
    setBusy(false)
    if (done) onClose()
  }

  return createPortal(
    <div className="rx-sheet-wrap" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <m.form
        className="rx-sheet"
        role="dialog"
        aria-label={reward ? 'Edit reward' : 'Add a reward'}
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <i className="rx-grab" aria-hidden />
        <header className="rx-sheet-head">
          <h3>{reward ? 'Edit reward' : 'Add a reward'}</h3>
          <button type="button" className="rx-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="rx-preview">
          <Cover r={preview} />
          <div>
            <b>{preview.title}</b>
            <span className="rx-price">
              <i className="coin-dot" aria-hidden /> {points ? Math.round(points).toLocaleString() : '—'}
              {Number(f.lei) > 0 && <small> · {Number(f.lei).toLocaleString()} lei</small>}
            </span>
            <small className="rx-sub">{f.oneTime ? 'Once, then it leaves the list' : f.cooldownDays ? `Again every ${f.cooldownDays} days` : 'Repeat as often as you earn it'}</small>
          </div>
        </div>

        <label className="rx-field">
          <span>Name</span>
          <input ref={first} value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. New headphones" maxLength={80} required />
        </label>

        <div className="rx-field">
          <span>Cover</span>
          <div className="rx-emojis" role="radiogroup" aria-label="Emoji">
            {EMOJIS.map((e) => (
              <button key={e} type="button" role="radio" aria-checked={f.emoji === e} className={f.emoji === e ? 'on' : ''} onClick={() => set({ emoji: f.emoji === e ? '' : e })}>
                {e}
              </button>
            ))}
          </div>
          <div className="rx-row">
            <input value={f.emoji} onChange={(e) => set({ emoji: e.target.value.slice(0, 8) })} placeholder={`Any emoji (${rewardEmoji(preview)})`} aria-label="Your own emoji" className="short" />
            <button type="button" className="rx-btn small" onClick={() => file.current?.click()}>
              📷 Photo
            </button>
            {f.imageUrl && (
              <button type="button" className="rx-btn small ghost" onClick={() => set({ imageUrl: '' })}>
                Remove photo
              </button>
            )}
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          </div>
          {!f.imageUrl.startsWith('data:') && <input value={f.imageUrl} onChange={(e) => set({ imageUrl: e.target.value.trim() })} placeholder="…or a link to an image (https://)" inputMode="url" aria-label="Image link" />}
        </div>

        <div className="rx-two">
          <label className="rx-field">
            <span>Real price ({currency === 'MDL' ? 'lei' : currency})</span>
            <input value={f.lei} onChange={(e) => set({ lei: e.target.value.replace(/[^\d]/g, '') })} placeholder="optional, e.g. 300" inputMode="numeric" />
          </label>
          <label className="rx-field">
            <span>Points {!f.priceLocked && suggested ? '(auto)' : ''}</span>
            <input
              value={f.priceLocked ? f.price : String(suggested ?? (f.bundle.length ? bundleSum || '' : f.price))}
              onChange={(e) => set({ price: e.target.value.replace(/\D/g, ''), priceLocked: true })}
              placeholder="e.g. 600"
              inputMode="numeric"
              required
            />
          </label>
        </div>
        <label className="rx-check">
          <input type="checkbox" checked={f.priceLocked} onChange={(e) => set({ priceLocked: e.target.checked, price: e.target.checked ? String(points || '') : f.price })} />
          <span>Keep these points (don't follow the real price)</span>
        </label>

        <div className="rx-field">
          <span>Category</span>
          <div className="rx-cats">
            {REWARD_CATEGORIES.map((c) => (
              <button key={c.id} type="button" className={`rx-chip ${f.category === c.id ? 'on' : ''}`} onClick={() => set({ category: f.category === c.id ? null : c.id })}>
                {c.emoji} {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rx-field">
          <span>How often</span>
          <div className="rx-seg" role="radiogroup">
            <button type="button" role="radio" aria-checked={!f.oneTime} className={!f.oneTime ? 'on' : ''} onClick={() => set({ oneTime: false })}>
              Repeat
            </button>
            <button type="button" role="radio" aria-checked={f.oneTime} className={f.oneTime ? 'on' : ''} onClick={() => set({ oneTime: true })}>
              Once
            </button>
          </div>
          {!f.oneTime && (
            <div className="rx-two">
              <label className="rx-field inline">
                <span>Wait between buys</span>
                <span className="rx-unit">
                  <input value={f.cooldownDays} onChange={(e) => set({ cooldownDays: e.target.value.replace(/\D/g, '').slice(0, 3) })} placeholder="0" inputMode="numeric" /> days
                </span>
              </label>
              <label className="rx-field inline">
                <span>At most</span>
                <span className="rx-unit">
                  <input value={f.monthLimit} onChange={(e) => set({ monthLimit: e.target.value.replace(/\D/g, '').slice(0, 3) })} placeholder="∞" inputMode="numeric" /> a month
                </span>
              </label>
            </div>
          )}
        </div>

        {all.filter((r) => r.id !== reward?.id && !r.bundle?.length).length > 1 && (
          <details className="rx-field rx-bundle" open={f.bundle.length > 0}>
            <summary>Make it a bundle (e.g. "Gaming night")</summary>
            <div className="rx-cats">
              {all
                .filter((r) => r.id !== reward?.id && !r.bundle?.length)
                .map((r) => (
                  <button key={r.id} type="button" className={`rx-chip ${f.bundle.includes(r.id) ? 'on' : ''}`} onClick={() => set({ bundle: f.bundle.includes(r.id) ? f.bundle.filter((x) => x !== r.id) : [...f.bundle, r.id] })}>
                    {rewardEmoji(r)} {r.title}
                  </button>
                ))}
            </div>
            {f.bundle.length > 0 && <small className="rx-sub">Together: {bundleSum.toLocaleString()} points</small>}
          </details>
        )}

        <label className="rx-field">
          <span>Note</span>
          <input value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder="optional: size, colour, why you want it" maxLength={140} />
        </label>
        <label className="rx-field">
          <span>Link</span>
          <input value={f.productUrl} onChange={(e) => set({ productUrl: e.target.value.trim() })} placeholder="optional: where to buy it" inputMode="url" />
        </label>

        {lockSlot}
        {err && <p className="rx-err">{err}</p>}

        <footer className="rx-sheet-foot">
          {onRemove && (
            <button type="button" className="rx-btn ghost danger" onClick={onRemove}>
              Remove
            </button>
          )}
          <button type="button" className="rx-btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="rx-btn primary" disabled={!ok || busy}>
            {reward ? 'Save' : 'Add reward'}
          </button>
        </footer>
      </m.form>
    </div>,
    document.body
  )
}
