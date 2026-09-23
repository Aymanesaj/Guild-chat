#!/bin/bash
set -eo pipefail

BACKUP_DIR="/backups"
BACKUP_INTERVAL="${BACKUP_INTERVAL:-43200}" # Default: 12 hours
RETENTION_DAYS="${RETENTION_DAYS:-7}"

POSTGRES_HOST="${PGHOST:-postgres}"
POSTGRES_PORT="${PGPORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-admin}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-admin}"
POSTGRES_DB="${POSTGRES_DB:-transdb}"

MONGO_HOST="${MONGO_HOST:-mongodb}"
MONGO_PORT="${MONGO_PORT:-27017}"

mkdir -p "$BACKUP_DIR"
chmod 777 "$BACKUP_DIR" 2>/dev/null || true

echo "=========================================="
echo " Starting Automated Backup Service"
echo " Interval: ${BACKUP_INTERVAL}s | Retention: ${RETENTION_DAYS} days"
echo " Target DBs: PostgreSQL (${POSTGRES_DB}), MongoDB (${MONGO_HOST})"
echo "=========================================="

perform_backup() {
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    echo "[$(date)] >>> Starting backup snapshot: ${TIMESTAMP}..."

    # 1. Wait for databases to be ready
    until pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" > /dev/null 2>&1; do
        echo "Waiting for PostgreSQL at ${POSTGRES_HOST}:${POSTGRES_PORT}..."
        sleep 2
    done

    # 2. Backup PostgreSQL (Flyway-adapted with --clean --if-exists)
    PG_FILE="${BACKUP_DIR}/postgres_${TIMESTAMP}.sql.gz"
    PG_LATEST="${BACKUP_DIR}/postgres_latest.sql.gz"
    export PGPASSWORD="$POSTGRES_PASSWORD"
    echo "Dumping PostgreSQL database '${POSTGRES_DB}'..."
    pg_dump -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" \
        --clean --if-exists --format=p "$POSTGRES_DB" | gzip -9 > "$PG_FILE"
    cp -f "$PG_FILE" "$PG_LATEST"
    echo "PostgreSQL backup completed: ${PG_FILE} ($(du -h "$PG_FILE" | cut -f1))"

    # 3. Backup MongoDB
    MONGO_FILE="${BACKUP_DIR}/mongo_${TIMESTAMP}.archive.gz"
    MONGO_LATEST="${BACKUP_DIR}/mongo_latest.archive.gz"
    echo "Dumping MongoDB from ${MONGO_HOST}:${MONGO_PORT}..."
    mongodump --host="${MONGO_HOST}:${MONGO_PORT}" --archive="$MONGO_FILE" --gzip
    cp -f "$MONGO_FILE" "$MONGO_LATEST"
    chmod 666 "$PG_FILE" "$PG_LATEST" "$MONGO_FILE" "$MONGO_LATEST" 2>/dev/null || true
    echo "MongoDB backup completed: ${MONGO_FILE} ($(du -h "$MONGO_FILE" | cut -f1))"

    # 4. Retention: Delete backups older than RETENTION_DAYS
    echo "Rotating backups older than ${RETENTION_DAYS} days..."
    find "$BACKUP_DIR" -type f -name "postgres_*.sql.gz" ! -name "postgres_latest.sql.gz" -mtime +"$RETENTION_DAYS" -delete || true
    find "$BACKUP_DIR" -type f -name "mongo_*.archive.gz" ! -name "mongo_latest.archive.gz" -mtime +"$RETENTION_DAYS" -delete || true

    echo "[$(date)] <<< Backup snapshot ${TIMESTAMP} finished successfully!"
}

# Run immediate backup on startup
perform_backup

# Loop on schedule
while true; do
    echo "Next automated backup scheduled in ${BACKUP_INTERVAL} seconds..."
    sleep "$BACKUP_INTERVAL"
    perform_backup
done
