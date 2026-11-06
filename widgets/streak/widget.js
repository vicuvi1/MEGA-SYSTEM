// Streak ring: your current streak, filling up to the next milestone.
const w = window.widget
const MILESTONES = [3, 7, 14, 30, 60, 100, 200, 365]
const NS = 'http://www.w3.org/2000/svg'
const style = document.createElement('style')
style.textContent = `
  .sr { flex: 1; display: flex; align-items: center; gap: 10px; }
  .sr svg { width: 54px; height: 54px; flex: none; transform: rotate(-90deg); }
  .sr .bg { stroke: var(--line, #333); }
  .sr .fg { stroke: var(--acc, #d4ff3f); transition: stroke-dashoffset .4s ease; }
  .sr div { display: flex; flex-direction: column; min-width: 0; }
  .sr b { font-size: 22px; line-height: 1; font-variant-numeric: tabular-nums; }
  .sr small { font-size: 11px; color: var(--sub, #999); }`
document.head.appendChild(style)
const box = document.createElement('div')
box.className = 'sr'
const svg = document.createElementNS(NS, 'svg')
svg.setAttribute('viewBox', '0 0 40 40')
const R = 16
const C = 2 * Math.PI * R
const ring = (cls) => {
  const c = document.createElementNS(NS, 'circle')
  c.setAttribute('cx', '20')
  c.setAttribute('cy', '20')
  c.setAttribute('r', String(R))
  c.setAttribute('fill', 'none')
  c.setAttribute('stroke-width', '4')
  c.setAttribute('stroke-linecap', 'round')
  c.setAttribute('class', cls)
  return c
}
const fg = ring('fg')
fg.setAttribute('stroke-dasharray', String(C))
svg.append(ring('bg'), fg)
const text = document.createElement('div')
const days = document.createElement('b')
const sub = document.createElement('small')
text.append(days, sub)
box.append(svg, text)
w.root.append(box)

function draw(data) {
  const st = data && data.today ? data.today.streak : null
  if (!data || !data.today) {
    days.textContent = '—'
    sub.textContent = 'Allow "read" in Settings'
    fg.setAttribute('stroke-dashoffset', String(C))
    return
  }
  const n = st ? st.days : 0
  const next = MILESTONES.find((m) => m > n) || n + 100
  const prev = [...MILESTONES].reverse().find((m) => m <= n) || 0
  const pct = (n - prev) / Math.max(1, next - prev)
  days.textContent = `${n} day${n === 1 ? '' : 's'}`
  sub.textContent = n ? `${next - n} to ${next}` : 'Start today'
  fg.setAttribute('stroke-dashoffset', String(C * (1 - pct)))
}
draw(w.data)
w.on('data', draw)
