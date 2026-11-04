# Desktop app with local data

The Windows app bundles the current web interface. It uses the same PIN,
Turso database, server coach and Telegram bot as the website. It does not start
a second copy of the Telegram bots or use the older desktop database.

Install the Windows setup file from the latest GitHub Release. Sign in with
the app PIN while online on first use to download your data. After that, local
tracking can continue offline. AI replies, Todoist, Google Calendar and Telegram
need a connection; requests to those services are not queued for later execution.

The top desktop bar offers Sync now, Save backup, Check for updates and Sign in
to GitHub. Updates use published GitHub Releases, not unbuilt commits on main.
After a new version is found, choose Update to download and install it.
Private releases use Git Credential Manager from Git for Windows, with GitHub
CLI as a fallback. Credentials stay in the computer's credential store and
are never passed to the page or included in the installer.

## Local database and syncing

The database lives at `%APPDATA%\LifeSystem-CloudDesktop\life-local.sqlite`.
It contains both the cached data and pending offline operations. Each change
must reach this file before it counts as locally saved. Writes use a temporary
file and atomic rename. Reinstalling or updating preserves this folder. The
older `%APPDATA%\LifeSystem` database remains separate and is not imported.

On reconnection, pending changes upload in order. Each has an operation ID and
a server receipt, so retrying a lost response does not apply it twice. A server
version check and the entire write run inside one transaction. A stale write
is not applied as-is; it is merged (below).

When the server changed meanwhile (the phone, Ben, the 10-minute tick or
Sporty write all the time), the change is merged instead of refused
(`rebaseWrite` in `src/renderer/src/web/desktopSync.ts`). Each saved change
keeps the rows it touched, before and after:
- rows only one side changed take that side;
- both changed: fields merge one by one, JSON values (settings blobs, logs)
  merge inside, lists by their `id`/`at`/`day`, counters add both changes,
  times take the later one, anything else keeps the desktop's value;
- a row the desktop deleted stays if the server edited it;
- a new row that got the same id on both sides gets the next free id, and
  rows pointing at it (foreign keys) follow. Later queued changes are then
  merged too and use the new ids; the server keeps the renumbering with the
  receipt (`desktop_sync_done`), so a crash in between repeats nothing.
After a merge the desktop downloads the server copy, which holds both sides.
A change that changes nothing is not queued. Only when a merged change still
breaks a rule of the data does sync stop with "Sync conflict"; then save a
backup before "Back up and use server copy".

Local database files and backups contain personal data. Keep them out of Git.
The database file is ordinary SQLite; the app PIN controls the interface, not
filesystem encryption.

## Build and release

Use Node 22 and npm. The modern desktop does not require compiling the older
better-sqlite3 native dependency:

```powershell
npm ci --ignore-scripts
node node_modules/electron/install.js
npm run typecheck
npm test
npm run dist
```

The installer is written to `release/Life-System-Setup-VERSION.exe`.
`npm run dev` builds and opens the modern desktop; `npm run dev:legacy` starts
the older Electron implementation. Every push to main that changes the app
publishes `vMAJOR.MINOR.(1000 + run number)` automatically (`release.yml`), so
the desktop never falls behind the website; the app looks for it on start and
every 4 hours and shows "Update to …". A pushed `vVERSION` tag
(`npm run release`, minor by default) publishes exactly that version and must
be higher than the automatic ones.

The renderer is loaded from the bundled `life-system://app` origin. Requests
under `/api/` are forwarded to the production website by the main process.
Only this bundled window can invoke the narrow local storage/update IPC bridge.
The renderer has no Node access. External web links open in the browser.

Tests use synthetic databases. The desktop sync tests cover restart recovery,
conflicts, lost acknowledgements and disk failures. Validate release checks
against published builds; development mode intentionally skips installation.
