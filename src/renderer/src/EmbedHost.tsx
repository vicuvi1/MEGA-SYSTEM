import { useEffect, useRef, useState } from 'react'
import type { EmbeddedApps } from '@shared/api'
import { life } from './bridge'
import { sportItems } from '@core/sportBridge'
import { dayNumber } from '@core/discipline'

// The apps load in a normal same-origin <iframe> (website and this desktop app);
// only the old desktop (window.life) had Electron's <webview> switched on.
// (Using <webview> anywhere else leaves the app blank.)
const isDemo = !window.life

/** MAN inside Life System: a readable column (no full-width buttons on big
 *  screens), no audio banner or version footer (Life System has its own). */
const MAN_FIT_CSS = `
  .app-container { max-width: 1080px !important; margin: 0 auto !important; padding-top: 12px !important; }
  .audio-banner, .version-footer { display: none !important; }
`
import { addDays } from '@core/dates'
import { embedThemeCss, readTokens } from '@core/embedTheme'
import { Icon } from './Icon'

export type EmbedKind = 'finance' | 'waky' | 'man' | 'sport'

export const EMBED_LABEL: Record<EmbedKind, string> = { finance: 'Finance Helper', waky: 'Waky', man: 'MAN', sport: 'Sport Track' }

/**
 * Keeps each app open once visited (hidden when not shown), so switching
 * sections doesn't reload it or lose what you were typing.
 */
export function EmbedHost({ active, soundEnabled = true }: { active: EmbedKind | null; soundEnabled?: boolean }) {
  const [info, setInfo] = useState<EmbeddedApps | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [visited, setVisited] = useState<EmbedKind[]>([])
  const [waky, setWaky] = useState<{ ok: boolean; error: string | null } | null>(isDemo ? { ok: true, error: null } : null)

  useEffect(() => {
    life.apps.info().then(setInfo, (e) => setError((e as Error).message))
  }, [])

  // Cross-app economy bridge: credit main character wallet for sport workouts, sleep wakeups, and finance logs
  useEffect(() => {
    const onWindowMessage = async (e: MessageEvent) => {
      const data = e.data
      if (!data || typeof data !== 'object') return
      // Only our own embedded apps (same origin) may log things here.
      if (e.origin !== window.location.origin) return

      // Sport Track (Iron Pulse)
      if (data.type === 'SPORT_WORKOUT_LOGGED' || (data.type === 'LIFE_SYSTEM_BRIDGE' && data.action === 'SPORT_WORKOUT_LOGGED')) {
        try {
          const name = String(data.workout?.name || data.workout?.title || 'Workout completed').slice(0, 120)
          // logWorkout pays "Workout done" itself (capped); a second award paid twice.
          await life.body.logWorkout({ title: name, items: sportItems(data.workout), note: 'Sport Track' })
          window.dispatchEvent(new CustomEvent('life-body-changed'))
          window.dispatchEvent(new CustomEvent('life-wallet-changed'))
        } catch (err) {
          console.error('[EmbedHost Sport] award error:', err)
        }
      }

      // Waky checked you in: the Sleep section logs the wake-up and pays
      // "Up on time" only if it was (once a day, like the desktop).
      if (data.type === 'WAKY_CHECKIN_LOGGED' || (data.type === 'LIFE_SYSTEM_BRIDGE' && data.action === 'WAKY_CHECKIN_LOGGED')) {
        try {
          const time = typeof data.payload?.time === 'string' && /^\d{2}:\d{2}$/.test(data.payload.time) ? data.payload.time : undefined
          await life.sleep.logWake(time)
          window.dispatchEvent(new CustomEvent('life-wallet-changed'))
        } catch (err) {
          console.error('[EmbedHost Waky] wake-up error:', err)
        }
      }

      // A morning edited or added in Waky's History: Life System's sleep
      // record gets the same time (coins only for today, as in "Fix wake-up").
      if (data.type === 'WAKY_DAY_EDITED') {
        const { date, time } = data.payload ?? {}
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time)) {
          try {
            const r = await life.sleep.setWake(date, time)
            if (r.awarded) window.dispatchEvent(new CustomEvent('life-wallet-changed'))
          } catch {
            /* older than 14 days: Waky keeps it, Life's record stays */
          }
        }
      }

      // Finance Helper saved: pay "Spending logged" for days with records,
      // through the connection sync (the same refs on PC and web, never twice).
      if (data.type === 'FINANCE_TRANSACTION_LOGGED' || (data.type === 'LIFE_SYSTEM_BRIDGE' && data.action === 'FINANCE_TRANSACTION_LOGGED')) {
        try {
          const r = await life.connections.sync()
          if (r.awarded) window.dispatchEvent(new CustomEvent('life-wallet-changed'))
        } catch (err) {
          console.error('[EmbedHost Finance] sync error:', err)
        }
      }

      // MAN's check-in, reset and diary are handled once, by its frame below
      // (which checks "already checked in today"); handling them here too paid twice.
    }

    window.addEventListener('message', onWindowMessage)
    return () => window.removeEventListener('message', onWindowMessage)
  }, [])

  useEffect(() => {
    if (active && !visited.includes(active)) setVisited((v) => [...v, active])
    if (active === 'waky' && !waky?.ok) life.apps.startWaky().then(setWaky)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  if (!active && !visited.length) return null

  if (error || !info) {
    return (
      <div className={`embed-host ${active ? 'on' : ''}`}>
        <div className="embed-msg">
          <Icon name="link" size={28} />
          <p>{error ?? 'Opening…'}</p>
        </div>
      </div>
    )
  }

  const src: Record<EmbedKind, { url: string; partition: string }> = { finance: info.finance, man: info.man, waky: info.waky, sport: info.sport }
  return (
    <div className={`embed-host ${active ? 'on' : ''}`}>
      {visited.map((k) => {
        if (k === 'waky' && !waky?.ok) {
          return (
            <div key={k} className="embed-msg" style={{ display: active === k ? undefined : 'none' }}>
              <Icon name="moon" size={28} />
              <p>{waky?.error ?? 'Starting Waky…'}</p>
              {waky?.error && (
                <button className="btn small" onClick={() => life.apps.startWaky().then(setWaky)}>
                  Try again
                </button>
              )}
            </div>
          )
        }
        return <AppFrame key={k} appKey={k} name={EMBED_LABEL[k]} url={src[k].url} partition={src[k].partition} visible={active === k} soundEnabled={soundEnabled} />
      })}
    </div>
  )
}

/**
 * Runs a line of code inside an embedded app: the desktop's <webview> has
 * executeJavaScript; on the web the app is a same-origin <iframe>.
 */
function runIn(el: any, code: string): Promise<any> {
  try {
    if (typeof el?.executeJavaScript === 'function') return el.executeJavaScript(code)
    const win = el?.contentWindow as (Window & { eval(c: string): any }) | null
    if (win) return Promise.resolve(win.eval(code))
  } catch (e) {
    return Promise.reject(e)
  }
  return Promise.resolve(null)
}

type WebviewEl = HTMLElement & { reload(): void; loadURL(url: string): Promise<void> }

/**
 * One app's page. If it fails to load (e.g. Waky's server is down) or its
 * page crashes, a card says so with a button to try again.
 */
function AppFrame({ appKey, name, url, partition, visible, soundEnabled }: { appKey: EmbedKind; name: string; url: string; partition: string; visible: boolean; soundEnabled: boolean }) {
  const ref = useRef<WebviewEl | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  // Telegram or another device changed Sport Track's (or Finance Helper's)
  // data: reload it, or it would save its older copy over the change.
  useEffect(() => {
    const event = ({ sport: 'life-sport-changed', finance: 'life-finance-changed', waky: 'life-waky-changed', man: 'life-man-changed' } as Record<string, string>)[appKey] ?? null
    if (!event) return
    const onChange = () => {
      const el = ref.current as any
      try {
        if (typeof el?.reload === 'function') el.reload()
        else el?.contentWindow?.location.reload()
      } catch {
        /* not loaded yet: it reads the new data when it opens */
      }
    }
    window.addEventListener(event, onChange)
    return () => window.removeEventListener(event, onChange)
  }, [appKey])

  // The same look (C8): Life System's colours and font inside Sport Track,
  // Waky and MAN, light or dark like the app, and a phone layout for MAN.
  // Settings → "Match the apps to Life System's look" turns it off.
  useEffect(() => {
    if (appKey !== 'sport' && appKey !== 'waky' && appKey !== 'man') return
    const el = ref.current as any
    if (!el) return
    let on = true
    let lastKey: string | null = null
    life.app.prefs().then((p) => (on = p.matchAppThemes !== false)).catch(() => {})
    const apply = () => {
      if (!on) return
      const root = document.documentElement
      const cs = getComputedStyle(root)
      const light = root.dataset.theme === 'light' || (root.dataset.theme !== 'dark' && window.matchMedia?.('(prefers-color-scheme: light)').matches)
      const css = embedThemeCss(appKey, readTokens((n) => cs.getPropertyValue(n), !!light))
      try {
        if (typeof el.insertCSS === 'function') {
          // Desktop webview: replace the previous sheet.
          if (lastKey && typeof el.removeInsertedCSS === 'function') void el.removeInsertedCSS(lastKey).catch(() => {})
          void el.insertCSS(css).then((k: string) => (lastKey = k)).catch(() => {})
        } else {
          const doc: Document | undefined = el.contentDocument
          if (!doc?.head) return
          let st = doc.getElementById('life-theme') as HTMLStyleElement | null
          if (!st) {
            st = doc.createElement('style')
            st.id = 'life-theme'
            doc.head.appendChild(st)
          }
          st.textContent = css
        }
      } catch {
        /* another origin or not loaded yet */
      }
    }
    const ev = typeof el.insertCSS === 'function' ? 'dom-ready' : 'load'
    el.addEventListener(ev, apply)
    const mo = new MutationObserver(apply)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-design', 'class'] })
    return () => {
      el.removeEventListener(ev, apply)
      mo.disconnect()
    }
  }, [appKey])

  // Bi-directional synchronization for MAN Spartan Discipline app
  useEffect(() => {
    if (appKey !== 'man') return
    const el = ref.current as any
    if (!el) return

    // MAN counts check-ins: the start day is Day 1 (a reset day is Day 0).
    // Life System counts whole days since the start, one less until the
    // first reset. Sending Life's number set MAN back a day ("Day 2" became
    // "Day 1" again).
    const manDay = (d: { current: number; resets: number; day?: number }) => d.day ?? dayNumber(d)

    const syncToMan = async () => {
      try {
        const d = await life.discipline.state()
        if (d.checkedInToday) {
          runIn(el, `window.syncFromLifeSystemCheckin?.(${JSON.stringify(d.today)}, ${manDay(d)})`).catch(() => {})
        }
        if (d.oathToday) {
          runIn(el, `window.syncFromLifeSystemOath?.(${JSON.stringify(d.today)})`).catch(() => {})
        }
        void pushStreak()
      } catch (err) {
        console.error('[EmbedHost MAN] syncToMan error:', err)
      }
    }

    const reconcile = async (manData?: any) => {
      try {
        const d = await life.discipline.state()
        const today = d.today
        let data = manData
        if (!data) {
          data = await runIn(el, 'window.getManCheckinState ? window.getManCheckinState() : null').catch(() => null)
        }
        if (!data) return

        // 1. If MAN is checked in today, but Life System is not
        if (data.lastCheckin === today && !d.checkedInToday && !d.resetToday) {
          if (!d.setup) {
            const streak = Number(data.streakDays) || 1
            const startDay = streak > 1 ? addDays(today, -streak + 1) : today
            await life.discipline.setStart(startDay)
          }
          await life.discipline.checkIn()
          window.dispatchEvent(new CustomEvent('life-discipline-synced', { detail: { action: 'checkin', ...data } }))
        } else if (d.checkedInToday && data.lastCheckin !== today) {
          // 2. If Life System is checked in today, but MAN is not
          await runIn(el, `window.syncFromLifeSystemCheckin?.(${JSON.stringify(today)}, ${manDay(d)})`).catch(() => {})
        }

        // Oath reconciliation
        if (data.lastOathDate === today && !d.oathToday) {
          await life.discipline.oath()
          window.dispatchEvent(new CustomEvent('life-discipline-synced', { detail: { action: 'oath' } }))
        } else if (d.oathToday && data.lastOathDate !== today) {
          await runIn(el, `window.syncFromLifeSystemOath?.(${JSON.stringify(today)})`).catch(() => {})
        }
      } catch (err) {
        console.error('[EmbedHost MAN] Reconcile error:', err)
      }
    }

    const handleManAction = async (action: string, payload: any) => {
      try {
        if (action === 'MAN_CHECKIN') {
          const d = await life.discipline.state()
          if (!d.setup) {
            const streak = Number(payload?.streakDays) || 1
            const startDay = streak > 1 ? addDays(d.today, -streak + 1) : d.today
            await life.discipline.setStart(startDay)
          }
          const cur = await life.discipline.state()
          if (!cur.checkedInToday && !cur.resetToday) {
            await life.discipline.checkIn()
            window.dispatchEvent(new CustomEvent('life-discipline-synced', { detail: { action: 'checkin', ...payload } }))
          }
        } else if (action === 'MAN_OATH') {
          const d = await life.discipline.state()
          if (!d.oathToday) {
            await life.discipline.oath()
            window.dispatchEvent(new CustomEvent('life-discipline-synced', { detail: { action: 'oath' } }))
          }
        } else if (action === 'MAN_RESET') {
          await life.discipline.reset()
          window.dispatchEvent(new CustomEvent('life-discipline-synced', { detail: { action: 'reset', ...payload } }))
          window.dispatchEvent(new Event('life-discipline-reset-done'))
        } else if (action === 'MAN_SET_STREAK') {
          const streak = Math.max(0, Number(payload?.streakDays) || 0)
          const d = await life.discipline.state()
          const startDay = streak > 0 ? addDays(d.today, -streak + 1) : d.today
          await life.discipline.setStart(startDay)
          window.dispatchEvent(new CustomEvent('life-discipline-synced', { detail: { action: 'set_streak', streak } }))
        } else if (action === 'MAN_DIARY') {
          // A diary entry pays nothing: it used to take the clean-day reward,
          // which then blocked that day's real check-in.
          window.dispatchEvent(new CustomEvent('life-discipline-synced', { detail: { action: 'diary', ...payload } }))
        } else if (action === 'MAN_INIT') {
          reconcile(payload)
        }
      } catch (err) {
        console.error('[EmbedHost MAN] handleManAction error:', err)
      }
    }

    const onConsole = (e: any) => {
      const msg: string = e.message || ''
      if (!msg.startsWith('LIFE_SYSTEM_BRIDGE:')) return

      if (msg.startsWith('LIFE_SYSTEM_BRIDGE:MAN_CHECKIN:')) {
        try {
          const payload = JSON.parse(msg.slice('LIFE_SYSTEM_BRIDGE:MAN_CHECKIN:'.length))
          handleManAction('MAN_CHECKIN', payload)
        } catch (err) {
          console.error('[EmbedHost MAN] Error parsing checkin:', err)
        }
      } else if (msg.startsWith('LIFE_SYSTEM_BRIDGE:MAN_OATH:')) {
        handleManAction('MAN_OATH', {})
      } else if (msg.startsWith('LIFE_SYSTEM_BRIDGE:MAN_RESET:')) {
        try {
          const payload = JSON.parse(msg.slice('LIFE_SYSTEM_BRIDGE:MAN_RESET:'.length))
          handleManAction('MAN_RESET', payload)
        } catch {
          handleManAction('MAN_RESET', {})
        }
      } else if (msg.startsWith('LIFE_SYSTEM_BRIDGE:MAN_SET_STREAK:')) {
        try {
          const payload = JSON.parse(msg.slice('LIFE_SYSTEM_BRIDGE:MAN_SET_STREAK:'.length))
          handleManAction('MAN_SET_STREAK', payload)
        } catch {}
      } else if (msg.startsWith('LIFE_SYSTEM_BRIDGE:MAN_DIARY:')) {
        try {
          const payload = JSON.parse(msg.slice('LIFE_SYSTEM_BRIDGE:MAN_DIARY:'.length))
          handleManAction('MAN_DIARY', payload)
        } catch {}
      } else if (msg.startsWith('LIFE_SYSTEM_BRIDGE:MAN_INIT:')) {
        try {
          const payload = JSON.parse(msg.slice('LIFE_SYSTEM_BRIDGE:MAN_INIT:'.length))
          handleManAction('MAN_INIT', payload)
        } catch (err) {
          console.error('[EmbedHost MAN] Error parsing init:', err)
        }
      }
    }

    const onWindowMessage = (e: MessageEvent) => {
      const data = e.data
      if (!data || typeof data !== 'object') return
      if (data.type === 'LIFE_SYSTEM_BRIDGE') {
        handleManAction(data.action, data.payload)
      }
    }

    // Life System's streak is the only one: MAN always shows it (also before
    // today's check-in), so MAN, Today, Ben and Telegram say the same Day N.
    const pushStreak = async () => {
      try {
        const d = await life.discipline.state()
        if (!d.setup) return
        const n = manDay(d)
        await runIn(el, `(function(){ if (typeof appData === 'undefined') return; var n = ${n}; if (appData.streakDays !== n) { appData.streakDays = n; appData.longestStreak = Math.max(appData.longestStreak || 0, n); try { saveData(); refreshUI(); } catch (e) {} } })()`).catch(() => {})
      } catch {
        /* not loaded yet */
      }
    }

    // In a normal frame (website, this desktop) MAN's "LIFE_SYSTEM_BRIDGE:…" lines
    // only went to its own console, so its check-ins and oaths never reached
    // Life System. Hear them again, and give MAN Life System's look and width.
    const hookFrame = () => {
      const w = (el as HTMLIFrameElement).contentWindow as (Window & { console: Console }) | null
      // Per page, not per window: the frame's window object survives navigation.
      const d0 = w?.document
      if (!w || !d0 || d0.URL === 'about:blank' || d0.documentElement.hasAttribute('data-life-hooked')) return
      try {
        d0.documentElement.setAttribute('data-life-hooked', '')
        const log = w.console.log.bind(w.console)
        w.console.log = (...args: unknown[]) => {
          log(...args)
          if (typeof args[0] === 'string' && args[0].startsWith('LIFE_SYSTEM_BRIDGE:')) onConsole({ message: args[0] })
        }
        const doc = w.document
        // MAN's urge crusher: counted in Life System too (time + what set it off).
        doc.getElementById('btn-open-urge')?.addEventListener('click', () => void life.discipline.startUrge().catch(() => {}))
        doc.getElementById('btn-conquer-urge')?.addEventListener('click', () => {
          life.discipline
            .finishUrge()
            .then(() => window.dispatchEvent(new Event('life-urge-won')))
            .catch(() => void life.discipline.cancelUrge().catch(() => {}))
        })
        if (!doc.getElementById('life-fit')) {
          const st = doc.createElement('style')
          st.id = 'life-fit'
          st.textContent = MAN_FIT_CSS
          doc.head.appendChild(st)
        }
      } catch {
        /* another origin: nothing to do */
      }
    }

    const onDomReady = () => {
      if (isDemo) hookFrame()
      reconcile().then(pushStreak)
    }

    if (isDemo) {
      el.addEventListener('load', onDomReady)
    } else {
      el.addEventListener('console-message', onConsole)
      el.addEventListener('dom-ready', onDomReady)
    }
    window.addEventListener('message', onWindowMessage)
    window.addEventListener('life-discipline-state', syncToMan)
    window.addEventListener('life-discipline-changed', syncToMan)

    if (isDemo && (el as HTMLIFrameElement).contentDocument?.readyState === 'complete') onDomReady()
    else if (visible) {
      reconcile()
    }

    return () => {
      if (isDemo) {
        el.removeEventListener('load', onDomReady)
      } else {
        el.removeEventListener('console-message', onConsole)
        el.removeEventListener('dom-ready', onDomReady)
      }
      window.removeEventListener('message', onWindowMessage)
      window.removeEventListener('life-discipline-state', syncToMan)
      window.removeEventListener('life-discipline-changed', syncToMan)
    }
  }, [appKey, visible])

  useEffect(() => {
    const el = ref.current as any
    if (!el) return
    const shouldMute = !visible || !soundEnabled
    if (typeof el.setAudioMuted === 'function') {
      try { el.setAudioMuted(shouldMute) } catch {}
    }
    if (shouldMute) {
      try {
        runIn(el, `
          if (typeof window !== 'undefined') {
            if (window.sound && typeof window.sound.stopBGM === 'function') {
              window.sound.stopBGM();
              if (typeof window.updateAnthemUI === 'function') window.updateAnthemUI(0);
            }
            if (window.sound && window.sound.ctx && window.sound.ctx.state === 'running') {
              window.sound.ctx.suspend().catch(() => {});
            }
            if (window.AmbientMusic && typeof window.AmbientMusic.pause === 'function') {
              window.AmbientMusic.pause();
            }
          }
        `).catch(() => {})
      } catch {}
    }
  }, [visible, soundEnabled])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (isDemo) {
      const handleLoad = () => setProblem(null)
      const handleError = () => setProblem(`${name} failed to load.`)
      el.addEventListener('load', handleLoad)
      el.addEventListener('error', handleError)
      return () => {
        el.removeEventListener('load', handleLoad)
        el.removeEventListener('error', handleError)
      }
    }

    const failed = (e: Event) => {
      const ev = e as Event & { errorCode: number; errorDescription: string; isMainFrame: boolean }
      // -3 is "aborted": a normal navigation inside the app, not a failure.
      if (!ev.isMainFrame || ev.errorCode === -3) return
      setProblem(`${name} didn't load (${ev.errorDescription || ev.errorCode}).`)
      life.app.reportError(`${name} failed to load: ${ev.errorDescription} (${ev.errorCode})`).catch(() => {})
    }
    const gone = (e: Event) => {
      const reason = (e as Event & { details?: { reason?: string } }).details?.reason ?? 'crashed'
      setProblem(`${name} stopped (${reason}).`)
    }
    const loaded = () => {
      setProblem(null)
      const el = ref.current as any
      if (el) {
        const shouldMute = !visible || !soundEnabled
        if (typeof el.setAudioMuted === 'function') {
          try { el.setAudioMuted(shouldMute) } catch {}
        }
        if (shouldMute) {
          try {
            runIn(el, `
              if (typeof window !== 'undefined') {
                if (window.sound && typeof window.sound.stopBGM === 'function') {
                  window.sound.stopBGM();
                  if (typeof window.updateAnthemUI === 'function') window.updateAnthemUI(0);
                }
                if (window.sound && window.sound.ctx && window.sound.ctx.state === 'running') {
                  window.sound.ctx.suspend().catch(() => {});
                }
                if (window.AmbientMusic && typeof window.AmbientMusic.pause === 'function') {
                  window.AmbientMusic.pause();
                }
              }
            `).catch(() => {})
          } catch {}
        }
      }
    }
    el.addEventListener('did-fail-load', failed)
    el.addEventListener('render-process-gone', gone)
    el.addEventListener('did-finish-load', loaded)
    return () => {
      el.removeEventListener('did-fail-load', failed)
      el.removeEventListener('render-process-gone', gone)
      el.removeEventListener('did-finish-load', loaded)
    }
  }, [name, visible, soundEnabled])

  return (
    <>
      {isDemo ? (
        <iframe
          ref={ref as any}
          className="embed"
          src={url}
          title={name}
          style={{
            display: visible && !problem ? 'block' : 'none',
            width: '100%',
            height: '100%',
            border: 'none',
            background: '#07080b'
          }}
        />
      ) : (
        <webview
          ref={ref as never}
          className="embed"
          src={url}
          partition={partition}
          style={{ display: visible && !problem ? undefined : 'none' }}
        />
      )}
      {visible && problem && (
        <div className="embed-msg">
          <Icon name="bolt" size={28} />
          <p>{problem}</p>
          <p className="hint">Your data in it is safe. Try again, and if it keeps happening, the log in Settings has the details.</p>
          <button
            className="btn primary small"
            onClick={() => {
              setProblem(null)
              const el = ref.current as any
              if (el) {
                if (isDemo && el.src) {
                  el.src = url
                } else if (el.loadURL) {
                  el.loadURL(url).catch(() => el.reload())
                }
              }
            }}
          >
            Try again
          </button>
        </div>
      )}
    </>
  )
}
