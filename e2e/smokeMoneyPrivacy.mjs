// Money privacy smoke step (called from e2e/smoke.mjs): every amount is hidden until Space.
// Made-up data only. No page reload: the Finance frame is opened, not reloaded, and the
// step ends with amounts shown again so later steps read real numbers.
// The rest of the smoke run starts with amounts shown (smoke.mjs init script); to check
// the real "hidden when the app opens" default run: SMOKE_PRIVACY_FRESH=1 SMOKE_ONLY="Money privacy".
// MONEY_PRIVACY_SHOTS=<dir> saves 1920-wide screenshots of the hidden and the shown Money page.

export async function moneyPrivacySteps({ step, pg, open, financeFrame }) {
  const shots = process.env.MONEY_PRIVACY_SHOTS
  const fresh = process.env.SMOKE_PRIVACY_FRESH === '1'
  const hasDigit = (t) => /\d/.test(t)
  // Text of every element that holds an amount on the Life Money page.
  const hubAmounts = () => pg.evaluate(() => [...document.querySelectorAll('.mh-big .num, .mh-amt, .mh-sub b, .mh-donut .num, .mh-forecast-line b')].map((e) => e.textContent || ''))
  const frameAmounts = (frame) => frame.evaluate(() => [...document.querySelectorAll('#app [data-count], #app .amount, #app .fig, #app .sh-fig')].map((e) => e.textContent || ''))
  const blur = () => pg.evaluate(() => document.activeElement && document.activeElement !== document.body && document.activeElement.blur())
  // Space on the Life shell: waits until the hub shows (or hides) its digits.
  const press = async (key = 'Space') => { await blur(); await pg.keyboard.press(key) }

  await step('Money privacy: amounts start hidden; Space shows them all, Space hides them; typing a space in a box is left alone', async () => {
    await pg.setViewportSize({ width: 1440, height: 900 })
    await open('money')
    // After the earlier Money steps Life's hub can be empty (no synced data yet); then only the
    // Finance Helper part runs here (the hub part is checked whenever the hub has its numbers).
    const hubOK = await pg.waitForSelector('.mh-hero .mh-big', { timeout: 8000 }).then(() => true).catch(() => false)
    if (hubOK) {
      const wasShown = (await hubAmounts()).some(hasDigit)
      if (fresh && wasShown) throw new Error('amounts are visible on a fresh open (they should start hidden)')
      if (wasShown) {
        await press()
        await pg.waitForFunction(() => ![...document.querySelectorAll('.mh-big .num')].some((e) => /\d/.test(e.textContent || '')), null, { timeout: 5000 })
      }
      // Hidden: no digit in any amount, the currency and the layout stay.
      const hidden = await hubAmounts()
      if (!hidden.length) throw new Error('no amount elements on the Money page')
      if (hidden.some(hasDigit)) throw new Error(`a digit is visible while hidden: ${hidden.filter(hasDigit).join(' | ')}`.slice(0, 300))
      if (!(await pg.locator('.mh-big small').first().innerText())) throw new Error('the currency vanished')
      if (shots) await pg.screenshot({ path: `${shots}/money-privacy-hidden.png` })

      // Space types a space in the quick add box and does not toggle.
      await pg.click('.mh-quick input')
      await pg.keyboard.type('a b')
      if ((await pg.inputValue('.mh-quick input')) !== 'a b') throw new Error('Space did not type a space in the quick add box')
      if ((await hubAmounts()).some(hasDigit)) throw new Error('Space in a box showed the amounts')
      await pg.fill('.mh-quick input', '')

      // Space shows every amount.
      await press()
      await pg.waitForFunction(() => /\d/.test(document.querySelector('.mh-big .num')?.textContent || ''), null, { timeout: 5000 })
      if (shots) await pg.screenshot({ path: `${shots}/money-privacy-shown.png` })

    }

    // Finance Helper follows the same state: open it, it starts shown; Space hides it; Life follows.
    await pg.waitForFunction(() => !!document.querySelector('.mh-open') || [...document.querySelectorAll('iframe')].some((e) => e.offsetParent), null, { timeout: 15000 })
    if (await pg.$('.mh-open')) await pg.click('.mh-open')
    let frame = null
    for (const end = Date.now() + 20000; !frame; ) {
      await pg.waitForTimeout(600)
      frame = await financeFrame().catch((e) => { if (Date.now() > end) throw e; return null })
    }
    await frame.evaluate(() => { location.hash = '#home' })
    await frame.waitForSelector('#app [data-count], #app .amount, #app .fig, #app .sh-fig', { timeout: 20000 })
    if (!(await frameAmounts(frame)).some(hasDigit)) throw new Error('Finance Helper joined the hidden state although Life shows amounts')
    await frame.evaluate(() => { location.hash = '#home' })
    await frame.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {})
    await frame.evaluate(() => document.activeElement?.blur?.())
    await pg.keyboard.press('Space')
    await frame.waitForFunction(() => document.body.classList.contains('money-hidden'), null, { timeout: 5000 })
    const fh = await frameAmounts(frame)
    if (fh.some(hasDigit)) throw new Error(`a digit is visible in Finance Helper while hidden: ${fh.filter(hasDigit).join(' | ')}`.slice(0, 300))
    if (!/Show amounts/.test((await frame.locator('[data-testid="privacy-eye"]').getAttribute('title')) || '')) throw new Error('the eye button does not say "Show amounts (Space)"')
    // Space in a Finance box types a space (the search box).
    await frame.evaluate(() => { location.hash = '#log' })
    await frame.waitForSelector('#search', { timeout: 8000 })
    await frame.click('#search')
    await pg.keyboard.type('x y')
    if ((await frame.inputValue('#search')) !== 'x y') throw new Error('Space did not type in the Finance search box')
    await frame.fill('#search', '')
    await frame.evaluate(() => { location.hash = '#home' })
    // Space again shows.
    await frame.evaluate(() => document.activeElement?.blur?.())
    await pg.keyboard.press('Space')
    await frame.waitForFunction(() => !document.body.classList.contains('money-hidden'), null, { timeout: 5000 })
    const shownFh = await frameAmounts(frame)
    if (!shownFh.some(hasDigit)) throw new Error('Space did not show the amounts in Finance Helper')
    // Leave Money (a reload that lands on the hub would put a quick add box under the PIN helper).
    await open('today')
    await pg.waitForSelector('.td2', { timeout: 10000 })
  })
}
