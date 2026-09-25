#!/bin/bash
set -eo pipefail

BACKUP_DIR="/backups"
BACKUP_INTERVAL="${BACKUP_INTERVAL:-43200}"
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

    until pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" > /dev/null 2>&1; do
        echo "Waiting for PostgreSQL at ${POSTGRES_HOST}:${POSTGRES_PORT}..."
        sleep 2
    done

    PG_FILE="${BACKUP_DIR}/postgres_${TIMESTAMP}.sql.gz"
    PG_LATEST="${BACKUP_DIR}/postgres_latest.sql.gz"
    export PGPASSWORD="$POSTGRES_PASSWORD"
    echo "Dumping PostgreSQL database '${POSTGRES_DB}'..."
    pg_dump -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" \
        --clean --if-exists --format=p "$POSTGRES_DB" | gzip -9 > "$PG_FILE"
    cp -f "$PG_FILE" "$PG_LATEST"
    echo "PostgreSQL backup completed: ${PG_FILE} ($(du -h "$PG_FILE" | cut -f1))"

    MONGO_FILE="${BACKUP_DIR}/mongo_${TIMESTAMP}.archive.gz"
    MONGO_LATEST="${BACKUP_DIR}/mongo_latest.archive.gz"
    echo "Dumping MongoDB from ${MONGO_HOST}:${MONGO_PORT}..."
    MONGO_AUTH=""
    MONGO_AUTH_USER="${CHAT_MONGO_USER:-${MONGO_INITDB_ROOT_USERNAME}}"
    MONGO_AUTH_PASS="${CHAT_MONGO_PASSWORD:-${MONGO_INITDB_ROOT_PASSWORD}}"
    MONGO_AUTH_DB="${CHAT_MONGO_AUTH_DB:-admin}"
    MONGO_AUTH_USER=$(echo "$MONGO_AUTH_USER" | sed -E 's/^[=[:space:]]+//')
    MONGO_AUTH_PASS=$(echo "$MONGO_AUTH_PASS" | sed -E 's/^[=[:space:]]+//')
    if [ -n "$MONGO_AUTH_USER" ] && [ -n "$MONGO_AUTH_PASS" ]; then
        MONGO_AUTH="--username=${MONGO_AUTH_USER} --password=${MONGO_AUTH_PASS} --authenticationDatabase=${MONGO_AUTH_DB}"
    fi
    if mongodump --host="${MONGO_HOST}:${MONGO_PORT}" $MONGO_AUTH --archive="$MONGO_FILE" --gzip; then
        cp -f "$MONGO_FILE" "$MONGO_LATEST"
        chmod 666 "$PG_FILE" "$PG_LATEST" "$MONGO_FILE" "$MONGO_LATEST" 2>/dev/null || true
        echo "MongoDB backup completed: ${MONGO_FILE} ($(du -h "$MONGO_FILE" | cut -f1))"
    else
        echo "⚠️ WARNING: MongoDB backup failed! Check credentials for user '${MONGO_AUTH_USER}' in .env"
    fi

    echo "Rotating backups older than ${RETENTION_DAYS} days..."
    find "$BACKUP_DIR" -type f -name "postgres_*.sql.gz" ! -name "postgres_latest.sql.gz" -mtime +"$RETENTION_DAYS" -delete || true
    find "$BACKUP_DIR" -type f -name "mongo_*.archive.gz" ! -name "mongo_latest.archive.gz" -mtime +"$RETENTION_DAYS" -delete || true

    echo "[$(date)] <<< Backup snapshot ${TIMESTAMP} finished successfully!"
}

perform_backup

while true; do
    echo "Next automated backup scheduled in ${BACKUP_INTERVAL} seconds..."
    sleep "$BACKUP_INTERVAL"
    perform_backup
done
