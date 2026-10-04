#!/bin/bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env"
BACKUP_DIR="${PROJECT_DIR}/backups"

if [ -f "$ENV_FILE" ]; then
    get_env_val() {
        (grep -E "^${1}=" "$ENV_FILE" || true) | head -n 1 | cut -d '=' -f 2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
    }
    [ -z "$POSTGRES_USER" ] && POSTGRES_USER=$(get_env_val "POSTGRES_USER")
    [ -z "$POSTGRES_PASSWORD" ] && POSTGRES_PASSWORD=$(get_env_val "POSTGRES_PASSWORD")
    [ -z "$POSTGRES_DB" ] && POSTGRES_DB=$(get_env_val "POSTGRES_DB")
    [ -z "$ORG_POSTGRES_DB" ] && ORG_POSTGRES_DB=$(get_env_val "ORG_POSTGRES_DB")
    [ -z "$MONGO_INITDB_ROOT_USERNAME" ] && MONGO_INITDB_ROOT_USERNAME=$(get_env_val "MONGO_INITDB_ROOT_USERNAME")
    [ -z "$MONGO_INITDB_ROOT_PASSWORD" ] && MONGO_INITDB_ROOT_PASSWORD=$(get_env_val "MONGO_INITDB_ROOT_PASSWORD")
    [ -z "$CHAT_MONGO_USER" ] && CHAT_MONGO_USER=$(get_env_val "CHAT_MONGO_USER")
    [ -z "$CHAT_MONGO_PASSWORD" ] && CHAT_MONGO_PASSWORD=$(get_env_val "CHAT_MONGO_PASSWORD")
fi

POSTGRES_USER="${POSTGRES_USER:-admin}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-admin}"
POSTGRES_DB="${POSTGRES_DB:-transdb}"
ORG_POSTGRES_DB="${ORG_POSTGRES_DB:-org_service_db}"

echo "=========================================="
echo " Disaster Recovery: Database Restore Tool"
echo " Target DBs: PostgreSQL (${POSTGRES_DB}, ${ORG_POSTGRES_DB}), MongoDB"
echo "=========================================="

if [ ! -d "$BACKUP_DIR" ]; then
    echo "ERROR: Backup directory '${BACKUP_DIR}' does not exist!"
    exit 1
fi

if [ -n "$1" ]; then
    PG_FILE="${BACKUP_DIR}/postgres_${1}.sql.gz"
    ORG_FILE="${BACKUP_DIR}/org_${1}.sql.gz"
    MONGO_FILE="${BACKUP_DIR}/mongo_${1}.archive.gz"
else
    PG_FILE="${BACKUP_DIR}/postgres_latest.sql.gz"
    ORG_FILE="${BACKUP_DIR}/org_latest.sql.gz"
    MONGO_FILE="${BACKUP_DIR}/mongo_latest.archive.gz"
fi

if [ ! -f "$PG_FILE" ]; then
    echo "ERROR: PostgreSQL backup file not found: $PG_FILE"
    echo "Available PostgreSQL backups:"
    ls -la "$BACKUP_DIR"/postgres_*.sql.gz 2>/dev/null || echo "None found."
    exit 1
fi

echo "Using snapshot files:"
echo " - PostgreSQL (${POSTGRES_DB}):     $(basename "$PG_FILE")"
[ -f "$ORG_FILE" ] && echo " - PostgreSQL (${ORG_POSTGRES_DB}): $(basename "$ORG_FILE")"
echo " - MongoDB:                      $(basename "$MONGO_FILE")"
echo ""

echo ">>> Restoring PostgreSQL database '${POSTGRES_DB}'..."
docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres psql -h /var/run/postgresql -U "$POSTGRES_USER" -d postgres -c "
SELECT pg_terminate_backend(pid) FROM pg_stat_activity 
WHERE datname = '${POSTGRES_DB}' AND pid <> pg_backend_pid();
" > /dev/null 2>&1 || true

gunzip -c "$PG_FILE" | docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres psql -h /var/run/postgresql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 > /dev/null
echo ">>> PostgreSQL '${POSTGRES_DB}' restored successfully!"

if [ -f "$ORG_FILE" ]; then
    echo ">>> Restoring PostgreSQL database '${ORG_POSTGRES_DB}'..."
    docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres psql -h /var/run/postgresql -U "$POSTGRES_USER" -d postgres -c "
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity 
    WHERE datname = '${ORG_POSTGRES_DB}' AND pid <> pg_backend_pid();
    " > /dev/null 2>&1 || true

    # Ensure database exists before restoring into it
    docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres psql -h /var/run/postgresql -U "$POSTGRES_USER" -d postgres -c "
    SELECT 'CREATE DATABASE ${ORG_POSTGRES_DB}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${ORG_POSTGRES_DB}')\gexec
    " > /dev/null 2>&1 || true

    gunzip -c "$ORG_FILE" | docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres psql -h /var/run/postgresql -U "$POSTGRES_USER" -d "$ORG_POSTGRES_DB" -v ON_ERROR_STOP=1 > /dev/null
    echo ">>> PostgreSQL '${ORG_POSTGRES_DB}' restored successfully!"
else
    echo "Notice: Organization database backup '$ORG_FILE' not found, skipped."
fi

if [ -f "$MONGO_FILE" ]; then
    echo ">>> Restoring MongoDB database..."
    MONGO_AUTH=""
    MONGO_AUTH_USER="${CHAT_MONGO_USER:-${MONGO_INITDB_ROOT_USERNAME}}"
    MONGO_AUTH_PASS="${CHAT_MONGO_PASSWORD:-${MONGO_INITDB_ROOT_PASSWORD}}"
    if [ -n "$MONGO_AUTH_USER" ] && [ -n "$MONGO_AUTH_PASS" ]; then
        MONGO_AUTH="--username=${MONGO_AUTH_USER} --password=${MONGO_AUTH_PASS} --authenticationDatabase=admin"
    fi
    docker exec -i mongodb mongorestore $MONGO_AUTH --drop --archive --gzip < "$MONGO_FILE" > /dev/null
    echo ">>> MongoDB restored successfully!"
else
    echo "Notice: MongoDB backup file '$MONGO_FILE' not found, skipped."
fi

echo ""
echo "=========================================="
echo " Disaster Recovery Complete! Verifying..."
echo "=========================================="
echo "PostgreSQL Tables in '${POSTGRES_DB}':"
docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres psql -h /var/run/postgresql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt" || true

echo ""
echo "PostgreSQL Tables in '${ORG_POSTGRES_DB}':"
docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres psql -h /var/run/postgresql -U "$POSTGRES_USER" -d "$ORG_POSTGRES_DB" -c "\dt" || true

echo ""
echo "MongoDB Collections in 'chatdb':"
if [ -n "$MONGO_AUTH_USER" ] && [ -n "$MONGO_AUTH_PASS" ]; then
    docker exec -i mongodb mongosh -u "$MONGO_AUTH_USER" -p "$MONGO_AUTH_PASS" --authenticationDatabase admin --eval "use chatdb; db.getCollectionNames();" --quiet || true
else
    docker exec -i mongodb mongosh --eval "use chatdb; db.getCollectionNames();" --quiet || true
fi

echo ""
echo "System successfully restored to backup point!"
