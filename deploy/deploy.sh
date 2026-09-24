#!/usr/bin/env bash
set -eo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
    echo "ERROR: .env file missing in $(pwd)"
    exit 1
fi

CURRENT_UID=$(id -u)
if [ -S "/var/run/user/${CURRENT_UID}/docker.sock" ]; then
    export DOCKER_SOCK="/var/run/user/${CURRENT_UID}/docker.sock"
else
    export DOCKER_SOCK="/var/run/docker.sock"
fi

echo "Starting databases..."
docker compose up -d postgres mongodb

echo "Waiting for databases to be ready..."
for _ in {1..30}; do
    if docker compose ps postgres | grep -q "(healthy)" && docker compose ps mongodb | grep -q "(healthy)"; then
        break
    fi
    sleep 2
done

PG_USER=$(grep -E '^POSTGRES_USER=' .env | cut -d'=' -f2 | tr -d '\r "' || echo "admin")
docker compose exec -T postgres psql -U "${PG_USER:-admin}" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'org_service_db'" 2>/dev/null | grep -q 1 || \
    docker compose exec -T postgres psql -U "${PG_USER:-admin}" -d postgres -c "CREATE DATABASE org_service_db;" 2>/dev/null || true

M_USER=$(grep -E '^CHAT_MONGO_USER=' .env | cut -d'=' -f2 | tr -d '\r "' || echo "rooted")
M_PASS=$(grep -E '^CHAT_MONGO_PASSWORD=' .env | cut -d'=' -f2 | tr -d '\r "' || echo "rooted123")
docker compose exec -T mongodb mongosh admin --eval "
try { db.createUser({ user: '${M_USER}', pwd: '${M_PASS}', roles: [{ role: 'root', db: 'admin' }] }); } catch(e) {}
" 2>/dev/null || true

echo "Building and launching containers..."
if ! docker compose up -d --build --remove-orphans; then
    echo "Deployment failed. Showing container status and logs:"
    docker compose ps -a
    docker compose logs --tail=50
    exit 1
fi

docker image prune -f
sleep 5

echo "Deployment finished. Status:"
docker compose ps
