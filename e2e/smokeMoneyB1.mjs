// Money batch 1 smoke steps (called from e2e/smoke.mjs, kept here so the big
// file only gains one line): a refund lowers spending (and Undo), the goals
// reservations warning with "Lower to", the date of the exchange rate with a
// stale chip, and the duplicate finder. Made-up data only (the seeded Finance
// Helper records). The stored copy is put back at the end of each step.
// MONEYB1_SHOTS=<dir> saves 1920-wide screenshots of the refund sheet and the goals warning.

export async function moneyB1Steps({ step, pg, open, financeFrame }) {
  const KEY = 'finance-helper.state'
  const shots = process.env.MONEYB1_SHOTS
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

  await step('Money refunds: a refund lowers its category spending, is not income, and Undo puts it back', async () => {
    await openFinance()
    const original = await seed(`
      st.settings.categories = st.settings.categories.filter((c) => c.id !== 'tech');
      st.settings.categories.push({ id: 'tech', type: 'expense', name: 'Tech', emoji: '💻', jar: 'living', updatedAt: Date.now() });
      const d = new Date(); const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      st.tx = st.tx.filter((t) => !String(t.id).startsWith('smoke-b1-'));
      const acc = (st.settings.accounts.find((a) => a.id === 'wallet') || st.settings.accounts[0]).id;
      st.tx.push({ id: 'smoke-b1-buy', type: 'expense', amount: 100000, currency: 'MDL', rate: 1, base: 100000, date: iso, account: acc, category: 'tech', note: 'smoke headphones', createdAt: Date.now(), updatedAt: Date.now() });
    `)
    try {
      const frame = await financeFrame()
      const month = (await frame.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }))
      const read = () => model(frame, `const s = M.monthSummary(st, a); return { expense: s.expense, income: s.income, tech: (s.byCategory.find((r) => r.id === 'tech') || {}).amount || 0, bal: M.accountBalances(st) }`, month)
      const before = await read()
      await frame.evaluate(() => { location.hash = '#log' })
      await frame.waitForSelector('[data-act="add"]', { timeout: 8000 })
      await frame.click('[data-act="add"]')
      await frame.waitForSelector('.sheet #tx-form', { timeout: 5000 })
      await frame.click('.sheet .seg button[data-type="income"]')
      await frame.waitForSelector('.sheet [data-testid="tx-refund"]', { timeout: 3000 })
      await frame.check('.sheet [data-testid="tx-refund"]')
      await frame.waitForSelector('.sheet .cat[data-cat="tech"]', { timeout: 3000 })
      if (await frame.locator('.sheet .cat[data-cat="work"]').count()) throw new Error('a refund still lists income categories')
      await frame.click('.sheet .cat[data-cat="tech"]')
      await frame.fill('.sheet #tx-amount', '300')
      await frame.fill('.sheet #tx-note', 'smoke refund headphones')
      if (shots) {
        await pg.setViewportSize({ width: 1920, height: 1080 })
        await pg.waitForTimeout(500)
        await pg.screenshot({ path: `${shots}/money-b1-refund-sheet.png` })
      }
      await frame.click('.sheet button[type="submit"]')
      await pg.waitForFunction((k) => JSON.parse(localStorage.getItem(k) || '{"tx":[]}').tx.some((t) => t.refund === true && t.note === 'smoke refund headphones'), KEY, { timeout: 6000 })
      const rec = await pg.evaluate((k) => JSON.parse(localStorage.getItem(k)).tx.find((t) => t.note === 'smoke refund headphones'), KEY)
      if (rec.type !== 'income' || rec.category !== 'tech' || rec.amount !== 30000) throw new Error(`refund record: ${JSON.stringify(rec)}`)
      const after = await read()
      if (after.expense !== before.expense - 30000) throw new Error(`month spent ${before.expense} -> ${after.expense} (want -30000)`)
      if (after.tech !== before.tech - 30000) throw new Error(`Tech ${before.tech} -> ${after.tech} (want -30000)`)
      if (after.income !== before.income) throw new Error(`income changed ${before.income} -> ${after.income}`)
      const accId = rec.account
      if (after.bal[accId] !== before.bal[accId] + 30000) throw new Error('the account balance did not go up by 300')
      // Undo takes it back out.
      await clickToast(frame)
      await pg.waitForFunction((k) => !JSON.parse(localStorage.getItem(k) || '{"tx":[]}').tx.some((t) => t.note === 'smoke refund headphones'), KEY, { timeout: 6000 })
      const back = await read()
      if (back.expense !== before.expense || back.income !== before.income) throw new Error('Undo did not restore the totals')
    } finally {
      await restore(original)
    }
  })

  await step('Money goals warning: names the goal and the amount, "Lower to" fixes it, Undo puts it back', async () => {
    await openFinance()
    const original = await seed(`
      const now = Date.now();
      st.goals = (st.goals || []).filter((g) => !String(g.id).startsWith('smoke-b1-'));
      st.goalAllocations = (st.goalAllocations || []).filter((a) => !String(a.id).startsWith('smoke-b1-'));
      st.goals.push({ id: 'smoke-b1-goal', name: 'Smoke trip', emoji: '🧳', target: 9000000, account: 'allocated', createdAt: now, updatedAt: now });
      st.goalAllocations.push({ id: 'smoke-b1-ga', goalId: 'smoke-b1-goal', amount: 99999999, currency: st.settings.currency || 'MDL', date: '2026-01-01', createdAt: now + 1e9, updatedAt: now });
    `)
    try {
      const frame = await financeFrame()
      await frame.evaluate(() => { location.hash = '#goals' })
      await frame.waitForSelector('[data-testid="goal-short"]', { timeout: 8000 })
      const text = (await frame.locator('[data-testid="goal-short"]').innerText()).replace(/\s+/g, ' ')
      if (!/Smoke trip/.test(text) || !/short by/.test(text)) throw new Error(`warning does not name the goal and the amount: ${text}`)
      if (!/cash and bank total is .* reservations ask for/.test(text)) throw new Error(`no reason line: ${text}`)
      if (/cannot be funded/.test(text)) throw new Error('the old long text is still there')
      const lower = frame.locator('[data-testid="goal-short"] [data-testid="goal-lower"]')
      if (!(await lower.count())) throw new Error('no "Lower to" button')
      if (!/^Lower to /.test((await lower.first().innerText()).trim())) throw new Error('the button does not say "Lower to"')
      if (!(await frame.locator('[data-testid="goal-short"] [data-act="goal-review"]').count())) throw new Error('no Review button')
      if (shots) {
        await pg.setViewportSize({ width: 1920, height: 1080 })
        await frame.locator('[data-testid="goal-short"]').scrollIntoViewIfNeeded()
        await pg.waitForTimeout(500)
        await pg.screenshot({ path: `${shots}/money-b1-goals-warning.png` })
      }
      const amountOf = () => pg.evaluate((k) => JSON.parse(localStorage.getItem(k)).goalAllocations.find((a) => a.id === 'smoke-b1-ga')?.amount, KEY)
      await lower.first().click()
      await pg.waitForFunction((k) => (JSON.parse(localStorage.getItem(k)).goalAllocations.find((a) => a.id === 'smoke-b1-ga')?.amount || 0) < 99999999, KEY, { timeout: 6000 })
      const lowered = await amountOf()
      if (!(lowered > 0)) throw new Error(`the reservation was released or zeroed (${lowered})`)
      await frame.waitForFunction(() => !document.querySelector('[data-testid="goal-short"]'), null, { timeout: 5000 })
      await clickToast(frame)
      await pg.waitForFunction((k) => JSON.parse(localStorage.getItem(k)).goalAllocations.find((a) => a.id === 'smoke-b1-ga')?.amount === 99999999, KEY, { timeout: 6000 })
    } finally {
      await restore(original)
    }
  })

  await step('Money exchange rates: the date of the rate, and a quiet chip with "Update rates" when it is older than 3 days', async () => {
    await openFinance()
    const iso = (back) => `new Date(Date.now() - ${back} * 864e5)`
    const seedRates = (back) => `
      const d = ${iso(back)}; const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      st.rates = { ...(st.rates || {}), usd: { ...(st.rates?.usd || {}), USD: 1, MDL: 17.6, EUR: 0.88 }, crypto: st.rates?.crypto || {}, history: st.rates?.history || {}, sources: { fiat: { name: 'open.er-api.com', date: day } }, fetchedAt: Date.now() };
    `
    let original = await seed(seedRates(6))
    try {
      const frame = await financeFrame()
      await frame.evaluate(() => { location.hash = '#rates' })
      await frame.waitForSelector('[data-testid="rate-date"]', { timeout: 8000 })
      if (!/^rate from \d{1,2} [A-Z][a-z]{2}$/.test((await frame.locator('[data-testid="rate-date"]').first().innerText()).trim())) throw new Error('the rate date is not shown as "rate from 12 Nov"')
      const chip = (await frame.locator('[data-testid="rate-stale"]').first().innerText()).replace(/\s+/g, ' ')
      if (!/6 days old/.test(chip) || !/Update rates|offline/.test(chip)) throw new Error(`stale chip: ${chip}`)
      const stored = await pg.evaluate((k) => JSON.stringify(JSON.parse(localStorage.getItem(k)).tx), KEY)
      if (!stored) throw new Error('no records')
      await restore(original)
      original = await seed(seedRates(1))
      const f2 = await financeFrame()
      await f2.evaluate(() => { location.hash = '#rates' })
      await f2.waitForSelector('[data-testid="rate-date"]', { timeout: 8000 })
      if (await f2.locator('[data-testid="rate-stale"]').count()) throw new Error('a rate from yesterday shows the stale chip')
    } finally {
      await restore(original)
    }
  })

  await step('Money duplicates: Find duplicates lists a seeded pair, skips a "not a duplicate" pair, removes one, and Undo brings it back', async () => {
    await openFinance()
    const original = await seed(`
      const d = (back) => { const x = new Date(Date.now() - back * 864e5); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
      const acc = (st.settings.accounts.find((a) => a.id === 'wallet') || st.settings.accounts[0]).id;
      st.tx = st.tx.filter((t) => !String(t.id).startsWith('smoke-b1-'));
      const mk = (id, amount, note, back, extra = {}) => ({ id, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date: d(back), account: acc, category: 'food', note, createdAt: Date.now() + back, updatedAt: Date.now(), ...extra });
      st.tx.push(mk('smoke-b1-d1', 77777, 'smoke dup lunch', 1), mk('smoke-b1-d2', 77777, 'Smoke dup lunch', 0));
      st.tx.push(mk('smoke-b1-n1', 66666, 'smoke skip taxi', 1, { notDupe: true }), mk('smoke-b1-n2', 66666, 'smoke skip taxi', 0, { notDupe: true }));
    `)
    try {
      const frame = await financeFrame()
      await frame.evaluate(() => { location.hash = '#log' })
      await frame.waitForSelector('[data-testid="dupes-open"]', { timeout: 8000 })
      await frame.click('[data-testid="dupes-open"]')
      await frame.waitForSelector('.sheet [data-testid="dupe-group"]', { timeout: 5000 })
      const groups = await frame.locator('.sheet [data-testid="dupe-group"]').allInnerTexts()
      const mine = groups.filter((g) => /smoke dup lunch/i.test(g))
      if (mine.length !== 1) throw new Error(`the seeded pair is in ${mine.length} groups`)
      if (groups.some((g) => /smoke skip taxi/i.test(g))) throw new Error('a "not a duplicate" pair is listed')
      const ids = () => pg.evaluate((k) => JSON.parse(localStorage.getItem(k)).tx.map((t) => t.id).filter((i) => i.startsWith('smoke-b1-d')), KEY)
      await frame.click('.sheet [data-testid="dupes-remove"]')
      await pg.waitForFunction((k) => JSON.parse(localStorage.getItem(k)).tx.filter((t) => t.id.startsWith('smoke-b1-d')).length === 1, KEY, { timeout: 12000 }).catch(async () => {
        throw new Error(`the pair was not reduced to one (${JSON.stringify(await ids())}; toast: ${await frame.locator('#toast').innerText().catch(() => '')})`)
      })
      await clickToast(frame)
      await pg.waitForFunction((k) => JSON.parse(localStorage.getItem(k)).tx.filter((t) => t.id.startsWith('smoke-b1-d')).length === 2, KEY, { timeout: 6000 })
    } finally {
      await restore(original)
    }
  })
}
