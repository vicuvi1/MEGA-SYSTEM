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
is refused, including spending against an old points balance.

Conflict handling is conservative: if the server version changes before an
offline operation uploads, automatic sync pauses and both copies are kept.
The app does not merge arbitrary SQL or guess which version to keep. Save a
backup to retain the local operations. The explicit Back up and use server copy
action downloads the server copy only after confirmation and a saved backup.
Recovering individual offline operations from that backup currently requires
manual review. Unrelated server updates can also cause this conflict prompt.

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
the older Electron implementation. A `vVERSION` tag triggers the Windows
release workflow, which builds and uploads the installer and update metadata.
The version in package.json and package-lock.json must match the tag. Each
release needs a higher version for the update button to offer it.

The renderer is loaded from the bundled `life-system://app` origin. Requests
under `/api/` are forwarded to the production website by the main process.
Only this bundled window can invoke the narrow local storage/update IPC bridge.
The renderer has no Node access. External web links open in the browser.

Tests use synthetic databases. The desktop sync tests cover restart recovery,
conflicts, lost acknowledgements and disk failures. Validate release checks
against published builds; development mode intentionally skips installation.
