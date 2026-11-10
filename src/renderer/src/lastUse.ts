// When you last touched this page (a tap, a key, coming back to the window). Started as soon as the app loads,
// so a card that appears later (the day plan at midnight) does not count as you using the page.
let at = Date.now()
// Noted just after the event, so a listener that asks "was I away?" on the same tap still sees the old time.
const touch = () => void setTimeout(() => (at = Date.now()), 0)
if (typeof window !== 'undefined') {
  for (const e of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(e, touch, { passive: true, capture: true })
  // The window coming to the front (not a field inside it getting focus).
  window.addEventListener('focus', touch)
}

/** Milliseconds since you last touched the page. */
export const idleFor = (): number => Date.now() - at
