// Money batch 3 smoke steps (called from e2e/smoke.mjs): keyboard shortcuts,
// changing many records at once with one Undo, and the weekly cash count.
// Made-up data only. The stored copy is put back at the end of each step.
// MONEYB3_SHOTS=<dir> saves 1920-wide screenshots of the selection bar and the cash card.

export async function moneyB3Steps({ step, pg, open, financeFrame }) {
  const KEY = 'finance-helper.state'
  const shots = process.env.MONEYB3_SHOTS
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
  // Put made-up data into the stored copy, then reload Finance Helper so it reads it.
  const seed = async (edit) => {
    const original = await pg.evaluate((k) => localStorage.getItem(k), KEY)
    await pg.evaluate(([k, src]) => {
      const st = JSON.parse(localStorage.getItem(k) || 'null')
      // eslint-disable-next-line no-new-func
      new Function('st', src)(st)
      localStorage.setItem(k, JSON.stringify(st))
    }, [KEY, edit])
    const frame = await financeFrame()
    await frame.evaluate(() => location.reload())
    await pg.waitForTimeout(2500)
    return original
  }
  const restore = async (original) => {
    if (original == null) return
    await pg.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, original])
    const frame = await financeFrame()
    await frame.evaluate(() => location.reload())
    await pg.waitForTimeout(1500)
  }
  const model = (frame, fn, arg) => frame.evaluate(async ([src, a]) => {
    const M = await import(new URL('./js/model.js', location.href).href)
    const st = JSON.parse(localStorage.getItem('finance-helper.state'))
    // eslint-disable-next-line no-new-func
    return new Function('M', 'st', 'a', src)(M, M.normalizeState(st), a)
  }, [fn, arg])
  const clickToast = (frame) => frame.evaluate(() => document.querySelector('#toast button')?.click())

  await step('Money shortcuts: ? opens the list, G then L goes to the Log, nothing fires while typing, Esc closes', async () => {
    await openFinance()
    const frame = await financeFrame()
    await frame.evaluate(() => { location.hash = '#home'; document.activeElement?.blur() })
    await pg.waitForTimeout(500)
    await frame.evaluate(() => { document.body.tabIndex = -1; document.body.focus() })
    await pg.keyboard.press('?')
    await frame.waitForSelector('.sheet [data-testid="shortcuts-list"]', { timeout: 6000 })
    const txt = await frame.locator('[data-testid="shortcuts-list"]').innerText()
    for (const w of ['New record', 'Search', 'Edit', 'Undo', 'Home', 'Reports']) if (!txt.includes(w)) throw new Error(`the help list misses "${w}"`)
    await pg.keyboard.press('Escape')
    await frame.waitForFunction(() => !document.querySelector('#sheet-root .sheet'), null, { timeout: 4000 })
    await pg.keyboard.press('g')
    await pg.keyboard.press('l')
    await frame.waitForFunction(() => location.hash === '#log', null, { timeout: 4000 })
    await frame.waitForSelector('#search', { timeout: 6000 })
    await frame.click('#search')
    await pg.keyboard.type('n?gh')
    await pg.waitForTimeout(400)
    if (await frame.locator('#sheet-root .sheet').count()) throw new Error('a shortcut opened a sheet while typing')
    if ((await frame.locator('#search').inputValue()) !== 'n?gh') throw new Error('typing in the search box was changed')
    if (await frame.evaluate(() => location.hash) !== '#log') throw new Error('typing moved to another screen')
    await frame.fill('#search', '')
  })

  await step('Money bulk change: 3 records get a new category after a confirm, one Undo restores all; delete asks and has Undo', async () => {
    await openFinance()
    const original = await seed(`
      const d = new Date(); const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      st.tx = st.tx.filter((t) => !String(t.id).startsWith('smoke-b3-'));
      const acc = (st.settings.accounts.find((a) => a.id === 'wallet') || st.settings.accounts[0]).id;
      for (let i = 1; i <= 3; i++) st.tx.push({ id: 'smoke-b3-' + i, type: 'expense', amount: 1000 * i, currency: 'MDL', rate: 1, base: 1000 * i, date: iso, account: acc, category: 'food', note: 'smoke bulk ' + i, createdAt: Date.now() + i, updatedAt: Date.now() });
      st.settings.logView = 'table'; st.meta = { ...(st.meta || {}), sheetIntro: 1 };
    `)
    try {
      const frame = await financeFrame()
      await frame.evaluate(() => { location.hash = '#log' })
      await frame.waitForSelector('#tx-table', { timeout: 10000 })
      await frame.fill('#search', 'smoke bulk')
      await frame.waitForFunction(() => document.querySelectorAll('#tx-table tr[data-id^="smoke-b3-"]').length === 3, null, { timeout: 6000 })
      await frame.click('#tx-table [data-act="sel-all"]')
      await frame.waitForSelector('[data-testid="bulk-count"]', { timeout: 4000 })
      if (!/3 selected/.test(await frame.locator('[data-testid="bulk-count"]').innerText())) throw new Error('the bar does not say 3 selected')
      if (shots) await pg.setViewportSize({ width: 1920, height: 1000 }).then(() => frame.locator('.bulk-bar').screenshot({ path: `${shots}/money-b3-selection-bar.png` })).catch(() => {})
      const cats = () => pg.evaluate((k) => JSON.parse(localStorage.getItem(k)).tx.filter((t) => t.id.startsWith('smoke-b3-')).map((t) => t.category), KEY)
      const count = () => pg.evaluate((k) => JSON.parse(localStorage.getItem(k)).tx.filter((t) => t.id.startsWith('smoke-b3-')).length, KEY)
      await frame.selectOption('select[data-bulk="category"]', 'transport')
      await frame.waitForSelector('[data-testid="bulk-confirm-text"]', { timeout: 4000 })
      if (!/3 records/.test(await frame.locator('[data-testid="bulk-confirm-text"]').innerText())) throw new Error('the confirm does not show the count')
      if ((await cats()).some((c) => c !== 'food')) throw new Error('records changed before the confirm')
      await frame.click('[data-testid="bulk-confirm-ok"]')
      await pg.waitForFunction((k) => JSON.parse(localStorage.getItem(k)).tx.filter((t) => t.id.startsWith('smoke-b3-') && t.category === 'transport').length === 3, KEY, { timeout: 10000 })
      await clickToast(frame)
      await pg.waitForFunction((k) => JSON.parse(localStorage.getItem(k)).tx.filter((t) => t.id.startsWith('smoke-b3-') && t.category === 'food').length === 3, KEY, { timeout: 8000 })
      // Delete: confirm, then gone, then Undo.
      await frame.waitForSelector('[data-testid="bulk-del"]', { timeout: 4000 }).catch(async () => { await frame.click('#tx-table [data-act="sel-all"]') })
      if (!(await frame.locator('[data-testid="bulk-del"]').count())) await frame.click('#tx-table [data-act="sel-all"]')
      await frame.click('[data-testid="bulk-del"]')
      await frame.waitForSelector('[data-testid="bulk-confirm-text"]', { timeout: 4000 })
      if ((await count()) !== 3) throw new Error('records were deleted before the confirm')
      await frame.click('[data-testid="bulk-confirm-ok"]')
      await pg.waitForFunction((k) => JSON.parse(localStorage.getItem(k)).tx.filter((t) => t.id.startsWith('smoke-b3-')).length === 0, KEY, { timeout: 15000 })
      await clickToast(frame)
      await pg.waitForFunction((k) => JSON.parse(localStorage.getItem(k)).tx.filter((t) => t.id.startsWith('smoke-b3-')).length === 3, KEY, { timeout: 8000 })
    } finally {
      await restore(original)
    }
  })

  await step('Money cash count: the card shows on the set day, a different count adds one "Cash count" record with Undo, the same count adds nothing', async () => {
    await openFinance()
    const original = await seed(`
      st.tx = st.tx.filter((t) => t.note !== 'Cash count');
      const w = st.settings.accounts.find((a) => a.kind === 'cash' && !a.archived);
      if (!w) st.settings.accounts.push({ id: 'smoke-b3-cash', name: 'Cash', kind: 'cash', currency: 'MDL', start: 50000, emoji: '💵', color: 2, updatedAt: Date.now() });
      st.settings.cashCountOn = true; st.settings.cashCountDay = new Date().getDay(); delete st.settings.cashCountLast; st.settings.updatedAt = Date.now();
    `)
    try {
      const frame = await financeFrame()
      await frame.evaluate(() => { location.hash = '#home' })
      await frame.waitForSelector('[data-testid="cash-count-card"]', { timeout: 10000 })
      if (shots) await pg.setViewportSize({ width: 1920, height: 1000 }).then(() => frame.locator('[data-testid="cash-count-card"]').screenshot({ path: `${shots}/money-b3-cash-card.png` })).catch(() => {})
      const recs = () => pg.evaluate((k) => JSON.parse(localStorage.getItem(k)).tx.filter((t) => t.note === 'Cash count').length, KEY)
      await frame.fill('[data-testid="cash-count-input"]', '123456')
      await frame.click('[data-testid="cash-count-save"]')
      await pg.waitForFunction((k) => JSON.parse(localStorage.getItem(k)).tx.filter((t) => t.note === 'Cash count').length === 1, KEY, { timeout: 10000 })
      await clickToast(frame)
      await pg.waitForFunction((k) => JSON.parse(localStorage.getItem(k)).tx.filter((t) => t.note === 'Cash count').length === 0, KEY, { timeout: 8000 })
      await frame.waitForSelector('[data-testid="cash-count-card"]', { timeout: 6000 })
      await frame.click('[data-testid="cash-count-same"]')
      await frame.waitForFunction(() => !document.querySelector('[data-testid="cash-count-card"]'), null, { timeout: 6000 })
      if ((await recs()) !== 0) throw new Error('"Same as the app" added a record')
    } finally {
      await restore(original)
    }
  })
}
