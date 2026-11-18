// What a person does on Today → Now, for the offline steps.
import { open } from './lib.mjs'

const NOW = '[data-testid="three-numbers"]'

export async function openNow(pg) {
  await open(pg, 'today')
  await pg.click('.td2 .ptabs [data-tab="now"]')
  await pg.waitForSelector(NOW, { timeout: 10000 })
}

export async function addMust(pg, text) {
  await pg.fill(`${NOW} .tn-add input`, text)
  await pg.click(`${NOW} .tn-add button`)
  await pg
    .waitForFunction(([sel, t]) => [...document.querySelectorAll(`${sel} .tn-list li`)].some((l) => l.textContent.includes(t)), [NOW, text], { timeout: 8000 })
    .catch(async () => {
      throw new Error(`the must-do "${text}" is not shown; error: ${await pg.locator('.tn-err').allInnerTexts()} toasts: ${await pg.locator('.toasts').allInnerTexts()}`)
    })
}

/** The must-dos shown: "[x] text" / "[ ] text". */
export const musts = (pg) =>
  pg.evaluate((sel) => [...document.querySelectorAll(`${sel} .tn-list li`)].map((l) => (l.classList.contains('done') ? '[x] ' : '[ ] ') + l.querySelector('span')?.textContent), NOW)

export async function logSleep(pg, bed, up) {
  if (!(await pg.locator('[data-testid="tn-sleep-form"]').count())) await pg.click('[data-testid="tn-sleep-open"]')
  await pg.fill('[data-testid="tn-sleep-form"] input[aria-label="Asleep at"]', bed)
  await pg.fill('[data-testid="tn-sleep-form"] input[aria-label="Up at"]', up)
  await pg.click('[data-testid="tn-sleep-form"] button[type="submit"]')
  await pg.waitForFunction((b) => new RegExp(b).test(document.querySelector('[data-testid="tn-sleep-result"]')?.textContent ?? ''), bed, { timeout: 10000 })
}
