// "Your SoundCloud": the row at the top of the Music page and the island's
// Music page, the signed-in tab (desktop), "Your mixes" and the ♥ button.
//  - Connect by username (website and desktop): your public Likes, your own
//    tracks and your public playlists as cards; they play in our embed
//    player. Only the public name is kept (synced, island_kit.music.scUser).
//    The playlists are asked from SoundCloud's embed player once a day at
//    most, only while this row shows, and cached on this device.
//  - Sign in to SoundCloud (desktop): SoundCloud's real home page inside the
//    app (src/desktop/scWeb.ts). Off until you press Sign in.
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { cleanSetsCache, parseScUser, setsStale, setStation, userSetsUrl, userStations, type UserSet, type UserSetsCache, cleanUserSets } from '@core/scAccount'
import { WIDGET_API, widgetSrc, type Station } from '@core/soundcloud'
import type { MusicKit } from '@core/music'
import type { MusicCtl } from './remote'
import { Eq, MuIcon, type Press } from './MusicUi'
import { uiTick } from './engine'
import { useStationArt } from './hooks'
import { hasScWeb, scWebOp, useScWeb } from './scWeb'
import './yoursc.css'

// ---- your public playlists (asked from the embed player, cached a day) ----
const SETS_KEY = 'ls.scUserSets'
const readCache = (): UserSetsCache | null => {
  try {
    return cleanSetsCache(JSON.parse(localStorage.getItem(SETS_KEY) ?? 'null'))
  } catch {
    return null
  }
}
let cache: UserSetsCache | null = readCache()
const cacheSubs = new Set<() => void>()
function writeCache(c: UserSetsCache) {
  cache = c
  try {
    localStorage.setItem(SETS_KEY, JSON.stringify(c))
  } catch {
    /* private window */
  }
  cacheSubs.forEach((f) => f())
}
const useCache = () => useSyncExternalStore((f) => (cacheSubs.add(f), () => void cacheSubs.delete(f)), () => cache, () => cache)

function loadApi(): Promise<any> {
  const w = window as any
  if (w.SC?.Widget) return Promise.resolve(w.SC)
  return new Promise((ok, no) => {
    const el = document.createElement('script')
    el.src = WIDGET_API
    el.async = true
    el.onload = () => (w.SC?.Widget ? ok(w.SC) : no(new Error('no widget')))
    el.onerror = () => no(new Error('SoundCloud did not load'))
    document.head.appendChild(el)
  })
}

let probing: string | null = null
/**
 * Asks SoundCloud's embed player for "<name>/sets" in a hidden frame and
 * keeps the playlists it lists. Gives up quietly after 10 s (then the row
 * shows Likes and tracks only, and asks again tomorrow).
 */
function probeSets(user: string): void {
  const url = userSetsUrl(user)
  if (!url || probing) return
  probing = user
  const frame = document.createElement('iframe')
  frame.src = widgetSrc(url)
  frame.allow = 'autoplay'
  frame.title = 'SoundCloud playlists'
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;border:0'
  let done = false
  const finish = (sets: UserSet[]) => {
    if (done) return
    done = true
    probing = null
    clearTimeout(t)
    frame.remove()
    writeCache({ user, at: Date.now(), sets })
  }
  const t = window.setTimeout(() => finish(cache?.user === user ? cache.sets : []), 10_000)
  document.body.appendChild(frame)
  void loadApi()
    .then((SC) => {
      const w = SC.Widget(frame)
      w.bind(SC.Widget.Events.ERROR, () => finish([]))
      w.bind(SC.Widget.Events.READY, () => {
        // Items fill in a moment after READY: ask twice.
        const ask = (last: boolean) => w.getSounds((list: unknown) => {
          const sets = cleanUserSets(list)
          if (sets.length || last) finish(sets)
        })
        ask(false)
        window.setTimeout(() => ask(true), 1800)
      })
    })
    .catch(() => finish([]))
}

function useUserSets(user: string): UserSet[] {
  const c = useCache()
  useEffect(() => {
    if (!user || !setsStale(cache, user, Date.now())) return
    // A moment after the page settles, never at start-up.
    const t = window.setTimeout(() => probeSets(user), 1500)
    return () => clearTimeout(t)
  }, [user])
  return c?.user === user ? c.sets : []
}

// ---- opening the signed-in tab ----
export const MUSIC_TAB_KEY = 'ls.musicTab'
/** Show the app's Music page on its "Your SoundCloud" tab (from the island too). */
export function openScWebTab() {
  try {
    localStorage.setItem(MUSIC_TAB_KEY, 'web')
  } catch {
    /* fine */
  }
  window.dispatchEvent(new CustomEvent('life-music-tab', { detail: 'web' }))
  if (/[?&]island=1\b/.test(location.search)) window.desktop?.showApp?.('music')
}

// ---- the cards ----
function hue(s: string) {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}
function Card({ title, sub, art, icon, on, playing, onPlay, press, id }: { title: string; sub: string; art?: string; icon: string; on: boolean; playing: boolean; onPlay: () => void; press: Press; id: string }) {
  return (
    <button className={`ysc-card ${on ? 'on' : ''}`} style={{ ['--ysc-h' as string]: hue(title) } as CSSProperties} aria-label={on && playing ? `Pause ${title}` : `Play ${title}`} title={title} {...press(id, () => (uiTick(), onPlay()))}>
      <span className="ysc-art">
        {art ? <img src={art} alt="" loading="lazy" referrerPolicy="no-referrer" draggable={false} /> : <i aria-hidden>{icon}</i>}
        <span className="ysc-play" aria-hidden>
          {on ? <Eq on={playing} /> : <svg width={12} height={12} viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg>}
        </span>
      </span>
      <b>{title}</b>
      <small>{sub}</small>
    </button>
  )
}

/**
 * The "Your SoundCloud" row. Not connected: type your profile name (or paste
 * its link). Connected: Likes, your tracks and your public playlists as
 * cards that play in our player; on the desktop also a way to sign in.
 */
export function YourScRow({ music, save, ctl, press, prefix, compact = false }: { music: MusicKit; save: (m: Partial<MusicKit>) => void; ctl: MusicCtl; press: Press; prefix: string; compact?: boolean }) {
  const user = music.scUser
  const sets = useUserSets(user)
  const arts = useStationArt()
  const w = useScWeb()
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)
  const connect = () => {
    const u = parseScUser(name)
    if (!u) return setErr('Type your SoundCloud profile name, or paste your profile link (soundcloud.com/your-name).')
    setErr('')
    setName('')
    setOpen(false)
    save({ scUser: u })
  }
  const play = (st: Station) => {
    const on = ctl.s.station?.url === st.url
    if (on && ctl.s.ready) return ctl.run({ op: ctl.s.playing ? 'pause' : 'resume' })
    ctl.run({ op: 'play', station: st })
  }
  const signIn = hasScWeb() && (
    <button className="vb-link" {...press(`${prefix}:ysc:signin`, openScWebTab)}>
      {w?.on ? 'Open your SoundCloud home' : 'Sign in for your mixes and stations'}
    </button>
  )
  if (!user) {
    return (
      <div className={`ysc ${compact ? 'compact' : ''}`} aria-label="Your SoundCloud">
        <div className="ysc-head">
          <h4>Your SoundCloud</h4>
          {signIn}
        </div>
        {open || !compact ? (
          <div className="ysc-connect">
            <input value={name} placeholder="Your SoundCloud name or profile link" onPointerDown={() => window.desktop?.islandFocus?.()} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && connect()} aria-label="Your SoundCloud profile name" />
            <button className="mu-btn" {...press(`${prefix}:ysc:connect`, connect)}>Connect</button>
          </div>
        ) : (
          <button className="ysc-cta" {...press(`${prefix}:ysc:open`, () => setOpen(true))}>
            <MuIcon d="plus" size={14} /> Connect by username: your likes and playlists
          </button>
        )}
        {err && <p className="mu-warn">{err}</p>}
        {!compact && <p className="mu-empty">Only your public profile name is kept. Your likes and public playlists play here; nothing is sent to SoundCloud but the usual player requests.</p>}
      </div>
    )
  }
  const base = userStations(user)
  const cards: { st: Station; sub: string; icon: string; art?: string }[] = [
    { st: base[0], sub: 'Likes', icon: '♥', art: arts[base[0].url] },
    { st: base[1], sub: 'Your tracks', icon: '♪', art: arts[base[1].url] },
    ...sets.map((x, i) => ({ st: setStation(x, i), sub: 'Playlist', icon: '≡', art: x.art || arts[x.url] }))
  ]
  return (
    <div className={`ysc ${compact ? 'compact' : ''}`} aria-label="Your SoundCloud">
      <div className="ysc-head">
        <h4>
          Your SoundCloud <span>@{user}</span>
        </h4>
        <span className="ysc-acts">
          {signIn}
          <button className="vb-link" title="Forget the profile name on all your devices" {...press(`${prefix}:ysc:forget`, () => save({ scUser: '', pin: music.pin === 'scweb' ? null : music.pin }))}>Disconnect</button>
        </span>
      </div>
      <div className="ysc-row" role="list">
        {cards.map((c) => (
          <Card key={c.st.url} title={c.st.name} sub={c.sub} icon={c.icon} art={c.art} on={ctl.s.station?.url === c.st.url} playing={ctl.s.playing} press={press} id={`${prefix}:ysc:${c.st.id}`} onPlay={() => play(c.st)} />
        ))}
      </div>
      {!sets.length && !compact && <p className="mu-empty">Public playlists show up here once SoundCloud lists them. You can also paste a playlist link under Stations.</p>}
    </div>
  )
}

/** The island's "Your mixes": the "Mixed for you" tiles from your signed-in home; a tap plays one. */
export function YourMixes({ press, prefix }: { press: Press; prefix: string }) {
  const w = useScWeb()
  if (!w?.on) return null
  return (
    <div className="ysc compact" aria-label="Your mixes">
      <div className="ysc-head">
        <h4>Your mixes</h4>
        <button className="vb-link" {...press(`${prefix}:mix:open`, openScWebTab)}>Open SoundCloud</button>
      </div>
      {w.mixes.length ? (
        <div className="ysc-row" role="list">
          {w.mixes.map((m, i) => (
            <Card key={m.url} title={m.title} sub="Mixed for you" icon={String(i + 1)} art={m.art} on={false} playing={false} press={press} id={`${prefix}:mix:${i}`} onPlay={() => void scWebOp('playMix', m.url)} />
          ))}
        </div>
      ) : (
        <button className="ysc-cta" {...press(`${prefix}:mix:open2`, openScWebTab)}>
          ♫ Your mixes, stations and likes are on the "Your SoundCloud" tab
        </button>
      )}
    </div>
  )
}

/** ♥ for the track playing in the signed-in view: presses SoundCloud's own like and checks it changed. */
export function LikeButton({ press, id }: { press: Press; id: string }) {
  const w = useScWeb()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const t = useRef(0)
  useEffect(() => () => clearTimeout(t.current), [])
  if (!w?.live) return null
  const liked = w.now.liked === true
  const go = async () => {
    if (busy) return
    setBusy(true)
    const r = await scWebOp('like')
    setBusy(false)
    const res = r?.result
    setNote(res === 'liked' ? 'Liked' : res === 'unliked' ? 'Removed from your likes' : res === 'unchanged' ? "SoundCloud didn't change it" : "Couldn't check: open the tab")
    clearTimeout(t.current)
    t.current = window.setTimeout(() => setNote(''), 2600)
  }
  return (
    <span className="ysc-like-wrap">
      <button className={`mu-ic ysc-like ${liked ? 'on' : ''}`} aria-pressed={liked} aria-label={liked ? 'Unlike on SoundCloud' : 'Like on SoundCloud'} title={liked ? 'Liked on SoundCloud (tap to unlike)' : 'Like on SoundCloud'} disabled={busy} {...press(id, () => void go())}>
        <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
          <path d="M12 20.3s-7.5-4.6-9.2-9.1C1.6 8 3.6 4.7 7 4.7c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.4 0 5.4 3.3 4.2 6.5-1.7 4.5-9.2 9.1-9.2 9.1z" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
        </svg>
      </button>
      {note && <small className="ysc-note" role="status">{note}</small>}
    </span>
  )
}

/**
 * The Music page's "Your SoundCloud" tab (desktop): SoundCloud's real home
 * page in its own isolated view, placed over this panel. Leaving the tab
 * only hides it, so the music goes on.
 */
export function ScWebPanel() {
  const w = useScWeb()
  const box = useRef<HTMLDivElement>(null)
  const on = !!w?.on
  const [sure, setSure] = useState(false)
  useEffect(() => {
    if (!sure) return
    const t = window.setTimeout(() => setSure(false), 4000)
    return () => clearTimeout(t)
  }, [sure])
  useEffect(() => {
    const el = box.current
    if (!on || !el) return
    let raf = 0
    const send = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        void scWebOp('show', { x: r.left, y: r.top, width: r.width, height: r.height })
      })
    }
    send()
    const ro = new ResizeObserver(send)
    ro.observe(el)
    window.addEventListener('resize', send)
    window.addEventListener('scroll', send, true)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', send)
      window.removeEventListener('scroll', send, true)
      void scWebOp('hide')
    }
  }, [on])
  if (!w) return <p className="mu-empty">Signing in to SoundCloud works in the Windows app.</p>
  if (!on) {
    return (
      <section className="mup-card ysw-intro" aria-label="Sign in to SoundCloud">
        <h3>Your SoundCloud, inside Life System</h3>
        <p>Sign in once on SoundCloud's own page. Then your home is right here: Mixed for you, Discover with Stations, Recently played and Likes, all clickable. The island shows your mixes and plays them, and its buttons, pill and lyrics follow what SoundCloud plays.</p>
        <ul>
          <li>Life System never sees or keeps your password: SoundCloud's own sign-in page does that, in its own separate space.</li>
          <li>Music keeps playing when you leave this tab.</li>
          <li>Sign out any time: it clears everything SoundCloud saved on this PC.</li>
        </ul>
        <button className="mu-btn ysw-signin" onClick={() => void scWebOp('signIn')}>Sign in to SoundCloud</button>
      </section>
    )
  }
  const zoom = (d: number) => void scWebOp('zoom', Math.round((w.zoom + d) * 100) / 100)
  return (
    <section className="ysw" aria-label="Your SoundCloud">
      <div className="ysw-bar">
        <button className="mu-chip" onClick={() => void scWebOp('back')} title="Back">‹ Back</button>
        <button className="mu-chip" onClick={() => void scWebOp('home')} title="Your SoundCloud home">Home</button>
        <span className="ysw-zoom">
          <button className="mu-ic sm" aria-label="Smaller" onClick={() => zoom(-0.05)}>−</button>
          <small>{Math.round(w.zoom * 100)}%</small>
          <button className="mu-ic sm" aria-label="Bigger" onClick={() => zoom(0.05)}>+</button>
        </span>
        <span className="ysw-now">{w.now.title ? `${w.now.playing ? '♪' : '⏸'} ${w.now.title}${w.now.artist ? ` · ${w.now.artist}` : ''}` : w.signedIn ? 'Signed in' : 'Sign in on the page below'}</span>
        <button className={`mu-chip ${sure ? 'on' : ''}`} title="Sign out and clear everything SoundCloud saved on this PC" onClick={() => (sure ? (setSure(false), void scWebOp('signOut')) : setSure(true))}>{sure ? 'Tap again to sign out' : 'Sign out'}</button>
      </div>
      <div ref={box} className="ysw-box">
        <p>Loading SoundCloud…</p>
      </div>
    </section>
  )
}

/** The Music page's tab ('player' or 'web'), remembered on this device; the island can switch it. */
export function useMusicTab(): ['player' | 'web', (t: 'player' | 'web') => void] {
  const read = (): 'player' | 'web' => {
    try {
      return hasScWeb() && localStorage.getItem(MUSIC_TAB_KEY) === 'web' ? 'web' : 'player'
    } catch {
      return 'player'
    }
  }
  const [tab, setTab] = useState(read)
  useEffect(() => {
    const ev = (e: Event) => setTab((e as CustomEvent).detail === 'web' && hasScWeb() ? 'web' : 'player')
    const st = (e: StorageEvent) => e.key === MUSIC_TAB_KEY && setTab(read())
    window.addEventListener('life-music-tab', ev)
    window.addEventListener('storage', st)
    return () => {
      window.removeEventListener('life-music-tab', ev)
      window.removeEventListener('storage', st)
    }
  }, [])
  const set = (t: 'player' | 'web') => {
    try {
      localStorage.setItem(MUSIC_TAB_KEY, t)
    } catch {
      /* fine */
    }
    setTab(t)
  }
  return [tab, set]
}
