import { useEffect, useRef, useState } from 'react'
import type { EmbeddedApps } from '@shared/api'
import { life } from './bridge'
import { logShared, sportDay } from './sportTrack'
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
import { addDays, dayKey } from '@core/dates'
import { readSoreness } from './body/useBodyPlus'
import { embedPhoneCss, embedThemeCss, readTokens } from '@core/embedTheme'
import { hostCall, parseBridgeLine, parseBridgeMessage } from '@core/embedBridge'
import { isSoundName } from '@core/sounds'
import { play } from './soundKit'
import { Icon } from './Icon'
import { offerWorkoutNote } from './benPushFeed'
import { openTab } from './PageTabs'
import { clearSportStart, SPORT_START_CODE, SPORT_START_EVENT, sportStartPending } from './sportStart'

export type EmbedKind = 'finance' | 'waky' | 'man' | 'sport'

/**
 * Finance Helper inside Life System: its own layout rules live in its
 * stylesheet (html[data-in-life]); here only Life's colours and font, used
 * by its "Match Life System" look (html[data-look="life"], the default here).
 */
export function financeLifeCss(t: { bg: string; surface: string; surface2: string; border: string; text: string; muted: string; font: string; light: boolean }): string {
  return `:root[data-look="life"] { --bg: ${t.bg}; --surface: ${t.surface}; --surface-2: ${t.surface2}; --surface-3: ${t.surface2}; --line: ${t.border}; --line-strong: ${t.border}; --text: ${t.text}; --muted: ${t.muted}; --side-bg: ${t.surface}; --font: ${t.font}; color-scheme: ${t.light ? 'light' : 'dark'}; }`
}

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
      // SO4: an embedded app's sound plays through the app's one sound kit.
      const snd = parseBridgeMessage(data, e.origin, window.location.origin)
      if (snd?.action === 'SOUND') return embedSound(snd.payload)

      // Sport Track (Iron Pulse)
      if (data.type === 'SPORT_WORKOUT_LOGGED' || (data.type === 'LIFE_SYSTEM_BRIDGE' && data.action === 'SPORT_WORKOUT_LOGGED')) {
        try {
          const name = String(data.workout?.name || data.workout?.title || 'Workout completed').slice(0, 120)
          // logWorkout pays "Workout done" itself (capped); a second award paid twice.
          const r = await life.body.logWorkout({ title: name, items: sportItems(data.workout), note: 'Sport Track' })
          window.dispatchEvent(new CustomEvent('life-body-changed'))
          // LF20: a workout done: your victory clip, if you switched it on.
          window.dispatchEvent(new CustomEvent('life-win', { detail: { kind: 'workout' } }))
          window.dispatchEvent(new CustomEvent('life-wallet-changed'))
          // SP1: Sport Track shows what was really paid (or "already counted today").
          const coins = (await life.rules.list().catch(() => [])).find((x: any) => x.id === 'body.workout_done')?.coins ?? 0
          ;(e.source as Window | null)?.postMessage({ type: 'LIFE_SPORT_RESULT', awarded: !!r.awarded, coins: r.awarded ? coins : 0 }, window.location.origin)
        } catch (err) {
          console.error('[EmbedHost Sport] award error:', err)
        }
      }

      // UX5: a workout finished: Ben's one line about it (the island, or Telegram when you're away).
      if (data.type === 'LIFE_SYSTEM_BRIDGE' && data.action === 'SPORT_SUMMARY') {
        offerWorkoutNote(data.payload)
        return
      }

      // PG4: the Progress tab asks why a move stalled; Ben answers from your protein, sleep and readiness.
      if (data.type === 'LIFE_SYSTEM_BRIDGE' && data.action === 'SPORT_INSIGHT') {
        const ins = await life.coach?.bodyPlus?.insight?.().catch(() => null)
        // The coach card reads protein, sleep and readiness from the same data.
        const bodyData = await life.coach?.bodyPlus?.sportBody?.().catch(() => null)
        ;(e.source as Window | null)?.postMessage({ type: 'LIFE_SPORT_INSIGHT', insight: ins ? { text: ins.text, missing: ins.missing } : null, body: bodyData ?? null }, window.location.origin)
        return
      }

      // Water and reps tapped in Sport Track: rows in the one log (body_log), like
      // every other place; the log's sums come back into Sport Track's copy.
      if (data.type === 'LIFE_SYSTEM_BRIDGE' && data.action === 'SPORT_LOG') {
        const p = data.payload ?? {}
        const changes = (Array.isArray(p.changes) ? p.changes : [])
          .filter((c: any) => c && typeof c.kind === 'string' && /^(water|reps:[\w .-]{1,60})$/.test(c.kind) && Number.isFinite(c.amount) && Math.abs(c.amount) <= 5000)
          .slice(0, 20)
          .map((c: any) => ({ kind: String(c.kind), amount: Math.round(c.amount), id: typeof c.id === 'string' ? `st-${c.id.replace(/[^\w-]/g, '').slice(0, 40)}` : undefined }))
        if (p.day === sportDay() && changes.length) {
          await logShared(changes, 'sport')
          window.dispatchEvent(new CustomEvent('life-water-changed'))
          window.dispatchEvent(new CustomEvent('life-body-changed'))
        }
        return
      }

      // SP4: a planned rest day from Sport Track keeps the workout streak.
      if (data.type === 'LIFE_SYSTEM_BRIDGE' && data.action === 'SPORT_REST') {
        const day = typeof data.payload?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.payload.day) ? data.payload.day : null
        await life.body.setRest?.(day, true).catch(() => null)
        window.dispatchEvent(new CustomEvent('life-body-changed'))
      }

      // Food counter: the protein line on Sport Track's Today was tapped: open Body → Food.
      if (data.type === 'LIFE_SYSTEM_BRIDGE' && data.action === 'SPORT_OPEN_FOOD') {
        openFoodCounter()
        return
      }

      // BD7: you picked Full / Lighter / Short in Sport Track: it wins over the automatic dose today (synced).
      if (data.type === 'LIFE_SYSTEM_BRIDGE' && data.action === 'SPORT_DOSE') {
        const mode = data.payload?.mode
        if (mode === 'full' || mode === 'light' || mode === 'short') {
          await life.coach?.bodyPlus?.setDose(mode, readSoreness(dayKey(new Date()))).catch(() => null)
        }
      }

      // Waky checked you in: the Sleep section logs the wake-up and pays
      // "Up on time" only if it was (once a day, like the desktop).
      if (data.type === 'WAKY_CHECKIN_LOGGED' || (data.type === 'LIFE_SYSTEM_BRIDGE' && data.action === 'WAKY_CHECKIN_LOGGED')) {
        try {
          const time = typeof data.payload?.time === 'string' && /^\d{2}:\d{2}$/.test(data.payload.time) ? data.payload.time : undefined
          const r = await life.sleep.logWake(time)
          window.dispatchEvent(new CustomEvent('life-wallet-changed'))
          window.dispatchEvent(new CustomEvent('life-sleep-changed'))
          // WK17: Ben's morning recap in one line: sleep, streak, the first thing in today's plan.
          void (async () => {
            const st = r.state
            const log = r.log
            const toM = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
            const slept = log.bedTime ? ((toM(log.wakeTime) - toM(log.bedTime) + 1440) % 1440) : 0
            const h = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
            const status = await life.coach?.status?.().catch(() => null)
            const first = status?.move && status.move.kind !== 'ask' ? status.move.title : null
            const body = [`Up at ${log.wakeTime}${log.onTime ? ' · on time' : ''}`, slept >= 120 && slept <= 960 ? `slept ${h(slept)}` : '', st.streak ? `streak ${st.streak} day${st.streak === 1 ? '' : 's'}` : '', first ? `first: ${first}` : ''].filter(Boolean).join(' · ')
            await life.notifications?.add?.({ id: `waky-recap:${log.day}`, at: new Date().toISOString(), kind: 'ben', title: '☀️ Good morning', body, action: { kind: 'page', page: 'coach' } as any }).catch(() => null)
          })()
        } catch (err) {
          console.error('[EmbedHost Waky] wake-up error:', err)
        }
      }

      // Bedtime in Waky: the sleep log gets it (and "in bed on time" once, like logging it here).
      const wakyAct = (name: string) => data.type === name || (data.type === 'LIFE_SYSTEM_BRIDGE' && data.action === name)
      // Waky's wake-up targets are Life System's (WK5): one setting everywhere.
      if (wakyAct('WAKY_TARGETS')) {
        const { weekday, weekend } = data.payload ?? {}
        if (/^\d{2}:\d{2}$/.test(weekday) && /^\d{2}:\d{2}$/.test(weekend)) {
          await life.sleep.setTargets(weekday, weekend).catch(() => null)
          window.dispatchEvent(new CustomEvent('life-sleep-changed'))
        }
      }
      // The mood after check-in is the night's sleep quality (WK13).
      if (wakyAct('WAKY_MOOD')) {
        const { date, quality } = data.payload ?? {}
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && [1, 2, 3, 4, 5].includes(Number(quality))) await life.sleep.setQuality?.(date, Number(quality)).catch(() => null)
      }
      if (wakyAct('WAKY_BED_LOGGED')) {
        const time = typeof data.payload?.time === 'string' && /^\d{2}:\d{2}$/.test(data.payload.time) ? data.payload.time : undefined
        try {
          const r = await life.sleep.logBed(time)
          window.dispatchEvent(new CustomEvent('life-sleep-changed'))
          if (r.awarded) window.dispatchEvent(new CustomEvent('life-wallet-changed'))
        } catch (err) {
          console.error('[EmbedHost Waky] bedtime error:', err)
        }
      }

      // A morning edited or added in Waky's History: Life System's sleep
      // record gets the same time (coins only for today, as in "Fix wake-up").
      if (wakyAct('WAKY_DAY_EDITED')) {
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

      // Finance Helper's "Nothing spent today": the one honest no-spend button (as on Today and
      // the Money page). It pays nothing now; the day is judged once it is over. No undo, no instant points.
      if (data.type === 'LIFE_SYSTEM_BRIDGE' && data.action === 'FINANCE_FREE_DAY') {
        const op = data.payload?.op
        let out: { days: string[]; paid?: number; error?: string } = { days: [] }
        try {
          if (op === 'mark') {
            await life.money.nothingSpent()
            out = { days: (await life.finance?.freeDays()) ?? [] }
          } else out = { days: (await life.finance?.freeDays()) ?? [] }
          if (op === 'mark' || op === 'undo') window.dispatchEvent(new CustomEvent('life-wallet-changed'))
        } catch (err) {
          out = { days: (await life.finance?.freeDays().catch(() => [])) ?? [], error: (err as Error).message }
        }
        ;(e.source as Window | null)?.postMessage({ type: 'LIFE_FINANCE_FREE_DAYS', op, ...out }, window.location.origin)
        return
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
/** A sound an embedded app asked for, by name (SO4): only the app's own sounds. */
function embedSound(p: Record<string, unknown>): void {
  if (isSoundName(p.name)) play(p.name, { step: Math.max(0, Math.min(10, Number(p.step) || 0)) })
}

/** Opens Body (Life System's view, not the tracker) on the Food tab. */
function openFoodCounter() {
  window.dispatchEvent(new CustomEvent('life-open-system', { detail: 'body' }))
  openTab('body', 'food')
}

function AppFrame({ appKey, name, url, partition, visible, soundEnabled }: { appKey: EmbedKind; name: string; url: string; partition: string; visible: boolean; soundEnabled: boolean }) {
  const ref = useRef<WebviewEl | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  // Desktop webview: an app's sounds arrive as console lines (SO4).
  useEffect(() => {
    const el = ref.current as any
    if (isDemo || !el?.addEventListener) return
    const onLine = (e: any) => {
      const m = parseBridgeLine(e.message || '')
      if (m?.action === 'SOUND' && visible) embedSound(m.payload)
      if (m?.action === 'SPORT_OPEN_FOOD' && visible) openFoodCounter()
    }
    el.addEventListener('console-message', onLine)
    return () => el.removeEventListener('console-message', onLine)
  }, [visible])

  // Telegram or another device changed Sport Track's (or Finance Helper's)
  // data: reload it, or it would save its older copy over the change.
  useEffect(() => {
    const event = ({ sport: 'life-sport-changed', finance: 'life-finance-changed', waky: 'life-waky-changed', man: 'life-man-changed' } as Record<string, string>)[appKey] ?? null
    if (!event) return
    const onChange = (ev?: Event) => {
      const el = ref.current as any
      // A sync write, or the log's sums echoed back, from this very page: the iframe is same-origin and already
      // listens for the 'storage' event, so it picks the new copy up in place. Reloading here threw away the
      // open workout screen in the middle of a set.
      if (((ev as CustomEvent | undefined)?.detail?.fromSync || (ev as CustomEvent | undefined)?.detail?.echo) && typeof el?.reload !== 'function' && el?.contentWindow) return
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
    if (appKey !== 'sport' && appKey !== 'waky' && appKey !== 'man' && appKey !== 'finance') return
    const el = ref.current as any
    if (!el) return
    let on = true
    let lastKey: string | null = null
    life.app.prefs().then((p) => (on = p.matchAppThemes !== false)).catch(() => {})
    const apply = () => {
      // Finance Helper keeps its own look; on a phone inside Life System its
      // robot buddy and calculator button go (they covered the numbers: U3).
      // Colours follow "match app themes"; the phone layouts always apply (U6).
      const root = document.documentElement
      const cs = getComputedStyle(root)
      const light = root.dataset.theme === 'light' || (root.dataset.theme !== 'dark' && window.matchMedia?.('(prefers-color-scheme: light)').matches)
      const base = appKey === 'finance' ? (on ? financeLifeCss(readTokens((n) => cs.getPropertyValue(n), !!light)) : '') : `${on ? embedThemeCss(appKey, readTokens((n) => cs.getPropertyValue(n), !!light)) : ''}${embedPhoneCss(appKey)}`
      // A drop-down's list is drawn by the system: solid, readable colours (it came out white with faint text on Windows).
      const css = `${base}\nselect option, select optgroup { background-color: ${light ? '#ffffff' : '#151a24'} !important; color: ${light ? '#151922' : '#f1f5f9'} !important; }\nselect option:disabled { color: ${light ? '#5b6475' : '#8b9bb4'} !important; }`
      // MO2: Finance Helper's "Match Life System" look (its default here)
      // follows Life's light / dark, live. Its own themes stay optional picks.
      if (appKey === 'finance') {
        const mode = light ? 'light' : 'dark'
        void runIn(el, `(() => { const r = document.documentElement; r.dataset.inLife = '1'; r.dataset.lifeMode = '${mode}'; window.dispatchEvent(new Event('life-theme')); })()`).catch(() => null)
      }
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

  // Body → Today's Start: Sport Track's own workout mode opens once its page is ready.
  useEffect(() => {
    if (appKey !== 'sport') return
    const el = ref.current as any
    if (!el) return
    const tryStart = async () => {
      if (!sportStartPending()) return
      const ok = await runIn(el, SPORT_START_CODE).catch(() => false)
      if (ok) clearSportStart()
    }
    void tryStart()
    const ev = typeof el.insertCSS === 'function' ? 'dom-ready' : 'load'
    el.addEventListener(ev, tryStart)
    window.addEventListener(SPORT_START_EVENT, tryStart)
    return () => {
      el.removeEventListener(ev, tryStart)
      window.removeEventListener(SPORT_START_EVENT, tryStart)
    }
  }, [appKey])

  // SP4 + SP11: Sport Track gets your rest days and last night's sleep (localStorage 'life_body').
  useEffect(() => {
    if (appKey !== 'sport') return
    const el = ref.current as any
    if (!el) return
    let gone = false
    const push = async () => {
      try {
        const [body, sleep] = await Promise.all([life.body.state(), life.sleep.state().catch(() => null)])
        const t = sleep?.todayLog
        const toM = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5))
        const slept = t?.bedTime && t.wakeTime ? (toM(t.wakeTime) - toM(t.bedTime) + 1440) % 1440 : null
        // BD7: today's dose (Full / Lighter 70% / Short 50%) and whether progression holds after a short night.
        const ready = await life.coach?.bodyPlus?.ready(readSoreness(dayKey(new Date())), t?.quality ?? null).catch(() => null)
        // Food counter: one line on Sport Track's Today ("Protein 92 / 150 g today · trained: +30 g").
        const food = await life.coach?.food?.view().then((v) => ({ day: v.today, line: v.sport })).catch(() => null)
        const data = JSON.stringify({ food: food ?? null, restDays: (body as any).restDays ?? [], sleptMin: slept && slept >= 120 && slept <= 960 ? slept : null, ready: ready ? { day: dayKey(new Date()), mode: ready.mode, hold: ready.hold, auto: ready.auto, line: ready.line } : null, at: Date.now() })
        if (gone) return
        try {
          localStorage.setItem('life_body', data)
        } catch {
          /* private window */
        }
        void runIn(el, `localStorage.setItem('life_body', ${JSON.stringify(data)})`).catch(() => null)
      } catch {
        /* not unlocked yet */
      }
    }
    void push()
    const ev = typeof el.insertCSS === 'function' ? 'dom-ready' : 'load'
    el.addEventListener(ev, push)
    window.addEventListener('life-body-changed', push)
    window.addEventListener('life-sleep-changed', push)
    return () => {
      gone = true
      el.removeEventListener(ev, push)
      window.removeEventListener('life-body-changed', push)
      window.removeEventListener('life-sleep-changed', push)
    }
  }, [appKey])

  // One wallet (Waky inside Life System): your points, what a wake-up and a
  // bedtime really pay, and your next reward go into Waky's page, which then
  // shows them instead of its own coins (public/apps/waky/life-points.js).
  useEffect(() => {
    if (appKey !== 'waky') return
    const el = ref.current as any
    if (!el) return
    let gone = false
    const push = async () => {
      try {
        const [sum, rules, shop] = await Promise.all([life.wallet.summary(), life.rules.list().catch(() => []), life.shop.state().catch(() => null)])
        const pts = (id: string, d: number) => rules.find((r) => r.id === id && r.enabled !== false)?.coins ?? d
        const next = ((shop as any)?.rewards ?? []).filter((r: any) => !r.archived && r.price > sum.balance).sort((a: any, b: any) => a.price - b.price)[0]
        const data = JSON.stringify({ balance: sum.balance, wake: pts('sleep.up_on_time', 2), bed: pts('sleep.bed_on_time', 2), goal: next ? { title: String(next.title), price: Number(next.price) } : null, at: Date.now() })
        if (gone) return
        // Same site (website): one storage, ready before Waky's first read.
        try {
          localStorage.setItem('life_points', data)
        } catch {
          /* private window */
        }
        // The desktop app keeps Waky's storage apart: write it there too.
        void runIn(el, `localStorage.setItem('life_points', ${JSON.stringify(data)}); window.dispatchEvent(new Event('life-points'))`).catch(() => null)
        // WK2: one sleep record: your real log and targets, which Waky shows instead of its own copy.
        const [st, logs] = await Promise.all([life.sleep.state(), life.sleep.logs?.().catch(() => null) ?? Promise.resolve(null)])
        const sleep = JSON.stringify({
          today: st.today,
          weekday: st.weekdayTarget,
          weekend: st.weekendTarget,
          bedTarget: st.bedTarget ?? null,
          logs: (logs ?? st.recentLogs).map((l) => ({ day: l.day, wakeTime: l.wakeTime, wakeTarget: l.wakeTarget, bedTime: l.bedTime, bedTarget: l.bedTarget, bedOnTime: l.bedOnTime, quality: l.quality })),
          at: Date.now()
        })
        if (gone) return
        try {
          localStorage.setItem('life_sleep', sleep)
        } catch {
          /* private window */
        }
        void runIn(el, `localStorage.setItem('life_sleep', ${JSON.stringify(sleep)}); window.dispatchEvent(new Event('life-points'))`).catch(() => null)
      } catch {
        /* not unlocked yet: the next wallet change tries again */
      }
    }
    void push()
    const ev = typeof el.insertCSS === 'function' ? 'dom-ready' : 'load'
    el.addEventListener(ev, push)
    window.addEventListener('life-wallet-changed', push)
    window.addEventListener('life-sleep-changed', push)
    return () => {
      gone = true
      el.removeEventListener(ev, push)
      window.removeEventListener('life-wallet-changed', push)
      window.removeEventListener('life-sleep-changed', push)
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
          runIn(el, hostCall({ action: 'checkin', today: d.today, streak: manDay(d) })).catch(() => {})
        }
        if (d.oathToday) {
          runIn(el, hostCall({ action: 'oath', today: d.today })).catch(() => {})
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
          data = await runIn(el, hostCall({ action: 'state' })).catch(() => null)
        }
        if (!data) return

        // 1. If MAN is checked in today, but Life System is not
        // BG4: only while today itself can be checked in (from 19:00). In the
        // morning the check-in is for yesterday, and MAN's tap is about today.
        if (data.lastCheckin === today && !d.checkedInToday && !d.resetToday && (d.checkIn?.mode ?? 'today') === 'today') {
          if (!d.setup) {
            const streak = Number(data.streakDays) || 1
            const startDay = streak > 1 ? addDays(today, -streak + 1) : today
            await life.discipline.setStart(startDay)
          }
          await life.discipline.checkIn()
          window.dispatchEvent(new CustomEvent('life-discipline-synced', { detail: { action: 'checkin', ...data } }))
        } else if (d.checkedInToday && data.lastCheckin !== today) {
          // 2. If Life System is checked in today, but MAN is not
          await runIn(el, hostCall({ action: 'checkin', today, streak: manDay(d) })).catch(() => {})
        }

        // Oath reconciliation
        if (data.lastOathDate === today && !d.oathToday) {
          await life.discipline.oath()
          window.dispatchEvent(new CustomEvent('life-discipline-synced', { detail: { action: 'oath' } }))
        } else if (d.oathToday && data.lastOathDate !== today) {
          await runIn(el, hostCall({ action: 'oath', today })).catch(() => {})
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
          if (!cur.checkedInToday && !cur.resetToday && (cur.checkIn?.mode ?? 'today') === 'today') {
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
          // MN4: the streak can't be set to any day. Only a first setup takes a
          // start date; after that the count comes from your check-ins and resets.
          if (d.setup) return
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

    // Desktop webview: MAN's typed messages arrive as console lines.
    const onConsole = (e: any) => {
      const m = parseBridgeLine(e.message || '')
      if (m && m.action.startsWith('MAN_')) handleManAction(m.action, m.payload)
    }

    const onWindowMessage = (e: MessageEvent) => {
      // Typed, and only from our own embedded apps (core/embedBridge.ts).
      const m = parseBridgeMessage(e.data, e.origin, window.location.origin)
      if (m && m.action.startsWith('MAN_')) handleManAction(m.action, m.payload)
    }

    // Life System's streak is the only one: MAN always shows it (also before
    // today's check-in), so MAN, Today, Ben and Telegram say the same Day N.
    const pushStreak = async () => {
      try {
        const d = await life.discipline.state()
        if (!d.setup) return
        const n = manDay(d)
        await runIn(el, hostCall({ action: 'set-streak', streak: n })).catch(() => {})
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
        // MAN posts its check-ins and oaths as typed messages now (no console patching).
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
