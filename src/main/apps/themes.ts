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
  ${ON} {
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
  ${ON} .atmosphere-particle { display: none !important; }
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
  ${ON} body { font-family: ${UI} !important; background-color: #0b0d12 !important; }
  ${SCROLLBARS}
`

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
    const sync = () => document.documentElement.toggleAttribute('data-ls', base === null || key() === base)
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
  if (partition === 'persist:man') return { css: MAN, script: "document.documentElement.setAttribute('data-ls', '')" }
  return null
}

/** Forget the remembered theme so Life System's look applies again. */
export const RESET_THEME_SCRIPT = "localStorage.removeItem('ls-theme-baseline')"
