#!/bin/bash
set -eo pipefail

BACKUP_DIR="/backups"
BACKUP_INTERVAL="${BACKUP_INTERVAL:-43200}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
mkdir -p "$BACKUP_DIR"

perform_backup() {
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    echo "[$(date)] Starting automated backup: ${TIMESTAMP}..."

    # 1. PostgreSQL
    PG_FILE="${BACKUP_DIR}/postgres_${TIMESTAMP}.sql.gz"
    export PGPASSWORD="$POSTGRES_PASSWORD"
    pg_dump -h "${PGHOST:-postgres}" -p "${PGPORT:-5432}" -U "$POSTGRES_USER" --clean --if-exists --format=p "$POSTGRES_DB" | gzip -9 > "$PG_FILE"
    cp -f "$PG_FILE" "${BACKUP_DIR}/postgres_latest.sql.gz"

    # 2. MongoDB
    MONGO_FILE="${BACKUP_DIR}/mongo_${TIMESTAMP}.archive.gz"
    mongodump --host="${MONGO_HOST:-mongodb}:${MONGO_PORT:-27017}" \
        --username="$MONGO_INITDB_ROOT_USERNAME" --password="$MONGO_INITDB_ROOT_PASSWORD" \
        --authenticationDatabase admin --archive="$MONGO_FILE" --gzip
    cp -f "$MONGO_FILE" "${BACKUP_DIR}/mongo_latest.archive.gz"

    # 3. Clean up old backups
    find "$BACKUP_DIR" -type f -name "postgres_*.sql.gz" ! -name "postgres_latest.sql.gz" -mtime +"$RETENTION_DAYS" -delete || true
    find "$BACKUP_DIR" -type f -name "mongo_*.archive.gz" ! -name "mongo_latest.archive.gz" -mtime +"$RETENTION_DAYS" -delete || true

    echo "[$(date)] Automated backup finished: ${TIMESTAMP}"
}

# Wait before first automated backup to give startup/restore time to settle
sleep "${BACKUP_INITIAL_DELAY:-300}"

while true; do
    perform_backup
    sleep "$BACKUP_INTERVAL"
done

