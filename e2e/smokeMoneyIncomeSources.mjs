// Income sources smoke step (called from e2e/smoke.mjs): create two sources in
// Settings, log income to them (quick add "@job2" and the add form's Source
// chips), see the right per-source totals in Reports, archive one and see it keep its
// history. Made-up data only; the stored copy is put back at the end. No page
// reloads except the one that restores the stored copy.
// MONEY_SOURCES_SHOTS=<dir> saves a 1920-wide screenshot of Reports -> Income by source.

export async function moneyIncomeSourcesSteps({ step, pg, open, financeFrame }) {
  const KEY = 'finance-helper.state'
  const shots = process.env.MONEY_SOURCES_SHOTS
  await step('Money income sources: create Job 1 and Job 2, log income with @job2 and the form, Reports shows the totals, archiving keeps history', async () => {
    await open('money')
    await pg.waitForFunction(() => !!document.querySelector('.mh-open') || [...document.querySelectorAll('iframe')].some((e) => e.offsetParent), null, { timeout: 15000 })
    if (await pg.$('.mh-open')) await pg.click('.mh-open')
    let frame = null
    for (const end = Date.now() + 20000; !frame; ) {
      await pg.waitForTimeout(800)
      frame = await financeFrame().catch((e) => { if (Date.now() > end) throw e; return null })
    }
    await pg.waitForTimeout(2500) // the embedded app finishes its start-up route
    frame = await financeFrame()
    const original = await pg.evaluate((k) => localStorage.getItem(k), KEY)
    try {
      // Start from no sources and no old smoke records, without reloading: the app writes its own copy on the first save.
      const sheetGone = () => frame.waitForFunction(() => !document.querySelector('#sheet-root .sheet'), null, { timeout: 6000 })
      const stored = () => frame.evaluate(() => JSON.parse(localStorage.getItem('finance-helper.state') || 'null'))
      const sources = async () => (await stored())?.settings?.incomeSources || []
      if ((await sources()).length) throw new Error('this copy already has income sources; the step needs a clean start')

      // 1. Settings -> Income sources: add Job 1, then Job 2 (with a pay day and an amount).
      await frame.evaluate(() => { location.hash = '#settings' })
      await frame.waitForSelector('[data-act="set-tab"][data-sec="sources"]', { timeout: 10000 })
      await frame.evaluate(() => document.querySelector('[data-act="set-tab"][data-sec="sources"]').click())
      await frame.waitForSelector('[data-testid="src-settings"]', { timeout: 5000 })
      if (!(await frame.locator('[data-testid="src-empty"]').count())) throw new Error('the list should start empty')
      for (const [name, extra] of [['Job 1', null], ['Job 2', { exp: '15000', day: '10' }]]) {
        await frame.click('[data-testid="src-new"]')
        await frame.waitForSelector('[data-testid="src-name"]', { timeout: 5000 })
        await frame.fill('[data-testid="src-name"]', name)
        if (extra) { await frame.fill('[data-testid="src-exp"]', extra.exp); await frame.fill('[data-testid="src-day"]', extra.day) }
        await frame.click('[data-testid="src-save"]')
        await sheetGone()
      }
      await frame.waitForFunction(() => document.querySelectorAll('[data-testid="src-row"]').length === 2, null, { timeout: 5000 })
      await frame.waitForFunction(() => (JSON.parse(localStorage.getItem('finance-helper.state'))?.settings?.incomeSources || []).length === 2, null, { timeout: 6000 })
      const made = await sources()
      if (made.map((s) => s.name).join() !== 'Job 1,Job 2') throw new Error(`wrong sources saved: ${JSON.stringify(made.map((s) => s.name))}`)
      const j1 = made[0].id
      const j2 = made[1].id
      if (made[1].expected !== 1500000 || made[1].payday !== 10) throw new Error('the expected amount and pay day were not saved')

      // 2. Quick add on Home: "+3000 @job2" goes to Job 2.
      await frame.evaluate(() => { location.hash = '#home' })
      await frame.waitForSelector('#qa-input', { timeout: 10000 })
      await frame.fill('#qa-input', '+3000 @job2')
      await frame.waitForSelector('[data-testid="qa-source"]', { timeout: 4000 })
      if (!(await frame.locator('[data-testid="qa-source"]').innerText()).includes('Job 2')) throw new Error('the quick add preview does not show Job 2')
      await frame.click('[data-testid="qa-save"]')
      await frame.waitForFunction((id) => { const st = JSON.parse(localStorage.getItem('finance-helper.state')); return st.tx.some((t) => t.incomeSource === id && t.amount === 300000) }, j2, { timeout: 6000 })

      // 3. The add form: Earned, 1200, Source chip Job 1.
      await frame.click('.lt-add, [data-act="add"]')
      await frame.waitForSelector('#tx-form', { timeout: 5000 })
      await frame.click('.seg button[data-type="income"]')
      await frame.fill('#tx-amount', '1200')
      await frame.waitForSelector('[data-testid="src-picker"]', { timeout: 4000 })
      await frame.locator('[data-testid="src-chip"]', { hasText: 'Job 1' }).click()
      if ((await frame.locator('[data-testid="src-chip"][aria-pressed="true"]').count()) !== 1) throw new Error('exactly one source chip should be picked')
      await frame.click('#tx-form button[type="submit"]')
      await frame.waitForFunction((id) => { const st = JSON.parse(localStorage.getItem('finance-helper.state')); return st.tx.some((t) => t.incomeSource === id && t.amount === 120000) }, j1, { timeout: 6000 })
      // A new income record opens the jar split sheet; close it.
      await frame.waitForTimeout(400)
      if (await frame.locator('#sheet-root .sheet').count()) { await pg.keyboard.press('Escape'); await frame.waitForTimeout(300) }
      if (await frame.locator('#sheet-root .sheet').count()) await frame.evaluate(() => document.querySelector('#sheet-root [data-close]')?.click())

      // 4. Reports: per-source totals that match the stored records.
      await frame.evaluate(() => { location.hash = '#reports' })
      await frame.waitForSelector('[data-testid="src-report"]', { timeout: 10000 })
      await frame.waitForSelector('[data-testid="src-rep-row"]', { timeout: 5000 })
      const rows = await frame.evaluate(() => [...document.querySelectorAll('[data-testid="src-rep-row"]')].map((r) => ({ name: r.querySelector('.src-name-cell')?.textContent?.trim() || '', total: (r.querySelector('[data-testid="src-total"]')?.textContent || '').replace(/[^\d]/g, '') })))
      const want = await frame.evaluate(async () => {
        const IS = await import(new URL('./js/incomesources.js', location.href).href)
        const M = await import(new URL('./js/model.js', location.href).href)
        const st = M.normalizeState(JSON.parse(localStorage.getItem('finance-helper.state')))
        const d = new Date()
        const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const rep = IS.sourceReport(st, today)
        return rep.rows.map((r) => ({ name: r.name, cents: r.total }))
      })
      const job = (list, n) => list.find((r) => r.name.includes(n))
      for (const [n, cents] of [['Job 1', 120000], ['Job 2', 300000]]) {
        const w = job(want, n)
        const got = job(rows, n)
        if (!w || w.cents !== cents) throw new Error(`the model total for ${n} is ${w?.cents}, expected ${cents}`)
        if (!got) throw new Error(`Reports has no row for ${n}`)
        if (!got.total.startsWith(String(cents / 100))) throw new Error(`Reports shows ${got.total} for ${n}, expected ${cents / 100}`)
      }
      if (await frame.locator('[data-testid="src-bars"] .sb-col').count() !== 12) throw new Error('the 12 month bars are missing')
      if (shots) {
        await pg.setViewportSize({ width: 1920, height: 1080 })
        await frame.evaluate(() => document.getElementById('src-report')?.scrollIntoView({ block: 'center' }))
        await pg.waitForTimeout(900)
        await pg.screenshot({ path: `${shots}/income-by-source.png` })
      }
      // Click a source: its records.
      await frame.locator('[data-testid="src-rep-row"]', { hasText: 'Job 2' }).click()
      await frame.waitForSelector('[data-testid="src-sheet-total"]', { timeout: 5000 })
      await frame.evaluate(() => document.querySelector('#sheet-root [data-close]')?.click())
      await sheetGone()

      // 5. Archive Job 2: it leaves the pickers but stays on its record and in Reports.
      await frame.evaluate(() => { location.hash = '#settings' })
      await frame.waitForSelector('[data-testid="src-row"]', { timeout: 6000 }).catch(async () => {
        await frame.click('[data-act="set-tab"][data-sec="sources"]')
        await frame.waitForSelector('[data-testid="src-row"]', { timeout: 6000 })
      })
      await frame.locator(`[data-testid="src-row"][data-id="${j2}"] [data-testid="src-archive"]`).click()
      await frame.waitForFunction((id) => JSON.parse(localStorage.getItem('finance-helper.state')).settings.incomeSources.find((s) => s.id === id)?.archived === true, j2, { timeout: 6000 })
      const after = await stored()
      if (after.tx.filter((t) => t.incomeSource === j2).length !== 1) throw new Error('archiving changed the records')
      await frame.evaluate(() => { location.hash = '#reports' })
      await frame.waitForSelector('[data-testid="src-report"]', { timeout: 8000 })
      if (!(await frame.locator('[data-testid="src-rep-row"]', { hasText: 'Job 2' }).count())) throw new Error('an archived source vanished from Reports')
    } catch (e) {
      if (process.env.MONEY_SOURCES_DEBUG) await pg.screenshot({ path: `${process.env.MONEY_SOURCES_DEBUG}/fail.png` }).catch(() => {})
      throw e
    } finally {
      if (original != null) {
        await pg.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, original])
        const f = await financeFrame()
        await f.evaluate(() => location.reload())
        await pg.waitForTimeout(1500)
      }
    }
  })
}
