// Money for long-term use smoke step (called from e2e/smoke.mjs): a repeating rent rule asks on its day and
// adds once, the monthly check-up makes one adjustment that does not count as income or spending, a trip
// budget shows up with its bar, and the Year summary matches the Log's income. Made-up data only; the
// Finance Helper state of this device is put back at the end.
// A screenshot of the Year summary goes to MONEYLONG_SHOTS when it is set.

const KEY = 'finance-helper.state'

export async function moneyLongSteps({ step, pg, open, financeFrame, storedTx }) {
  await step('Money long-term: repeating rent asks once, check-up adjustment, trip budget, Year summary', async () => {
    await pg.setViewportSize({ width: 1440, height: 900 })
    await open('money')
    await pg.waitForFunction(() => !!document.querySelector('.mh-open') || [...document.querySelectorAll('iframe')].some((e) => e.offsetParent), null, { timeout: 15000 })
    if (await pg.$('.mh-open')) await pg.click('.mh-open')
    let frame = null
    for (const end = Date.now() + 30000; !frame; ) {
      await pg.waitForTimeout(800)
      frame = await financeFrame().catch((e) => { if (Date.now() > end) throw e; return null })
    }
    await pg.waitForTimeout(1500)
    const original = await frame.evaluate((KEY) => { window.dispatchEvent(new Event('pagehide')); return moneyStore.getItem(KEY) }, KEY)
    const go = async (hash) => {
      await frame.evaluate((h) => { if (location.hash !== h) location.hash = h; else window.dispatchEvent(new HashChangeEvent('hashchange')) }, hash)
      await pg.waitForTimeout(400)
    }
    const settle = () => pg.waitForTimeout(1500) // the save waits a moment before it writes
    try {
      // 1. A repeating rent rule, from today, that asks first.
      await go('#plan')
      await frame.waitForSelector('[data-testid="plan-tab-repeating"]', { timeout: 15000 })
      await frame.click('[data-testid="plan-tab-repeating"]')
      await frame.waitForSelector('[data-testid="repeating-tab"]', { timeout: 5000 })
      await frame.click('[data-testid="repeating-tab"] [data-act="rec-new"]')
      await frame.waitForSelector('#rec-form', { timeout: 5000 })
      await frame.fill('#rec-amount', '1234')
      await frame.fill('#rec-note', 'Rent smoke')
      await frame.click('#rec-form button[type="submit"]')
      await frame.waitForSelector('[data-testid="repeating-row"]:has-text("Rent smoke")', { timeout: 8000 })
      if (!/asks me/i.test(await frame.locator('[data-testid="repeating-row"]:has-text("Rent smoke")').innerText())) throw new Error('the new rule does not say it asks first')
      await go('#home')
      await frame.waitForSelector('[data-testid="to-confirm-row"]:has-text("Rent smoke")', { timeout: 10000 })
      const rows = frame.locator('[data-testid="to-confirm-row"]:has-text("Rent smoke")')
      if ((await rows.count()) !== 1) throw new Error('Rent smoke is listed more than once in "To confirm"')
      await rows.locator('[data-testid="to-confirm-ok"]').click()
      await frame.waitForFunction(() => ![...document.querySelectorAll('[data-testid="to-confirm-row"]')].some((e) => /Rent smoke/.test(e.textContent)), null, { timeout: 8000 })
      await settle()
      const made = (await storedTx()).filter((t) => t.note === 'Rent smoke')
      if (made.length !== 1 || !/^rec-.+-\d{4}-\d{2}-\d{2}$/.test(made[0].id) || made[0].amount !== 123400) throw new Error(`the rent record: ${JSON.stringify(made)}`)

      // 2. The monthly check-up: a different real balance makes one visible adjustment that does not count.
      await go('#home')
      await frame.waitForSelector('[data-testid="checkup-card"]', { timeout: 10000 })
      await frame.click('[data-testid="checkup-open"]')
      await frame.waitForSelector('.sheet [data-testid="checkup-row"]', { timeout: 5000 })
      const row = frame.locator('.sheet [data-testid="checkup-row"]').first()
      await row.locator('[data-testid="checkup-real"]').fill('1')
      await row.locator('[data-testid="checkup-set"]').click()
      await frame.waitForSelector('.sheet [data-testid="checkup-row"]:has-text("Checked this month")', { timeout: 5000 })
      await settle()
      const adj = (await storedTx()).filter((t) => t.checkup)
      if (adj.length !== 1 || adj[0].note !== 'Monthly check-up' || !(adj[0].type === 'income' ? adj[0].notIncome === true : adj[0].notSpending === true)) throw new Error(`check-up adjustment: ${JSON.stringify(adj)}`)
      await frame.click('.sheet .icon-btn[data-close]')
      await pg.waitForTimeout(400)

      // 3. A trip budget for some dates and a tag.
      await go('#plan')
      await frame.waitForSelector('[data-act="plan-tab"][data-tab="budgets"]', { timeout: 10000 })
      await frame.click('[data-act="plan-tab"][data-tab="budgets"]')
      await frame.click('[data-testid="budget-kind-add"]')
      await frame.waitForSelector('#bk-form', { timeout: 5000 })
      await frame.fill('#bk-name', 'Trip smoke')
      await frame.fill('#bk-limit', '1000')
      await frame.selectOption('#bk-period', 'range')
      await frame.waitForSelector('#bk-from', { timeout: 3000 })
      const days = await frame.evaluate(() => { const p = (n) => String(n).padStart(2, '0'); const iso = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; return [iso(new Date()), iso(new Date(Date.now() + 3 * 864e5))] })
      await frame.fill('#bk-from', days[0])
      await frame.fill('#bk-to', days[1])
      await frame.fill('#bk-tags', '#smoketrip')
      await frame.click('#bk-form button[type="submit"]')
      await frame.waitForSelector('[data-testid="budget-kind-row"]:has-text("Trip smoke")', { timeout: 8000 })
      if (!(await frame.locator('[data-testid="budget-kind-row"]:has-text("Trip smoke") .bar').count())) throw new Error('the trip budget has no progress bar')

      // 4. Year summary: the same income as the Log's.
      await go('#review')
      await frame.waitForSelector('[data-testid="year-summary"]', { timeout: 10000 })
      if ((await frame.locator('[data-testid="year-summary"] .ys-m').count()) !== 12) throw new Error('the year summary does not show 12 months')
      await frame.waitForTimeout(1200)
      const [shown, expected] = await frame.evaluate((KEY) => {
        const st = JSON.parse(moneyStore.getItem(KEY) || '{"tx":[]}')
        const year = String(new Date().getFullYear())
        const sum = st.tx
          .filter((t) => t.type === 'income' && t.date.startsWith(year) && !t.loan && !t.refund && !t.notIncome && !t.reconcile && !String(t.id).startsWith('life-reward-'))
          .reduce((a, t) => a + (Number.isInteger(t.base) ? t.base : t.amount), 0)
        return [Number(document.querySelector('[data-testid="ys-income"] [data-count]')?.getAttribute('data-count')), Math.round(sum / 100) * 100]
      }, KEY)
      if (shown !== expected) throw new Error(`Year summary income ${shown} is not the Log's ${expected}`)
      for (const id of ['ys-spending', 'ys-rate', 'ys-nospend']) if (!(await frame.locator(`[data-testid="${id}"]`).count())) throw new Error(`no ${id}`)
      if (process.env.MONEYLONG_SHOTS) await frame.locator('[data-testid="year-summary"]').screenshot({ path: `${process.env.MONEYLONG_SHOTS}/year-summary.png` })
    } finally {
      // Put this device's Money data back as it was.
      await frame.evaluate(([KEY, original]) => { window.dispatchEvent(new Event('pagehide')); if (original == null) moneyStore.removeItem(KEY); else moneyStore.setItem(KEY, original) }, [KEY, original])
      await frame.evaluate(() => location.reload())
      await pg.waitForTimeout(2500)
    }
  })
}
