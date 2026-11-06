// Quote of the day: one short line a day, from the list below (written for
// this widget; no internet).
const w = window.widget
const LINES = [
  'Small steps every day beat one big step once a month.',
  'Start before you feel ready.',
  'Do the hard thing first; the rest of the day gets easier.',
  'You don’t need more time, you need one clear next step.',
  'Rest is part of the work.',
  'Finish one thing before you open the next.',
  'Ten honest minutes are worth more than an hour of pretending.',
  'Make it easy to start and hard to quit.',
  'A missed day is a lesson; two missed days is a habit. Come back today.',
  'Write it down. A plan you can see is a plan you can keep.',
  'Your future self is watching what you do right now.',
  'Done is a skill. Practise it.',
  'Move a little, drink some water, then decide.',
  'Focus is saying no to good things.',
  'Learn something today that you couldn’t do yesterday.',
  'Show up. The rest comes with time.'
]
const style = document.createElement('style')
style.textContent = `
  .q { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
  .q p { margin: 0; font-size: 13.5px; line-height: 1.35; }
  .q small { color: var(--sub, #999); font-size: 11px; }`
document.head.appendChild(style)
const box = document.createElement('div')
box.className = 'q'
const p = document.createElement('p')
const s = document.createElement('small')
s.textContent = 'Quote of the day'
box.append(p, s)
w.root.append(box)

function draw(data) {
  // The same line all day: the day number picks it.
  const n = Math.floor(new Date(`${data.day}T12:00:00`).getTime() / 86400000)
  p.textContent = `“${LINES[((n % LINES.length) + LINES.length) % LINES.length]}”`
}
draw(w.data)
w.on('data', draw)
