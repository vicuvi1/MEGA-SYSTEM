// Asks the Life System desktop app (on this PC only) whether a focus timer
// runs and which sites to keep away. Nothing goes online.
const PORT = 47321
let state = { on: false, subject: '', endsAt: 0, sites: [] }

async function poll() {
  const { token } = await chrome.storage.local.get('token')
  if (!token) return (state = { on: false, subject: '', endsAt: 0, sites: [] })
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/focus?token=${encodeURIComponent(token)}`)
    state = r.ok ? await r.json() : { on: false, subject: '', endsAt: 0, sites: [] }
  } catch {
    // Life System isn't running: nothing is blocked.
    state = { on: false, subject: '', endsAt: 0, sites: [] }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.kind !== 'focus?') return
  poll().then(() => reply(state))
  return true
})
chrome.alarms?.create?.('poll', { periodInMinutes: 0.5 })
chrome.alarms?.onAlarm?.addListener(() => void poll())
