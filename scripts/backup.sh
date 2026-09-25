#!/bin/bash
set -eo pipefail

BACKUP_DIR="$(pwd)/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
mkdir -p "$BACKUP_DIR"

POSTGRES_USER="${POSTGRES_USER:-admin}"
POSTGRES_DB="${POSTGRES_DB:-transdb}"

echo "=========================================="
echo " Starting Manual On-Demand Backup"
echo " Timestamp: ${TIMESTAMP}"
echo " Destination: ${BACKUP_DIR}"
echo "=========================================="

# 1. Backup PostgreSQL
PG_FILE="${BACKUP_DIR}/postgres_${TIMESTAMP}.sql.gz"
PG_LATEST="${BACKUP_DIR}/postgres_latest.sql.gz"

echo "Dumping PostgreSQL ('${POSTGRES_DB}')..."
docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-admin}" postgres \
    pg_dump -U "$POSTGRES_USER" --clean --if-exists --format=p "$POSTGRES_DB" | gzip -9 > "$PG_FILE"
cp -f "$PG_FILE" "$PG_LATEST"
echo "  -> Created: ${PG_FILE} ($(du -h "$PG_FILE" | cut -f1))"

# 2. Backup MongoDB
MONGO_FILE="${BACKUP_DIR}/mongo_${TIMESTAMP}.archive.gz"
MONGO_LATEST="${BACKUP_DIR}/mongo_latest.archive.gz"

echo "Dumping MongoDB ('chatdb')..."
docker exec mongodb mongodump --archive --gzip > "$MONGO_FILE"
cp -f "$MONGO_FILE" "$MONGO_LATEST"
echo "  -> Created: ${MONGO_FILE} ($(du -h "$MONGO_FILE" | cut -f1))"

echo "=========================================="
echo " Backup completed successfully!"
echo " Latest symlinks updated in ${BACKUP_DIR}"
echo "=========================================="

