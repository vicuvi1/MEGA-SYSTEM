// Countdown: days left until the date in your settings.
const w = window.widget
const style = document.createElement('style')
style.textContent = `
  .cd { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 2px; }
  .cd b { font-size: 30px; line-height: 1; font-variant-numeric: tabular-nums; color: var(--acc, #d4ff3f); }
  .cd span { font-size: 12px; color: var(--sub, #999); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`
document.head.appendChild(style)
const box = document.createElement('div')
box.className = 'cd'
const big = document.createElement('b')
const small = document.createElement('span')
box.append(big, small)
w.root.append(box)

function draw(data) {
  const date = w.config.date
  const label = w.config.label || 'the day'
  if (!date) {
    big.textContent = '—'
    small.textContent = 'Pick a date in Settings'
    return
  }
  const today = new Date(`${data.day}T00:00:00`)
  const target = new Date(`${date}T00:00:00`)
  const days = Math.round((target - today) / 86400000)
  big.textContent = days > 0 ? String(days) : days === 0 ? 'Today' : '✓'
  small.textContent = days > 1 ? `days to ${label}` : days === 1 ? `day to ${label}` : days === 0 ? label : `${label} is done`
}
draw(w.data)
w.on('data', draw)
