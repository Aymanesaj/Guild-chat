#!/bin/bash
set -eo pipefail

BACKUP_DIR="$(pwd)/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
mkdir -p "$BACKUP_DIR"

echo "Creating backup snapshot: ${TIMESTAMP}..."

# 1. Backup PostgreSQL
PG_FILE="${BACKUP_DIR}/postgres_${TIMESTAMP}.sql.gz"
docker exec postgres sh -c 'pg_dump -h /var/run/postgresql -U "$POSTGRES_USER" --clean --if-exists --format=p "$POSTGRES_DB"' | gzip -9 > "$PG_FILE"
cp -f "$PG_FILE" "${BACKUP_DIR}/postgres_latest.sql.gz"

# 2. Backup MongoDB
MONGO_FILE="${BACKUP_DIR}/mongo_${TIMESTAMP}.archive.gz"
docker exec mongodb sh -c 'mongodump -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive --gzip' > "$MONGO_FILE"
cp -f "$MONGO_FILE" "${BACKUP_DIR}/mongo_latest.archive.gz"

echo "Backup complete: ${TIMESTAMP}"


