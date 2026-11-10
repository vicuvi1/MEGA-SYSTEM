# Photo Locker (vault)

> Progress photos, short videos and private files, on every device and backed up to a folder in the owner's own Google Drive.
> Start at [`docs/INDEX.md`](../INDEX.md). Decision: [DECISIONS.md](../DECISIONS.md), "Photo Locker".

## What it does
- Sidebar → Life → **Photo Locker** (page id `locker`). Also linked from Body → Progress photos ("Kept on this device and in Photo Locker").
- **Not encrypted** (the owner's choice). The page says so plainly: "Not encrypted: anyone with access to your Google Drive can see these files."
- Upload (several at once, drag and drop, the phone camera through the file picker), **Progress photo** (camera with a dashed standing outline to line up; "Choose a photo" falls back to the picker). Progress photos carry the tag `progress`.
- Timeline by month (newest first), filters All · Progress photos · Videos · Files, search by name and `#tag`.
- Item view: photo (tap to zoom), video player, file Download / Open; rename, tags, Delete. A progress photo shows that week's average weight and last waist (read-only, from the body log: `core/vaultBody.ts`). Growth level: not shown (the growth files belong to another area).
- Google Drive card: Connect Google Drive, the folder ("My Drive › name", opens Drive), last sync, storage (Locker size and Drive's own numbers), Sync now (also downloads videos and files), Change folder.
- Tile badges: ✓ in Drive and on this device, ☁ in Drive only, ! not backed up yet. A warning line "Not backed up yet: N items on this device, M on another device · Upload now".
- No points.

## Limits (`core/vaultSync.ts`)
- Photos: made smaller in the browser (longest side 2000 px, JPEG 0.86, EXIF dropped, a 360 px thumbnail).
- Videos: at most **60 s** (refused with "This video is 61 seconds long. Videos can be at most 60 seconds: trim it first.") and 150 MB. Kept as they are: re-encoding to 720p in a browser (MediaRecorder runs in real time, WebCodecs is not on every phone) was not reliable enough. A thumbnail frame is made.
- Other files: any type, up to 200 MB.

## How it is built
- **Local:** IndexedDB `life-vault`, store `items` (`vault/vaultStore.ts`): `{id, kind, name, tags, takenAt, sizeBytes, mime, blob?, thumb?, w, h, durationS, driveFileId?, driveFolderId?, syncedAt?, removedHere?, upload?: {url, folderId, at}, updatedAt}`.
- **Synced index:** setting `vault_index` (`core/vaultSync.ts cleanIndex`): the chosen folder and, per item, metadata and the Drive file id. Never image data; at most 3,000 items and 400 KB (old tombstones go first). Saved through `life.vault.saveIndex`, which joins with the saved copy (`mergeIndex`: later change wins, a known Drive link is never lost, a tombstone wins).
- **Drive:** the device talks to `https://www.googleapis.com` directly (`vault/driveApi.ts`) with a short-lived key from `/api/google {op:'driveToken'}`; files never pass through Vercel (4.5 MB body limit). Each Drive file carries `appProperties` `lsApp=locker, lsId, lsKind, lsAt, lsTags, lsDur`, so an item is matched by app id and never uploaded twice. Resumable uploads in 8 MiB pieces with progress; Google's session link is kept on the item, so a reload carries on from where Google stopped (a dead session starts over once). Downloads stream with progress.
- **Sync engine:** pure decisions in `core/vaultSync.ts planSync` (uploads, links to adopt, downloads, rows to learn, drops, the warning counts); the IO in `vault/driveSync.ts`. Runs when the page opens, after something is added, on `life-data-changed` (another device saved the index), when back online, and once ~20 s after the app starts if uploads are waiting. Photos download by themselves; videos and files on a tap or Sync now.
- **Delete:** "Delete" then "Delete from Google Drive too?": Yes = Drive's bin (30 days) and a tombstone so every device drops it; No = removed from this device only (kept in Drive, not downloaded again by itself, "Download to this device" brings it back). An item never backed up is simply gone.
- **Folder:** with the `drive.file` permission the app sees only files and folders it made. "New folder…" makes one (named by the owner; he can move it anywhere in his Drive later, ids stay); "Use a folder made before" lists the app's own folders. **Changing the folder moves** the app's files from the old folder to the new one (a metadata change in Drive, nothing uploaded again). No Google Picker (it needs extra Google scripts in the CSP and an API key).
- **Progress photos:** Body → Progress photos still saves into `life-body-photos` and also adds a Locker copy with the same id (`addProgressPhoto`); opening the Locker brings in older ones (`importProgressPhotos`). `body/bodyPhotos.ts listPhotos` also returns Locker progress photos downloaded from Drive (same API), so the photo compare works on a new device. A Locker delete removes the Body copy too.
- **CSP:** `connect-src` has `https://www.googleapis.com` (vercel.json and index.html).
- **Desktop app:** same page and code. **Phones:** through the website.

## Server
- `api/google.mjs`: `connect {drive:true}` adds `https://www.googleapis.com/auth/drive.file` (incremental: `include_granted_scopes`, the calendar and Gmail stay; `keepGooglePrefs` keeps the calendar picks). `status` returns `drive`. `driveToken` (session required) → `{token, expiresAt}`: the refresh asks Google for the `drive.file` scope only (`src/server/googleCalendar.ts driveAccessToken`), so the key cannot read the calendar or Gmail; a key with more scopes is refused, never handed out. The key is never logged or put in an error. No new `api/` file.


## Food photos from Telegram (2026-11-10)
- A meal photo sent to the bot (single or album, owner's chats only) also goes into the Locker as a food photo: tags `food` + the meal type, file name "2026-11-10 13-05 Lunch - White rice.jpg", Drive folder **Food/YYYY-MM** inside the Locker's folder. Filter chip **Food**.
- **The server never uploads to Drive** (files stay device-to-Google). It only HOLDS a reference: one server-only `sys_kv` row per photo, `lkh:<draft>:<n>` = Telegram's file id, the draft, the time and, after Save, the meal id, name and type (`web/bots/foodLocker.ts`). Never the picture. Cancel or Not this meal erases the rows at once; any row is erased after **3 days**. A photo whose preview was neither saved nor cancelled is offered after 2 hours (unlinked).
- **The app copies it** (`vault/driveSync.ts pullFoodInbox`, on app start, every 30 minutes and at the start of every sync): `/api/google {op:'foodInbox'}` lists the held photos, `{op:'foodInboxGet', id}` fetches one (base64, at most 4 MB; the server tries its bot tokens, none leaves it), the item is kept in IndexedDB with `folderPath`, uploaded in the next sync, and then `{op:'foodInboxDone', ids}` erases the rows (**erase after copy**; also for one another device already put in Drive). Each photo is fetched once.
- **Sub-folders:** the sync lists the folder and the app's own sub-folders in it (`driveApi.listTree`, `appProperties.lsApp = locker-sub`, 3 levels at most), so a photo in Food/2026-11 is never uploaded again; an upload makes a missing sub-folder once. "Use a folder made before" hides sub-folders. Changing the folder moves the app's files and its sub-folders (`folderMovePlan`).
- **Linked to the meal:** the meal's `photos` holds the Locker ids (`fp<draft>n<n>`, the same on every device); Body → Food shows the thumbnail (a 📷 placeholder until the photo arrives).
- Limits: Telegram photos are up to 1280 px (well under the Locker's photo limits); no points.
- Tests: `core/vaultFood.test.ts`, `server/foodTelegram.server.test.ts` (held, listed, fetched once, erased, 3 days); smoke "Photo Locker" (a held photo → Drive under Food/YYYY-MM → the server erases it → the meal row's thumbnail and big view; `FOODPHOTO_SHOTS=<dir>` saves two screenshots).
## Owner set-up
1. In the Google Cloud project of the existing OAuth client: enable the **Google Drive API**, and add the `.../auth/drive.file` scope to the OAuth consent screen (it is a non-sensitive scope: no Google review).
2. Photo Locker → **Connect Google Drive** → allow → **New folder…**.

## Tests
- `core/vaultSync.test.ts` (plan: uploads, no duplicates, downloads, removed here, tombstones, warning, delete flow, folder move, 60 s / size limits, index cap and merge, appProperties), `core/vaultBody.test.ts`.
- `vault/driveApi.test.ts` (fake Drive: pieces with progress, resume after a cut, move, trash, a wrong key).
- `server/googleDrive.server.test.ts` (scope asked, wider key refused, never logged, session required).
- Smoke step "Photo Locker" (fake Drive in `e2e/server.mjs` at `/_fakedrive`, googleapis.com routed there): a made-up photo uploaded on device A → `vault_index` (no image data) → device B (second browser context, phone size) downloads it; a 61 s clip is refused; one file in Drive. `LOCKER_SHOTS=<dir>` saves two screenshots.

## Known gaps
- Not tried against the real Google Drive yet (fakes only). The narrowed-scope refresh and CORS from the desktop app's `life-system://` origin are the parts to watch on first real use.
- Videos are not re-encoded (kept as recorded).
- Uploads carry on only while the app is open (the website has no background upload).
