// Meetings on the desktop island (MT1–MT3) and "Help me reply" (AI17), the
// desktop side. One IPC channel ("meet") and one event to the island page
// ("meet:state").
//
// - Caption: only in a call, only on Windows 11 (Live Captions), never for a
//   private meeting. The watcher (captionWatch.ts) runs only while you
//   caption; it is killed on Stop, about 20 s after the call ends, on quit
//   and on the release check's quick exit ('life-exit-now').
// - The captions live here, in memory only (at most 2 hours). Stop wipes
//   them. When the call ends they wait 10 minutes for Save, then go.
// - Help me reply: reads only on your tap, through the eyes' gate.
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { deniedBy, denyRegex, type EyesPrefs } from '../../core/eyesGuard'
import { callApp, captionStep, captionWordCount, liveLines, meetingPrivate, newCaptions, type CaptionState } from '../../core/meetings'
import { lastMessage, mayReply, replyApp, textForAi, type ReplyApp } from '../../core/replyHelper'
import type { MeetRead, MeetState, MeetTranscript } from '../../shared/meetings'
import { hasLiveCaptions, startCaptionWatch, type WatchLine } from './captionWatch'
import { readForReply } from './replyRead'

/** The call has to be gone this long before captions stop (a mic can flicker off). */
const CALL_GONE_MS = 20_000
/** Captions wait this long for Save after the call ended. */
const HOLD_MS = 10 * 60_000
/** Live Captions must show up within this time. */
const OPEN_MS = 25_000
/** Live Captions closed for this long: captioning stops. */
const CLOSED_MS = 6000

export interface MeetingsHandle {
  /** The program in front changed (and its title, when the PC sensor's titles are on). */
  noteFg(proc: string, title: string | null): void
}

export function createMeetings(o: { origin: string; inCall: () => boolean; eyesPrefs: () => EyesPrefs }): MeetingsHandle {
  const live = hasLiveCaptions()
  let caps: CaptionState | null = null
  let meta: { title: string | null; app: string | null } = { title: null, app: null }
  let stopWatch: (() => void) | null = null
  let starting = false
  let seenText = false
  let noWinSince = 0
  let callGoneSince = 0
  let note = ''
  let timer: NodeJS.Timeout | null = null
  let holdTimer: NodeJS.Timeout | null = null
  let fg = { proc: '', title: null as string | null }
  let replyNow: ReplyApp | null = null
  let lastReplyAt = 0

  const own = (e: IpcMainInvokeEvent) => {
    const url = e.senderFrame?.url ?? ''
    return url.startsWith(o.origin + '/') && !url.startsWith(o.origin + '/apps/')
  }
  const islandPages = () =>
    BrowserWindow.getAllWindows().filter((w) => {
      if (w.isDestroyed()) return false
      const u = w.webContents.getURL()
      return u.startsWith(o.origin + '/') && /[?&]island=1/.test(u) && !/[?&]dock=1/.test(u)
    })
  const state = (): MeetState => ({
    windows: process.platform === 'win32',
    live,
    inCall: o.inCall(),
    captioning: !!stopWatch,
    starting: !!stopWatch && starting,
    lines: caps ? liveLines(caps.lines) : [],
    words: caps ? captionWordCount(caps.lines) : 0,
    startedAt: caps?.startedAt ?? 0,
    note,
    replyApp: replyNow
  })
  let lastSent = ''
  const broadcast = () => {
    const s = state()
    const k = JSON.stringify(s)
    if (k === lastSent) return
    lastSent = k
    for (const w of islandPages()) w.webContents.send('meet:state', s)
  }

  const killWatch = () => {
    const s = stopWatch
    stopWatch = null
    if (timer) clearInterval(timer)
    timer = null
    starting = false
    try {
      s?.()
    } catch {
      /* already gone */
    }
  }
  const wipe = () => {
    caps = null
    meta = { title: null, app: null }
    if (holdTimer) clearTimeout(holdTimer)
    holdTimer = null
  }
  /** Stop: the watcher goes and the captions are wiped. */
  const stop = (why = '') => {
    killWatch()
    wipe()
    note = why
    broadcast()
  }
  /** The call or Live Captions ended: the watcher goes, the captions wait 10 minutes for Save. */
  const end = (why: string) => {
    killWatch()
    note = why
    if (!caps || !caps.lines.length) wipe()
    else {
      if (holdTimer) clearTimeout(holdTimer)
      holdTimer = setTimeout(() => stop(''), HOLD_MS)
    }
    broadcast()
  }

  const onLine = (l: WatchLine) => {
    if (!stopWatch || !caps) return
    const now = Date.now()
    if (l.s === 'noexe') return end('Live Captions could not open on this PC')
    if (l.s === 'launched') note = 'Opening Live Captions…'
    else if (l.s === 'found') {
      starting = false
      note = ''
    } else if (l.s === 'nowin') {
      if (seenText && !noWinSince) noWinSince = now
    } else if (l.s === 'ok') {
      seenText = true
      starting = false
      noWinSince = 0
      note = ''
      caps = captionStep(caps, l.t, now).state
    }
    broadcast()
  }
  const check = () => {
    if (!stopWatch || !caps) return
    const now = Date.now()
    if (o.inCall()) callGoneSince = 0
    else if (!callGoneSince) callGoneSince = now
    else if (now - callGoneSince > CALL_GONE_MS) return end('The call ended, so captions stopped')
    if (noWinSince && now - noWinSince > CLOSED_MS) return end('Live Captions was closed, so captions stopped')
    if (!seenText && starting && now - caps.startedAt > OPEN_MS) return end("Live Captions didn't show up. Try Win+Ctrl+L, then Caption again.")
    broadcast()
  }

  const start = (title: string | null): { ok: boolean; said: string } => {
    if (process.platform !== 'win32') return { ok: false, said: 'Captions work in the Windows app only' }
    if (!live) return { ok: false, said: 'Live Captions needs Windows 11, so captions are not available on this PC' }
    if (!o.inCall()) return { ok: false, said: 'Captions are for calls: no call is on' }
    if (meetingPrivate(title, o.eyesPrefs().deny)) return { ok: false, said: 'This meeting looks private, so it is never captioned' }
    if (stopWatch) return { ok: true, said: 'Already captioning' }
    wipe()
    caps = newCaptions(Date.now())
    meta = { title: title ? title.slice(0, 120) : null, app: callApp(fg.proc) }
    starting = true
    seenText = false
    noWinSince = 0
    callGoneSince = 0
    note = 'Starting Live Captions…'
    stopWatch = startCaptionWatch(onLine, () => {
      if (stopWatch) end('Captions stopped')
    })
    timer = setInterval(check, 3000)
    broadcast()
    return { ok: true, said: 'Captioning' }
  }

  const readReply = async (): Promise<MeetRead> => {
    if (process.platform !== 'win32') return { ok: false, said: 'Help me reply works in the Windows app only' }
    const appName = replyApp(fg.proc, fg.title)
    if (!appName) return { ok: false, said: 'Open Telegram, WhatsApp, Discord or your mail first' }
    const prefs = o.eyesPrefs()
    const now = Date.now()
    const c = mayReply({ prefs, lastAt: lastReplyAt, now, proc: fg.proc, app: appName, title: fg.title })
    if (!c.ok) return c
    lastReplyAt = now
    const r = await readForReply(denyRegex(prefs.deny)).catch(() => null)
    if (!r) return { ok: false, said: 'Nothing to read in that window' }
    const got = replyApp(r.proc, r.title) ?? (r.proc === fg.proc ? appName : null)
    if (r.denied || deniedBy({ proc: r.proc, app: got ?? appName, title: r.title }, prefs.deny)) return { ok: false, said: `${got ?? appName} is on your private list (Settings → Island eyes)` }
    if (!got) return { ok: false, said: 'The window in front is not a chat or mail' }
    const msg = textForAi(r.from === 'selection' ? r.text : lastMessage(r.text))
    if (!msg) return { ok: false, said: 'That looked private (a password, code or card), so nothing was sent' }
    return { ok: true, app: got, message: msg, from: r.from }
  }

  ipcMain.handle('meet', async (e, op: unknown, arg: unknown) => {
    if (!own(e)) return null
    const title = typeof arg === 'string' ? arg.slice(0, 200) : null
    if (op === 'status') return { ...state(), private: meetingPrivate(title, o.eyesPrefs().deny) }
    if (op === 'start') return start(title)
    if (op === 'stop') return (stop(''), true)
    if (op === 'transcript') return caps && caps.lines.length ? ({ title: meta.title, app: meta.app, startedAt: caps.startedAt, lines: caps.lines.map((l) => ({ at: l.at, words: l.words.slice() })) } satisfies MeetTranscript) : null
    if (op === 'readReply') return readReply()
    return null
  })

  // Never left running: quit, and the release check's quick exit (app.exit skips will-quit).
  app.on('will-quit', () => killWatch())
  ;(app as unknown as NodeJS.EventEmitter).on('life-exit-now', () => killWatch())

  return {
    noteFg(proc, title) {
      const p = String(proc ?? '')
      if (p !== fg.proc) fg = { proc: p, title: title ?? null }
      else if (title != null) fg = { proc: p, title }
      const r = replyApp(fg.proc, fg.title)
      if (r !== replyNow) {
        replyNow = r
        broadcast()
      }
    }
  }
}
