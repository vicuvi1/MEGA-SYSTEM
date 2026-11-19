// Money feel and long-run smoke steps (called from e2e/smoke.mjs): empty states, one tip,
// the Tips switch, rows that ease in, hidden amounts that never flash digits, and
// "Archive old years" (balances and the year summary stay the same, Unarchive restores).
// Made-up data only. The stored copy is put back at the end of each step.
// The smoke run starts with Finance's motion switched off (finance-helper.motion = off) so
// animations never slow a step down; the motion step switches it on for itself and back.
// MONEYFLOW_SHOTS=<dir> saves a screenshot of the archive card.

export async function moneyFlowSteps({ step, pg, open, financeFrame }) {
  const KEY = 'finance-helper.state'
  const TIPS = 'finance-helper.tips'
  const MOTION = 'finance-helper.motion'
  const shots = process.env.MONEYFLOW_SHOTS
  const openFinance = async () => {
    await open('money')
    await pg.waitForFunction(() => !!document.querySelector('.mh-open') || [...document.querySelectorAll('iframe')].some((e) => e.offsetParent), null, { timeout: 15000 })
    if (await pg.$('.mh-open')) await pg.click('.mh-open')
    let frame = null
    for (const end = Date.now() + 20000; !frame; ) {
      await pg.waitForTimeout(800)
      frame = await financeFrame().catch((e) => { if (Date.now() > end) throw e; return null })
    }
    return frame
  }
  const reload = async () => {
    const frame = await financeFrame()
    await frame.evaluate(() => location.reload())
    await pg.waitForTimeout(2200)
    return financeFrame()
  }
  // Put made-up data into the stored copy, then reload Finance Helper so it reads it.
  const seed = async (edit) => {
    const original = await pg.evaluate((k) => moneyStore.getItem(k), KEY)
    await pg.evaluate(([k, src]) => {
      const st = JSON.parse(moneyStore.getItem(k) || 'null')
      // eslint-disable-next-line no-new-func
      new Function('st', src)(st)
      moneyStore.setItem(k, JSON.stringify(st))
    }, [KEY, edit])
    await reload()
    return original
  }
  const restore = async (original) => {
    await pg.evaluate(([k, v, t, m]) => {
      if (v != null) moneyStore.setItem(k, v)
      localStorage.removeItem(t)
      localStorage.setItem(m, 'off')
    }, [KEY, original, TIPS, MOTION])
    await reload()
  }
  const model = (frame, fn, arg) => frame.evaluate(async ([src, a]) => {
    const M = await import(new URL('./js/model.js', location.href).href)
    const A = await import(new URL('./js/archive.js', location.href).href)
    const Y = await import(new URL('./js/yearreview.js', location.href).href)
    const st = JSON.parse(moneyStore.getItem('finance-helper.state'))
    // eslint-disable-next-line no-new-func
    return new Function('M', 'A', 'Y', 'st', 'a', src)(M, A, Y, M.normalizeState(st), a)
  }, [fn, arg])

  await step('Money feel: empty Goals shows what it is for, one example and one button; one tip, closed once; the Tips switch brings it back', async () => {
    await openFinance()
    await pg.evaluate((t) => localStorage.removeItem(t), TIPS)
    const original = await seed('st.goals = []; st.goalAllocations = []')
    try {
      const frame = await financeFrame()
      await frame.evaluate(() => { location.hash = '#goals' })
      await frame.waitForSelector('[data-testid="empty-goals"]', { timeout: 8000 })
      const txt = await frame.locator('[data-testid="empty-goals"]').innerText()
      for (const w of ['Save for something', 'Example', 'Add a goal']) if (!txt.includes(w)) throw new Error(`the empty Goals screen misses "${w}"`)
      if ((await frame.locator('[data-testid="empty-goals"] button').count()) !== 1) throw new Error('the empty Goals screen should have exactly one button')
      await frame.click('[data-testid="empty-goals"] button')
      await frame.waitForSelector('.sheet #goal-form', { timeout: 5000 })
      await frame.click('.sheet #goal-form button[type="submit"]')
      await frame.waitForFunction(() => /name/i.test(document.querySelector('#g-msg')?.textContent || ''), null, { timeout: 4000 })
      await pg.keyboard.press('Escape')
      await frame.evaluate(() => { location.hash = '#home' })
      await frame.waitForSelector('[data-testid="tip-card"]', { timeout: 6000 })
      if ((await frame.locator('[data-testid="tip-card"]').count()) !== 1) throw new Error('more than one tip on the screen')
      if (!(await frame.locator('[data-testid="tip-card"]').innerText()).includes('Space')) throw new Error('the Home tip is not about Space')
      await frame.click('[data-testid="tip-card"] [data-tip-x]')
      await frame.waitForFunction(() => !document.querySelector('[data-testid="tip-card"]'), null, { timeout: 3000 })
      await frame.evaluate(() => { location.hash = '#log' })
      await pg.waitForTimeout(300)
      await frame.evaluate(() => { location.hash = '#home' })
      await pg.waitForTimeout(500)
      if (await frame.locator('[data-testid="tip-card"]').count()) throw new Error('a closed tip came back')
      // Settings -> General -> Tips on again: the tips return.
      await frame.evaluate(() => { location.hash = '#settings' })
      await frame.waitForSelector('[data-act="set-tab"][data-sec="general"]', { timeout: 6000 })
      await frame.click('[data-act="set-tab"][data-sec="general"]')
      await frame.waitForSelector('[data-tips-toggle]', { timeout: 6000 })
      await frame.uncheck('[data-tips-toggle]')
      await frame.check('[data-tips-toggle]')
      await frame.evaluate(() => { location.hash = '#home' })
      await frame.waitForSelector('[data-testid="tip-card"]', { timeout: 6000 })
    } finally {
      await restore(original)
    }
  })

  await step('Money feel: a new row eases in, and with amounts hidden the balance never shows a digit while it counts; motion off does nothing', async () => {
    await openFinance()
    const original = await pg.evaluate((k) => moneyStore.getItem(k), KEY)
    try {
      // Motion on for this step (Calm and the smoke's off switch are put back after).
      await pg.evaluate((m) => { localStorage.setItem(m, 'on'); document.documentElement.classList.remove('calm') }, MOTION)
      let frame = await financeFrame()
      await frame.evaluate(() => { location.hash = '#log' })
      await frame.waitForSelector('[data-act="log-view"][data-view="list"]', { timeout: 6000 })
      await frame.click('[data-act="log-view"][data-view="list"]')
      await frame.waitForSelector('[data-act="add"]', { timeout: 6000 })
      const addRecord = async (note, amount) => {
        await frame.click('.fab[data-act="add"], [data-act="add"]')
        await frame.waitForSelector('.sheet #tx-form', { timeout: 5000 })
        await frame.click('.sheet .cat')
        await frame.fill('.sheet #tx-amount', amount)
        await frame.fill('.sheet #tx-note', note)
        await frame.click('.sheet button[type="submit"]')
      }
      // Motion on: the new row gets the ease-in class.
      await frame.evaluate(() => { window.__rowIn = 0; new MutationObserver((ms) => { for (const m of ms) if (m.target.classList?.contains('row-in') || m.target.classList?.contains('row-saved')) window.__rowIn++ }).observe(document.getElementById('app'), { attributes: true, subtree: true, attributeFilter: ['class'] }) })
      await addRecord('smoke flow one', '41')
      await frame.waitForFunction(() => window.__rowIn > 0 || !!document.querySelector('.tx.row-in, .tx.row-saved'), null, { timeout: 5000 })
      // Amounts hidden: the balance rolls to its new value as dots only.
      await frame.waitForSelector('[data-testid="privacy-eye"]', { timeout: 4000 })
      if ((await frame.getAttribute('[data-testid="privacy-eye"]', 'aria-pressed')) !== 'true') await frame.click('[data-testid="privacy-eye"]')
      await frame.waitForFunction(() => document.querySelector('[data-testid="privacy-eye"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 3000 })
      await frame.evaluate(() => {
        window.__digits = 0
        const look = () => { for (const el of document.querySelectorAll('.sc-total, [data-count]')) if (/\d/.test(el.textContent || '')) window.__digits++ }
        new MutationObserver(look).observe(document.body, { childList: true, characterData: true, subtree: true })
        window.__digitTimer = setInterval(look, 25)
      })
      await addRecord('smoke flow two', '73')
      await pg.waitForTimeout(1200)
      const digits = await frame.evaluate(() => { clearInterval(window.__digitTimer); return window.__digits })
      if (digits) throw new Error(`a digit showed in the balance ${digits} time(s) while amounts were hidden`)
      await frame.click('[data-testid="privacy-eye"]')
      // Motion off: nothing eases in.
      await pg.evaluate((m) => localStorage.setItem(m, 'off'), MOTION)
      await frame.evaluate(() => { window.__rowIn = 0 })
      await addRecord('smoke flow three', '12')
      await pg.waitForTimeout(700)
      if (await frame.evaluate(() => window.__rowIn)) throw new Error('rows animated with motion off')
    } finally {
      await pg.evaluate((m) => localStorage.setItem(m, 'off'), MOTION)
      if (original != null) await pg.evaluate(([k, v]) => moneyStore.setItem(k, v), [KEY, original])
      await reload()
    }
  })

  await step('Money archive: archiving old years keeps every balance and the year summary, search can include them, Unarchive restores the same records', async () => {
    await openFinance()
    const edit = `
      const acc = st.settings.accounts[0].id
      const mk = (id, date, type, amount, note) => ({ id, type, amount, currency: st.settings.currency, rate: 1, base: amount, date, category: type === 'income' ? (st.settings.categories.find((c) => c.type === 'income') || {}).id : (st.settings.categories.find((c) => c.type === 'expense') || {}).id, account: acc, note, createdAt: 5, updatedAt: 5 })
      st.tx.push(mk('arch-a', '2023-05-05', 'expense', 11100, 'smoke arch old shoes'), mk('arch-b', '2024-02-02', 'income', 900000, 'smoke arch salary'), mk('arch-c', '2024-08-08', 'expense', 25050, 'smoke arch tickets'))
    `
    const original = await seed(edit)
    try {
      let frame = await financeFrame()
      const snap = () => model(frame, `
        const st2 = A.withArchive(st)
        const y = Y.yearReview(st, 2024, '2026-06-01')
        return { bal: M.accountBalances(st), total: M.totalBalance(st).total, y24: { income: y.income, expense: y.expense, records: y.records, net: y.netWorth }, ids: st2.tx.map((t) => t.id).sort(), active: st.tx.length, archived: A.archivedTx(st).length }
      `)
      const before = await snap()
      await frame.evaluate(() => { location.hash = '#settings' })
      await frame.waitForSelector('[data-act="set-tab"][data-sec="data"]', { timeout: 6000 })
      await frame.click('[data-act="set-tab"][data-sec="data"]')
      await frame.waitForSelector('[data-testid="archive-card"]', { timeout: 6000 })
      await frame.selectOption('[data-testid="archive-year"]', '2025')
      const pre = await frame.locator('[data-testid="archive-preview"]').innerText()
      if (!/before 2025/.test(pre)) throw new Error(`the preview says "${pre}"`)
      if (shots) {
        await pg.setViewportSize({ width: 1920, height: 1080 })
        await pg.waitForTimeout(400)
        await frame.locator('[data-testid="archive-card"]').scrollIntoViewIfNeeded()
        await pg.screenshot({ path: `${shots}/money-archive-card.png` })
      }
      await frame.click('[data-testid="archive-go"]')
      await frame.waitForSelector('[data-testid="archive-confirm"]', { timeout: 5000 })
      await frame.click('[data-testid="archive-confirm"]')
      await frame.waitForSelector('[data-testid="archive-state"]', { timeout: 15000 })
      await pg.waitForFunction((k) => !!JSON.parse(moneyStore.getItem(k) || '{}').settings?.archive?.cutoff, KEY, { timeout: 6000 })
      frame = await financeFrame()
      const mid = await snap()
      if (JSON.stringify(mid.bal) !== JSON.stringify(before.bal)) throw new Error(`balances changed: ${JSON.stringify(before.bal)} -> ${JSON.stringify(mid.bal)}`)
      if (mid.total !== before.total) throw new Error(`total ${before.total} -> ${mid.total}`)
      if (JSON.stringify(mid.y24) !== JSON.stringify(before.y24)) throw new Error(`the 2024 summary changed: ${JSON.stringify(before.y24)} -> ${JSON.stringify(mid.y24)}`)
      if (JSON.stringify(mid.ids) !== JSON.stringify(before.ids)) throw new Error('the records the history readers see changed')
      if (!(mid.archived >= 3) || mid.active >= before.active) throw new Error(`nothing moved (${mid.active} active, ${mid.archived} archived)`)
      // Search: archived records only with the switch.
      await frame.evaluate(() => { location.hash = '#log' })
      await frame.waitForSelector('#search', { timeout: 6000 })
      await frame.fill('#search', 'smoke arch')
      await pg.waitForTimeout(600)
      if (await frame.locator('tr[data-id]', { hasText: 'smoke arch' }).count()) throw new Error('archived records showed without the switch')
      await frame.click('[data-testid="include-archived"]')
      await frame.waitForFunction(() => document.querySelectorAll('tr[data-id]').length >= 3, null, { timeout: 5000 })
      await frame.fill('#search', '')
      // Unarchive: the same records, the same balances.
      await frame.evaluate(() => { location.hash = '#settings' })
      await frame.waitForSelector('[data-act="set-tab"][data-sec="data"]', { timeout: 6000 })
      await frame.click('[data-act="set-tab"][data-sec="data"]')
      await frame.waitForSelector('[data-testid="archive-undo"]', { timeout: 6000 })
      await frame.click('[data-testid="archive-undo"]')
      await frame.waitForFunction(() => !document.querySelector('[data-testid="archive-undo"]'), null, { timeout: 8000 })
      await pg.waitForFunction((k) => !JSON.parse(moneyStore.getItem(k) || '{}').settings?.archive?.cutoff, KEY, { timeout: 6000 })
      const after = await snap()
      if (after.active !== before.active || after.archived !== 0) throw new Error(`unarchive: ${after.active} active, ${after.archived} archived (want ${before.active}, 0)`)
      if (JSON.stringify(after.bal) !== JSON.stringify(before.bal) || JSON.stringify(after.y24) !== JSON.stringify(before.y24)) throw new Error('unarchive changed balances or the year summary')
    } finally {
      await restore(original)
    }
  })
}
