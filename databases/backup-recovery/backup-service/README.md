# Containerized Automated Backup Daemon

This directory provides the automated, continuous background backup daemon container for `ft_transcendence`.

---

## Difference Between `databases/backup-recovery/backup-service/` and `databases/backup-recovery/scripts/backup.sh`

- **`databases/backup-recovery/backup-service/` (Background Daemon Container)**:
  Runs as an autonomous Alpine-based container inside Docker compose (`backup` service). It executes continuously on a periodic loop (default every 12 hours) and performs automated retention pruning of snapshots older than 7 days.
- **`databases/backup-recovery/scripts/backup.sh` (Operator CLI Tool)**:
  Executed manually on the host machine by developers/operators (or via `make backup`) for immediate on-demand database snapshots before deployments or maintenance.

---

## How the Daemon Operates (`backup.sh`)

1. **Liveness Polling**: Checks `pg_isready` against PostgreSQL host and port before attempting dumps.
2. **PostgreSQL Dump**: Streams a clean compressed SQL dump via `pg_dump` with `--clean --if-exists` into `/backups/postgres_<TIMESTAMP>.sql.gz`.
3. **MongoDB Dump**: Dumps the `chatdb` collections via `mongodump --archive --gzip` into `/backups/mongo_<TIMESTAMP>.archive.gz`.
4. **Latest Pointer**: Updates `postgres_latest.sql.gz` and `mongo_latest.archive.gz`.
5. **Retention Cleanup**: Automatically removes snapshot files older than `RETENTION_DAYS` (default: 7 days) while preserving `_latest` files.
6. **Sleep Cycle**: Sleeps for `BACKUP_INTERVAL` seconds (default: 43200s / 12h) before triggering the next snapshot.

---

## Configuration Variables

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `BACKUP_INTERVAL` | `43200` (12h) | Frequency between automatic backup runs (seconds) |
| `RETENTION_DAYS` | `7` | Retention window before automatic file deletion |
| `BACKUP_DIR` | `/backups` | Volume mount path storing backup archives |
| `PGHOST` / `PGPORT` | `postgres` / `5432` | PostgreSQL network connection |
| `MONGO_HOST` / `MONGO_PORT` | `mongodb` / `27017` | MongoDB network connection |
