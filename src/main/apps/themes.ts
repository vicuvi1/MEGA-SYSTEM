// Life System's look for the apps inside it. Each sheet overrides only the
// app's own color variables, fonts and a few hard-coded glows, and keeps the
// accent of its section in the sidebar: Money gold, Sleep teal, Discipline
// orange. It applies while the app's own theme is the one it had when Life
// System first saw it; pick another theme inside the app and that choice
// wins (html[data-ls] is switched off).
import { FINANCE_PARTITION } from './finance'

const UI = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'
const DISPLAY = '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif'
const ON = 'html[data-ls]'

const SCROLLBARS = `
  ${ON} ::-webkit-scrollbar { width: 10px; height: 10px; }
  ${ON} ::-webkit-scrollbar-track { background: transparent; }
  ${ON} ::-webkit-scrollbar-thumb { background: #2c3446; border-radius: 10px; border: 2px solid transparent; background-clip: padding-box; }
  ${ON} ::-webkit-scrollbar-thumb:hover { background: #3a4358; background-clip: padding-box; }
`

const FINANCE = `
  ${ON}:not([data-design]) {
    --bg: #0b0d12 !important; --surface: #141822 !important; --surface-2: #1a1f2b !important; --surface-3: #222838 !important;
    --side-bg: #0e1118 !important; --line: #242a38 !important; --line-strong: #2c3446 !important;
    --text: #e9ecf3 !important; --muted: #8a93a6 !important; --faint: #5b6376 !important;
    --gold: #f5c84b !important; --gold-soft: rgb(245 200 75 / 12%) !important;
    --btn-bg: #f5c84b !important; --btn-ink: #1d1704 !important; --chart-bar: #5f6b88 !important;
    --income: #4ade80 !important; --income-soft: rgb(74 222 128 / 12%) !important;
    --expense: #ff5d6c !important; --expense-soft: rgb(255 93 108 / 12%) !important;
    --warn: #ff8a3d !important; --warn-soft: rgb(255 138 61 / 12%) !important;
    --info: #7cc4ff !important; --info-soft: rgb(124 196 255 / 12%) !important;
    --c1: #3987e5 !important; --c2: #d95926 !important; --c3: #199e70 !important; --c4: #c98500 !important;
    --c5: #d55181 !important; --c6: #008300 !important; --c7: #9085e9 !important; --c8: #e66767 !important;
    --backdrop: rgb(4 6 10 / 64%) !important; --shadow-pop: 0 20px 60px rgb(0 0 0 / 50%) !important;
    --spot: rgb(245 200 75 / 5%) !important; --ambient: transparent !important;
    --shadow-card: 0 1px 0 rgb(255 255 255 / 3%) inset, 0 10px 30px -18px rgb(0 0 0 / 70%) !important;
    --card-line: #242a38 !important;
    --lift: 0 1px 0 rgb(255 255 255 / 4%) inset, 0 18px 40px -28px rgb(0 0 0 / 75%) !important;
    --font: ${UI} !important; --display: ${DISPLAY} !important;
    --radius: 14px !important; --radius-sm: 10px !important;
    color-scheme: dark !important;
  }
  /* The falling-leaf decorations belong to the paper/ocean looks, not this one. */
  ${ON}:not([data-design]) .atmosphere-particle { display: none !important; }
  ${SCROLLBARS}
`

const WAKY = `
  ${ON}, ${ON} body {
    --bg: #0b0d12 !important; --surface: #141822 !important; --surface-2: #1a1f2b !important;
    --line: #242a38 !important; --text: #e9ecf3 !important; --muted: #8a93a6 !important; --missed: #222838 !important;
    --sun: #6ee7d8 !important; --sun-2: #a7f3e9 !important; --radius: 14px !important;
  }
  ${ON} body {
    font-family: ${UI} !important;
    background: radial-gradient(1200px 520px at 50% -300px, rgb(110 231 216 / 8%) 0%, transparent 70%), #0b0d12 !important;
  }
  /* Life System's header already names the section: keep only Waky's menu, slimmer. */
  ${ON} .topbar { padding: 10px 40px 8px !important; background: rgb(11 13 18 / 86%) !important; box-shadow: 0 0 0 100vmax rgb(11 13 18 / 86%) !important; border-bottom: 1px solid #1a1f2b; }
  ${ON} .topbar .brand, ${ON} .topbar .clock { display: none !important; }
  ${ON} main { padding-top: 22px !important; }
  /* One wallet: coins and rewards live in Life System's top bar and Shop, so
     Waky's own coin card and Rewards tab are hidden inside Life System. */
  ${ON} [data-goto="rewards"], ${ON} .tab[data-view="rewards"], ${ON} .tab[data-tab="rewards"] { display: none !important; }
  ${ON} .stat-card:not([data-goto]):has(+ [data-goto="rewards"]) { grid-column: 1 / -1; }
  /* Waky's orange glows, retinted to Sleep's teal. */
  ${ON} .btn.primary { color: #062421 !important; box-shadow: 0 8px 30px -8px rgb(110 231 216 / 50%) !important; }
  ${ON} body::before {
    background: radial-gradient(40% 60% at 30% 40%, rgb(110 231 216 / 6%), transparent 70%),
                radial-gradient(35% 55% at 75% 30%, rgb(124 196 255 / 4%), transparent 70%) !important;
  }
  ${ON} .hero::after { background: radial-gradient(circle, rgb(110 231 216 / 14%), transparent 65%) !important; }
  ${ON} .milestone-hit { background: rgb(110 231 216 / 8%) !important; border-color: rgb(110 231 216 / 35%) !important; }
  ${ON} .stage.current::before { box-shadow: 0 0 0 5px rgb(110 231 216 / 20%) !important; }
  ${ON} .stage.current .card { border-color: rgb(110 231 216 / 45%) !important; background: linear-gradient(180deg, rgb(110 231 216 / 6%), var(--surface)) !important; }
  ${ON} .stage.current .s-tag { background: rgb(110 231 216 / 14%) !important; }
  ${ON} .balance-card { background: linear-gradient(135deg, rgb(110 231 216 / 8%), var(--surface) 60%) !important; }
  ${ON} .reward.ready { border-color: rgb(110 231 216 / 45%) !important; }
  ${SCROLLBARS}
`

const MAN = `
  ${ON} {
    --bg-dark: #0b0d12 !important; --card-bg: #141822 !important; --card-border: #242a38 !important;
    --text-primary: #e9ecf3 !important; --text-secondary: #c3c9d6 !important; --text-muted: #8a93a6 !important;
    --spartan-gold: #ff8a3d !important; --spartan-bronze: #e07a35 !important;
  }
  ${ON} body {
    font-family: ${UI} !important;
    background-color: #0b0d12 !important;
    overflow-y: auto !important;
    min-height: 100vh !important;
  }
  /* Spacious, full-command desktop layout inside Life System */
  ${ON} .app-container.ls-wide {
    max-width: 1560px !important;
    width: min(96vw, 1560px) !important;
    margin: 0 auto !important;
    display: grid !important;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr) !important;
    column-gap: 36px !important;
    row-gap: 20px !important;
    align-items: start !important;
    padding: 24px 40px 64px !important;
  }
  ${ON} .ls-top {
    grid-column: 1 / -1 !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    margin-bottom: 14px !important;
  }
  ${ON} .ls-top .audio-banner {
    width: min(640px, 100%) !important;
    padding: 10px 22px !important;
    border-radius: 30px !important;
    margin-bottom: 16px !important;
  }
  ${ON} .header {
    margin-top: 6px !important;
    gap: 16px !important;
  }
  ${ON} .header-lambda {
    font-size: 42px !important;
  }
  ${ON} .header-title {
    font-size: 38px !important;
    letter-spacing: 9px !important;
  }
  ${ON} .header-tagline {
    font-size: 13px !important;
    letter-spacing: 2.2px !important;
    margin-top: 4px !important;
    margin-bottom: 22px !important;
  }
  ${ON} .ls-col {
    display: flex !important;
    flex-direction: column !important;
    gap: 16px !important;
    min-width: 0 !important;
  }
  ${ON} .ls-col .streak-card {
    padding: 30px 32px !important;
    border-radius: 20px !important;
    border: 1px solid rgba(255, 138, 61, 0.45) !important;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 138, 61, 0.25) !important;
    margin-bottom: 0 !important;
  }
  ${ON} .streak-label {
    font-size: 13px !important;
    letter-spacing: 2px !important;
  }
  ${ON} .streak-number {
    font-size: 66px !important;
    line-height: 1.05 !important;
    margin: 4px 0 6px !important;
    text-shadow: 0 0 24px rgba(255, 138, 61, 0.45) !important;
  }
  ${ON} .streak-status-badge {
    font-size: 11.5px !important;
    padding: 8px 16px !important;
    border-radius: 20px !important;
  }
  ${ON} #btn-quick-adjust-streak {
    font-size: 12px !important;
    padding: 5px 12px !important;
    border-radius: 6px !important;
  }
  ${ON} .rank-info-row {
    font-size: 15px !important;
    margin-top: 20px !important;
  }
  ${ON} .progress-bar-container {
    height: 13px !important;
    border-radius: 8px !important;
    margin-top: 12px !important;
  }
  ${ON} .victory-status-text {
    font-size: 14.5px !important;
    margin-top: 18px !important;
  }
  ${ON} .btn-victory {
    font-size: 16px !important;
    font-weight: 900 !important;
    padding: 18px 24px !important;
    border-radius: 14px !important;
    letter-spacing: 1px !important;
    margin-bottom: 0 !important;
  }
  ${ON} .btn-oath {
    font-size: 15.5px !important;
    font-weight: 800 !important;
    padding: 18px 24px !important;
    border-radius: 14px !important;
    letter-spacing: 0.8px !important;
    margin-bottom: 0 !important;
  }
  ${ON} .btn-urge {
    font-size: 16px !important;
    font-weight: 900 !important;
    padding: 19px 24px !important;
    border-radius: 14px !important;
    letter-spacing: 1px !important;
    margin-bottom: 0 !important;
  }
  ${ON} .quote-card {
    padding: 24px 28px !important;
    border-radius: 16px !important;
    margin-bottom: 0 !important;
  }
  ${ON} .quote-category {
    font-size: 12px !important;
    letter-spacing: 1.5px !important;
    margin-bottom: 8px !important;
  }
  ${ON} .quote-text {
    font-size: 15.5px !important;
    line-height: 1.65 !important;
    margin-bottom: 8px !important;
  }
  ${ON} .quote-author {
    font-size: 13px !important;
    margin-bottom: 12px !important;
  }
  ${ON} .btn-next-quote {
    font-size: 13px !important;
    font-weight: 800 !important;
  }
  ${ON} #reward-teaser-card,
  ${ON} #empire-teaser-card {
    padding: 20px 24px !important;
    border-radius: 16px !important;
    margin-bottom: 0 !important;
  }
  ${ON} #reward-teaser-title,
  ${ON} #empire-teaser-headline {
    font-size: 15.5px !important;
  }
  ${ON} #reward-teaser-status,
  ${ON} #empire-teaser-sub {
    font-size: 12.5px !important;
    margin-top: 4px !important;
  }
  ${ON} .grid-2 {
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    gap: 14px !important;
    margin-bottom: 0 !important;
  }
  ${ON} .btn-secondary {
    font-size: 13.5px !important;
    font-weight: 700 !important;
    padding: 16px 14px !important;
    min-height: 56px !important;
    border-radius: 14px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
  }
  ${ON} .version-footer {
    margin-top: 14px !important;
    font-size: 11.5px !important;
    color: var(--text-muted) !important;
    text-align: center !important;
  }
  /* Modals enlarged for desktop */
  ${ON} .modal-card {
    max-width: 780px !important;
    border-radius: 20px !important;
  }
  ${ON} #modal-map .modal-card,
  ${ON} #modal-codex .modal-card,
  ${ON} #modal-timeline .modal-card,
  ${ON} #modal-empire .modal-card {
    max-width: 920px !important;
  }
  ${ON} .map-grid {
    grid-template-columns: repeat(10, 1fr) !important;
    gap: 8px !important;
  }
  ${ON} .map-node {
    height: 52px !important;
    font-size: 13px !important;
    border-radius: 10px !important;
  }
  ${ON} .modal-title {
    font-size: 18px !important;
  }
  @media (max-width: 980px) {
    ${ON} .app-container.ls-wide {
      grid-template-columns: 1fr !important;
      padding: 16px !important;
    }
  }
  ${SCROLLBARS}
`

/**
 * MAN is a phone-width page. Inside Life System its sections are moved into
 * a header and two columns (the same elements, so its own code keeps working).
 */
const MAN_LAYOUT = `(() => {
  document.documentElement.setAttribute('data-ls', '')
  const lock = document.getElementById('lock-screen')
  if (lock) lock.remove()
  if (window.sound && typeof window.sound.stopBGM === 'function') {
    window.sound.stopBGM()
    if (typeof window.updateAnthemUI === 'function') window.updateAnthemUI(0)
  }
  const c = document.getElementById('app-container')
  if (!c || c.classList.contains('ls-wide')) return
  const top = document.createElement('div')
  const left = document.createElement('div')
  const right = document.createElement('div')
  top.className = 'ls-top'
  left.className = 'ls-col'
  right.className = 'ls-col'
  const kids = Array.from(c.children)
  const isTop = (el) => el.matches('.audio-banner, .header, .header-tagline')
  const isLeft = (el) => el.matches('.streak-card, #btn-claim-victory, #btn-morning-oath, #btn-open-urge, .quote-card')
  for (const el of kids) {
    if (el.matches('.modal, .modal-overlay, [class*="modal"], script, style')) continue
    if (isTop(el)) top.appendChild(el)
    else if (isLeft(el)) left.appendChild(el)
    else right.appendChild(el)
  }
  c.prepend(top, left, right)
  c.classList.add('ls-wide')
})()`

/**
 * Runs in the app's page: turns html[data-ls] on while the app's own theme
 * attributes still match the ones first seen ("baseline"), off otherwise.
 */
function guard(target: 'html' | 'body', attrs: string[], normalize: Record<string, string> = {}): string {
  return `(() => {
    const K = 'ls-theme-baseline'
    const el = ${target === 'html' ? 'document.documentElement' : 'document.body'}
    if (!el) return
    const attrs = ${JSON.stringify(attrs)}
    const norm = ${JSON.stringify(normalize)}
    const key = () => attrs.map((a) => { const v = el.getAttribute(a) || ''; return norm[v] ?? v }).join('|')
    let base = localStorage.getItem(K)
    const hasCustomDesign = () => Boolean(el.getAttribute('data-design'))
    const sync = () => document.documentElement.toggleAttribute('data-ls', !hasCustomDesign() && (base === null || key() === base))
    sync()
    // The app sets its theme while starting up; take the baseline once it settled.
    if (base === null) setTimeout(() => { base = key(); localStorage.setItem(K, base); sync() }, 1500)
    new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: attrs })
  })()`
}

export interface AppTheme {
  css: string
  script: string
}

/** Look to apply to an embedded app, by its storage partition. */
export function themeFor(partition: string): AppTheme | null {
  if (partition === FINANCE_PARTITION) return { css: FINANCE, script: guard('html', ['data-design', 'data-theme']) }
  if (partition === 'persist:waky') return { css: WAKY, script: guard('body', ['data-theme'], { '': 'dawn' }) }
  if (partition === 'persist:man') return { css: MAN, script: MAN_LAYOUT }
  return null
}

/** Forget the remembered theme so Life System's look applies again. */
export const RESET_THEME_SCRIPT = "localStorage.removeItem('ls-theme-baseline')"
