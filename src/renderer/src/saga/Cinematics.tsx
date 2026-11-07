// The saga's big moments: the season intro (LF1), the end-of-season recap,
// Ben's path with its chapter reveal (LF12) and the full-screen level-up
// cinematic (LF7). Scenes move only transform and opacity, stop on Esc or a
// tap, and show a still frame with reduced motion.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { life } from '../bridge'
import { useAction } from '../ui'
import { artUrl } from '../wallpaper/art'
import { reducedMotion } from '../motionKit'
import { playVoices } from '../soundKit'
import { ARC } from '@core/benArc'
import { CINE, CINE_REDUCED_MS, rankUp, synthHit, type Cinematic } from '@core/levelCine'
import type { SagaView } from '../web/sagaStore'
import { BenArcAvatar, BossSigil } from './sagaArt'
import './cinematics.css'

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

function useEsc(fn: () => void) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && ref.current()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
}

/** Letters that rise one after another (each a span; only transform/opacity animate). */
function Letters({ text, delay = 0, step = 45 }: { text: string; delay?: number; step?: number }) {
  return (
    <span className="cn-letters" aria-label={text}>
      {[...text].map((ch, i) => (
        <span key={i} aria-hidden="true" style={{ animationDelay: `${delay + i * step}ms` }}>
          {ch === ' ' ? ' ' : ch}
        </span>
      ))}
    </span>
  )
}

/** LF1: the season's opening scene, like the first minute of a new arc. */
export function SeasonIntro({ v, onClose }: { v: SagaView; onClose: () => void }) {
  const c = v.current
  useEsc(onClose)
  const still = reducedMotion()
  if (!c) return null
  const s = c.season
  const cover = artUrl(s.cover)
  return createPortal(
    <div className={`cn-intro ${still ? 'still' : ''}`} role="dialog" aria-modal="true" aria-label={`Season ${c.number}: ${s.name}`} style={{ '--sc': s.color } as CSSProperties} onClick={onClose}>
      {cover && <img className="cn-intro-art" src={cover} alt="" aria-hidden="true" />}
      <div className="cn-intro-shade" aria-hidden="true" />
      <div className="cn-bar top" aria-hidden="true" />
      <div className="cn-bar bottom" aria-hidden="true" />
      <div className="cn-intro-body">
        <span className="cn-kicker" style={{ animationDelay: '500ms' }}>Season {c.number} · 8 weeks · {fmtDay(s.start)}</span>
        <h1 className="cn-intro-title"><Letters text={s.name} delay={900} /></h1>
        {s.theme && <p className="cn-intro-theme" style={{ animationDelay: `${1300 + s.name.length * 45}ms` }}>{s.theme}</p>}
        <ol className="cn-intro-quests">
          {s.quests.map((q, i) => (
            <li key={q.id} style={{ animationDelay: `${2700 + i * 420}ms` }}>
              <small>Main quest {i + 1}</small>
              <b>{q.title}</b>
            </li>
          ))}
        </ol>
        <div className="cn-intro-boss" style={{ animationDelay: `${2900 + s.quests.length * 420}ms` }}>
          <BossSigil kind={s.boss.kind} color={s.color} size={56} />
          <div>
            <small>Final boss · {fmtDay(s.boss.day)}</small>
            <b>{s.boss.title}</b>
          </div>
        </div>
        <button className="btn primary cn-begin" style={{ animationDelay: `${3500 + s.quests.length * 420}ms` }} onClick={onClose} autoFocus>
          Begin
        </button>
      </div>
    </div>,
    document.body
  )
}

/** The end-of-season recap: the numbers, the verdict, and closing the arc. */
export function SeasonRecapSheet({ v, onClose, onNext }: { v: SagaView; onClose: () => void; onNext: () => void }) {
  const act = useAction()
  useEsc(onClose)
  const c = v.current
  const r = c?.recap
  if (!c || !r) return null
  const s = c.season
  return createPortal(
    <div className="sheet cn-recap" role="dialog" aria-modal="true" aria-label={`Recap of ${s.name}`} style={{ '--sc': s.color } as CSSProperties} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-card cn-recap-card">
        {artUrl(s.cover) && <img className="cn-recap-art" src={artUrl(s.cover)!} alt="" aria-hidden="true" />}
        <div className="cn-recap-shade" aria-hidden="true" />
        <div className="cn-recap-body">
          <span className="cn-kicker">Season {c.number} · recap</span>
          <h2>{s.name}</h2>
          <div className={`cn-stamp v-${r.verdict.toLowerCase()}`}>{r.verdict}</div>
          <div className="cn-recap-stats">
            <div><b>{r.questsDone}/{r.questsTotal}</b><small>main quests</small></div>
            <div><b>{r.perfectDays}</b><small>perfect days</small></div>
            <div><b>{r.xp.toLocaleString('en-GB')}</b><small>XP</small></div>
            <div><b>{r.boss === 'won' ? '⚔ Won' : r.boss === 'lost' ? 'Lost' : '—'}</b><small>the boss</small></div>
          </div>
          <ul className="cn-recap-lines">{r.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          <footer>
            {!s.closed && (
              <button className="btn primary" onClick={async () => { await act(() => life.saga!.closeSeason(s.id), 'Season closed. On to the next arc.'); onClose() }}>
                Close the season
              </button>
            )}
            <button className="btn" onClick={() => { onClose(); onNext() }}>Plan the next season</button>
          </footer>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** LF12: Ben's path, every chapter, the outfits you unlocked and the moments he remembers. */
export function ArcSheet({ v, onClose }: { v: SagaView; onClose: () => void }) {
  const act = useAction()
  const fresh = v.arcNew
  const close = useCallback(() => {
    if (fresh) void life.saga?.seeChapter(fresh.n)
    onClose()
  }, [fresh, onClose])
  useEsc(close)
  return createPortal(
    <div className="sheet cn-arc" role="dialog" aria-modal="true" aria-label="Ben's path" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet-card cn-arc-card">
        <header className="cn-arc-head">
          {fresh ? (
            <div className="cn-reveal" style={{ '--au': fresh.aura } as CSSProperties}>
              <span className="cn-reveal-ring" aria-hidden="true" />
              <BenArcAvatar outfit={fresh.outfit} size={128} />
              <div>
                <span className="cn-kicker">New chapter unlocked</span>
                <h2>{fresh.title}</h2>
                <p>New look: {fresh.outfitLabel}. “{fresh.lines[0]}”</p>
              </div>
            </div>
          ) : (
            <div className="cn-arc-now">
              <BenArcAvatar outfit={v.arc.outfit} size={96} />
              <div>
                <span className="cn-kicker">Ben's path · chapter {v.arc.chapter.n}</span>
                <h2>{v.arc.chapter.title}</h2>
                <p>{v.arc.next ? `Finish ${v.arc.toNext} more season${v.arc.toNext === 1 ? '' : 's'} to open “${v.arc.next.title}”.` : 'Every chapter is open. The student became the master.'}</p>
              </div>
            </div>
          )}
          <button className="icon-btn" onClick={close} aria-label="Close">✕</button>
        </header>
        <ol className="cn-chapters">
          {ARC.map((ch) => {
            const open = v.arc.unlocked.some((u) => u.n === ch.n)
            const wearing = v.arc.outfit === ch.outfit
            return (
              <li key={ch.n} className={`${open ? 'open' : 'locked'} ${v.arc.chapter.n === ch.n ? 'now' : ''}`} style={{ '--au': ch.aura } as CSSProperties}>
                <BenArcAvatar outfit={ch.outfit} size={56} locked={!open} />
                <div className="cn-ch-text">
                  <small>Chapter {ch.n} · {ch.at === 0 ? 'from the start' : `after ${ch.at} season${ch.at === 1 ? '' : 's'}`}</small>
                  <b>{open ? ch.title : '???'}</b>
                  <em>{open ? `“${ch.lines[ch.lines.length - 1]}”` : 'Finish more seasons to hear it.'}</em>
                </div>
                {open && (
                  <button className={`btn sm ${wearing ? 'primary' : ''}`} disabled={wearing} onClick={() => act(() => life.saga!.setOutfit(ch.n === v.arc.chapter.n ? null : ch.outfit))}>
                    {wearing ? 'Wearing' : ch.outfitLabel}
                  </button>
                )}
              </li>
            )
          })}
        </ol>
        <section className="cn-moments">
          <span className="cn-kicker">Moments Ben remembers</span>
          {v.moments.length ? (
            <ul>{v.moments.slice(-6).reverse().map((m) => <li key={m.day + m.text}><small>{fmtDay(m.day)}</small>{m.text}</li>)}</ul>
          ) : (
            <p className="sg-muted">Beat a boss or finish a season: he keeps those for good.</p>
          )}
        </section>
      </div>
    </div>,
    document.body
  )
}

/** LF7: the 5-second scene. Pure visuals: it never blocks a click (Esc or a tap ends it). */
export function LevelScene({ c, onDone }: { c: Cinematic; onDone: () => void }) {
  const still = reducedMotion()
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    if (!still) playVoices(synthHit(), 'success')
    const t = setTimeout(() => done.current(), still ? CINE_REDUCED_MS : CINE.end)
    const end = () => done.current()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && end()
    // A tap ends it a moment later (so the tap that ends it still lands on the page below).
    const tap = () => setTimeout(end, 50)
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', tap)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerdown', tap)
    }
  }, [still])
  return createPortal(
    <div className={`cn-level ${still ? 'still' : ''} k-${c.kind}`} style={{ '--rk': c.color } as CSSProperties} role="status" aria-live="polite" aria-label={`${c.over}: ${c.title}`}>
      <div className="cn-dark" />
      <div className="cn-rays" aria-hidden="true" />
      <div className="cn-blade" aria-hidden="true"><i /></div>
      <div className="cn-flash" aria-hidden="true" />
      <div className="cn-sparks" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--i': i } as CSSProperties} />)}</div>
      <div className="cn-level-body">
        <span className="cn-badge">{c.badge}</span>
        <span className="cn-over">{c.over}</span>
        <h1 className="cn-level-title"><Letters text={c.title} delay={still ? 0 : CINE.title} step={38} /></h1>
        <span className="cn-sub">{c.sub}</span>
      </div>
      <span className="cn-skip">Esc to skip</span>
    </div>,
    document.body
  )
}

/**
 * The host (mounted once in the app): plays a new rank or a season moment
 * once, across devices. `life-cinematic` (detail: a Cinematic) plays one on
 * demand ("watch it again", screenshots).
 */
export function CinematicHost({ level }: { level: number | null }) {
  const [now, setNow] = useState<Cinematic | null>(null)
  const busy = useRef(false)
  const check = useCallback(async () => {
    if (busy.current || !life.saga) return
    const v = await life.saga.view().catch(() => null)
    if (!v) return
    // First run: today's rank counts as already seen (no scene for where you already are).
    if (!v.arcBook.played.some((p) => p.startsWith('rank:'))) {
      const seed = rankUp(1, v.level.level)?.id ?? 'rank:1'
      await life.saga.played(seed).catch(() => null)
      if (v.cinematic?.kind === 'rank') return
    }
    if (v.cinematic && !busy.current) {
      busy.current = true
      await life.saga.played(v.cinematic.id).catch(() => null)
      setNow(v.cinematic)
    }
  }, [])
  // On start (once the app is idle) and whenever the level changes.
  const lastLevel = useRef<number | null>(null)
  useEffect(() => {
    if (level == null) return
    if (lastLevel.current === level) return
    lastLevel.current = level
    const t = setTimeout(() => void check(), 1500)
    return () => clearTimeout(t)
  }, [level, check])
  useEffect(() => {
    const on = (e: Event) => {
      const c = (e as CustomEvent).detail as Cinematic | undefined
      if (c && c.title) {
        busy.current = true
        setNow(c)
      }
    }
    const saga = () => void check()
    window.addEventListener('life-cinematic', on)
    window.addEventListener('life-saga-changed', saga)
    return () => {
      window.removeEventListener('life-cinematic', on)
      window.removeEventListener('life-saga-changed', saga)
    }
  }, [check])
  if (!now) return null
  return (
    <LevelScene
      key={now.id}
      c={now}
      onDone={() => {
        busy.current = false
        setNow(null)
      }}
    />
  )
}
