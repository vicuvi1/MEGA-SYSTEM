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
import { boundsKey, clip, covered, fillHeight, type Rect } from '@core/scBounds'
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

/** What of ours can lie over the page: the view would hide it, so it steps aside while one shows over its box. */
const OVERLAYS = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], .nt-stack > *, .nv-bar, [role="menu"], [role="listbox"], .palette-back, .qa-back, .toasts > *, .zoom-toast, .sheet'
function overlayRects(): Rect[] {
  const out: Rect[] = []
  document.querySelectorAll<HTMLElement>(OVERLAYS).forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return
    out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
  })
  return out
}

const NAV_ICON: Record<'back' | 'forward' | 'home' | 'reload' | 'more', string> = {
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  home: 'M4 11.5 12 5l8 6.5M6.5 10v9h11v-9',
  reload: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  more: 'M6 12h.01M12 12h.01M18 12h.01'
}
const NavIcon = ({ d }: { d: keyof typeof NAV_ICON }) => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={d === 'more' ? 3 : 1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={NAV_ICON[d]} />
  </svg>
)

/**
 * The Music page's "Your SoundCloud" tab (desktop): SoundCloud's real home
 * page in its own isolated view, placed over this panel's box. The box fills
 * the page down to the bottom of the window, and the view follows it when the
 * window, the zoom or the sidebar changes. It steps aside while one of our
 * menus, dialogs, the search box or a toast lies over it. Leaving the tab only
 * hides it, so the music goes on.
 */
export function ScWebPanel() {
  const w = useScWeb()
  const box = useRef<HTMLDivElement>(null)
  const on = !!w?.on
  const [sure, setSure] = useState(false)
  const [menu, setMenu] = useState(false)
  const [aside, setAside] = useState(false)
  const [height, setHeight] = useState(0)
  const menuRef = useRef(menu)
  menuRef.current = menu
  useEffect(() => {
    if (!sure) return
    const t = window.setTimeout(() => setSure(false), 4000)
    return () => clearTimeout(t)
  }, [sure])
  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element)?.closest?.('.ysw-more')) (setMenu(false), setSure(false))
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [menu])
  useEffect(() => {
    const el = box.current
    if (!on || !el) return
    let raf = 0
    let last = ''
    const content = el.closest('.content')
    const area = (): Rect => {
      const c = content?.getBoundingClientRect()
      return c ? { left: c.left, top: c.top, right: c.right, bottom: c.bottom } : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
    }
    const check = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        // The box reaches down to the window's bottom (less a small margin).
        const h = fillHeight({ viewport: window.innerHeight, top: r.top + (content?.scrollTop ?? 0), margin: 16, min: 320 })
        setHeight((old) => (Math.abs(old - h) > 1 ? h : old))
        // Inside the box's border, so the border and its rounded corners show around the view.
        const bl = el.clientLeft, bt = el.clientTop
        const seen = clip({ left: r.left + bl, top: r.top + bt, right: r.right - bl, bottom: r.bottom - bt }, area())
        const over = menuRef.current || covered(seen, overlayRects())
        const hidden = over || seen.right - seen.left < 80 || seen.bottom - seen.top < 80
        setAside(over)
        const key = boundsKey(seen, window.devicePixelRatio, hidden)
        if (key === last) return
        last = key
        void scWebOp(hidden ? 'hide' : 'show', hidden ? undefined : { x: seen.left, y: seen.top, width: seen.right - seen.left, height: seen.bottom - seen.top })
      })
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    if (content) ro.observe(content)
    // A menu or dialog opening anywhere on the page: look again.
    const mo = new MutationObserver(check)
    mo.observe(document.body, { childList: true, subtree: true })
    // Things that move the box without resizing it (the sidebar sliding): a light check a few times a second.
    const tick = window.setInterval(check, 250)
    window.addEventListener('resize', check)
    window.addEventListener('scroll', check, true)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      mo.disconnect()
      clearInterval(tick)
      window.removeEventListener('resize', check)
      window.removeEventListener('scroll', check, true)
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
  const pct = Math.round(w.zoom * 100)
  const zoom = (d: number) => void scWebOp('zoom', Math.round((w.zoom + d) * 100) / 100)
  const nav = (op: 'back' | 'forward' | 'home' | 'reload', label: string) => (
    <button className="ysw-ic" aria-label={label} title={label} onClick={() => void scWebOp(op)}>
      <NavIcon d={op} />
    </button>
  )
  return (
    <section className="ysw" aria-label="Your SoundCloud">
      <div className="ysw-bar">
        <div className="ysw-nav" role="group" aria-label="Move around SoundCloud">
          {nav('back', 'Back')}
          {nav('forward', 'Forward')}
          {nav('home', 'Your SoundCloud home')}
          {nav('reload', 'Reload the page')}
        </div>
        {w.signedIn ? (
          <span className="ysw-state on" title="You're signed in to SoundCloud in this app">
            <i aria-hidden /> Signed in
          </span>
        ) : (
          <button className="ysw-state" title="Open SoundCloud's sign-in page below" onClick={() => void scWebOp('signIn')}>
            <i aria-hidden /> Not signed in · Sign in
          </button>
        )}
        <span className="ysw-now" title={w.now.title ? `${w.now.title}${w.now.artist ? ` · ${w.now.artist}` : ''}` : undefined}>
          {w.now.title ? (
            <>
              <span aria-hidden>{w.now.playing ? '♪' : '❚❚'}</span> <b>{w.now.title}</b>
              {w.now.artist ? ` · ${w.now.artist}` : ''}
            </>
          ) : null}
        </span>
        <span className="ysw-zoom" role="group" aria-label="Page size">
          <button aria-label="Smaller" title="Smaller" disabled={w.zoom <= 0.5} onClick={() => zoom(-0.05)}>−</button>
          <button className="ysw-pct" title="Back to 100 %" onClick={() => void scWebOp('zoom', 1)}>{pct}%</button>
          <button aria-label="Bigger" title="Bigger" disabled={w.zoom >= 1.5} onClick={() => zoom(0.05)}>+</button>
        </span>
        <span className="ysw-more">
          <button className="ysw-ic" aria-label="More" title="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => (setMenu((m) => !m), setSure(false))}>
            <NavIcon d="more" />
          </button>
          {menu && (
            <div className="ysw-menu" role="menu">
              <button role="menuitem" className={sure ? 'warn' : ''} onClick={() => (sure ? (setSure(false), setMenu(false), void scWebOp('signOut')) : setSure(true))}>
                {sure ? 'Press again to sign out' : 'Sign out of SoundCloud'}
                <small>Clears everything SoundCloud saved on this PC</small>
              </button>
            </div>
          )}
        </span>
      </div>
      <div ref={box} className="ysw-box" style={height ? { height } : undefined} data-aside={aside || undefined}>
        <p>{aside ? 'SoundCloud steps aside while a menu or window is open.' : 'Loading SoundCloud…'}</p>
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
