// Money batch 2 smoke steps (called from e2e/smoke.mjs, kept here so the big
// file only gains one line): budgets from the last 3 months (Save + Undo), the
// month review card on the 1st to 7th (dismiss), the net worth line, and the
// subscriptions list with their yearly cost (Keep and the reminder survive a
// reload). The clock is moved to 3 March 2031 for these steps and put back at
// the end; made-up records only, the stored copy is restored after each step.
// MONEYB2_SHOTS=<dir> saves 1920-wide screenshots of the review card, the net worth line and the subscriptions list.

export async function moneyB2Steps({ step, pg, open, financeFrame, resetClock }) {
  const KEY = 'finance-helper.state'
  const shots = process.env.MONEYB2_SHOTS
  const AT = new Date(2031, 2, 3, 12, 0, 0)
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
    await pg.context().clock.setSystemTime(resetClock())
    if (original == null) return
    await pg.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, original])
    const frame = await financeFrame()
    await frame.evaluate(() => { try { localStorage.removeItem('finance-helper.monthReviewDismissed') } catch {} location.reload() })
    await pg.waitForTimeout(1500)
  }
  const stored = () => pg.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY)
  const SEED = `
    const now = Date.now();
    st.tx = st.tx.filter((t) => !String(t.id).startsWith('smoke-b2-'));
    const acc = (st.settings.accounts.find((a) => a.id === 'wallet') || st.settings.accounts[0]).id;
    const rec = (id, date, amount, extra) => st.tx.push({ id: 'smoke-b2-' + id, type: 'expense', amount, currency: st.settings.currency || 'MDL', rate: 1, base: amount, date, account: acc, category: 'food', note: 'smoke ' + id, createdAt: now, updatedAt: now, ...extra });
    rec('d', '2030-12-05', 31000); rec('j', '2031-01-05', 45000); rec('f', '2031-02-05', 60000);
    rec('oneoff', '2031-01-20', 150000);
    st.tx.push({ id: 'smoke-b2-pay', type: 'income', amount: 500000, currency: st.settings.currency || 'MDL', rate: 1, base: 500000, date: '2031-02-01', account: acc, category: 'work', note: 'smoke pay', createdAt: now, updatedAt: now });
    const food = st.settings.categories.find((c) => c.id === 'food');
    food.budget = 40000; food.updatedAt = now;
  `
  const toHome = async (frame) => {
    await frame.evaluate(() => { location.hash = '#home'; })
    await frame.waitForSelector('[data-testid="b2-review"], .home-top', { timeout: 8000 })
  }

  await step('Money month review and net worth line: the card shows on the 1st to 7th with the right numbers, Dismiss hides it for the month; the line has the month ends', async () => {
    await openFinance()
    await pg.context().clock.setSystemTime(AT)
    const original = await seed(SEED)
    try {
      const frame = await financeFrame()
      await toHome(frame)
      await frame.waitForSelector('[data-testid="b2-review"]', { timeout: 8000 })
      const card = (await frame.locator('[data-testid="b2-review"]').innerText()).replace(/\s+/g, ' ')
      if (!/February review/.test(card)) throw new Error(`review title: ${card.slice(0, 120)}`)
      if (!/600 MDL/.test(card) || !/↓ 69% vs the month before/.test(card) || /\bNaN\b/.test(card)) throw new Error(`review numbers: ${card}`)
      if (!/Food was 50% over budget/.test(card)) throw new Error(`review tip: ${card}`)
      if (!(await frame.locator('[data-testid="b2-review"] [data-act="recap-open"]').count())) throw new Error('no Open full recap button')
      const nwText = (await frame.locator('[data-testid="b2-networth"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      if (!/Net worth/.test(nwText) || !/vs /.test(nwText)) throw new Error(`net worth card: ${nwText}`)
      const st = await stored()
      const live = await frame.evaluate(async () => {
        const L = await import(new URL('./js/monthreview.js', location.href).href)
        const M = await import(new URL('./js/model.js', location.href).href)
        const s = M.normalizeState(JSON.parse(localStorage.getItem('finance-helper.state')))
        const nw = L.netWorthLine(s, '2031-03-03')
        return { n: nw.points.length, jan: nw.points.find((p) => p.key === '2031-01').value, feb: nw.points.find((p) => p.key === '2031-02').value, today: nw.points.at(-1).value, now: nw.now }
      })
      if (live.today !== live.now || live.n < 2 || live.n > 13) throw new Error(`net worth line: ${JSON.stringify(live)}`)
      // Feb end = Jan end + income 5 000 - 600 food.
      if (live.feb - live.jan !== 500000 - 60000) throw new Error(`month ends: ${JSON.stringify(live)}`)
      if (shots) {
        await pg.setViewportSize({ width: 1920, height: 1080 })
        await pg.waitForTimeout(500)
        await frame.locator('[data-testid="b2-review"]').screenshot({ path: `${shots}/money-b2-review.png` })
        await frame.locator('[data-testid="b2-networth"]').screenshot({ path: `${shots}/money-b2-networth.png` })
      }
      await frame.click('[data-testid="b2-review-dismiss"]')
      await pg.waitForTimeout(400)
      if (await frame.locator('[data-testid="b2-review"]').count()) throw new Error('the card is still there after Dismiss')
      await frame.evaluate(() => location.reload())
      await pg.waitForTimeout(2500)
      if (await frame.locator('[data-testid="b2-review"]').count()) throw new Error('the card came back after a reload')
      // Nothing was written to the money data.
      if (JSON.stringify((await stored()).tx) !== JSON.stringify(st.tx)) throw new Error('records changed')
      // After the 7th: no card.
      await pg.context().clock.setSystemTime(new Date(2031, 2, 8, 12, 0, 0))
      await frame.evaluate(() => { try { localStorage.removeItem('finance-helper.monthReviewDismissed') } catch {} location.reload() })
      await pg.waitForTimeout(2500)
      if (await frame.locator('[data-testid="b2-review"]').count()) throw new Error('review shown on the 8th')
    } finally {
      await restore(original)
    }
  })

  await step('Money budgets from the last 3 months: rounded averages without one-offs, Save writes the ticked ones, Undo puts the old budget back', async () => {
    await openFinance()
    await pg.context().clock.setSystemTime(AT)
    const original = await seed(SEED)
    try {
      const frame = await financeFrame()
      await frame.evaluate(() => { location.hash = '#plan' })
      await frame.waitForSelector('[data-act="plan-tab"][data-tab="budgets"]', { timeout: 8000 })
      await frame.click('[data-act="plan-tab"][data-tab="budgets"]')
      await frame.waitForSelector('[data-testid="b2-suggest-btn"]', { timeout: 5000 })
      await frame.click('[data-testid="b2-suggest-btn"]')
      await frame.waitForSelector('[data-testid="b2-form"]', { timeout: 5000 })
      // Food: (310 + 450 + 600) / 3 = 453,33 -> 500; the 1 500 one-off is left out.
      const v = await frame.inputValue('[data-b2-val="food"]')
      if (v !== '500') throw new Error(`Food suggestion ${v} (want 500)`)
      if (shots) {
        await pg.setViewportSize({ width: 1920, height: 1080 })
        await pg.waitForTimeout(400)
        await pg.screenshot({ path: `${shots}/money-b2-suggest.png` })
      }
      // Unticked ones are not saved.
      await frame.fill('[data-b2-val="food"]', '480')
      await frame.click('[data-testid="b2-save"]')
      await pg.waitForFunction((k) => JSON.parse(localStorage.getItem(k)).settings.categories.find((c) => c.id === 'food').budget === 48000, KEY, { timeout: 6000 })
      await frame.evaluate(() => document.querySelector('#toast button')?.click())
      await pg.waitForFunction((k) => JSON.parse(localStorage.getItem(k)).settings.categories.find((c) => c.id === 'food').budget === 40000, KEY, { timeout: 6000 })
    } finally {
      await restore(original)
    }
  })

  await step('Money subscriptions per year: a monthly one shows 12 x its amount, Keep and the reminder note survive a reload', async () => {
    await openFinance()
    await pg.context().clock.setSystemTime(AT)
    const original = await seed(`
      st.recurring = (st.recurring || []).filter((r) => !String(r.id).startsWith('smoke-b2-'));
      const acc = (st.settings.accounts.find((a) => a.id === 'wallet') || st.settings.accounts[0]).id;
      st.recurring = [{ id: 'smoke-b2-rec', createdAt: Date.now(), updatedAt: Date.now(), type: 'expense', amount: 9900, currency: st.settings.currency || 'MDL', account: acc, category: 'fun', note: 'Smoke music app', every: 'month', start: '2030-12-03', lastDone: '2031-03-03', auto: false, paused: false }];
      st.settings.subsKept = {}; st.settings.subsRemind = {};
    `)
    try {
      const frame = await financeFrame()
      await frame.evaluate(() => { location.hash = '#plan' })
      await frame.waitForSelector('[data-act="plan-tab"][data-tab="yearly"]', { timeout: 8000 })
      await frame.click('[data-act="plan-tab"][data-tab="yearly"]')
      await frame.waitForSelector('[data-testid="b2-sub-row"]', { timeout: 5000 })
      const row = frame.locator('[data-testid="b2-sub-row"]', { hasText: 'Smoke music app' })
      const year = (await row.locator('[data-testid="b2-year"]').innerText()).replace(/\s+/g, ' ')
      if (!/1\s?188 MDL/.test(year)) throw new Error(`per year ${year} (want 1 188 MDL)`)
      const total = (await frame.locator('[data-testid="b2-subs-total"]').innerText()).replace(/\s+/g, ' ')
      if (!/per year/.test(total) || !/\d MDL/.test(total)) throw new Error(`total ${total}`)
      if (shots) {
        await pg.setViewportSize({ width: 1920, height: 1080 })
        await pg.waitForTimeout(400)
        await frame.locator('[data-testid="b2-subs"]').screenshot({ path: `${shots}/money-b2-subs.png` })
      }
      await row.locator('[data-op="keep"]').click()
      await pg.waitForTimeout(400)
      await frame.locator('[data-testid="b2-sub-row"]', { hasText: 'Smoke music app' }).locator('[data-op="remind"]').click()
      await pg.waitForFunction((k) => { const s = JSON.parse(localStorage.getItem(k)).settings; return !!s.subsKept?.['rec:smoke-b2-rec'] && !!s.subsRemind?.['rec:smoke-b2-rec'] }, KEY, { timeout: 6000 })
      await frame.evaluate(() => location.reload())
      await pg.waitForTimeout(2500)
      await frame.evaluate(() => { location.hash = '#plan' })
      await frame.waitForSelector('[data-act="plan-tab"][data-tab="yearly"]', { timeout: 8000 })
      await frame.click('[data-act="plan-tab"][data-tab="yearly"]')
      await frame.waitForSelector('[data-testid="b2-remind-note"]', { timeout: 5000 })
      const rec = (await stored()).recurring.find((r) => r.id === 'smoke-b2-rec')
      if (!rec || rec.amount !== 9900 || rec.paused) throw new Error(`the recurring record changed: ${JSON.stringify(rec)}`)
    } finally {
      await restore(original)
    }
  })
}
