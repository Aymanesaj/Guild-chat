# Operational Automation & Disaster Recovery Scripts

This directory houses the operational scripts for database backup snapshots, point-in-time disaster recovery, and live automated verification for evaluation defense.

---

## Script Overview

| Script | Purpose | Execution Command |
| :--- | :--- | :--- |
| `backup.sh` | Creates gzipped snapshots of PostgreSQL and MongoDB databases | `./databases/backup-recovery/scripts/backup.sh` or `make backup` |
| `restore.sh` | Restores databases from the latest or a timestamped snapshot | `./databases/backup-recovery/scripts/restore.sh [TIMESTAMP]` or `make restore` |
| `test-disaster-recovery.sh` | End-to-end automated 5-step disaster recovery verification test | `./databases/backup-recovery/scripts/test-disaster-recovery.sh` or `make test-recovery` |

---

## 1. Backup Engine (`backup.sh`)

### How It Works
1. **Dynamic Configuration Discovery**: Automatically loads database credentials from `.env` in the project root if environment variables are not already exported.
2. **PostgreSQL Dump**:
   - Executes `pg_dump` inside the `postgres` container using Unix domain socket (`-h /var/run/postgresql`) to bypass network authentication issues.
   - Generates full SQL dumps for both databases: `${POSTGRES_DB}` (`transdb`) and `${ORG_POSTGRES_DB}` (`org_service_db`), including `--clean` and `--if-exists` flags.
   - Compresses the output on the fly with `gzip -9` into `backups/postgres_<TIMESTAMP>.sql.gz` and `backups/org_<TIMESTAMP>.sql.gz`.
   - Creates/overwrites `backups/postgres_latest.sql.gz` and `backups/org_latest.sql.gz` atomically once all dumps succeed.
3. **MongoDB Dump**:
   - Executes `mongodump` inside the `mongodb` container with admin authentication credentials.
   - Dumps the `chatdb` database into an archive format with `--gzip` into `backups/mongo_<TIMESTAMP>.archive.gz`.
   - Creates/overwrites `backups/mongo_latest.archive.gz`.

---

## 2. Disaster Recovery Engine (`restore.sh`)

### How It Works
1. **Snapshot Selection**:
   - By default, restores from `postgres_latest.sql.gz`, `org_latest.sql.gz`, and `mongo_latest.archive.gz`.
   - Alternatively, accepts a timestamp argument (e.g. `./databases/backup-recovery/scripts/restore.sh 20260925_035012`) to restore from a specific point-in-time snapshot.
2. **Connection Eviction**:
   - Runs `pg_terminate_backend` on PostgreSQL to terminate any active client connections on both `transdb` and `org_service_db`, ensuring clean restore without table lock deadlocks.
3. **PostgreSQL Restoration**:
   - Streams the decompressed dumps via `psql` with `-v ON_ERROR_STOP=1` into both `transdb` and `org_service_db` to recreate schema, tables, and records.
4. **MongoDB Restoration**:
   - Executes `mongorestore` with `--drop` flag to clean existing collections before restoring all documents and indexes from the gzip archive.
5. **Post-Restore Verification**:
   - Automatically queries `\dt` on both PostgreSQL databases and lists MongoDB collections to visually confirm healthy database state.

---

## 3. Automated Defense Verification (`test-disaster-recovery.sh`)

This script is specifically designed for live evaluation defenses to prove 100% disaster recovery capability within seconds.

### Execution Stages
1. **Step 1 - Data Injection**: Inserts test rows into both PostgreSQL databases (`defense_recovery_test` in `transdb` and `defense_recovery_org_test` in `org_service_db`) and a test chat message into MongoDB (`DEFENSE_TEST_CHAT_MESSAGE`).
2. **Step 2 - Snapshot**: Triggers an on-demand snapshot via `backup.sh`.
3. **Step 3 - Disaster Simulation**: Drops both PostgreSQL tables and deletes the MongoDB message, then verifies that the data is completely gone.
4. **Step 4 - Disaster Recovery**: Invokes `restore.sh` to recover the database state from the snapshot.
5. **Step 5 - Validation & Cleanup**: Asserts that all records are resurrected, then cleans up temporary test records.

Run with:
```bash
make test-recovery
```
