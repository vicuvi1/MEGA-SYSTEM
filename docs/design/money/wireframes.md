# Money v2: wireframes

> These go with [money-v2-plan.md](money-v2-plan.md). They are desktop first (Finance Helper inside the
> Windows app, 1280 px wide) and use made-up data only. Each screen has one primary action.

## Phase 2: books

### W2.1 Book switch (Finance Helper header; the Life Money page has the same control)
```
┌──────────────────────────────────────────────────────────────────────────┐
│ ☰  Finance Helper          [ Personal │ Business │ Both ]      🔍  ⚙     │
│    Home · Log · Accounts · Goals · Plan · People · Reports               │
└──────────────────────────────────────────────────────────────────────────┘
```
- The switch shows only while Settings → Books is on.
- It is remembered per device. The Life Money page opens on Personal.
- Keyboard: `B` cycles through the three.

### W2.2 Business home
```
┌ Business · November 2026 ───────────────────────────── ◀ Nov ▶ ┐
│  Profit                Income        Costs        Paid to you   │
│  18 400 MDL            31 000        4 600        8 000         │
├─────────────────────────────────────────────────────────────────┤
│ Unpaid invoices   2 · 1 450 USD                  [ Open list ]  │
│   ⚠ INV-2026-014  Acme Studio   950 USD   9 days overdue        │
│     INV-2026-016  Nova Labs     500 USD   due 20 Nov            │
├─────────────────────────────────────────────────────────────────┤
│ Income per client (2026)                                        │
│   Acme Studio  ████████████████  210 400 MDL  68%               │
│   Nova Labs    ██████            88 100 MDL   28%               │
├─────────────────────────────────────────────────────────────────┤
│ Hours → money   Nov 52 h billed · 590 MDL/h   2026 610 h        │
│ Costs  Software 2 100 · Bank fees 300 · Hardware 2 200          │
│ Business cash  Studio account 64 200 MDL · runway 4 months      │
└─────────────────────────────────────────────────────────────────┘
```

### W2.3 Add sheet with a book chip
```
┌ New expense ───────────────────────────────────────┐
│  245,00  MDL                                       │
│  Figma                                  📎 receipt │
│  Category  [ Software ▾ ]   Account [ Card ▾ ]     │
│  Book      ( Personal )( ●Business )   ← from category, tap to change │
│                                   [ Save ]         │
└────────────────────────────────────────────────────┘
```

### W2.4 Move records (Log, select mode)
```
┌ Log · November ──────────────── 3 selected  [ Move to Business ] ✕ ┐
│ ☑ 03 Nov  Figma            Software       −245,00 MDL   Personal   │
│ ☑ 05 Nov  Laptop stand     Hardware       −610,00 MDL   Personal   │
│ ☑ 07 Nov  Hosting          Software        −90,00 MDL   Personal   │
└────────────────────────────────────────────────────────────────────┘
 toast:  Moved 3 records to Business            [ Undo ]
 later:  Settings → Books → Recent moves → "3 records, 12 Nov" [ Undo move ]
```

### W2.5 Turning books on (a one-time review; every step can be skipped)
```
┌ Business books ────────────────────────────────────────────┐
│ 1. Which accounts are business?                            │
│    ☐ Wallet   ☐ Card   ☑ Studio account (214 records)      │
│ 2. Your Pay-yourself buffer "Studio account" is business:  │
│    its monthly salary will show as income in Personal and  │
│    "Paid to you" in Business.                              │
│ 3. ☑ Add business categories (Client work, Software,       │
│      Hardware, Bank fees, Taxes, Accounting)               │
│                              [ Turn on ]   Not now         │
└────────────────────────────────────────────────────────────┘
```

## Phase 3: taxes and receipts

### W3.1 Taxes (year summary)
```
┌ Taxes 2026 ──────────────────────── profile [ Individual ▾ ] ┐
│ Taxable income        214 300 MDL    12 records              │
│ − Personal exemption   27 000 MDL    ⚠ 2026 amount not       │
│                                        confirmed: check it   │
│ Estimate (12%)         22 476 MDL                            │
│ Set aside so far       18 000 MDL    ≈ 1 870 MDL a month     │
│ Deadline  CET18 by 30 April 2027                             │
│ 4 records not tagged yet                 [ Tag categories ]  │
│                                     [ Accountant export ]    │
│ Not tax advice. Numbers from the State Tax Service, checked  │
│ 12 Nov 2026. Check with sfs.md or your accountant.           │
└──────────────────────────────────────────────────────────────┘
```

### W3.2 Tag categories
```
┌ Tax tags ────────────────────────────────────────┐
│ Income                                           │
│  Client work     [ Taxable ▾ ]                   │
│  Gifts received  [ Not taxable ▾ ]               │
│ Costs (Business)                                 │
│  Software        [ Deductible ▾ ]                │
│  Hardware        [ Deductible ▾ ]                │
└──────────────────────────────────────────────────┘
```

### W3.3 Accountant export
```
┌ Accountant export ───────────────────────────┐
│ Year [ 2026 ▾ ]   Books [ Business ▾ ]       │
│ Sheets: Summary · Income · Costs · Invoices  │
│         · Receipts (Drive links) · By month  │
│ ⚠ 2 receipts are not in Drive yet            │
│                 [ Save XLSX ]   Save CSV     │
└──────────────────────────────────────────────┘
```

### W3.4 Record with receipts
```
┌ Figma · 245,00 MDL ───────────────────────────────┐
│ Receipts   [🧾 2026-11-03 … .jpg  ✓ in Drive ]     │
│            [＋ Add photo or PDF ]                  │
│ Tax tag    Deductible (from Software)  change      │
└───────────────────────────────────────────────────┘
 On delete:  "Delete the receipt from Google Drive too?"  [ Yes ] [ Keep it in Drive ]
```

### W3.5 Life Money page warning
```
┌──────────────────────────────────────────────────────────┐
│ 🧾 3 receipts are only on this device. [ Upload now ]    │
└──────────────────────────────────────────────────────────┘
```

## Phase 4: long view

### W4.1 Reports → Long view
```
┌ Reports · Year in review · Long view ─────── [ Personal │ Business │ Both ] ┐
│ Net worth                                     412 300 MDL  +38% in a year  │
│  ▁▂▂▃▃▄▄▅▅▆▆▇▇█   ● snapshot  ○ rebuilt (that day's rate)                  │
│  2023 120 400 · 2024 205 900 · 2025 298 700 · 2026 412 300                 │
├────────────────────────────────────────────────────────────────────────────┤
│ Savings rate   2026 31%   2025 22%       monthly ▂▃▅▃▄▆▅▆▇▅▆               │
├────────────────────────────────────────────────────────────────────────────┤
│ This year vs last (1 Jan – 12 Nov)                                         │
│  Food        14 200 → 12 900   −9%                                         │
│  Transport    3 100 →  4 050  +31%                                         │
├────────────────────────────────────────────────────────────────────────────┤
│ Runway   Personal 7.5 months (reachable 96 000 ÷ 12 800 a month)           │
│          Business 4 months (64 200 ÷ costs + pay 16 050)                   │
└────────────────────────────────────────────────────────────────────────────┘
```

### W4.2 Money page hero line
```
  Safe to spend today 420 MDL  ·  Runway 7.5 months
```

## Phase 5: less typing

### W5.1 To sort
```
┌ To sort · 4 ─────────────────────────────────────────────────────┐
│ 🏦 maib · Today 12:41      GLOVO*KITCHEN           145,00 MDL    │
│   [ Food › Delivery ●●● ] [ Fun ] [ Other… ]          ✕ not mine │
│ 💳 Revolut · Yesterday     FIGMA                    15,00 USD    │
│   [ Software · Business ●●○ ] [ Subscriptions ] [ Other… ]       │
│ 📱 Google Wallet · Yesterday  (also seen in maib)  89,00 MDL     │
│   [ Food › Groceries ●●○ ] [ Home ] [ Other… ]                   │
│ ✎ Records still in Other (1)                                     │
│   02 Nov  "xyz 300"   [ Gifts ●○○ ] [ Fun ] [ Other… ]           │
└──────────────────────────────────────────────────────────────────┘
 ●●● sure (pre-filled)   ●●○ maybe   ●○○ guess.  One tap files it; Undo in the toast.
```

### W5.2 Bills logged by themselves
```
┌ 2 bills logged by themselves ──────────────────────────┐
│ Rent        4 000,00 MDL  1 Nov   [ ✓ ] change  didn't happen │
│ Internet      150,00 MDL  5 Nov   [ ✓ ] change  didn't happen │
│ Electricity  amount changes each month → [ Log amount ]      │
└────────────────────────────────────────────────────────┘
```

### W5.3 Add sheet suggestion
```
  Note [ glovo         ]   →  Food › Delivery · Personal   ●●● sure (7 of 7 times)
```

### W5.4 Settings → Rules
```
┌ Rules ─────────────────────────────────────────────┐
│ Your rules (always win)                            │
│  "bolt"  → Transport › Taxi · Personal       ✕     │
│  "figma" → Software · Business · Deductible  ✕     │
│ Learned from your choices (read-only)              │
│  glovo      Food › Delivery   7/7  [ Make a rule ] │
│  linella    Food › Groceries  11/12                │
└────────────────────────────────────────────────────┘
```

### W5.5 Life Money page card
```
┌──────────────────────────────────────────┐
│ 4 payments to sort        [ Sort now ]   │
└──────────────────────────────────────────┘
```

### W5.6 Telegram reply (made-up)
```
You:  figma 15 usd biz
Bot:  Logged 15,00 USD (≈ 270 MDL) · Software · Business
      [ Card ▾ ] [ Change category ] [ Undo ]
You:  xyz 300
Bot:  Logged 300,00 MDL. Which one?
      [ Gifts ] [ Fun ] [ Food ] [ Other… ]
```
