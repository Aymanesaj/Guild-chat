#!/bin/bash
set -eo pipefail

BACKUP_DIR="$(pwd)/backups"

POSTGRES_USER="${POSTGRES_USER:-admin}"
POSTGRES_DB="${POSTGRES_DB:-transdb}"

echo "=========================================="
echo " Disaster Recovery: Database Restore Tool"
echo " Target DBs: PostgreSQL (${POSTGRES_DB}), MongoDB"
echo "=========================================="

if [ ! -d "$BACKUP_DIR" ]; then
    echo "ERROR: Backup directory '${BACKUP_DIR}' does not exist!"
    exit 1
fi

# Determine which PostgreSQL backup to restore
if [ -n "$1" ]; then
    PG_FILE="${BACKUP_DIR}/postgres_${1}.sql.gz"
    MONGO_FILE="${BACKUP_DIR}/mongo_${1}.archive.gz"
else
    PG_FILE="${BACKUP_DIR}/postgres_latest.sql.gz"
    MONGO_FILE="${BACKUP_DIR}/mongo_latest.archive.gz"
fi

if [ ! -f "$PG_FILE" ]; then
    echo "ERROR: PostgreSQL backup file not found: $PG_FILE"
    echo "Available PostgreSQL backups:"
    ls -la "$BACKUP_DIR"/postgres_*.sql.gz 2>/dev/null || echo "None found."
    exit 1
fi

echo "Using snapshot files:"
echo " - PostgreSQL: $(basename "$PG_FILE")"
echo " - MongoDB:    $(basename "$MONGO_FILE")"
echo ""

# 1. Restore PostgreSQL
echo ">>> Restoring PostgreSQL database '${POSTGRES_DB}'..."
# Terminate existing connections so restore runs cleanly
docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD:-admin}" postgres psql -U "$POSTGRES_USER" -d postgres -c "
SELECT pg_terminate_backend(pid) FROM pg_stat_activity 
WHERE datname = '${POSTGRES_DB}' AND pid <> pg_backend_pid();
" > /dev/null 2>&1 || true

gunzip -c "$PG_FILE" | docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD:-admin}" postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" > /dev/null
echo ">>> PostgreSQL restored successfully!"

# 2. Restore MongoDB
if [ -f "$MONGO_FILE" ]; then
    echo ">>> Restoring MongoDB database..."
    docker exec -i mongodb mongorestore --drop --archive --gzip < "$MONGO_FILE" > /dev/null 2>&1
    echo ">>> MongoDB restored successfully!"
else
    echo "Notice: MongoDB backup file '$MONGO_FILE' not found, skipped."
fi

# 3. Verification Summary
echo ""
echo "=========================================="
echo " Disaster Recovery Complete! Verifying..."
echo "=========================================="
echo "PostgreSQL Tables in '${POSTGRES_DB}':"
docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD:-admin}" postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt" || true

echo ""
echo "MongoDB Collections in 'chatdb':"
docker exec -i mongodb mongosh --eval "use chatdb; db.getCollectionNames();" --quiet || true

echo ""
echo "System successfully restored to backup point!"

