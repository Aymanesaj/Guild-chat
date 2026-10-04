#!/bin/bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$PROJECT_DIR"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}    ft_transcendence: Live Disaster Recovery Defense  ${NC}"
echo -e "${BLUE}======================================================${NC}"

echo -e "\n${YELLOW}[STEP 1/5] Injecting test records into PostgreSQL (transdb & org_service_db) & MongoDB...${NC}"
POSTGRES_DB="${POSTGRES_DB:-transdb}"
ORG_POSTGRES_DB="${ORG_POSTGRES_DB:-org_service_db}"

docker exec -i postgres sh -c 'psql -h /var/run/postgresql -U "$POSTGRES_USER" -d "'"${POSTGRES_DB}"'" -c "
  CREATE TABLE IF NOT EXISTS defense_recovery_test (id serial PRIMARY KEY, note text, created_at timestamptz DEFAULT now());
  INSERT INTO defense_recovery_test (note) VALUES ('\''Evaluation Defense Live Test Record'\'');
"' > /dev/null

docker exec -i postgres sh -c 'psql -h /var/run/postgresql -U "$POSTGRES_USER" -d "'"${ORG_POSTGRES_DB}"'" -c "
  CREATE TABLE IF NOT EXISTS defense_recovery_org_test (id serial PRIMARY KEY, note text, created_at timestamptz DEFAULT now());
  INSERT INTO defense_recovery_org_test (note) VALUES ('\''Evaluation Defense Org Test Record'\'');
"' > /dev/null

docker exec -i mongodb sh -c 'mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin chatdb --quiet --eval "
  db.messages.insertOne({ content: \"DEFENSE_TEST_CHAT_MESSAGE\", room_id: 9999, created_at: new Date() });
"' > /dev/null

echo -e "${GREEN}✓ Test data created in all three databases.${NC}"

echo -e "\n${YELLOW}[STEP 2/5] Triggering on-demand backup snapshot (make backup)...${NC}"
./databases/backup-recovery/scripts/backup.sh
echo -e "${GREEN}✓ Backup snapshot successfully created.${NC}"

echo -e "\n${RED}[STEP 3/5] Simulating catastrophic disaster (destroying data)...${NC}"
docker exec -i postgres sh -c 'psql -h /var/run/postgresql -U "$POSTGRES_USER" -d "'"${POSTGRES_DB}"'" -c "
  DROP TABLE defense_recovery_test;
"' > /dev/null

docker exec -i postgres sh -c 'psql -h /var/run/postgresql -U "$POSTGRES_USER" -d "'"${ORG_POSTGRES_DB}"'" -c "
  DROP TABLE defense_recovery_org_test;
"' > /dev/null

docker exec -i mongodb sh -c 'mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin chatdb --quiet --eval "
  db.messages.deleteOne({ content: \"DEFENSE_TEST_CHAT_MESSAGE\" });
"' > /dev/null

PG_CHECK=$(docker exec -i postgres sh -c 'psql -h /var/run/postgresql -U "$POSTGRES_USER" -d "'"${POSTGRES_DB}"'" -t -c "
  SELECT to_regclass('\''defense_recovery_test'\'');
"' 2>/dev/null | tr -d '[:space:]')

ORG_CHECK=$(docker exec -i postgres sh -c 'psql -h /var/run/postgresql -U "$POSTGRES_USER" -d "'"${ORG_POSTGRES_DB}"'" -t -c "
  SELECT to_regclass('\''defense_recovery_org_test'\'');
"' 2>/dev/null | tr -d '[:space:]')

MONGO_CHECK=$(docker exec -i mongodb sh -c 'mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin chatdb --quiet --eval "
  print(db.messages.countDocuments({ content: \"DEFENSE_TEST_CHAT_MESSAGE\" }));
"' 2>/dev/null | tr -d '[:space:]')

if [ -z "$PG_CHECK" ] || [ "$PG_CHECK" = "" ]; then
  echo -e "  - PostgreSQL ($POSTGRES_DB): table 'defense_recovery_test' is ${RED}GONE${NC} (Confirmed Data Loss)"
fi
if [ -z "$ORG_CHECK" ] || [ "$ORG_CHECK" = "" ]; then
  echo -e "  - PostgreSQL (${ORG_POSTGRES_DB}): table 'defense_recovery_org_test' is ${RED}GONE${NC} (Confirmed Data Loss)"
fi
if [ "$MONGO_CHECK" = "0" ]; then
  echo -e "  - MongoDB: message 'DEFENSE_TEST_CHAT_MESSAGE' is ${RED}GONE${NC} (Confirmed Data Loss)"
fi

echo -e "\n${YELLOW}[STEP 4/5] Executing Disaster Recovery Restore (make restore)...${NC}"
./databases/backup-recovery/scripts/restore.sh

echo -e "\n${YELLOW}[STEP 5/5] Verifying restored data...${NC}"
PG_RESULT=$(docker exec -i postgres sh -c 'psql -h /var/run/postgresql -U "$POSTGRES_USER" -d "'"${POSTGRES_DB}"'" -t -c "
  SELECT note FROM defense_recovery_test LIMIT 1;
"' 2>/dev/null | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

ORG_RESULT=$(docker exec -i postgres sh -c 'psql -h /var/run/postgresql -U "$POSTGRES_USER" -d "'"${ORG_POSTGRES_DB}"'" -t -c "
  SELECT note FROM defense_recovery_org_test LIMIT 1;
"' 2>/dev/null | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

MONGO_RESULT=$(docker exec -i mongodb sh -c 'mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin chatdb --quiet --eval "
  print(db.messages.countDocuments({ content: \"DEFENSE_TEST_CHAT_MESSAGE\" }));
"' 2>/dev/null | tr -d '[:space:]')

docker exec -i postgres sh -c 'psql -h /var/run/postgresql -U "$POSTGRES_USER" -d "'"${POSTGRES_DB}"'" -c "DROP TABLE IF EXISTS defense_recovery_test;"' > /dev/null 2>&1 || true
docker exec -i postgres sh -c 'psql -h /var/run/postgresql -U "$POSTGRES_USER" -d "'"${ORG_POSTGRES_DB}"'" -c "DROP TABLE IF EXISTS defense_recovery_org_test;"' > /dev/null 2>&1 || true
docker exec -i mongodb sh -c 'mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin chatdb --eval "db.messages.deleteOne({ content: \"DEFENSE_TEST_CHAT_MESSAGE\" });"' > /dev/null 2>&1 || true

if [ "$PG_RESULT" = "Evaluation Defense Live Test Record" ] && [ "$ORG_RESULT" = "Evaluation Defense Org Test Record" ] && [ "$MONGO_RESULT" = "1" ]; then
  echo -e "  - PostgreSQL ($POSTGRES_DB): '${GREEN}$PG_RESULT${NC}' recovered successfully!"
  echo -e "  - PostgreSQL (${ORG_POSTGRES_DB}): '${GREEN}$ORG_RESULT${NC}' recovered successfully!"
  echo -e "  - MongoDB: chat message '${GREEN}DEFENSE_TEST_CHAT_MESSAGE${NC}' recovered successfully!"
  echo -e "\n${GREEN}======================================================${NC}"
  echo -e "${GREEN}  ✓ DISASTER RECOVERY VERIFICATION: 100% PASSED!      ${NC}"
  echo -e "${GREEN}======================================================${NC}"
  exit 0
else
  echo -e "${RED}❌ Verification failed!${NC}"
  exit 1
fi
