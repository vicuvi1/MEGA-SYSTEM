// Money smoke steps (called from e2e/smoke.mjs): Money opens on Finance Helper's Home with its own sidebar and the balance
// card top-left (kept on Log too); favourites add a record with Undo; the Log search understands over / under / date ranges and
// shows removable chips with a count and total; the emergency fund meter shows its months.
// Made-up data only: the stored copy is put back at the end. Timeouts keep 10%+ headroom.
// MONEY3_SHOTS=<dir> saves a screenshot of Money Home.

export async function money3Steps({ step, pg, open, financeFrame }) {
  const KEY = 'finance-helper.state'
  const shots = process.env.MONEY3_SHOTS
  const waitFrame = async () => {
    await pg.waitForFunction(() => [...document.querySelectorAll('iframe')].some((e) => e.offsetParent), null, { timeout: 16500 })
    let frame = null
    for (const end = Date.now() + 22000; !frame; ) {
      await pg.waitForTimeout(800)
      frame = await financeFrame().catch((e) => { if (Date.now() > end) throw e; return null })
    }
    return frame
  }
  const stored = () => pg.evaluate((k) => JSON.parse(moneyStore.getItem(k) || '{"tx":[]}'), KEY)

  await step('Money opens on the balance: clicking Money in the menu shows Finance Home with its own sidebar and the balance card top-left, kept on Log, the Life hub is one tab away', async () => {
    await pg.setViewportSize({ width: 1440, height: 900 })
    await open('today')
    await pg.waitForSelector('aside.sb .sb-item[aria-label="Money"]', { timeout: 11000 })
    await pg.click('aside.sb .sb-item[aria-label="Money"]')
    const frame = await waitFrame()
    // Finance Helper's own sidebar is visible, with the balance card top-left, on Home and then on Log.
    const sideBalance = async (where) => {
      await frame.waitForSelector('.tabbar .side-card .sc-total', { state: 'visible', timeout: 16500 }).catch(async (e) => { if (shots) await pg.screenshot({ path: `${shots}/money-fail.png` }); throw e })
      const box = await frame.waitForFunction(() => { const r = document.querySelector('.tabbar .side-card .sc-total')?.getBoundingClientRect(); return r && r.width > 0 ? { x: r.x, y: r.y } : null }, null, { timeout: 5500 }).then((h) => h.jsonValue()).catch(() => null)
      if (!box || box.x > 400 || box.y > 330) throw new Error(`the balance card is not top-left on ${where}: ${JSON.stringify(box)}`)
      if (!/\d/.test(await frame.locator('.tabbar .side-card .sc-total').innerText())) throw new Error(`the balance shows no number on ${where}`)
      if (!(await frame.locator('.tabbar a[data-tab="log"]').isVisible())) throw new Error(`the sidebar sections are not visible on ${where}`)
    }
    await sideBalance('Home')
    if (await frame.locator('[data-testid="home-balance"]').count()) throw new Error('Home still repeats the balance block above its title')
    if (!(await frame.evaluate(() => /home|^$/.test(location.hash.replace('#', ''))))) throw new Error(`Finance did not open on Home: ${await frame.evaluate(() => location.hash)}`)
    if (shots) await pg.screenshot({ path: `${shots}/money-home.png` })
    await frame.locator('.tabbar a[data-tab="log"]').click({ timeout: 5500 })
    await frame.waitForFunction(() => location.hash === '#log', null, { timeout: 5500 })
    await sideBalance('Log')
    await frame.locator('.tabbar a[data-tab="home"]').click({ timeout: 5500 })
    // The Life hub is still there, and leaving Money and coming back opens the balance again.
    await pg.locator('.seg-switch [role="tab"]', { hasText: 'Money hub' }).click({ timeout: 5500 })
    // The hub shows its numbers, or its empty card when no synced data came yet: either is the hub.
    await pg.waitForSelector('.mh .mh-hero, .mh .mh-open, .mh .mh-empty, .mh [data-tab="today"]', { timeout: 15000 })
    await open('today')
    await pg.click('aside.sb .sb-item[aria-label="Money"]')
    await waitFrame()
    if (await pg.$('.mh-hero')) throw new Error('Money came back on the hub instead of the balance')
  })

  await step('Money favourites, search and emergency fund: one tap adds with Undo, search words make chips with a count and total, the meter shows months', async () => {
    await open('money')
    let frame = await waitFrame()
    const original = await pg.evaluate((k) => moneyStore.getItem(k), KEY)
    await pg.evaluate((k) => {
      const st = JSON.parse(moneyStore.getItem(k) || 'null')
      const iso = (back) => { const d = new Date(); d.setDate(d.getDate() - back); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
      const monthMid = (back) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - back); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-10` }
      st.tx = st.tx.filter((t) => !String(t.id).startsWith('smoke-m3-'))
      st.settings.accounts = st.settings.accounts.filter((a) => a.id !== 'smoke-m3-save')
      st.settings.categories = st.settings.categories.filter((c) => c.id !== 'smoke-m3-ess')
      const acc = (st.settings.accounts.find((a) => a.id === 'wallet') || st.settings.accounts.find((a) => !a.savings)).id
      st.settings.accounts.push({ id: 'smoke-m3-save', name: 'Smoke jar', currency: 'MDL', kind: 'savings', savings: true, start: 102000 })
      st.settings.categories.push({ id: 'smoke-m3-ess', type: 'expense', name: 'Smoke rent', emoji: '🏠' })
      st.settings.emergency = { accounts: ['smoke-m3-save'], essential: ['smoke-m3-ess'] }
      st.settings.favorites = []
      st.settings.updatedAt = Date.now()
      let i = 0
      const add = (note, amount, date, category) => st.tx.push({ id: `smoke-m3-${++i}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date, account: acc, category, note, createdAt: Date.now() + i, updatedAt: Date.now() + i })
      // 15 of them, so it ranks first whatever the demo data holds; the newest is 35, the rest 30.
      for (let d = 1; d <= 15; d++) add('Smoke coffee', d === 1 ? 3500 : 3000, iso(d), 'food')
      for (const b of [1, 2, 3]) add('Smoke rent', 30000, monthMid(b), 'smoke-m3-ess')
      moneyStore.setItem(k, JSON.stringify(st))
    }, KEY)
    await frame.evaluate(() => { location.hash = '#home'; location.reload() })
    await pg.waitForTimeout(2800)
    try {
      frame = await financeFrame()
      await frame.waitForSelector('[data-testid="favs"] .fav-add', { timeout: 11000 })
      const coffee = frame.locator('[data-testid="favs"] .fav:has-text("Smoke coffee")')
      if (!(await coffee.count())) { if (shots) await pg.screenshot({ path: `${shots}/money-fail2.png` }); throw new Error(`no Smoke coffee favourite: ${(await frame.locator('[data-testid="favs"]').innerText()).slice(0, 200)}`) }
      if (!/35/.test(await coffee.first().innerText())) throw new Error('the favourite does not show the latest amount (35)')
      const count = async () => (await stored()).tx.filter((t) => t.note === 'Smoke coffee').length
      const before = await count()
      await coffee.first().locator('.fav-add').click()
      await frame.waitForSelector('#toast:not([hidden]) button', { timeout: 5500 })
      await pg.waitForFunction(([k, n]) => (JSON.parse(moneyStore.getItem(k)).tx || []).filter((t) => t.note === 'Smoke coffee').length === n, [KEY, before + 1], { timeout: 11000 })
      const added = (await stored()).tx.filter((t) => t.note === 'Smoke coffee').sort((a, b) => b.createdAt - a.createdAt)[0]
      if (added.amount !== 3500) throw new Error(`added ${added.amount}, expected the latest amount 3500`)
      await frame.evaluate(() => document.querySelector('#toast button')?.click())
      await pg.waitForFunction(([k, n]) => (JSON.parse(moneyStore.getItem(k)).tx || []).filter((t) => t.note === 'Smoke coffee').length === n, [KEY, before], { timeout: 11000 })
      // Pin keeps it; right-click opens the form to edit before adding.
      await frame.locator('[data-testid="favs"] .fav:has-text("Smoke coffee") .fav-pin').first().click()
      await frame.waitForSelector('[data-testid="favs"] .fav.pinned:has-text("Smoke coffee")', { timeout: 5500 })
      await frame.locator('[data-testid="favs"] .fav-add').first().click({ button: 'right' })
      await frame.waitForSelector('.sheet #tx-amount, .sheet input[inputmode="decimal"]', { timeout: 5500 })
      if ((await count()) !== before) throw new Error('right-click added a record')
      await pg.keyboard.press('Escape')

      // Emergency fund: 102 000 cents of savings / 300 a month = 3.4 months.
      await frame.waitForSelector('[data-testid="emergency-months"]', { timeout: 5500 })
      const months = await frame.locator('[data-testid="emergency-months"]').innerText()
      if (!/^3[.,]4 months$/.test(months.trim())) throw new Error(`emergency fund shows "${months}", expected 3.4 months [stored ${JSON.stringify((await stored()).settings.emergency)} ${JSON.stringify((await stored()).settings.accounts.map((a) => a.id))}]: ${(await frame.locator('[data-testid="emergency"]').innerText()).replace(/\s+/g, ' ')}`)
      if ((await frame.locator('[data-testid="emergency"] .ef-mark').count()) !== 2) throw new Error('the meter has no 3 and 6 month marks')
      if (!(await frame.locator('[data-testid="emergency"] .ef-advice').innerText()).trim()) throw new Error('no advice line')

      // Search: words, chips, count and total.
      await frame.evaluate(() => { location.hash = '#log' })
      await frame.waitForSelector('#search', { timeout: 5500 })
      const today = await pg.evaluate(() => { const d = new Date(); return `${d.getDate()} ${['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][d.getMonth()]}` })
      await frame.fill('#search', `smoke coffee under 40 from 1 jan to ${today}`)
      await frame.waitForSelector('[data-testid="search-chips"] .sq-chip', { timeout: 5500 })
      const chips = await frame.locator('[data-testid="search-chips"] .sq-chip > span').allInnerTexts()
      if (chips.length !== 4 || !chips.includes('Under 40') || !/^From 1 Jan To /.test(chips[3])) throw new Error(`chips: ${chips.join(' | ')}`)
      const card = () => frame.locator('.search-card').innerText()
      let c = await card()
      if (!/15 records/.test(c) || !/455/.test(c)) throw new Error(`result line: ${c.replace(/\s+/g, ' ').slice(0, 160)}`)
      // Remove a chip: "over 29 under 31" is the 14 records of 30, and without "under 31" it is all 15.
      await frame.fill('#search', 'smoke coffee over 29 under 31')
      await frame.waitForFunction(() => /14 records/.test(document.querySelector('.search-card')?.textContent || ''), null, { timeout: 5500 })
      await frame.locator('[data-testid="search-chips"] .sq-chip:has-text("Under 31") button').click()
      await frame.waitForFunction(() => /15 records/.test(document.querySelector('.search-card')?.textContent || ''), null, { timeout: 5500 })
      if ((await frame.locator('[data-testid="search-chips"] .sq-chip').count()) !== 3) throw new Error('removing a chip did not drop it')
      await frame.fill('#search', '')
    } finally {
      await pg.evaluate(([k, o]) => { if (o == null) moneyStore.removeItem(k); else moneyStore.setItem(k, o) }, [KEY, original])
      await frame.evaluate(() => { location.hash = '#home'; location.reload() }).catch(() => {})
      await pg.waitForTimeout(1500)
    }
  })
}
