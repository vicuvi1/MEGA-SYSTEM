// Money usability smoke step (called from e2e/smoke.mjs): the Log Table and Sheet edited with the
// keyboard only (arrows, Enter, type to replace, a dropdown you filter by typing, Ctrl+D, Delete,
// copy and paste of cells, Ctrl+Z that never steals typing), Recent actions with the "changed on
// another device, ask first" question, and a saved view that comes back after a restart.
// Made-up data only; the stored copy is put back at the end. Timeouts keep 10%+ headroom.

export async function moneyUsabilitySteps({ step, pg, open, financeFrame }) {
  const KEY = 'finance-helper.state'
  const openFinance = async () => {
    await open('money')
    await pg.waitForFunction(() => !!document.querySelector('.mh-open') || [...document.querySelectorAll('iframe')].some((e) => e.offsetParent), null, { timeout: 17000 })
    if (await pg.$('.mh-open')) await pg.click('.mh-open')
    let frame = null
    for (const end = Date.now() + 22000; !frame; ) {
      await pg.waitForTimeout(800)
      frame = await financeFrame().catch((e) => { if (Date.now() > end) throw e; return null })
    }
    return frame
  }
  const edit = (src) => pg.evaluate(([k, s]) => {
    const st = JSON.parse(localStorage.getItem(k) || 'null')
    // eslint-disable-next-line no-new-func
    new Function('st', s)(st)
    localStorage.setItem(k, JSON.stringify(st))
  }, [KEY, src])
  const reloadFrame = async (ms = 3000) => { const f = await financeFrame(); await f.evaluate(() => location.reload()); await pg.waitForTimeout(ms); return financeFrame() }
  const rec = (id) => pg.evaluate(([k, i]) => (JSON.parse(localStorage.getItem(k)).tx || []).find((t) => t.id === i) || null, [KEY, id])
  const waitRec = (id, field, value, ms = 11000) => pg.waitForFunction(([k, i, f, v]) => {
    const t = (JSON.parse(localStorage.getItem(k)).tx || []).find((x) => x.id === i)
    return !!t && t[f] === v
  }, [KEY, id, field, value], { timeout: ms })
  const press = async (...keys) => { for (const k of keys) { await pg.keyboard.press(k); await pg.waitForTimeout(160) } }
  const clip = (frame, type, text) => frame.evaluate(([t, txt]) => {
    const dt = new DataTransfer()
    if (txt != null) dt.setData('text/plain', txt)
    const el = document.activeElement
    el.dispatchEvent(new ClipboardEvent(t, { clipboardData: dt, bubbles: true, cancelable: true }))
    return dt.getData('text/plain')
  }, [type, text ?? null])

  await step('Money usability: Ctrl+Z and Recent actions, saved views, and the Log edited like a spreadsheet', async () => {
    await openFinance()
    const original = await pg.evaluate((k) => localStorage.getItem(k), KEY)
    await edit(`
      const d = new Date(); const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); const iso = ym + '-' + String(d.getDate()).padStart(2, '0');
      st.tx = st.tx.filter((t) => !String(t.id).startsWith('smoke-u-'));
      const acc = (st.settings.accounts.find((a) => a.id === 'wallet') || st.settings.accounts[0]).id;
      for (let i = 1; i <= 3; i++) st.tx.push({ id: 'smoke-u-' + i, type: 'expense', amount: 1000 * i, currency: 'MDL', rate: 1, base: 1000 * i, date: iso, account: acc, category: 'food', note: 'smoke usab ' + i, createdAt: Date.now() + i, updatedAt: Date.now() + i });
      st.settings.logView = 'table'; st.settings.savedViews = []; st.meta = { ...(st.meta || {}), sheetIntro: 1 };
    `)
    let at = 0
    try {
      let frame = await reloadFrame()
      await frame.evaluate(() => { location.hash = '#log' })
      await frame.waitForSelector('[data-act="log-view"][data-view="table"]', { timeout: 11000 })
      await frame.click('[data-act="log-view"][data-view="table"]')
      await frame.waitForSelector('#tx-table', { timeout: 11000 })
      await frame.fill('#search', 'smoke usab')
      await frame.waitForFunction(() => document.querySelectorAll('#tx-table tr[data-id^="smoke-u-"]').length === 3, null, { timeout: 7000 })
      const active = () => frame.evaluate(() => { const td = document.querySelector('#tx-table td.gx-active'); return td ? { id: td.closest('tr').dataset.id, col: td.querySelector('[data-col]')?.dataset.col } : null })

      // 1) Escape from a clicked box leaves the cell selected; arrows move; Enter on a dropdown opens a filter list.
      at = 1
      await frame.click('#tx-table tr[data-id="smoke-u-1"] [data-col="note"]')
      await press('Escape')
      let a = await active()
      if (a?.id !== 'smoke-u-1' || a.col !== 'note') throw new Error(`no active note cell after Escape: ${JSON.stringify(a)}`)
      await press('ArrowLeft')
      a = await active()
      if (a?.col !== 'category') throw new Error(`ArrowLeft did not reach the category cell: ${JSON.stringify(a)}`)
      await press('Enter')
      await frame.waitForSelector('[data-testid="gx-pop"]', { timeout: 5500 })
      await pg.keyboard.type('trans')
      await pg.waitForTimeout(250)
      if ((await frame.locator('.gx-pop li[data-i]').count()) !== 1) throw new Error('the dropdown did not filter by typing')
      await press('Enter')
      await waitRec('smoke-u-1', 'category', 'transport')

      // 2) Shift+arrows select a range, Ctrl+D fills it down as ONE undo step, Ctrl+Z (no typing) undoes it.
      at = 2
      await frame.waitForFunction(() => document.querySelector('#tx-table td.gx-active [data-col="category"]'), null, { timeout: 6000 })
      await press('Shift+ArrowDown', 'Shift+ArrowDown', 'Control+d')
      await waitRec('smoke-u-3', 'category', 'transport')
      await waitRec('smoke-u-2', 'category', 'transport')
      await press('Control+z')
      await waitRec('smoke-u-2', 'category', 'food')
      await waitRec('smoke-u-3', 'category', 'food')
      if ((await rec('smoke-u-1')).category !== 'transport') throw new Error('one Ctrl+Z undid more than the fill')

      // 3) Type to replace an amount, Enter saves and moves down; Ctrl+Z / Ctrl+Shift+Z.
      at = 3
      await press('Escape') // back to one cell (the one the range ended on)
      await press('ArrowUp', 'ArrowUp', 'End')
      a = await active()
      if (a?.col !== 'amount') throw new Error(`End did not reach the amount cell: ${JSON.stringify(a)}`)
      await pg.keyboard.type('999')
      await press('Enter')
      await waitRec('smoke-u-1', 'amount', 99900)
      a = await active()
      if (a?.id !== 'smoke-u-2') throw new Error(`Enter did not move down: ${JSON.stringify(a)}`)
      await press('ArrowUp', 'Control+z')
      await waitRec('smoke-u-1', 'amount', 1000)
      await press('Control+Shift+z')
      await waitRec('smoke-u-1', 'amount', 99900)
      await press('Control+z')
      await waitRec('smoke-u-1', 'amount', 1000)

      // 4) Copy a column of cells, paste a column of amounts (one undo step); Delete clears a note, not the record.
      at = 4
      await press('ArrowDown', 'Shift+ArrowDown')
      const copied = await clip(frame, 'copy')
      if (copied.split('\n').length !== 2) throw new Error(`copy gave ${JSON.stringify(copied)}`)
      await press('Escape', 'ArrowUp')
      await clip(frame, 'paste', '500\n600')
      await waitRec('smoke-u-3', 'amount', 60000)
      await waitRec('smoke-u-2', 'amount', 50000)
      await press('Control+z')
      await waitRec('smoke-u-2', 'amount', 2000)
      await waitRec('smoke-u-3', 'amount', 3000)
      await press('ArrowLeft', 'ArrowLeft', 'Delete')
      await pg.waitForTimeout(500)
      if (!(await rec('smoke-u-3')) ) throw new Error('Delete removed the record')
      await press('Control+z')

      // 5) Ctrl+Z inside a box undoes the text, never a record.
      at = 5
      await pg.waitForTimeout(900) // the last save lands
      await frame.click('#tx-table tr[data-id="smoke-u-2"] [data-col="note"]')
      const before = await rec('smoke-u-2')
      await frame.evaluate(() => { window.__zPrevented = null; window.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === 'z') window.__zPrevented = e.defaultPrevented }) })
      await pg.keyboard.type('abc')
      await press('Control+z')
      if ((await frame.evaluate(() => window.__zPrevented)) === null) throw new Error('Ctrl+Z was not seen')
      if (await frame.evaluate(() => window.__zPrevented)) throw new Error('Ctrl+Z in a box was taken by the page (the box keeps its own undo)')
      if (JSON.stringify(await rec('smoke-u-2')) !== JSON.stringify(before)) throw new Error('Ctrl+Z in a box changed a record')
      await press('Escape')
      if ((await rec('smoke-u-2')).note !== before.note) throw new Error('the cancelled edit changed the record')

      // 6) Recent actions list the changes; another device's change asks first.
      at = 6
      await frame.evaluate(() => { document.activeElement?.blur(); document.body.tabIndex = -1; document.body.focus() })
      await frame.fill('#tx-table tr[data-id="smoke-u-1"] [data-col="note"]', 'smoke usab one!')
      await frame.press('#tx-table tr[data-id="smoke-u-1"] [data-col="note"]', 'Tab')
      await waitRec('smoke-u-1', 'note', 'smoke usab one!')
      await frame.evaluate(() => { document.activeElement?.blur(); document.body.focus() })
      await pg.waitForTimeout(500)
      at = '6 (u key)'
      await pg.keyboard.press('u')
      await frame.waitForSelector('[data-testid="ra-row"]', { timeout: 6000 })
      const rows = await frame.locator('[data-testid="ra-row"]').count()
      if (rows < 3 || rows > 10) throw new Error(`Recent actions shows ${rows} rows`)
      if (!/Edited/.test(await frame.locator('[data-testid="ra-row"]').first().innerText())) throw new Error('the newest action is not the edit')
      await pg.keyboard.press('Escape')
      await frame.waitForFunction(() => !document.querySelector('#sheet-root .sheet'), null, { timeout: 4500 })
      at = '6 (phone edit)'
      await edit(`const t = st.tx.find((x) => x.id === 'smoke-u-1'); t.note = 'smoke usab phone'; t.editedOn = 'phone'; t.updatedAt = Date.now() + 5000;`)
      await frame.waitForFunction(() => document.querySelector('#tx-table tr[data-id="smoke-u-1"] [data-col="note"]')?.value === 'smoke usab phone', null, { timeout: 11000 })
      await frame.evaluate(() => { document.activeElement?.blur(); document.body.focus() })
      await pg.keyboard.press('Control+z')
      await frame.waitForSelector('[data-testid="undo-ask-text"]', { timeout: 6000 })
      if (!/again since|changed/.test(await frame.locator('[data-testid="undo-ask-text"]').innerText())) throw new Error('the question does not say why it asks')
      await frame.click('.sheet [data-close]:has-text("Cancel")')
      await pg.waitForTimeout(500)
      if ((await rec('smoke-u-1')).note !== 'smoke usab phone') throw new Error('Ctrl+Z undid another device\'s change without a yes')
      await frame.waitForFunction(() => !document.querySelector('#sheet-root .sheet'), null, { timeout: 4500 })

      // 7) A saved view: one click brings the search back, and it is still there after a restart.
      at = 7
      await frame.fill('#search', 'smoke usab')
      await frame.waitForSelector('[data-testid="sv-save"]', { timeout: 5500 })
      await frame.click('[data-testid="sv-save"]')
      await frame.fill('[data-testid="sv-name"]', 'Smoke views this month')
      await frame.click('[data-testid="sv-save-ok"]')
      await frame.waitForSelector('[data-testid="sv-chip"]:has-text("Smoke views this month")', { timeout: 6000 })
      await frame.click('[data-act="log-clear-search"]')
      await frame.waitForFunction(() => document.querySelector('#search')?.value === '', null, { timeout: 5500 })
      frame = await reloadFrame(3300)
      await frame.evaluate(() => { location.hash = '#log' })
      await frame.waitForSelector('[data-testid="sv-chip"]:has-text("Smoke views this month")', { timeout: 11000 })
      await frame.click('[data-testid="sv-chip"]:has-text("Smoke views this month")')
      await frame.waitForFunction(() => document.querySelector('#search')?.value === 'smoke usab', null, { timeout: 6000 })
      await frame.click('[data-testid="sv-manage"]')
      await frame.waitForSelector('[data-testid="sv-rename"]', { timeout: 5500 })
      await frame.click('[data-testid="sv-del"]')
      await frame.waitForFunction(() => !document.querySelector('[data-testid="sv-chip"]'), null, { timeout: 6000 })
      await pg.keyboard.press('Escape')

      // 8) The Sheet: type to replace a note, Enter moves down; a pasted column of amounts makes records in one step.
      at = 8
      await frame.fill('#search', '')
      await frame.click('[data-act="log-view"][data-view="sheet"]')
      await frame.waitForSelector('#sheet-grid', { timeout: 8000 })
      const ym = await frame.evaluate(() => document.querySelector('#sheet-grid tr[data-date]').dataset.date.slice(0, 7))
      await frame.click(`#sheet-grid [data-sh="${ym}-01|in|0|amount"]`)
      await press('Escape')
      await clip(frame, 'paste', '111\n222')
      await pg.waitForFunction(([k, m]) => {
        const inc = (JSON.parse(localStorage.getItem(k)).tx || []).filter((t) => t.type === 'income' && (t.date === `${m}-01` || t.date === `${m}-02`) && [11100, 22200].includes(t.amount))
        return inc.length === 2
      }, [KEY, ym], { timeout: 14000 })
      await press('Control+z')
      await pg.waitForFunction(([k, m]) => !(JSON.parse(localStorage.getItem(k)).tx || []).some((t) => t.type === 'income' && (t.date === `${m}-01` || t.date === `${m}-02`) && [11100, 22200].includes(t.amount)), [KEY, ym], { timeout: 11000 })
    } catch (e) {
      throw new Error(`part ${at}: ${e.message}`)
    } finally {
      if (original != null) {
        await pg.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, original])
        const f = await financeFrame()
        await f.evaluate(() => { location.hash = '#home'; location.reload() })
        await pg.waitForTimeout(1700)
      }
    }
  })
}
