#!/bin/bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env"
BACKUP_DIR="${PROJECT_DIR}/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
mkdir -p "$BACKUP_DIR"

if [ -f "$ENV_FILE" ]; then
    get_env_val() {
        (grep -E "^${1}=" "$ENV_FILE" || true) | head -n 1 | cut -d '=' -f 2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
    }
    [ -z "$IDENTITY_POSTGRES_USER" ] && IDENTITY_POSTGRES_USER=$(get_env_val "IDENTITY_POSTGRES_USER")
    [ -z "$IDENTITY_POSTGRES_PASSWORD" ] && IDENTITY_POSTGRES_PASSWORD=$(get_env_val "IDENTITY_POSTGRES_PASSWORD")
    [ -z "$IDENTITY_POSTGRES_DB" ] && IDENTITY_POSTGRES_DB=$(get_env_val "IDENTITY_POSTGRES_DB")
    [ -z "$ORG_POSTGRES_DB" ] && ORG_POSTGRES_DB=$(get_env_val "ORG_POSTGRES_DB")
    [ -z "$ORG_POSTGRES_USER" ] && ORG_POSTGRES_USER=$(get_env_val "ORG_POSTGRES_USER")
    [ -z "$ORG_POSTGRES_PASSWORD" ] && ORG_POSTGRES_PASSWORD=$(get_env_val "ORG_POSTGRES_PASSWORD")
    [ -z "$MONGO_INITDB_ROOT_USERNAME" ] && MONGO_INITDB_ROOT_USERNAME=$(get_env_val "MONGO_INITDB_ROOT_USERNAME")
    [ -z "$MONGO_INITDB_ROOT_PASSWORD" ] && MONGO_INITDB_ROOT_PASSWORD=$(get_env_val "MONGO_INITDB_ROOT_PASSWORD")
    [ -z "$CHAT_MONGO_USER" ] && CHAT_MONGO_USER=$(get_env_val "CHAT_MONGO_USER")
    [ -z "$CHAT_MONGO_PASSWORD" ] && CHAT_MONGO_PASSWORD=$(get_env_val "CHAT_MONGO_PASSWORD")
    [ -z "$CHAT_MONGO_AUTH_DB" ] && CHAT_MONGO_AUTH_DB=$(get_env_val "CHAT_MONGO_AUTH_DB")
fi

IDENTITY_POSTGRES_USER="${IDENTITY_POSTGRES_USER:-admin}"
IDENTITY_POSTGRES_PASSWORD="${IDENTITY_POSTGRES_PASSWORD:-admin}"
IDENTITY_POSTGRES_DB="${IDENTITY_POSTGRES_DB:-transdb}"
ORG_POSTGRES_DB="${ORG_POSTGRES_DB:-org_service_db}"
ORG_POSTGRES_USER="${ORG_POSTGRES_USER:-admin}"
ORG_POSTGRES_PASSWORD="${ORG_POSTGRES_PASSWORD:-admin}"

echo "=========================================="
echo " Starting Manual On-Demand Backup"
echo " Timestamp: ${TIMESTAMP}"
echo " Destination: ${BACKUP_DIR}"
echo " Target DBs: PostgreSQL (${IDENTITY_POSTGRES_DB}, ${ORG_POSTGRES_DB}), MongoDB"
echo "=========================================="

PG_FILE="${BACKUP_DIR}/postgres_${TIMESTAMP}.sql.gz"
PG_LATEST="${BACKUP_DIR}/postgres_latest.sql.gz"

ORG_FILE="${BACKUP_DIR}/org_${TIMESTAMP}.sql.gz"
ORG_LATEST="${BACKUP_DIR}/org_latest.sql.gz"

echo "Dumping PostgreSQL ('${IDENTITY_POSTGRES_DB}')..."
docker exec -e PGPASSWORD="${IDENTITY_POSTGRES_PASSWORD}" identity-service_postgres \
    pg_dump -h /var/run/postgresql -U "$IDENTITY_POSTGRES_USER" --clean --if-exists --format=p "$IDENTITY_POSTGRES_DB" | gzip -9 > "$PG_FILE"
echo "  -> Created: ${PG_FILE} ($(du -h "$PG_FILE" | cut -f1))"

echo "Dumping PostgreSQL ('${ORG_POSTGRES_DB}')..."
docker exec -e PGPASSWORD="${ORG_POSTGRES_PASSWORD}" identity-service_postgres \
    pg_dump -h /var/run/postgresql -U "$ORG_POSTGRES_USER" --clean --if-exists --format=p "$ORG_POSTGRES_DB" | gzip -9 > "$ORG_FILE"
echo "  -> Created: ${ORG_FILE} ($(du -h "$ORG_FILE" | cut -f1))"

MONGO_FILE="${BACKUP_DIR}/mongo_${TIMESTAMP}.archive.gz"
MONGO_LATEST="${BACKUP_DIR}/mongo_latest.archive.gz"

echo "Dumping MongoDB ('chatdb')..."
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
docker exec mongodb mongodump "${MONGO_AUTH[@]}" --archive --gzip > "$MONGO_FILE"
echo "  -> Created: ${MONGO_FILE} ($(du -h "$MONGO_FILE" | cut -f1))"

# Update latest copies atomically only when all databases succeed
cp -f "$PG_FILE" "$PG_LATEST"
cp -f "$ORG_FILE" "$ORG_LATEST"
cp -f "$MONGO_FILE" "$MONGO_LATEST"
chmod 644 "$PG_FILE" "$PG_LATEST" "$ORG_FILE" "$ORG_LATEST" "$MONGO_FILE" "$MONGO_LATEST" 2>/dev/null || true

echo "=========================================="
echo " Backup completed successfully!"
echo " Latest files updated in ${BACKUP_DIR}"
echo "=========================================="
