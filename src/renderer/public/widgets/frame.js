// The runtime inside a widget's box (PL1). It waits for the island's hello
// (with a private message port and the widget's code, already checked
// against its pinned hash), then runs the code and gives it `widget`:
//
//   widget.root                  the element to draw in
//   widget.data                  the latest read-only data ({ now, day, today? })
//   widget.config                your settings for this widget
//   widget.manifest              its manifest
//   widget.on('data', fn)        fresh data (at the widget's refresh rate, never while hidden)
//   widget.on('visible', fn)     shown / hidden
//   await widget.fetch(url)      { status, type, body } (only hosts you allowed)
//   await widget.addTask(text)   asks you first; rejects when you say no
//   await widget.addNote(text)   the same, into Notebook → Inbox
//   widget.sound('done' | 'tick' | 'chime')
//
// Everything goes over the port; the island checks every call.
;(() => {
  'use strict'
  const root = document.getElementById('w')
  // A few ways out that the page's policy can't close: gone before any widget code runs.
  for (const k of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'open', 'showModalDialog', 'print']) {
    try { Object.defineProperty(window, k, { value: undefined, writable: false, configurable: false }) } catch (e) { /* fine */ }
  }
  let port = null
  let started = false
  let seq = 0
  let busy = 0
  const waits = new Map()
  const subs = { data: [], visible: [] }
  const emit = (k, v) => subs[k].forEach((f) => { try { f(v) } catch (e) { report(e) } })
  const report = (e) => port && port.postMessage({ t: 'error', text: String((e && e.message) || e).slice(0, 160) })
  const call = (c) => new Promise((ok, no) => {
    if (!port) return no(new Error('Not ready'))
    const id = ++seq
    waits.set(id, { ok, no })
    port.postMessage({ t: 'call', id, call: c })
  })
  let data = null
  let config = Object.freeze({})
  let manifest = Object.freeze({})
  const api = {
    root,
    get data() { return data },
    get config() { return config },
    get manifest() { return manifest },
    on(k, fn) { if (subs[k] && typeof fn === 'function') subs[k].push(fn) },
    fetch: (url) => call({ op: 'fetch', url: String(url) }),
    addTask: (text) => call({ op: 'addTask', text: String(text) }),
    addNote: (text) => call({ op: 'addNote', text: String(text) }),
    sound: (name) => call({ op: 'sound', name: String(name) }).catch(() => false)
  }
  // How long this page was busy (long tasks), for the island's speed budget.
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) busy += e.duration }).observe({ type: 'longtask', buffered: false })
  } catch (e) { /* not supported: the island's pings still watch */ }
  const onHost = (e) => {
    const m = e.data
    if (!m || typeof m !== 'object') return
    if (m.t === 'ping') {
      port.postMessage({ t: 'pong', n: m.n })
      if (busy) port.postMessage({ t: 'busy', ms: Math.round(busy) })
      busy = 0
    } else if (m.t === 'data') {
      data = m.data
      emit('data', m.data)
    } else if (m.t === 'reply') {
      const w = waits.get(m.id)
      if (!w) return
      waits.delete(m.id)
      m.ok ? w.ok(m.value) : w.no(new Error(String(m.error || 'Refused')))
    } else if (m.t === 'visible') {
      document.documentElement.classList.toggle('paused', !m.on)
      emit('visible', !!m.on)
    }
  }
  window.addEventListener('error', (e) => report(e.error || e.message))
  window.addEventListener('unhandledrejection', (e) => report(e.reason))
  window.addEventListener('message', (e) => {
    const m = e.data
    if (started || e.source !== window.parent || !m || m.t !== 'hello' || !e.ports || !e.ports[0] || typeof m.code !== 'string') return
    started = true
    port = e.ports[0]
    port.onmessage = onHost
    data = m.data || null
    config = Object.freeze(Object.assign({}, m.config || {}))
    manifest = Object.freeze(Object.assign({}, m.manifest || {}))
    const vars = m.theme && typeof m.theme === 'object' ? m.theme : {}
    for (const k of ['fg', 'sub', 'acc', 'line', 'bg']) if (typeof vars[k] === 'string' && /^[#a-z0-9(),.\s%/-]{1,60}$/i.test(vars[k])) document.documentElement.style.setProperty(`--${k}`, vars[k])
    Object.defineProperty(window, 'widget', { value: Object.freeze(api), writable: false, configurable: false })
    const url = URL.createObjectURL(new Blob([m.code], { type: 'text/javascript' }))
    const s = document.createElement('script')
    s.src = url
    s.onload = () => { URL.revokeObjectURL(url); port.postMessage({ t: 'ready' }) }
    s.onerror = () => { URL.revokeObjectURL(url); report('The widget could not start') }
    document.body.appendChild(s)
  })
})()
