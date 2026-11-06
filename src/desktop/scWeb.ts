// "Sign in to SoundCloud" (desktop only). SoundCloud's own site runs in a
// WebContentsView owned by this main process, in its own isolated, saved
// session (partition 'persist:soundcloud'): no preload, no app APIs, no Node,
// context isolation and the sandbox on. You sign in on SoundCloud's own page;
// the app never sees or keeps the password. The view is shown over the Music
// page's "Your SoundCloud" tab and simply detached when you leave it, so the
// music keeps playing. Off until you press "Sign in"; nothing is created or
// loaded before that (and after a restart, only when you open the tab or play
// something from it). "Sign out" clears the whole session.
//
// While the view exists, a tiny script reads what's playing (the page's
// navigator.mediaSession and its player bar) every second while it plays or
// shows, every 5 s otherwise; everything read is checked again in
// core/scAccount.ts. The buttons are SoundCloud's own, clicked by script,
// with its keyboard shortcuts as the fallback.
import { BrowserWindow, ipcMain, session, shell, WebContentsView, type Session } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  cleanMixTiles, cleanZoom, likeResult, mapNowPlaying, mixUrl, NO_NOW, SCWEB_HOME, SCWEB_PARTITION, SCWEB_SIGNIN, SCWEB_ZOOM, scWebPollMs, scWebRoute, viewBounds,
  type MixTile, type ScWebState
} from '../core/scAccount'

/** Reads what's playing. Defensive: any missing piece is just left empty. */
const NOW_JS = `(() => { try {
  const q = (s) => document.querySelector(s)
  const ms = navigator.mediaSession, md = ms && ms.metadata
  const prog = q('.playbackTimeline__progressWrapper')
  const txt = (s) => { const e = q(s); return e ? (e.textContent || '').trim() : '' }
  const link = q('.playbackSoundBadge__titleLink')
  const like = q('.playbackSoundBadge__like, .playbackSoundBadge .sc-button-like')
  const art = q('.playbackSoundBadge__avatar span[style*="background-image"], .playbackSoundBadge span.sc-artwork[style]')
  const pc = q('.playControls__play, .playControl')
  return {
    md: md ? { title: md.title, artist: md.artist, artwork: Array.from(md.artwork || []).slice(0, 10).map((a) => ({ src: a.src, sizes: a.sizes })) } : null,
    state: ms ? ms.playbackState : 'none',
    playingDom: pc ? pc.classList.contains('playing') : null,
    now: prog ? prog.getAttribute('aria-valuenow') : null,
    max: prog ? prog.getAttribute('aria-valuemax') : null,
    passed: txt('.playbackTimeline__timePassed span[aria-hidden="true"]') || txt('.playbackTimeline__timePassed'),
    duration: txt('.playbackTimeline__duration span[aria-hidden="true"]') || txt('.playbackTimeline__duration'),
    href: link ? link.href : '',
    titleDom: link ? (link.getAttribute('title') || link.textContent || '') : '',
    artistDom: txt('.playbackSoundBadge__lightLink'),
    artDom: art ? art.style.backgroundImage : '',
    liked: like ? like.classList.contains('sc-button-selected') : null,
    home: location.pathname === '/discover' || location.pathname === '/'
  }
} catch (e) { return null } })()`

/** Reads the "Mixed for …" tiles on the home page. Fails soft (an empty list) when the page changes. */
const MIXES_JS = `(() => { try {
  const out = []
  const heads = Array.from(document.querySelectorAll('h2, h3')).filter((h) => /mixed for|made for|your mixes/i.test(h.textContent || ''))
  for (const h of heads) {
    let sec = h.parentElement
    for (let i = 0; i < 5 && sec && !sec.querySelector('.playableTile, .audibleTile, [class*="Tile"] a[href]'); i++) sec = sec.parentElement
    if (!sec) continue
    sec.querySelectorAll('.playableTile, .audibleTile').forEach((t) => {
      const a = t.querySelector('a[href^="/"], a[href^="https://soundcloud.com/"]')
      if (!a) return
      const ti = t.querySelector('.playableTile__mainHeading, .playableTile__heading, .audibleTile__heading, .playableTile__descriptionContainer a, a[title]')
      const im = t.querySelector('span.sc-artwork[style*="background-image"], span[style*="background-image"], img')
      out.push({ url: a.getAttribute('href'), title: ti ? (ti.getAttribute('title') || ti.textContent || '') : (a.getAttribute('aria-label') || a.getAttribute('title') || ''), art: im ? (im.getAttribute('src') || im.style.backgroundImage || '') : '' })
    })
    if (out.length >= 30) break
  }
  return out.slice(0, 30)
} catch (e) { return [] } })()`

/** SoundCloud's own player buttons. Returns true when it found and clicked one. */
const clickJs = (sel: string, only?: 'playing' | 'paused') => `(() => { try {
  const b = document.querySelector(${JSON.stringify(sel)})
  if (!b) return false
  ${only ? `const playing = b.classList.contains('playing'); if (${only === 'playing' ? '!playing' : 'playing'}) return true` : ''}
  b.click(); return true
} catch (e) { return false } })()`
const BTN = { toggle: '.playControls__play, .playControl', next: '.skipControl__next', prev: '.skipControl__previous', like: '.playbackSoundBadge__like, .playbackSoundBadge .sc-button-like' }
/** The first play button on a playlist / mix page (after "Play a mix"). */
const PLAY_PAGE_JS = `(() => { try {
  const b = Array.from(document.querySelectorAll('.l-main .sc-button-play, .fullHero .sc-button-play, .sc-button-play, .playButton')).find((x) => x.offsetParent !== null)
  if (!b) return false
  if (!b.classList.contains('sc-button-pause')) b.click()
  return true
} catch (e) { return false } })()`

type Op = 'toggle' | 'play' | 'pause' | 'next' | 'prev'

export function createScWeb(o: { dir: string; origin: string; appWindow: BrowserWindow }) {
  const file = join(o.dir, 'soundcloud-signin.json')
  let st: ScWebState = { on: false, signedIn: false, live: false, visible: false, zoom: SCWEB_ZOOM, now: NO_NOW, mixes: [], at: 0 }
  const loaded = readFile(file, 'utf8')
    .then((t) => {
      const j = JSON.parse(t)
      st = { ...st, on: j?.on === true, zoom: cleanZoom(j?.zoom), mixes: cleanMixTiles(j?.mixes) }
    })
    .catch(() => {})
  const save = () => void writeFile(file, JSON.stringify({ on: st.on, zoom: st.zoom, mixes: st.mixes })).catch(() => {})

  let view: WebContentsView | null = null
  let ses: Session | null = null
  let timer: NodeJS.Timeout | null = null
  let lastSent = ''
  let mixesAt = 0

  const send = () => {
    const msg = JSON.stringify(st)
    if (msg === lastSent) return
    lastSent = msg
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && w.webContents.getURL().startsWith(`${o.origin}/`)) w.webContents.send('scweb:state', st)
  }
  const set = (p: Partial<ScWebState>) => {
    st = { ...st, ...p }
    send()
  }
  const external = (url: string) => {
    if (scWebRoute(url) === 'out') void shell.openExternal(url)
  }

  /** The session, set up once: no permissions, no downloads, a plain browser name. */
  function theSession(): Session {
    if (ses) return ses
    const s = session.fromPartition(SCWEB_PARTITION)
    // Audio needs no permission. Camera, microphone, notifications, location…: all refused.
    s.setPermissionRequestHandler((_wc, _perm, done) => done(false))
    s.setPermissionCheckHandler(() => false)
    s.on('will-download', (e) => e.preventDefault())
    // Some sites refuse an "Electron" browser name; drop the app tokens, keep Chrome's.
    s.setUserAgent(s.getUserAgent().split(' ').filter((t) => !/^[\w.-]+\/[\d.]+$/.test(t) || /^(Mozilla|AppleWebKit|Chrome|Safari)\//.test(t)).join(' '))
    ses = s
    return s
  }
  const signedIn = async () => {
    if (!st.on) return false
    try {
      return (await theSession().cookies.get({ url: 'https://soundcloud.com', name: 'oauth_token' })).length > 0
    } catch {
      return false
    }
  }

  /** Limits a SoundCloud page (the view or a sign-in window) to where it may go. */
  function guard(wc: Electron.WebContents, isPopup: boolean) {
    // SoundCloud and its CDNs; plus the sign-in pages of Google / Apple / Facebook (SoundCloud's "Continue with…").
    const ok = (url: string) => scWebRoute(url) === 'in' || scWebRoute(url) === 'signin'
    wc.on('will-navigate', (e, url) => {
      if (ok(url)) return
      e.preventDefault()
      external(url)
    })
    wc.on('will-redirect', (e, url) => {
      if (!ok(url)) e.preventDefault()
    })
    wc.setWindowOpenHandler(({ url }) => {
      const r = scWebRoute(url)
      if (r === 'in' && !isPopup) {
        void wc.loadURL(url)
        return { action: 'deny' }
      }
      if (r === 'signin' || (r === 'in' && isPopup)) {
        return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, title: 'Sign in', webPreferences: { partition: SCWEB_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } } }
      }
      external(url)
      return { action: 'deny' }
    })
    wc.on('did-create-window', (child) => {
      child.setMenu(null)
      guard(child.webContents, true)
      // Signed in through Google / Apple: check the cookie once it closes.
      child.on('closed', () => void signedIn().then((v) => set({ signedIn: v })))
    })
  }

  function ensure(): WebContentsView {
    if (view && !view.webContents.isDestroyed()) return view
    const v = new WebContentsView({
      webPreferences: { partition: SCWEB_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webviewTag: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', spellcheck: false }
    })
    theSession()
    v.setBackgroundColor('#121212')
    const wc = v.webContents
    guard(wc, false)
    wc.on('did-finish-load', () => {
      try {
        wc.setZoomFactor(st.zoom)
      } catch {
        /* closing */
      }
      void signedIn().then((s) => set({ signedIn: s }))
      setTimeout(() => void readMixes(), 2500)
    })
    wc.on('render-process-gone', () => drop())
    view = v
    set({ live: true })
    void wc.loadURL(SCWEB_HOME)
    schedule(300)
    return v
  }

  function drop() {
    if (timer) clearTimeout(timer)
    timer = null
    const v = view
    view = null
    if (v) {
      try {
        o.appWindow.contentView.removeChildView(v)
      } catch {
        /* not attached */
      }
      try {
        v.webContents.close()
      } catch {
        /* gone */
      }
    }
    set({ live: false, visible: false, now: NO_NOW })
  }

  const js = async <T>(code: string): Promise<T | null> => {
    const wc = view?.webContents
    if (!wc || wc.isDestroyed() || wc.isLoading()) return null
    try {
      return (await wc.executeJavaScript(code, false)) as T
    } catch {
      return null
    }
  }

  async function readNow() {
    const raw = await js<any>(NOW_JS)
    if (raw) set({ now: mapNowPlaying(raw), at: Date.now() })
    // On the home page (and not too often): the mixes.
    if (raw?.home && Date.now() - mixesAt > 60_000) void readMixes()
  }
  async function readMixes() {
    const raw = await js<unknown>(MIXES_JS)
    if (!raw) return
    mixesAt = Date.now()
    const mixes = cleanMixTiles(raw)
    if (mixes.length && JSON.stringify(mixes) !== JSON.stringify(st.mixes)) {
      set({ mixes })
      save()
    }
  }
  function schedule(ms = scWebPollMs({ playing: st.now.playing, visible: st.visible })) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      timer = null
      if (!view) return
      await readNow()
      if (view) schedule()
    }, ms)
  }

  /** SoundCloud's own button, or its keyboard shortcut if the button isn't found. */
  async function control(op: Op) {
    if (!view) ensure()
    const wc = view!.webContents
    const sel = op === 'next' ? BTN.next : op === 'prev' ? BTN.prev : BTN.toggle
    const only = op === 'play' ? 'paused' : op === 'pause' ? 'playing' : undefined
    const done = await js<boolean>(clickJs(sel, only === 'paused' ? 'paused' : only === 'playing' ? 'playing' : undefined))
    if (!done && (op === 'toggle' || op === 'next' || op === 'prev')) {
      const key = op === 'toggle' ? 'Space' : op === 'next' ? 'Right' : 'Left'
      const modifiers: ('shift')[] = op === 'toggle' ? [] : ['shift']
      wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers })
      wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers })
    }
    setTimeout(() => void readNow(), 400)
    return true
  }

  async function like() {
    const before = (await js<any>(NOW_JS))?.liked ?? null
    const clicked = await js<boolean>(clickJs(BTN.like))
    if (!clicked) return { result: 'unknown' as const }
    await new Promise((r) => setTimeout(r, 700))
    const after = (await js<any>(NOW_JS))?.liked ?? null
    void readNow()
    return { result: likeResult(typeof before === 'boolean' ? before : null, typeof after === 'boolean' ? after : null) }
  }

  async function playMix(url: unknown) {
    const u = mixUrl(url)
    if (!u) return false
    const wc = ensure().webContents
    await wc.loadURL(u).catch(() => {})
    // The page fills in after loading: try the play button a few times.
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 900))
      if (await js<boolean>(PLAY_PAGE_JS)) break
    }
    setTimeout(() => void readNow(), 1200)
    return true
  }

  function show(r: unknown) {
    const b = viewBounds(r)
    if (!b || o.appWindow.isDestroyed()) return false
    const v = ensure()
    const k = o.appWindow.webContents.getZoomFactor() || 1
    if (!o.appWindow.contentView.children.includes(v)) o.appWindow.contentView.addChildView(v)
    v.setBounds({ x: Math.round(b.x * k), y: Math.round(b.y * k), width: Math.round(b.width * k), height: Math.round(b.height * k) })
    if (!st.visible) {
      set({ visible: true })
      schedule(200)
    }
    return true
  }
  function hide() {
    if (view) {
      try {
        o.appWindow.contentView.removeChildView(view)
      } catch {
        /* not attached */
      }
    }
    if (st.visible) set({ visible: false })
  }

  async function signOut() {
    drop()
    const s = theSession()
    await s.clearStorageData().catch(() => {})
    await s.clearCache().catch(() => {})
    await s.clearAuthCache().catch(() => {})
    set({ on: false, signedIn: false, mixes: [] })
    save()
  }

  // Our own pages only (the app window and the island), never a frame inside them.
  const ours = (e: Electron.IpcMainInvokeEvent) => !!BrowserWindow.fromWebContents(e.sender) && e.senderFrame === e.sender.mainFrame && String(e.senderFrame?.url ?? '').startsWith(`${o.origin}/`)
  ipcMain.handle('scweb', async (e, op: string, arg?: any) => {
    if (!ours(e)) return null
    await loaded
    switch (op) {
      case 'status':
        if (st.on && !st.live) set({ signedIn: await signedIn() })
        return st
      case 'signIn':
        set({ on: true })
        save()
        void ensure().webContents.loadURL(SCWEB_SIGNIN)
        return st
      case 'show':
        return st.on ? show(arg) : false
      case 'hide':
        return hide()
      case 'home':
        if (st.on) void ensure().webContents.loadURL(SCWEB_HOME)
        return true
      case 'back':
        if (view?.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack()
        return true
      case 'zoom':
        set({ zoom: cleanZoom(arg) })
        save()
        try {
          view?.webContents.setZoomFactor(st.zoom)
        } catch {
          /* closing */
        }
        return st.zoom
      case 'op':
        return st.on && ['toggle', 'play', 'pause', 'next', 'prev'].includes(arg) ? control(arg as Op) : false
      case 'like':
        return st.on && view ? like() : { result: 'unknown' }
      case 'playMix':
        return st.on ? playMix(arg) : false
      case 'mixes':
        return st.mixes as MixTile[]
      case 'stop':
        drop()
        return true
      case 'signOut':
        await signOut()
        return st
    }
    return null
  })
  o.appWindow.on('closed', () => drop())
  return { drop }
}
