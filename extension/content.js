// During a focus timer, a site on your list shows "after the block" instead.
// "Open anyway" works after 10 seconds (your call, always).
(function () {
  const host = location.hostname.toLowerCase().replace(/^www\./, '')
  const blocked = (sites) => sites.some((s) => host === s || host.endsWith('.' + s))
  const show = (st) => {
    if (document.getElementById('ls-focus-wall')) return
    const left = Math.max(1, Math.round((st.endsAt - Date.now()) / 60000))
    const wall = document.createElement('div')
    wall.id = 'ls-focus-wall'
    wall.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#0d0f12;color:#eef0ea;font:16px/1.5 system-ui,sans-serif;text-align:center')
    const box = document.createElement('div')
    const h = document.createElement('div')
    h.textContent = '🎯 After the block'
    h.setAttribute('style', 'font-size:28px;font-weight:800;margin-bottom:8px')
    const p = document.createElement('div')
    p.textContent = `Focus: ${st.subject || 'your block'} · ${left} min left. Ben says: this can wait.`
    const b = document.createElement('button')
    b.textContent = 'Open anyway (10)'
    b.disabled = true
    b.setAttribute('style', 'margin-top:18px;padding:8px 16px;border-radius:999px;border:1px solid #444;background:transparent;color:#9aa1ab;cursor:pointer')
    let n = 10
    const t = setInterval(() => {
      n--
      b.textContent = n > 0 ? `Open anyway (${n})` : 'Open anyway'
      if (n <= 0) {
        clearInterval(t)
        b.disabled = false
      }
    }, 1000)
    b.onclick = () => wall.remove()
    box.append(h, p, b)
    wall.append(box)
    ;(document.body || document.documentElement).append(wall)
  }
  const check = () =>
    chrome.runtime.sendMessage({ kind: 'focus?' }, (st) => {
      if (chrome.runtime.lastError || !st) return
      if (st.on && blocked(st.sites || [])) show(st)
      else document.getElementById('ls-focus-wall')?.remove()
    })
  check()
  setInterval(check, 30000)
})()
