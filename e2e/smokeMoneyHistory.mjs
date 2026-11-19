// Money change history smoke step (called from e2e/smoke.mjs): a record changed and deleted
// on "another device" (the stored copy, as Life's sync writes it) shows up in Change history with
// its device and old -> new; Put back restores it (and Undo), Bring back returns the deleted one.
// Made-up data only; the stored copy is put back at the end. Timeouts keep 10%+ headroom.
// MONEYHIST_SHOTS=<dir> saves a 1920-wide screenshot of the screen.

export async function moneyHistorySteps({ step, pg, open, financeFrame }) {
  const KEY = 'finance-helper.state'
  const ID = 'smoke-ch-1'
  const openFinance = async () => {
    await open('money')
    await pg.waitForFunction(() => !!document.querySelector('.mh-open') || [...document.querySelectorAll('iframe')].some((e) => e.offsetParent), null, { timeout: 16500 })
    if (await pg.$('.mh-open')) await pg.click('.mh-open')
    let frame = null
    for (const end = Date.now() + 22000; !frame; ) {
      await pg.waitForTimeout(800)
      frame = await financeFrame().catch((e) => { if (Date.now() > end) throw e; return null })
    }
    return frame
  }
  // What another device's sync would do: rewrite the stored copy (the frame hears it as a storage event).
  const fromOtherDevice = (src) => pg.evaluate(([k, s]) => {
    const st = JSON.parse(moneyStore.getItem(k) || 'null')
    // eslint-disable-next-line no-new-func
    new Function('st', s)(st)
    moneyStore.setItem(k, JSON.stringify(st))
  }, [KEY, src])
  const stored = () => pg.evaluate(([k, id]) => (JSON.parse(moneyStore.getItem(k)).tx || []).find((t) => t.id === id) || null, [KEY, ID])
  const clickToast = (frame) => frame.evaluate(() => document.querySelector('#toast button')?.click())

  await step('Money change history: an edit from another device shows old -> new and its device, Put back restores it with Undo, a deleted record comes back', async () => {
    await openFinance()
    const original = await pg.evaluate((k) => moneyStore.getItem(k), KEY)
    await fromOtherDevice(`
      const d = new Date(); const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      st.tx = st.tx.filter((t) => t.id !== '${ID}');
      if (st.deleted) delete st.deleted['${ID}'];
      const acc = (st.settings.accounts.find((a) => a.id === 'wallet') || st.settings.accounts[0]).id;
      st.tx.push({ id: '${ID}', type: 'expense', amount: 12000, currency: 'MDL', rate: 1, base: 12000, date: iso, account: acc, category: 'food', note: 'smoke history lunch', createdAt: Date.now(), updatedAt: Date.now() });
    `)
    // Reload only the Money frame so the seeded record is its starting point (the copy is put back below).
    let frame = await financeFrame()
    await frame.evaluate(() => location.reload())
    await pg.waitForTimeout(2800)
    try {
      frame = await financeFrame()
      await frame.evaluate(() => { location.hash = '#changes' })
      await frame.waitForSelector('[data-testid="changes-screen"]', { timeout: 11000 })
      // The edit arrives from "another device" (stamped Web).
      await fromOtherDevice(`const t = st.tx.find((x) => x.id === '${ID}'); t.amount = 15000; t.base = 15000; t.updatedAt = Date.now() + 1000; t.editedOn = 'web';`)
      await frame.waitForFunction(() => [...document.querySelectorAll('[data-testid="ch-entry"]')].some((e) => /smoke history lunch/.test(e.textContent) && /Amount/.test(e.textContent)), null, { timeout: 11000 })
      const head = await frame.locator('[data-testid="ch-step"]').first().innerText()
      if (!/Web/.test(head)) throw new Error(`the entry does not name the device: ${head.slice(0, 120)}`)
      // Filters: only Web, then only this record.
      await frame.selectOption('[data-testid="ch-dev"]', 'web')
      await frame.click('.ch-rec:has-text("smoke history lunch")')
      await frame.waitForSelector('[data-testid="ch-rec-clear"]', { timeout: 5500 })
      const entry = frame.locator('[data-testid="ch-entry"][data-act-kind="edit"]').first()
      const lines = await entry.innerText()
      if (!/Amount/.test(lines) || !/→/.test(lines)) throw new Error(`no old -> new line: ${lines.slice(0, 160)}`)
      // Put back: the stored record is 120 again, newer than the edit (so it wins the sync).
      const edited = (await stored()).updatedAt
      await entry.locator('[data-testid="ch-back"]').click()
      await pg.waitForFunction(([k, id]) => (JSON.parse(moneyStore.getItem(k)).tx || []).find((t) => t.id === id)?.amount === 12000, [KEY, ID], { timeout: 11000 })
      const back = await stored()
      if (!(back.updatedAt > edited)) throw new Error('the put back record is not stamped as changed now')
      await frame.click('[data-testid="ch-rec-clear"]')
      await frame.selectOption('[data-testid="ch-dev"]', '')
      await frame.waitForSelector('[data-testid="ch-entry"][data-act-kind="putback"]', { timeout: 5500 })
      if (process.env.MONEYHIST_SHOTS) await pg.setViewportSize({ width: 1920, height: 1000 }).then(() => frame.locator('#app').screenshot({ path: `${process.env.MONEYHIST_SHOTS}/money-change-history.png` })).catch(() => {})
      // Undo from the toast: back to 150, logged as an undo.
      await clickToast(frame)
      await pg.waitForFunction(([k, id]) => (JSON.parse(moneyStore.getItem(k)).tx || []).find((t) => t.id === id)?.amount === 15000, [KEY, ID], { timeout: 9000 })
      await frame.waitForSelector('[data-testid="ch-entry"][data-act-kind="undo"]', { timeout: 5500 })
      // Deleted on another device: "Deleted only", then Bring back.
      await fromOtherDevice(`st.tx = st.tx.filter((x) => x.id !== '${ID}'); st.deleted = { ...(st.deleted || {}), '${ID}': Date.now() + 2000 };`)
      await frame.waitForFunction(() => [...document.querySelectorAll('[data-testid="ch-entry"][data-act-kind="delete"]')].some((e) => /smoke history lunch/.test(e.textContent)), null, { timeout: 11000 })
      await frame.selectOption('select[data-ch="kind"]', 'deleted')
      const del = frame.locator('[data-testid="ch-entry"][data-act-kind="delete"]', { hasText: 'smoke history lunch' }).first()
      if (!/Bring back/.test(await del.innerText())) throw new Error('the deleted record has no Bring back')
      await del.locator('[data-testid="ch-back"]').click()
      await pg.waitForFunction(([k, id]) => (JSON.parse(moneyStore.getItem(k)).tx || []).find((t) => t.id === id)?.amount === 15000, [KEY, ID], { timeout: 11000 })
      const st = await pg.evaluate((k) => JSON.parse(moneyStore.getItem(k)), KEY)
      if (st.deleted?.[ID]) throw new Error('the tombstone is still there after Bring back')
      await frame.selectOption('select[data-ch="kind"]', 'all')
    } finally {
      if (original != null) {
        await pg.evaluate(([k, v]) => moneyStore.setItem(k, v), [KEY, original])
        const f = await financeFrame()
        await f.evaluate(() => { location.hash = '#home'; location.reload() })
        await pg.waitForTimeout(1600)
      }
    }
  })
}
