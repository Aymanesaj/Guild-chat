#!/bin/bash
set -eo pipefail

BACKUP_DIR="$(pwd)/backups"
SNAPSHOT="${1:-latest}"
PG_FILE="${BACKUP_DIR}/postgres_${SNAPSHOT}.sql.gz"
MONGO_FILE="${BACKUP_DIR}/mongo_${SNAPSHOT}.archive.gz"

if [ ! -f "$PG_FILE" ]; then
    echo "ERROR: Backup file '$PG_FILE' not found."
    exit 1
fi

echo "Restoring snapshot: ${SNAPSHOT}..."

# 1. Restore PostgreSQL
docker exec -i postgres sh -c 'psql -h /var/run/postgresql -U "$POSTGRES_USER" -d postgres -c "
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '\''$POSTGRES_DB'\'' AND pid <> pg_backend_pid();
"' > /dev/null 2>&1 || true

gunzip -c "$PG_FILE" | docker exec -i postgres sh -c 'psql -h /var/run/postgresql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > /dev/null
echo "PostgreSQL restored."

# 2. Restore MongoDB
if [ -f "$MONGO_FILE" ]; then
    docker exec -i mongodb sh -c 'mongorestore -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --drop --archive --gzip' < "$MONGO_FILE" > /dev/null 2>&1 || true
    echo "MongoDB restored."
fi

echo "Restore complete: ${SNAPSHOT}"


