# Backups and recovery

Docker stores persistent data in `/data`; the native installer uses `/var/lib/life-management`. Development defaults to `data/`. Keep the whole data directory separate from application releases.

| Location | Contents |
|---|---|
| `life.db` | Live SQLite database; may also have WAL/SHM sidecars |
| `backups/` | Daily app snapshots and uniquely named pre-restore recovery backups |
| `deploy-backups/` | Verified snapshots before container startup or native deployment |

App snapshots run on startup and hourly, reusing the current UTC day's filename. Container snapshots run before each startup, including ordinary restarts. Native installations also have a daily systemd backup timer. Copy completed backups off-server; storage volumes alone are not backups. No automatic retention deletion is configured.

## Export and restore

Use **Settings → Backup & restore** to export JSON, create a backup, or restore a supported JSON/SQLite file up to 10 MB. Both restore flows require typing `RESTORE`, validate the input, and retain a verified recovery snapshot before replacing data. The success message names that snapshot. Failed validation, backup, or transactional insertion leaves existing data unchanged.

To migrate installations, export from the old app, stop it, deploy the new app with a fresh volume, and restore through Settings. Retain the old data as a fallback. Recheck the restored AI server URL and other server-specific settings.

## Rollback

Changing the image version changes code; it does not reverse database migrations. Reuse an older version only if it supports the current schema.

For an incompatible schema or a startup failure:

1. Stop the app. Preserve the entire current data directory, including WAL/SHM files, elsewhere.
2. Restore a matching verified pre-deployment `.db` snapshot as `life.db`; remove displaced WAL/SHM files from the active database path only after preserving them.
3. Restore ownership/permissions and start the matching application version. Docker uses UID/GID `1000:1000`; the native installer uses `life-management:life-management` and database mode `0600`.
4. Verify the restored tasks and settings. Changes made after the snapshot are absent; retain the displaced data for recovery.

Never overwrite a running SQLite database. An unhealthy deployment keeps its snapshots and data; it does not automatically roll back migrations.

For compatible native releases, `sudo bash deploy/activate-release.sh --rollback RELEASE_ID` takes another snapshot and switches code. Inspect logs with `sudo journalctl -u life-management -n 100 --no-pager`.
