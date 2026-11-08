// Body → Today's Start button: open Sport Track's own workout mode (its
// "Start workout" button), not a second workout screen. The request waits
// here until Sport Track's page has loaded (EmbedHost runs it there).
let pending = false

export const SPORT_START_EVENT = 'life-sport-start'

/** Asks Sport Track to open workout mode as soon as its page is ready. */
export function requestSportStart(): void {
  pending = true
  try {
    window.dispatchEvent(new CustomEvent(SPORT_START_EVENT))
  } catch {
    /* not in a page */
  }
}

export const sportStartPending = (): boolean => pending
export const clearSportStart = (): void => {
  pending = false
}

/** Runs inside Sport Track: its Today tab, then its own Start workout button. True when it was there. */
export const SPORT_START_CODE = `(() => { const b = document.getElementById('btn-workout-mode'); if (!b) return false; const t = document.querySelector('.st-tab[data-tab="today"]'); if (t) t.click(); b.click(); return true })()`
