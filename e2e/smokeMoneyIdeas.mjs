// Money ideas smoke steps (called from e2e/smoke.mjs, kept here so the big file
// only gains one line): the money calendar with no-spend days, "Can I afford it?"
// and the wishlist with a wait. Made-up data only: the step puts a small seeded
// Finance Helper state on this device (dated from the real today, so it works on
// any day), checks the screens against it and puts the old data back at the end.
// Screenshots (1920 wide) go to MONEYIDEAS_SHOTS when it is set.

const KEY = 'finance-helper.state'

export async function moneyIdeasSteps({ step, pg, open, financeFrame, storedTx }) {
  let original = null
  const tag = `x${Date.now().toString(36)}` // ids of this run: a record deleted by an earlier run stays deleted
  let P = ''
  let N = ''
  let daysP = 0
  let daysN = 0
  let today = ''

  const frameNow = async () => {
    let frame = null
    for (const end = Date.now() + 25000; !frame; ) {
      await pg.waitForTimeout(800)
      frame = await financeFrame().catch((e) => { if (Date.now() > end) throw e; return null })
    }
    return frame
  }
  const reloadFrame = async () => {
    const f = await financeFrame()
    await f.evaluate(() => location.reload())
    await pg.waitForTimeout(2500)
    return frameNow()
  }
  const openFinance = async () => {
    await open('money')
    await pg.waitForFunction(() => !!document.querySelector('.mh-open') || [...document.querySelectorAll('iframe')].some((e) => e.offsetParent), null, { timeout: 15000 })
    if (await pg.$('.mh-open')) await pg.click('.mh-open')
    return frameNow()
  }
  const shot = async (loc, name) => { if (process.env.MONEYIDEAS_SHOTS) await loc.screenshot({ path: `${process.env.MONEYIDEAS_SHOTS}/${name}.png` }) }

  await step('Money calendar: spent, bills, salary, big buy, tight days and no-spend marks for a seeded month', async () => {
    await pg.setViewportSize({ width: 1920, height: 1080 })
    let frame = await openFinance()
    await pg.waitForTimeout(1500) // nothing waiting to be saved before the seed goes in
    const seeded = await frame.evaluate(([KEY, tag]) => {
      const pad = (n) => String(n).padStart(2, '0')
      const now = new Date()
      const key = (y, m) => { const d = new Date(y, m, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
      // A: a month before the made-up records start (all its days are over). N: next month (all days to come).
      const P = key(now.getFullYear(), now.getMonth() - 3)
      const N = key(now.getFullYear(), now.getMonth() + 1)
      const dim = (k) => new Date(Number(k.slice(0, 4)), Number(k.slice(5)), 0).getDate()
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      const raw = localStorage.getItem(KEY)
      const base = JSON.parse(raw)
      const t = (id, date, amount, extra = {}) => ({ id, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date, category: 'food', account: 'card', note: '', createdAt: 1, updatedAt: 1, ...extra })
      const rule = (id, type, amount, note, every, start, lastDone) => ({ id, type, amount, currency: 'MDL', account: 'card', category: type === 'income' ? 'work' : 'home', note, every, start, ...(lastDone ? { lastDone } : {}), createdAt: 1, updatedAt: 1 })
      const day = new Date(now.getTime() - 10 * 864e5)
      const tenAgo = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
      // Added next to what is there (the app merges the made-up records back in anyway); taken out again at the end.
      const next = {
        ...base,
        settings: { ...base.settings, wishlist: [], wishlistDays: 7, moneyFloor: 0, updatedAt: Date.now() },
        tx: [...base.tx,
          t(`mi-1-${tag}`, `${P}-01`, 500000, { type: 'income', category: 'work' }),
          t(`mi-2-${tag}`, `${P}-03`, 30000), t(`mi-3-${tag}`, `${P}-05`, 20000),
          t(`mi-4-${tag}`, `${P}-08`, 120000, { category: 'fun', note: 'Headphones' }),
          t(`mi-5-${tag}`, `${P}-10`, 40000, { type: 'transfer', from: 'card', to: 'safe', category: undefined, account: undefined }),
        ],
        recurring: [...(base.recurring || []),
          rule(`mr-1-${tag}`, 'expense', 150000, 'Rent', 'once', `${P}-20`, `${P}-20`),
          rule(`mr-2-${tag}`, 'income', 400000, 'Salary', 'once', `${P}-28`, `${P}-28`),
          rule(`mr-3-${tag}`, 'expense', 150000, 'Rent', 'month', `${N}-20`),
          rule(`mr-4-${tag}`, 'income', 400000, 'Salary', 'month', `${N}-28`),
        ],
        goals: [...(base.goals || []), { id: `mg-1-${tag}`, name: 'Laptop', emoji: '💻', target: 3000000, account: 'manual', saved: 0, history: [{ date: tenAgo, amount: 300000 }], deadline: null, doneAt: null, updatedAt: 1 }],
      }
      localStorage.setItem(KEY, JSON.stringify(next))
      return { raw, P, N, daysP: dim(P), daysN: dim(N), today }
    }, [KEY, tag])
    original = JSON.parse(seeded.raw).settings
    ;({ P, N, daysP, daysN, today } = seeded)
    frame = await reloadFrame()
    await frame.evaluate(() => { location.hash = '#calendar' })
    await frame.waitForSelector('[data-testid="money-calendar"]', { timeout: 10000 })
    if (!(await frame.locator('.subtabs a[aria-current="page"]', { hasText: 'Calendar' }).count())) throw new Error('Calendar is not a tab next to Plan')
    // Three months back (before the made-up records): every day is over.
    for (let i = 0; i < 3; i++) await frame.click('[data-act="mc-prev"]')
    await frame.waitForSelector(`[data-testid="mc-day"][data-date="${P}-08"]`, { timeout: 5000 })
    const cell = (d) => frame.locator(`[data-testid="mc-day"][data-date="${P}-${String(d).padStart(2, '0')}"]`)
    // Spent that day, to the lei: the 30 000 / 20 000 / 1 200 records.
    if (!/−\s?300/.test(await cell(3).innerText())) throw new Error(`the 3rd does not show 300 spent: ${await cell(3).innerHTML()} ${JSON.stringify((await storedTx()).map((t) => t.id + t.date))} P=${P} ${await frame.locator('.mc h2').innerText()}`)
    if (!/−\s?1[\s ]?200/.test(await cell(8).innerText())) throw new Error(`the 8th does not show 1 200 spent: ${await cell(8).innerText()}`)
    if (!(await cell(8).locator('.mc-big').count())) throw new Error('the big buy has no star')
    if (!(await cell(20).locator('.mc-bill').count())) throw new Error('the rent on the 20th is not shown')
    if (!(await cell(28).locator('.mc-inc').count())) throw new Error('the salary on the 28th is not shown')
    // A transfer is no spending: the 10th is a no-spend day, the 3rd, 5th and 8th are not.
    if (!(await cell(10).locator('.mc-ns').count())) throw new Error('the 10th (only a transfer) is not marked no-spend')
    for (const d of [3, 5, 8]) if (await cell(d).locator('.mc-ns').count()) throw new Error(`day ${d} has spending but a no-spend mark`)
    const header = (await frame.locator('[data-testid="mc-nospend"]').innerText()).replace(/\s+/g, ' ')
    const want = daysP - 3
    if (!new RegExp(`^${want} no-spend days`).test(header)) throw new Error(`header "${header}", expected ${want} no-spend days`)
    const marks = await frame.locator('.mc-cell.nospend').count()
    if (marks !== want) throw new Error(`${marks} marked days, expected ${want}`)
    // Tap a day: its records.
    await cell(8).click()
    await frame.waitForSelector('.sheet .tx', { timeout: 5000 })
    if (!/Headphones/.test(await frame.locator('.sheet').innerText())) throw new Error('the day sheet does not list the record')
    await frame.click('.sheet button[data-close]')
    await shot(frame.locator('main#app'), 'money-ideas-calendar-past')
    // Next month: the money left line and tight days under the safety floor.
    await frame.click('[data-act="mc-today"]')
    await frame.click('[data-act="mc-next"]')
    await frame.waitForSelector(`[data-testid="mc-day"][data-date="${N}-20"]`, { timeout: 5000 })
    const left = async (d) => Number(await frame.locator(`[data-testid="mc-day"][data-date="${N}-${d}"]`).getAttribute('data-left'))
    const l19 = await left(19)
    // The rent on the 20th takes 1 500 off the line, the salary on the 28th adds 4 000.
    if ((await left(20)) !== l19 - 150000) throw new Error(`the 20th: ${await left(20)}, expected ${l19 - 150000}`)
    if ((await left(28)) !== (await left(27)) + 400000) throw new Error('the salary on the 28th does not lift the line by 4 000')
    // A floor just above what is left after the rent: the 20th to the 27th are tight.
    await frame.fill('#mc-floor', String((l19 - 149900) / 100))
    await frame.press('#mc-floor', 'Tab')
    await frame.waitForFunction((n) => document.querySelectorAll('.mc-cell.tight').length === n, 8, { timeout: 6000 }).catch(async () => {
      throw new Error(`tight days: ${await frame.locator('.mc-cell.tight').count()}, expected 8 (the 20th to the 27th)`)
    })
    const tightDays = await frame.locator('.mc-cell.tight').evaluateAll((els) => els.map((e) => Number(e.dataset.date.slice(8))))
    if (tightDays.join() !== '20,21,22,23,24,25,26,27') throw new Error(`tight days: ${tightDays.join()}`)
    if (!(await frame.locator(`[data-testid="mc-day"][data-date="${N}-28"] .mc-inc`).count())) throw new Error('no salary on the 28th')
    await shot(frame.locator('main#app'), 'money-ideas-calendar-next')
    // The floor is a setting kept with the data.
    await pg.waitForFunction(([KEY, v]) => JSON.parse(localStorage.getItem(KEY) || '{}').settings?.moneyFloor === v, [KEY, l19 - 149900], { timeout: 8000 }).catch(() => { throw new Error('the floor was not kept with the data') })
    // Back to a floor of 0 for the steps after.
    await frame.fill('#mc-floor', '')
    await frame.press('#mc-floor', 'Tab')
    await pg.waitForFunction((KEY) => !JSON.parse(localStorage.getItem(KEY) || '{}').settings?.moneyFloor, KEY, { timeout: 8000 })
  })

  await step('Money afford: a price shows safe to spend before and after, goal delay and a verdict, and creates nothing', async () => {
    let frame = await financeFrame()
    await frame.evaluate(() => { location.hash = '#home' })
    await frame.waitForSelector('[data-testid="afford-open"]', { timeout: 10000 })
    const before = JSON.stringify(await storedTx())
    await frame.click('[data-testid="afford-open"]')
    await frame.waitForSelector('#af-price', { timeout: 5000 })
    await frame.fill('#af-price', '1000')
    await frame.waitForSelector('[data-testid="afford-verdict"]', { timeout: 5000 })
    const verdict = (await frame.locator('[data-testid="afford-verdict"]').innerText()).trim()
    if (!/^(Yes, comfortably|Yes, but tight until .+|Not this month)$/.test(verdict)) throw new Error(`verdict: ${verdict}`)
    const safe = (await frame.locator('[data-testid="afford-safe"]').innerText()).replace(/\s+/g, ' ')
    if (!/→/.test(safe) || !/\d/.test(safe)) throw new Error(`safe to spend line: ${safe}`)
    // 3 000 a month towards the laptop: 1 000 is about 4 weeks.
    const sheetText = await frame.locator('.sheet').innerText()
    if (!/Laptop[\s\S]*about 4 weeks later/.test(sheetText)) throw new Error(`no goal delay: ${sheetText.slice(0, 300)}`)
    if (!(await frame.locator('[data-testid="afford-short"]').count())) throw new Error('no "days the money runs short" line')
    // A price bigger than the month: not this month.
    await frame.fill('#af-price', '9999999')
    await frame.waitForFunction(() => /Not this month/.test(document.querySelector('[data-testid="afford-verdict"]')?.textContent || ''), null, { timeout: 5000 })
    await frame.fill('#af-price', '1000')
    await frame.waitForFunction(() => /about 4 weeks later/.test(document.querySelector('.sheet')?.textContent || ''), null, { timeout: 5000 })
    await frame.locator('.sheet').screenshot({ path: process.env.MONEYIDEAS_SHOTS ? `${process.env.MONEYIDEAS_SHOTS}/money-ideas-afford.png` : undefined }).catch((e) => { if (process.env.MONEYIDEAS_SHOTS) throw e })
    if (JSON.stringify(await storedTx()) !== before) throw new Error('the afford sheet changed a stored record')
    // "Add to wishlist instead" puts it on the list, still no record.
    await frame.fill('#af-name', 'Headphones')
    await frame.click('#af-wish')
    await frame.waitForFunction((KEY) => (JSON.parse(localStorage.getItem(KEY) || '{}').settings?.wishlist || []).some((w) => w.name === 'Headphones' && w.price === 100000), KEY, { timeout: 5000 }).catch(async () => { throw new Error(`not on the wishlist: ${await pg.evaluate((KEY) => JSON.stringify(JSON.parse(localStorage.getItem(KEY) || '{}').settings?.wishlist), KEY)} verdictText=${await frame.locator('[data-testid="afford-verdict"]').innerText().catch(() => '')}`) })
    if (JSON.stringify(await storedTx()) !== before) throw new Error('adding to the wishlist created a record')
  })

  await step('Money wishlist: locked for 7 days, then Buy fills the expense sheet (nothing saved), Remove adds to saved by waiting, kept after a reload', async () => {
    let frame = await financeFrame()
    await frame.evaluate(() => { location.hash = '#wishlist' })
    await frame.waitForSelector('[data-testid="wishlist"]', { timeout: 10000 })
    if (!(await frame.locator('.subtabs a[aria-current="page"]', { hasText: 'Wishlist' }).count())) throw new Error('Wishlist is not a tab next to Plan')
    const txBefore = JSON.stringify(await storedTx())
    // The item from the afford sheet is locked: "Ready on <today + 7>", no Buy.
    const ready = await frame.evaluate(() => {
      const d = new Date(Date.now() + 7 * 864e5)
      return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`
    })
    const first = frame.locator('[data-testid="wl-item"]').first()
    if ((await first.getAttribute('data-state')) !== 'locked') throw new Error('a new item is not locked')
    if (!new RegExp(`Ready on ${ready}`).test(await first.innerText())) throw new Error(`no "Ready on ${ready}": ${await first.innerText()}`)
    if (await first.locator('[data-act="wl-buy"]').count()) throw new Error('a locked item has a Buy button')
    // Two more items through the form.
    for (const [name, price] of [['Bike', '3200'], ['Lamp', '150']]) {
      await frame.fill('#wl-name', name)
      await frame.fill('#wl-price', price)
      await frame.click('[data-act="wl-add"]')
      await frame.waitForFunction((n) => [...document.querySelectorAll('[data-testid="wl-item"] b')].some((b) => b.textContent === n), name, { timeout: 5000 })
    }
    if (!/3\s?items?|3 items/.test(await frame.locator('[data-testid="wl-total"]').innerText())) throw new Error(`total: ${await frame.locator('[data-testid="wl-total"]').innerText()}`)
    // Days later (a fixed 8 days after they were added): ready, "Still want it?".
    await pg.waitForTimeout(1500)
    await frame.evaluate((KEY) => {
      const s = JSON.parse(localStorage.getItem(KEY))
      const d = new Date(Date.now() - 8 * 864e5)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      for (const w of s.settings.wishlist) if (w.name !== 'Headphones') w.added = iso
      s.settings.updatedAt = Date.now()
      localStorage.setItem(KEY, JSON.stringify(s))
    }, KEY)
    frame = await reloadFrame()
    await frame.evaluate(() => { location.hash = '#wishlist' })
    await frame.waitForSelector('[data-testid="wl-item"]', { timeout: 10000 })
    const states = await frame.locator('[data-testid="wl-item"]').evaluateAll((els) => els.map((e) => `${e.querySelector('b').textContent}:${e.dataset.state}`).sort())
    if (states.join() !== 'Bike:ready,Headphones:locked,Lamp:ready') throw new Error(`states: ${states.join()}`)
    await shot(frame.locator('main#app'), 'money-ideas-wishlist')
    // Remove the lamp: 150 saved by waiting.
    await frame.locator('[data-testid="wl-item"]', { hasText: 'Lamp' }).locator('[data-act="wl-remove"]').click()
    await frame.waitForFunction(() => /Saved by waiting:\s*150\s*MDL/.test((document.querySelector('[data-testid="wl-saved"]')?.textContent || '').replace(/[  ]/g, ' ')), null, { timeout: 5000 })
    // Buy the bike: the normal expense sheet, filled in; no record until it is saved.
    await frame.locator('[data-testid="wl-item"]', { hasText: 'Bike' }).locator('[data-act="wl-buy"]').click()
    await frame.waitForSelector('#tx-amount', { timeout: 5000 })
    if ((await frame.inputValue('#tx-amount')) !== '3200') throw new Error(`the sheet amount is ${await frame.inputValue('#tx-amount')}`)
    if (!/Bike/.test(await frame.locator('.sheet').innerHTML())) throw new Error('the sheet does not carry the name')
    if (JSON.stringify(await storedTx()) !== txBefore) throw new Error('Buy created a record before it was saved')
    await frame.click('.sheet button[data-close]')
    // Saved by waiting survives a reload.
    frame = await reloadFrame()
    await frame.evaluate(() => { location.hash = '#wishlist' })
    await frame.waitForFunction(() => /Saved by waiting:\s*150\s*MDL/.test((document.querySelector('[data-testid="wl-saved"]')?.textContent || '').replace(/[  ]/g, ' ')), null, { timeout: 10000 })
    if (JSON.stringify(await storedTx()) !== txBefore) throw new Error('the wishlist changed a record')
  })

  // Put this device's own Finance Helper data back, whatever the steps above did.
  await step('Money ideas: this device\'s own Finance Helper data is put back', async () => {
    if (original === null) return
    const frame = await financeFrame()
    await pg.waitForTimeout(1500)
    await frame.evaluate(([KEY, settings, tag]) => {
      const s = JSON.parse(localStorage.getItem(KEY))
      const mine = (x) => x.id.endsWith(`-${tag}`)
      s.deleted = { ...(s.deleted || {}) }
      for (const x of [...s.tx, ...(s.recurring || []), ...(s.goals || [])].filter(mine)) s.deleted[x.id] = Date.now()
      s.tx = s.tx.filter((x) => !mine(x))
      s.recurring = (s.recurring || []).filter((x) => !mine(x))
      s.goals = (s.goals || []).filter((x) => !mine(x))
      for (const k of ['wishlist', 'wishlistDays', 'moneyFloor']) { if (k in settings) s.settings[k] = settings[k]; else delete s.settings[k] }
      s.settings.updatedAt = Date.now()
      localStorage.setItem(KEY, JSON.stringify(s))
    }, [KEY, original, tag])
    await reloadFrame()
    const left = (await storedTx()).filter((x) => x.id.endsWith(`-${tag}`)).length
    if (left) throw new Error(`${left} seeded records are still on this device`)
    await pg.setViewportSize({ width: 1440, height: 900 })
  })
}
