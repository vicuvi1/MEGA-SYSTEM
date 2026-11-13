# Phone payments: setup

You pay with NFC on your Android phone. Android does not let a website read notifications, so the
free app **MacroDroid** reads the payment notification from maib, Google Wallet, Revolut or Paynet and
sends its text to Life System. Life System saves it at once in **To sort**. You tap what it was for,
and only then does it go into Finance Helper.

## 1. Make a key (in Life System)
1. Open **Settings → Phone payments**.
2. Type a name for the phone (for example "Pixel") and tap **Make a key**.
3. Copy the key now. It starts with `pk_` and is shown only once. Only a fingerprint of it is kept on
   the server.

Each phone gets its own key. **Remove** next to a key stops that phone at once. A key for phone health
numbers does not work here, and this key does not work for health numbers.

## 2. Set up MacroDroid (on the phone)
1. Install **MacroDroid** from Google Play and open it. Tap **Add macro**.
2. **Trigger:** tap **+**, search **Notification** and pick **Notification received**.
   - Choose **Select application(s)** and tick **maib**, **Google Wallet**, **Revolut** and **Paynet**.
   - Set the text content to **Any**.
   - When MacroDroid asks, allow it to read notifications.
3. **Action:** tap **+**, search **HTTP request** and pick it.
   - Method: **POST**.
   - URL: `https://<your Life System address>/api/cron?job=pay` (Settings shows the exact one, with
     **Copy URL**).
   - Header: name `Authorization`, value `Bearer <your key>`.
   - Body, with content type **text/plain**:
     ```
     {"app": "[app_name]", "title": "[notification_title]", "text": "[notification]", "time": "[hour]:[minute]"}
     ```
     Insert each `[name]` with MacroDroid's magic text button (…) so it fills them in. The bracket
     names are what MacroDroid calls the notification's app name, title and text. If yours are
     spelled differently, use the ones its picker shows.
4. Name the macro "Life payments" and save it.

**text/plain** is safest. Life System reads the body as JSON. If a quote or a line break in the
notification breaks the JSON, it still picks out the fields, or uses the whole body as the text.

## 3. Check it
- Tap **Send test** in Settings → Phone payments. Right after you make a key, the test goes through the
  real URL with that key, the same way MacroDroid will. A made-up 1,00 MDL payment at TEST SHOP
  shows under **Last received**, marked "test". It never goes into Finance Helper.
- Then pay for something small. **Last received** lists the last 5 notifications with what was read
  from each one: the amount, the shop, "to sort", or why it was skipped.

## What happens to each notification
| Notification | What Life System does |
|---|---|
| A payment (maib, Google Wallet, Revolut, Paynet or another app with payment words) | Saved to **To sort** with the amount in its own currency and the shop |
| The same tap told by two apps (maib and Google Wallet), same amount and currency within 5 minutes | Kept once, with both apps |
| The same notification sent twice | Kept once |
| A refund | Saved to sort as money back |
| Declined, a 3-D Secure or confirmation code, or money in (a transfer, a top-up) | Kept in Last received as skipped, with the reason |
| No amount with a currency in it | Kept in To sort as "not read", with the reason, so you can type the amount. An amount is never guessed. |

Nothing is ever dropped silently.

## Points
A captured payment pays no points by itself. Once you sort it, it counts as "logged" only if you
sorted it **on the day of the payment**.

## Without MacroDroid
Paste the notification text to the finance bot on Telegram. The same reader saves it to To sort and
tells you what it read.

## If something goes wrong
- **Nothing arrives:** check that MacroDroid may read notifications and that the macro is on. Also
  check that the header is exactly `Authorization` = `Bearer pk_…`.
- **"Not allowed" (401):** the key is wrong or was removed. Make a new one.
- **"Too many" (429):** more than 30 payments came from one phone in 10 minutes. The macro is probably
  looping.
- **503:** the database was briefly unreachable. MacroDroid does not retry, so paste that notification
  to the finance bot.
- **The amount or the shop is read wrong:** the shape of real notifications can differ from the
  made-up ones in the tests. Copy the wording into `src/core/payNotify.fixtures.ts` (`REAL_SHAPES`).
  Change the shop, amount, card digits and balance to made-up ones first, because the repo is public.
