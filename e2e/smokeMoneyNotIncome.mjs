// "Doesn't count as income" smoke step (called from e2e/smoke.mjs): an Earned
// "Other income" record with no note is suggested on the Log; confirming it
// takes it out of the month's Earned (the balance stays), and Undo puts it back.
// Made-up data only; the stored copy is put back at the end. No page reloads
// except the two that restore the stored copy.

export async function moneyNotIncomeSteps({ step, pg, open, financeFrame }) {
  const KEY = 'finance-helper.state'
  await step('Money not income: a suggested record leaves Earned, keeps the balance, and Undo puts it back', async () => {
      await open('money')
      await pg.waitForFunction(() => !!document.querySelector('.mh-open') || [...document.querySelectorAll('iframe')].some((e) => e.offsetParent), null, { timeout: 15000 })
      if (await pg.$('.mh-open')) await pg.click('.mh-open')
      let frame = null
      for (const end = Date.now() + 20000; !frame; ) {
        await pg.waitForTimeout(800)
        frame = await financeFrame().catch((e) => { if (Date.now() > end) throw e; return null })
      }
      const original = await pg.evaluate((k) => moneyStore.getItem(k), KEY)
      await pg.evaluate((k) => {
        const st = JSON.parse(moneyStore.getItem(k) || 'null')
        const d = new Date()
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        st.tx = st.tx.filter((t) => !String(t.id).startsWith('smoke-ni-'))
        const acc = (st.settings.accounts.find((a) => a.id === 'wallet') || st.settings.accounts[0]).id
        st.tx.push({ id: 'smoke-ni-1', type: 'income', amount: 77700, currency: st.settings.currency || 'MDL', rate: 1, base: 77700, date: iso, account: acc, category: 'other-in', note: '', createdAt: Date.now(), updatedAt: Date.now() })
        moneyStore.setItem(k, JSON.stringify(st))
      }, KEY)
      frame = await financeFrame()
      await frame.evaluate(() => location.reload())
      await pg.waitForTimeout(2500)
      try {
        frame = await financeFrame()
        const month = await frame.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })
        const read = () => frame.evaluate(async (m) => {
          const M = await import(new URL('./js/model.js', location.href).href)
          const st = M.normalizeState(JSON.parse(moneyStore.getItem('finance-helper.state')))
          const s = M.monthSummary(st, m)
          const t = st.tx.find((x) => x.id === 'smoke-ni-1')
          return { income: s.income, bal: JSON.stringify(M.accountBalances(st)), flag: t?.notIncome === true }
        }, month)
        const before = await read()
        await frame.evaluate(() => { location.hash = '#log' })
        await frame.waitForSelector('[data-testid="notincome-open"]', { timeout: 10000 })
        await frame.click('[data-testid="notincome-open"]')
        await frame.waitForSelector('[data-testid="notincome-suggestion"]', { timeout: 5000 })
        const row = frame.locator('[data-notincome="smoke-ni-1"]')
        if (!(await row.count())) throw new Error('the seeded record is not in the suggestions')
        if ((await read()).flag) throw new Error('the record was changed before confirming')
        await row.locator('[data-ni="mark"]').click()
        await frame.waitForFunction(() => { const st = JSON.parse(moneyStore.getItem('finance-helper.state')); return st.tx.find((x) => x.id === 'smoke-ni-1')?.notIncome === true }, null, { timeout: 6000 })
        const after = await read()
        if (after.income !== before.income - 77700) throw new Error(`Earned did not drop by 777: ${before.income} -> ${after.income}`)
        if (after.bal !== before.bal) throw new Error('the account balances changed')
        await frame.evaluate(() => document.querySelector('#toast button')?.click())
        await frame.waitForFunction(() => { const st = JSON.parse(moneyStore.getItem('finance-helper.state')); return st.tx.find((x) => x.id === 'smoke-ni-1')?.notIncome !== true }, null, { timeout: 6000 })
        const undone = await read()
        if (undone.income !== before.income) throw new Error(`Undo did not bring Earned back: ${undone.income}`)
      } finally {
        if (original != null) {
          await pg.evaluate(([k, v]) => moneyStore.setItem(k, v), [KEY, original])
          const f = await financeFrame()
          await f.evaluate(() => location.reload())
          await pg.waitForTimeout(1500)
        }
      }
  })
}
