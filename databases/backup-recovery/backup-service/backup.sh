#!/bin/bash
set -eo pipefail

BACKUP_DIR="/backups"
BACKUP_INTERVAL="${BACKUP_INTERVAL:-43200}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

IDENTITY_POSTGRES_HOST="${IDENTITY_POSTGRES_HOST:-identity-service_postgres}"
IDENTITY_POSTGRES_PORT="${IDENTITY_POSTGRES_PORT:-5432}"
IDENTITY_POSTGRES_USER="${IDENTITY_POSTGRES_USER:-admin}"
IDENTITY_POSTGRES_PASSWORD="${IDENTITY_POSTGRES_PASSWORD:-admin}"
IDENTITY_POSTGRES_DB="${IDENTITY_POSTGRES_DB:-transdb}"
ORG_POSTGRES_DB="${ORG_POSTGRES_DB:-org_service_db}"
ORG_POSTGRES_HOST="${ORG_POSTGRES_HOST:-$IDENTITY_POSTGRES_HOST}"
ORG_POSTGRES_PORT="${ORG_POSTGRES_PORT:-$IDENTITY_POSTGRES_PORT}"
ORG_POSTGRES_USER="${ORG_POSTGRES_USER:-admin}"
ORG_POSTGRES_PASSWORD="${ORG_POSTGRES_PASSWORD:-admin}"

MONGO_HOST="${MONGO_HOST:-mongodb}"
MONGO_PORT="${MONGO_PORT:-27017}"

mkdir -p "$BACKUP_DIR"
chmod 755 "$BACKUP_DIR" 2>/dev/null || true

echo "=========================================="
echo " Starting Automated Backup Service"
echo " Interval: ${BACKUP_INTERVAL}s | Retention: ${RETENTION_DAYS} days"
echo " Target DBs: PostgreSQL (${IDENTITY_POSTGRES_DB}, ${ORG_POSTGRES_DB}), MongoDB (${MONGO_HOST})"
echo "=========================================="

perform_backup() {
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    echo "[$(date)] >>> Starting backup snapshot: ${TIMESTAMP}..."

    until pg_isready -h "$IDENTITY_POSTGRES_HOST" -p "$IDENTITY_POSTGRES_PORT" -U "$IDENTITY_POSTGRES_USER" > /dev/null 2>&1; do
        echo "Waiting for PostgreSQL at ${IDENTITY_POSTGRES_HOST}:${IDENTITY_POSTGRES_PORT}..."
        sleep 2
    done

    until pg_isready -h "$ORG_POSTGRES_HOST" -p "$ORG_POSTGRES_PORT" -U "$ORG_POSTGRES_USER" > /dev/null 2>&1; do
        echo "Waiting for PostgreSQL at ${ORG_POSTGRES_HOST}:${ORG_POSTGRES_PORT}..."
        sleep 2
    done

    PG_FILE="${BACKUP_DIR}/postgres_${TIMESTAMP}.sql.gz"
    PG_LATEST="${BACKUP_DIR}/postgres_latest.sql.gz"

    ORG_FILE="${BACKUP_DIR}/org_${TIMESTAMP}.sql.gz"
    ORG_LATEST="${BACKUP_DIR}/org_latest.sql.gz"

    echo "Dumping PostgreSQL database '${IDENTITY_POSTGRES_DB}'..."
    PGPASSWORD="$IDENTITY_POSTGRES_PASSWORD" pg_dump -h "$IDENTITY_POSTGRES_HOST" -p "$IDENTITY_POSTGRES_PORT" -U "$IDENTITY_POSTGRES_USER" \
        --clean --if-exists --format=p "$IDENTITY_POSTGRES_DB" | gzip -9 > "$PG_FILE"
    echo "PostgreSQL '${IDENTITY_POSTGRES_DB}' backup completed: ${PG_FILE} ($(du -h "$PG_FILE" | cut -f1))"

    echo "Dumping PostgreSQL database '${ORG_POSTGRES_DB}'..."
    PGPASSWORD="$ORG_POSTGRES_PASSWORD" pg_dump -h "$ORG_POSTGRES_HOST" -p "$ORG_POSTGRES_PORT" -U "$ORG_POSTGRES_USER" \
        --clean --if-exists --format=p "$ORG_POSTGRES_DB" | gzip -9 > "$ORG_FILE"
    echo "PostgreSQL '${ORG_POSTGRES_DB}' backup completed: ${ORG_FILE} ($(du -h "$ORG_FILE" | cut -f1))"

    MONGO_FILE="${BACKUP_DIR}/mongo_${TIMESTAMP}.archive.gz"
    MONGO_LATEST="${BACKUP_DIR}/mongo_latest.archive.gz"
    echo "Dumping MongoDB from ${MONGO_HOST}:${MONGO_PORT}..."
    # Full-instance dumps/restores need administrator privileges, not chat's readWrite role.
    MONGO_AUTH=()
    if [ -n "$MONGO_INITDB_ROOT_USERNAME" ]; then
        MONGO_AUTH_USER="$MONGO_INITDB_ROOT_USERNAME"
        MONGO_AUTH_PASS="${MONGO_INITDB_ROOT_PASSWORD:?MongoDB root password is required}"
        MONGO_AUTH_DB=admin
    else
        MONGO_AUTH_USER="${CHAT_MONGO_USER:-}"
        MONGO_AUTH_PASS="${CHAT_MONGO_PASSWORD:-}"
        MONGO_AUTH_DB="${CHAT_MONGO_AUTH_DB:-admin}"
    fi
    if [ -n "$MONGO_AUTH_USER" ] && [ -n "$MONGO_AUTH_PASS" ]; then
        MONGO_AUTH=("--username=$MONGO_AUTH_USER" "--password=$MONGO_AUTH_PASS" "--authenticationDatabase=$MONGO_AUTH_DB")
    fi

    if mongodump --host="${MONGO_HOST}:${MONGO_PORT}" "${MONGO_AUTH[@]}" --archive="$MONGO_FILE" --gzip; then
        echo "MongoDB backup completed: ${MONGO_FILE} ($(du -h "$MONGO_FILE" | cut -f1))"

        # Update latest copies atomically only when all databases have succeeded
        cp -f "$PG_FILE" "$PG_LATEST"
        cp -f "$ORG_FILE" "$ORG_LATEST"
        cp -f "$MONGO_FILE" "$MONGO_LATEST"
        chmod 644 "$PG_FILE" "$PG_LATEST" "$ORG_FILE" "$ORG_LATEST" "$MONGO_FILE" "$MONGO_LATEST" 2>/dev/null || true
    else
        echo "⚠️ WARNING: MongoDB backup failed! Check credentials for user '${MONGO_AUTH_USER}' in .env"
        rm -f "$MONGO_FILE"
    fi

    echo "Rotating backups older than ${RETENTION_DAYS} days..."
    find "$BACKUP_DIR" -type f -name "postgres_*.sql.gz" ! -name "postgres_latest.sql.gz" -mtime +"$RETENTION_DAYS" -delete || true
    find "$BACKUP_DIR" -type f -name "org_*.sql.gz" ! -name "org_latest.sql.gz" -mtime +"$RETENTION_DAYS" -delete || true
    find "$BACKUP_DIR" -type f -name "mongo_*.archive.gz" ! -name "mongo_latest.archive.gz" -mtime +"$RETENTION_DAYS" -delete || true

    echo "[$(date)] <<< Backup snapshot ${TIMESTAMP} finished successfully!"
}

perform_backup

while true; do
    echo "Next automated backup scheduled in ${BACKUP_INTERVAL} seconds..."
    sleep "$BACKUP_INTERVAL"
    perform_backup
done
