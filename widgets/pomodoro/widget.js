// Pomodoro mini: 25 minutes of work, then 5 of rest. It ticks once a second
// only while it runs, and stops when hidden (the island pauses it).
const w = window.widget
const WORK = 25 * 60
const REST = 5 * 60
let mode = 'work'
let left = WORK
let timer = 0
const style = document.createElement('style')
style.textContent = `
  .pm { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 4px; }
  .pm b { font-size: 24px; line-height: 1; font-variant-numeric: tabular-nums; }
  .pm small { font-size: 11px; color: var(--sub, #999); }
  .pm .row { display: flex; gap: 4px; }
  .pm button { border: 1px solid var(--line, #333); background: transparent; border-radius: 999px; padding: 2px 8px; font-size: 11.5px; transition: transform .12s ease; }
  .pm button:active { transform: scale(.94); }
  .pm button.go { background: var(--acc, #d4ff3f); color: #11140a; border-color: transparent; }`
document.head.appendChild(style)
const box = document.createElement('div')
box.className = 'pm'
const label = document.createElement('small')
const clock = document.createElement('b')
const row = document.createElement('div')
row.className = 'row'
const go = document.createElement('button')
go.className = 'go'
const reset = document.createElement('button')
reset.textContent = '↺'
reset.title = 'Start over'
row.append(go, reset)
box.append(label, clock, row)
w.root.append(box)

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
function draw() {
  label.textContent = mode === 'work' ? 'Focus' : 'Rest'
  clock.textContent = mmss(left)
  go.textContent = timer ? 'Pause' : left === (mode === 'work' ? WORK : REST) ? 'Start' : 'Go on'
}
function stop() {
  clearInterval(timer)
  timer = 0
}
function tick() {
  left -= 1
  if (left > 0) return draw()
  stop()
  w.sound('done')
  if (mode === 'work') {
    mode = 'rest'
    left = REST
    // Asks you first (the island shows Add / No).
    w.addNote('Pomodoro done: 25 min of focus').catch(() => {})
  } else {
    mode = 'work'
    left = WORK
  }
  draw()
}
go.addEventListener('click', () => {
  if (timer) stop()
  else timer = setInterval(tick, 1000)
  draw()
})
reset.addEventListener('click', () => {
  stop()
  mode = 'work'
  left = WORK
  draw()
})
w.on('visible', (on) => { if (!on) stop(); draw() })
draw()
