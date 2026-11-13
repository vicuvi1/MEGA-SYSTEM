# Recovery: how to get your data back

One page. Your data is in four places, and any one of them is enough to get everything back.
Settings → **Data safety** shows how fresh each one is (green, amber or red).

| Copy | Where | How often | Kept |
|---|---|---|---|
| **Main data** | Turso cloud database | every change | — |
| **Cloud backup** | the same Turso database (`cloud_snapshots` + `cloud_snapshot_parts`) | daily (Ben's server, and the app) | 30 days |
| **Backup on this PC** | `Documents/LifeSystem/Backups` (or the folder you chose), plus a copy in Google Drive when found | daily, and before every risky step | 14 daily, 8 weekly, 12 monthly, 30 "before" |
| **Off-site copy** | GitHub → Actions → Off-site backup → Artifacts (encrypted) | weekly (Mondays) | 90 days |

Every restore first saves a backup of how things are now, so a restore can itself be undone
(Settings → Data safety → "Undo to before restore").

## The owner must do this once
- Put **`BACKUP_PASSPHRASE`** in a password manager. Without it the off-site copies can't be opened.
  It lives only in GitHub (repo Settings → Secrets and variables → Actions), never in this repo.
- Check that `CRON_SECRET` is set in GitHub Actions too (the weekly job needs it).

## 1. Undo a recent mistake (fastest)
Settings → Data safety → **Undo to before…** lists every backup made before a restore, an import,
a big delete or a big change of an app's data (Finance, Sport Track, Waky, MAN). Click the one you want.

## 2. From the backup on this PC
- In the app: Settings → Data safety → **Daily backups on this PC** → Restore, or **Restore from file**
  and pick any `life-system-*.zip` (or the `backup.json` inside it).
- Without the app: the `.zip` opens with any zip tool. `backup.json` is plain JSON (every table and
  every app's data); `life-system.sqlite` opens in any SQLite viewer (for example DB Browser for SQLite);
  `manifest.json` lists row counts and checksums.
- On a new PC: install Life System, sign in, then Restore from file.

## 3. From a cloud backup
Settings → Data safety → **Cloud backups** → Restore (one of the last 30 days). A big backup is stored
in parts; the app joins them and checks every part's SHA-256 before anything changes.

## 4. From the off-site copy (when the cloud is gone)
1. GitHub → Actions → **Off-site backup** → the newest green run → Artifacts → download and unzip.
2. Decrypt (Linux, macOS, Git Bash on Windows):
   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in life-backup-YYYY-MM-DD.json.gz.enc \
     -pass pass:'<BACKUP_PASSPHRASE from your password manager>' | gunzip > backup.json
   ```
3. Life System → Settings → Data safety → **Restore from file** → `backup.json`.
   If the cloud database itself is new and empty, first sign in once so the app creates the tables.

## 5. Export everything (to keep or to move)
Settings → Data safety → **Export everything**: one zip with the full JSON, every table as CSV and every
app's data as JSON and CSV. Restore from file takes this zip too. PINs, keys and tokens are never in it.

## What a restore does
- Puts back every table: rows go into staging tables first (any size, many small requests), then one
  transaction replaces the tables in foreign-key order. If anything fails, nothing changes.
- The points history (`ledger`) and discipline history only get missing rows back (they are append-only).
- Your PIN and bot setup stay as they are now.
- The apps' own data (Finance, Sport Track, Waky, MAN) is put back on this device and marked, so every
  other device takes the restored copy instead of merging its old one back in. Each device keeps its
  copy from before next to it (`life_sync_<app>_before_restore` in its storage).

## If a light is red
- **Cloud backup:** Settings → Data safety → Back up now. Still red: the line says why (often the server
  or the internet). Your data is safe in the main database and on this PC.
- **Backup on this PC:** the folder may be full or gone: Change folder, then Back up now.
- **Off-site copy:** GitHub → Actions → Off-site backup → the failed run. Usually a missing secret.
- **Restore test:** a backup did not come back whole. Back up now, then Test a restore; tell your helper.
