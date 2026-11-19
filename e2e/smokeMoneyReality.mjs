// Money reality check smoke step (called from e2e/smoke.mjs): the Home card opens the full Reality check
// window; a made-up bot record dated in the future is in "Check these" and "It's right" clears it; a real
// balance that differs shows the causes and then ONE adjustment that is neither income nor spending, kept in
// the history; "Matches" on the next row; hidden amounts keep the boxes usable; Ctrl+Z undoes; the window has
// no sideways scroll. Made-up data only (seeded, then one reload); this device's Finance Helper state is put back at the end (then the
// one reload). A screenshot of the window goes to REALITY_SHOTS when it is set.

const KEY = 'finance-helper.state'

export async function moneyRealitySteps({ step, pg, open, financeFrame }) {
  await step('Money reality check: window, causes, one honest adjustment, Matches, Check these, hidden amounts, Undo', async () => {
    await pg.setViewportSize({ width: 1440, height: 900 })
    await open('money')
    await pg.waitForFunction(() => !!document.querySelector('.mh-open') || [...document.querySelectorAll('iframe')].some((e) => e.offsetParent), null, { timeout: 20000 })
    if (await pg.$('.mh-open')) await pg.click('.mh-open')
    let frame = null
    for (const end = Date.now() + 40000; !frame; ) {
      await pg.waitForTimeout(800)
      frame = await financeFrame().catch((e) => { if (Date.now() > end) throw e; return null })
    }
    await pg.waitForTimeout(1500)
    const original = await frame.evaluate((KEY) => { window.dispatchEvent(new Event('pagehide')); return moneyStore.getItem(KEY) }, KEY)
    const stored = () => frame.evaluate((KEY) => JSON.parse(moneyStore.getItem(KEY) || '{"tx":[],"settings":{}}'), KEY)
    const go = async (hash) => {
      await frame.evaluate((h) => { if (location.hash !== h) location.hash = h; else window.dispatchEvent(new HashChangeEvent('hashchange')) }, hash)
      await pg.waitForTimeout(500)
    }
    const settle = () => pg.waitForTimeout(1800) // the save waits a moment before it writes
    try {
      // A made-up Telegram record dated next year, added now: the guard should list it. Nothing checked yet.
      await pg.evaluate((KEY) => {
        const st = JSON.parse(moneyStore.getItem(KEY) || 'null')
        if (!st) throw new Error('no Money data on this device')
        const acc = (st.settings.accounts || []).find((a) => !a.archived)
        const now = Date.now()
        const y = new Date().getFullYear() + 1
        st.tx.push({ id: 'smoke-rc-future', type: 'expense', amount: 4321, currency: acc.currency || st.settings.currency, rate: 1, base: 4321, date: `${y}-01-02`, account: acc.id, category: 'food', note: 'Smoke reality bus', source: 'telegram', createdAt: now, updatedAt: now })
        st.settings.checkupLast = {}
        st.settings.checkupOn = true
        delete st.settings.checkupSnooze
        moneyStore.setItem(KEY, JSON.stringify(st))
      }, KEY)
      // Finance Helper reads the seeded copy after a reload (the finally block puts the original back).
      await frame.evaluate(() => location.reload())
      await pg.waitForTimeout(3000)
      frame = null
      for (const end = Date.now() + 40000; !frame; ) {
        await pg.waitForTimeout(800)
        frame = await financeFrame().catch((e) => { if (Date.now() > end) throw e; return null })
      }
      await go('#home')
      await frame.waitForSelector('[data-testid="checkup-card"]', { timeout: 20000 })
      await frame.click('[data-testid="checkup-open"]')
      await frame.waitForSelector('[data-testid="reality-window"] [data-testid="reality-row"]', { timeout: 15000 })

      // Check these: the future-dated bot record, then "It's right".
      const flag = frame.locator('[data-testid="reality-flag"][data-id="smoke-rc-future"]')
      await flag.waitFor({ timeout: 10000 }).catch(async (e) => {
        const st = await stored()
        throw new Error(`no "Check these" row for the seeded record (stored: ${st.tx.some((t) => t.id === 'smoke-rc-future')}; window: ${(await frame.locator('[data-testid="reality-window"]').innerText()).slice(0, 200)})`)
      })
      if (!/future/i.test(await flag.innerText())) throw new Error('the future-dated record does not say why it is listed')
      await flag.locator('[data-testid="reality-flag-ok"]').click()
      await frame.waitForSelector('[data-testid="reality-flag"][data-id="smoke-rc-future"]', { state: 'detached', timeout: 10000 })

      // Row 1: a real balance of 1 → the causes, then one adjustment.
      const rows = frame.locator('[data-testid="reality-row"]:not(.done)')
      const accId = await rows.first().getAttribute('data-acc')
      const row = frame.locator(`[data-testid="reality-row"][data-acc="${accId}"]`)
      await row.locator('[data-testid="reality-real"]').fill('1')
      await row.locator('[data-testid="reality-real"]').press('Enter')
      await row.locator('[data-testid="reality-causes"]').waitFor({ timeout: 10000 })
      const focusedInRow = await frame.evaluate((id) => !!document.activeElement?.closest(`[data-acc="${id}"]`) && document.activeElement.tagName === 'BUTTON', accId)
      if (!focusedInRow) throw new Error('Enter on a difference did not move to what to do about it')
      if (process.env.REALITY_SHOTS) await frame.locator('[data-testid="reality-window"]').screenshot({ path: `${process.env.REALITY_SHOTS}/reality-window.png` })
      await row.locator('[data-testid="reality-adjust"]').click()
      await frame.waitForSelector(`[data-testid="reality-row"].done[data-acc="${accId}"]`, { timeout: 10000 })
      await settle()
      let st = await stored()
      const adj = st.tx.filter((t) => t.checkup && t.account === accId)
      if (adj.length !== 1 || !/^Reality check \d+ \w{3}$/.test(adj[0].note) || !(adj[0].type === 'income' ? adj[0].notIncome === true : adj[0].notSpending === true)) throw new Error(`the adjustment: ${JSON.stringify(adj)}`)
      if (!(st.settings.realityHistory || []).some((e) => e.rows?.some((r) => r.account === accId && r.how === 'adjusted'))) throw new Error('the check is not in the history')
      if (!st.tx.find((t) => t.id === 'smoke-rc-future')?.guardOk) throw new Error('"It\'s right" was not saved')

      // Row 2: Matches (only the date).
      const left = frame.locator('[data-testid="reality-row"]:not(.done)')
      const second = (await left.count()) ? await left.first().getAttribute('data-acc') : null
      if (second) {
        await frame.locator(`[data-testid="reality-row"][data-acc="${second}"] [data-testid="reality-match"]`).click()
        await frame.waitForSelector(`[data-testid="reality-row"].done[data-acc="${second}"]`, { timeout: 10000 })
      }

      // Hidden amounts: the app balances are masked, the boxes still take a number.
      await frame.evaluate(() => document.activeElement?.blur())
      const wasHidden = await frame.evaluate(() => /••••/.test(document.querySelector('[data-testid="reality-app"]')?.textContent || ''))
      await frame.locator('body').press('Space')
      await pg.waitForTimeout(500)
      const nowHidden = await frame.evaluate(() => /••••/.test(document.querySelector('[data-testid="reality-app"]')?.textContent || ''))
      if (nowHidden === wasHidden) throw new Error('Space did not show or hide the amounts in the window')
      if (!nowHidden) { await frame.locator('body').press('Space'); await pg.waitForTimeout(500) }
      const box = frame.locator('[data-testid="reality-row"]:not(.done) [data-testid="reality-real"]').first()
      if (await box.count()) { await box.fill('12'); if ((await box.inputValue()) !== '12') throw new Error('the box does not work with amounts hidden'); await box.fill('') }

      // No sideways scroll (10% spare is not needed for width; the page must simply fit).
      const fits = await frame.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
      if (!fits) throw new Error('the Reality check window scrolls sideways')

      // Ctrl+Z undoes the last finish (Matches, else the adjustment).
      await frame.evaluate(() => document.activeElement?.blur())
      await frame.locator('body').press('Control+z')
      const undone = second || accId
      await frame.waitForSelector(`[data-testid="reality-row"]:not(.done)[data-acc="${undone}"]`, { timeout: 10000 })
      if (!second) {
        await settle()
        st = await stored()
        if (st.tx.some((t) => t.checkup && t.account === accId)) throw new Error('Undo left the adjustment')
      }
    } finally {
      // Put this device's Money data back as it was.
      await frame.evaluate(([KEY, original]) => { window.dispatchEvent(new Event('pagehide')); if (original == null) moneyStore.removeItem(KEY); else moneyStore.setItem(KEY, original) }, [KEY, original])
      await frame.evaluate(() => location.reload())
      await pg.waitForTimeout(2500)
    }
  })
}
