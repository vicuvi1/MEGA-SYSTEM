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

## The desktop island

A small always-on-top window at the top center of the screen the mouse is on
(`src/desktop/island.ts`, UI `src/renderer/src/DesktopIsland.tsx`, logic
`src/core/islandModel.ts`). Hidden it is a thin line; while a timer runs, a
block is now or within the hour, or Ben wrote, it is a small pill. Hover or
click opens it: plan now & next (Start), must-dos, water and reps, Ben's last
message and a box to write to him. Time up, a block starting or a new message
from Ben (Telegram, nudges) drop it down for 8 seconds with buttons.

The island never opens the data: the app window, which keeps running hidden in
the tray when you close it, sends it snapshots (`IslandFeed.tsx`) and does what
its buttons ask, so there is one owner of the local database. The main process
polls the real pointer: over the pill/card the window takes clicks, elsewhere
clicks pass through to the apps below.

Placement (tray → Island position, or drag-and-drop it): top of the screen,
docked on the left or right edge (a small vertical tab that slides out), or
floating where you dropped it. Idle at an edge it is fully hidden: touch that
screen edge with the mouse, or press Ctrl+Alt+Space anywhere, to bring it out.

**Quick add from anywhere:** Alt+Space (Ctrl+Shift+Space when another app
holds it; Settings → Quick add, tray → Quick add) opens a small box over any
app. Like the island it never opens the data: the line goes to the app window,
which saves it, and a toast with Undo shows for 5 seconds. Details:
[areas/workflow.md](areas/workflow.md) ("Quick add from anywhere").

Life System starts with Windows (`--hidden`, tray only) from the first run of
an installed copy; the tray menu turns that and the island off, and Quit ends
it for real.

### Windows wallpaper per mode (Custom Center)

`src/desktop/wallpaper.ts`, IPC `wallpaper` (app window only), prefs in `wallpaper.json` on that PC. Off by default: Custom Center → Modes → "Change my Windows wallpaper". Switching it on keeps your current wallpaper (read from `HKCU\Control Panel\Desktop`) and switching it off puts it back. When the mode changes, the app window sends the mode's picture (from this device's IndexedDB) and the desktop writes it into its own `wallpapers` folder; or the desktop picks the next picture from a folder you picked for that mode with the Windows folder dialog (images directly inside it, by name, every 15 min to once a day). Safety: one fixed PowerShell script calls `SystemParametersInfo(SPI_SETDESKWALLPAPER)`; the picture's path is handed over in the `LS_WALLPAPER` environment variable, never in the command line, through `execFile` without a shell; only absolute local `.jpg .jpeg .png .bmp` paths without forbidden characters or `..` pass `validImagePath`; nothing is downloaded. Tests: `wallpaper.test.ts` (a fake execFile).

## Where the data is, and backups

- **Main copy: Turso** (the cloud database). Website, Ben/Telegram, Sporty's sync
  and the desktop all read and write it.
- **This PC:** `%APPDATA%\LifeSystem-CloudDesktop\life-local.sqlite`, a full copy
  plus changes waiting to sync (works offline). Plain SQLite, not encrypted.
- **Daily backup files** (desktop, `src/desktop/backups.ts`): one JSON a day in
  `Documents\Life System Backups` and, when Google Drive for desktop is found
  (`G:\My Drive`, …) or its folder is chosen, `My Drive\Life System Backups`.
  The last 30 days plus the first of each month for a year
  (`backupsToDelete` in `src/core/backupPlan.ts`). Settings → Backups on this PC:
  back up now, open the folders, choose the Drive folder, restore any file.
- **Cloud snapshots:** one a day inside Turso, 30 kept (`cloud_snapshots`, never
  copied to devices).
A backup holds every data table (`backupTables`) plus the Sport/Waky/MAN/Finance
app states. Restoring (`restoreStatements`) replaces each table in one
transaction, only adds missing rows to the append-only history (ledger,
discipline), keeps the PIN and bot setup, and moves the data marker so every
device reloads. Settings → Restore from backup file takes the same files.

## Island sound on Windows (2026-11-09)

All island sounds are synthesized (no files to package). `main.ts` sets `autoplay-policy=no-user-gesture-required` before ready (Electron's default too). The island rings through `soundKit.ts playCard`, which waits for the AudioContext to run and makes a fresh one if it won't; if the island has no audio, `island:soundFallback` asks the app window (hidden in the tray is fine) to play the same sound, else `shell.beep()`. Every notification writes a sound line to the island log (Settings → Island log). Settings → Sound → Test island sound runs the real path. Windows counts any app holding the microphone as a call, which silences reminders (the log says "in a call (mic or camera in use)"). Details: `docs/areas/island.md`, "Every notification rings".
