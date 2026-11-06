// Meetings on the island (MT1–MT3) and Help me reply (AI17), under the pill.
// - In a call (and not a private meeting): "Caption" starts Windows 11 Live
//   Captions; the newest 1–2 lines show in a strip with a red dot; Stop
//   wipes them, Save keeps them as a Notebook note (after a short notice
//   about recording others, which you can turn off for good); "Tell the
//   others" copies a short consent message.
// - Telegram, WhatsApp, Discord or mail in front: "Help me reply" reads the
//   last message on your tap and shows 3 short replies with Copy and Paste
//   (Paste asks Allow / Deny first and never sends).
// Shown only in the desktop app (window.desktop.meetings).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { consentMessage, SAVE_NOTICE, transcriptNote } from '@core/meetings'
import type { MeetState } from '../../shared/meetings'
import { askMeetHost } from './islandMeetHost'
import { tp } from './islandTap'
import './islandMeet.css'

const NOTICE_KEY = 'ls.meetSaveNoticeOff'
const noticeOff = () => {
  try {
    return localStorage.getItem(NOTICE_KEY) === '1'
  } catch {
    return false
  }
}
const setNoticeOff = () => {
  try {
    localStorage.setItem(NOTICE_KEY, '1')
  } catch {
    /* this time only */
  }
}

type Replies = { phase: 'reading' | 'asking' | 'ready'; app: string; message: string; list: string[]; confirm: number | null }

export function IslandMeet({ inCall, title, near, onLayout, onCaptioning }: { inCall: boolean; title: string | null; near: boolean; onLayout: () => void; /** Captions on or off (the thin Indicator shows a red dot). */ onCaptioning?: (on: boolean) => void }) {
  const meet = window.desktop?.meetings
  const [s, setS] = useState<(MeetState & { private?: boolean }) | null>(null)
  const [priv, setPriv] = useState(false)
  const [notice, setNotice] = useState(false)
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)
  const [rep, setRep] = useState<Replies | null>(null)
  useEffect(() => {
    if (!meet) return
    meet.onState((x) => setS((old) => ({ ...old, ...x })))
  }, [meet])
  // The state (and whether this meeting is private) when the call or its title changes.
  useEffect(() => {
    if (!meet) return
    void meet.status(title).then((x) => {
      if (!x) return
      setS(x)
      setPriv(!!x.private)
    }, () => {})
  }, [meet, inCall, title])
  useEffect(() => {
    if (!said) return
    const t = setTimeout(() => setSaid(''), 4500)
    return () => clearTimeout(t)
  }, [said])
  const captioning = !!s?.captioning
  const captioningRef = useRef(onCaptioning)
  captioningRef.current = onCaptioning
  useEffect(() => {
    captioningRef.current?.(captioning)
  }, [captioning])
  const held = !captioning && (s?.words ?? 0) > 0
  const canCaption = inCall && !!s?.windows && !!s.live && !priv
  // While captions run, the strip shows on its own; Stop / Save wait for the mouse (the resting island stays clean).
  const showCall = !!s && ((captioning && near) || held || (near && inCall && !priv && !!s.windows))
  const showReply = !!s?.replyApp && !captioning && (near || !!rep)
  const shown = !!meet && !!s && (showCall || showReply || !!said || notice)
  const layout = useRef(onLayout)
  layout.current = onLayout
  useLayoutEffect(() => {
    layout.current()
  }, [shown, captioning, held, notice, said, rep, s?.lines.join('|')])
  if (!meet || !s || !shown) return null

  const start = async () => {
    setBusy(true)
    const r = await meet.start(title).catch(() => ({ ok: false, said: 'Did not work' }))
    setBusy(false)
    if (!r.ok) setSaid(r.said)
  }
  const stop = async () => {
    await meet.stop().catch(() => false)
    setNotice(false)
    setSaid('Captions stopped and wiped')
  }
  const tell = () => {
    window.desktop?.islandCopy?.(consentMessage())
    setSaid('Copied: paste it in the call’s chat')
  }
  const save = async (forever = false) => {
    if (forever) setNoticeOff()
    setNotice(false)
    setBusy(true)
    try {
      const t = await meet.transcript()
      if (!t || !t.lines.length) throw new Error('No captions to save yet')
      const n = transcriptNote({ ...t, now: Date.now() })
      const name = await askMeetHost<string>({ op: 'save', title: n.title, body: n.body })
      await meet.stop()
      setSaid(`📓 Saved in Notebook → ${name}`)
    } catch (e) {
      setSaid((e as Error).message || 'Could not save')
    } finally {
      setBusy(false)
    }
  }
  const askSave = () => (noticeOff() ? void save() : setNotice(true))

  const help = async () => {
    setRep({ phase: 'reading', app: s.replyApp ?? '', message: '', list: [], confirm: null })
    const r = await meet.readReply().catch(() => ({ ok: false as const, said: 'Could not read that window' }))
    if (!r.ok) {
      setRep(null)
      return setSaid(r.said)
    }
    setRep({ phase: 'asking', app: r.app, message: r.message, list: [], confirm: null })
    try {
      const list = await askMeetHost<string[]>({ op: 'replies', app: r.app, message: r.message })
      setRep((x) => (x ? { ...x, phase: 'ready', list } : x))
    } catch (e) {
      setRep(null)
      setSaid((e as Error).message || 'No replies')
    }
  }
  const copy = (t: string) => {
    window.desktop?.islandCopy?.(t)
    setSaid('Copied')
  }
  const answerPaste = async (t: string, allow: boolean) => {
    setRep((x) => (x ? { ...x, confirm: null } : x))
    try {
      const line = await askMeetHost<string>({ op: allow ? 'paste' : 'deny', text: t }, 15_000)
      setSaid(line)
      if (allow) setRep(null)
    } catch (e) {
      setSaid((e as Error).message || 'It did not paste')
    }
  }

  return (
    <div className="di-meet" data-hot>
      {showCall && (
        <div className="di-meet-row">
          {captioning ? (
            <>
              <span className="di-meet-live" role="status"><i aria-hidden />{s.starting ? 'Starting…' : 'Captioning'}</span>
              <button {...tp('meet:stop', () => void stop())}>Stop</button>
              <button className="primary" disabled={busy || !s.words} {...tp('meet:save', askSave)}>Save</button>
              <button {...tp('meet:tell', tell)} title="Copy a short message that tells the others you use captions">Tell the others</button>
            </>
          ) : held ? (
            <>
              <span className="di-meet-off">Captions stopped · {s.words} words</span>
              <button className="primary" disabled={busy} {...tp('meet:save', askSave)}>Save</button>
              <button {...tp('meet:discard', () => void stop())}>Discard</button>
            </>
          ) : canCaption ? (
            <>
              <button className="primary di-meet-cc" disabled={busy} {...tp('meet:caption', () => void start())} title="Turn on Windows Live Captions for this call (memory only until you save)">
                <b aria-hidden>CC</b> Caption
              </button>
              <button {...tp('meet:tell', tell)} title="Copy a short message that tells the others you use captions">Tell the others</button>
            </>
          ) : !s.live ? (
            <span className="di-meet-off">Captions need Windows 11 (Live Captions), so they are off on this PC</span>
          ) : null}
        </div>
      )}
      {captioning && (
        <div className="di-meet-strip" aria-live="polite">
          {s.lines.length ? s.lines.map((l, i) => <p key={i} className={i === s.lines.length - 1 ? 'now' : ''}>{l}</p>) : <p className="wait">{s.note || 'Waiting for someone to speak…'}</p>}
        </div>
      )}
      {!captioning && s.note && (held || near) && <div className="di-meet-note">{s.note}</div>}
      {notice && (
        <div className="di-meet-card" role="dialog" aria-label="Before you save">
          <p>{SAVE_NOTICE}</p>
          <div className="di-meet-row">
            <button className="primary" {...tp('meet:saveOk', () => void save())}>Save</button>
            <button {...tp('meet:saveForever', () => void save(true))}>Save, don’t show this again</button>
            <button {...tp('meet:saveNo', () => setNotice(false))}>Cancel</button>
          </div>
        </div>
      )}
      {showReply && !rep && (
        <div className="di-meet-row">
          <button {...tp('meet:reply', () => void help())} title={`Read the last message in ${s.replyApp} and suggest 3 replies (nothing is sent)`}>✍ Help me reply</button>
        </div>
      )}
      {rep && (
        <div className="di-meet-card di-meet-replies">
          <div className="di-meet-head">
            <b>{rep.phase === 'reading' ? `Reading ${rep.app}…` : rep.phase === 'asking' ? 'Writing replies…' : `Replies for ${rep.app}`}</b>
            <button className="x" aria-label="Close" {...tp('meet:repClose', () => setRep(null))}>×</button>
          </div>
          {rep.message && <q>{rep.message.split('\n').pop()}</q>}
          {rep.list.map((r, i) => (
            <div key={i} className="di-meet-reply">
              <span>{r}</span>
              {rep.confirm === i ? (
                <span className="di-meet-ask">
                  Type it into {rep.app}? It won’t send.
                  <button className="primary" {...tp(`meet:allow:${i}`, () => void answerPaste(r, true))}>Allow</button>
                  <button {...tp(`meet:deny:${i}`, () => void answerPaste(r, false))}>Deny</button>
                </span>
              ) : (
                <span className="di-meet-btns">
                  <button {...tp(`meet:copy:${i}`, () => copy(r))}>Copy</button>
                  <button {...tp(`meet:paste:${i}`, () => setRep((x) => (x ? { ...x, confirm: i } : x)))}>Paste</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {said && <div className="di-meet-note" role="status">{said}</div>}
    </div>
  )
}
